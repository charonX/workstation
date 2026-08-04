// src/services/confirmationService.js
// 确认服务（tech-design「确认服务（b 解耦）」；REQ-AGENT-016 高危确认挂起与解耦执行）。
//
// 职责：
// - 挂起队列 = SQLite agent_confirmations 表（**真相**，重启后 pending 项仍可确认/
//   拒绝——「稍后处理」语义，签核决策 18 / REQ-AGENT-016 标准 5）；
// - confirm 级命令被工具适配器拦截 → submit 入队（pending）+ 发确认卡片（含命令摘要
//   与确认/拒绝按钮，按钮 value 携带 confirmId）→ agent 回复「操作待确认」并结束该轮；
// - 确认回调（approve/reject）驱动执行：approve → **确认服务直接执行同一命令模块**
//   （execute 注入，C2 路径——不经过 agent turn）→ 结果经 notifyResult 注入 agent
//   会话 → agent 生成自然语言回投（W-2）；reject → 不执行 + 回投「已取消」；
// - confirmId 幂等（REQ-AGENT-016 标准 4）：同一确认回调只执行一次，重复回调忽略。
//
// 接口：createConfirmationService({ dbPath, execute, notifyResult, sendCard }) →
// { submit(req) → {status, replyText}, approve(confirmId), reject(confirmId),
//   get(confirmId), listPending() }。
// req = { confirmId, sessionKey, command, args, riskLevel }（tech-design IPC
// confirm-request 内容）；execute/notifyResult/sendCard 均可选注入（缺省时对应
// 步骤为 no-op——业务测试按需注入，生产接线见 server.js）。
//
// ADR-009：惰性初始化——模块级无副作用；数据库连接经 getDb() 按路径缓存。

import { getDb, defaultDbPath } from "../db.js";

// agent 该轮结束的待确认回复（REQ-AGENT-016 标准 1：回复「操作待确认」）。
function pendingReply(req) {
  return `操作待确认（${req.riskLevel ?? "confirm"}）：${req.command}，请在确认卡片中完成确认（E-CONFIRM-PENDING）`;
}

// 已处理回执（重复 submit 同一 confirmId / 非 pending 状态查询用）。
function settledReply(status) {
  return status === "approved" ? "操作已确认并执行" : status === "rejected" ? "操作已取消" : `操作已处理（${status}）`;
}

// 确认卡片（REQ-AGENT-016 标准 1：含命令摘要与确认/拒绝按钮）。按钮 value 携带
// confirmId + decision——飞书卡片动作回调（WS 事件 → HTTP 端点）按 value 分发到
// approve/reject（卡片动作桥接属通道集成，QA/REFLECT 验收）。
function buildConfirmationCard(req) {
  return {
    schema: "2.0",
    config: { streaming_mode: false },
    body: {
      elements: [
        {
          tag: "markdown",
          id: "summary",
          content: `【操作确认】${req.command}\n参数：${JSON.stringify(req.args ?? {})}\n\n请确认是否执行该操作（E-CONFIRM-PENDING）`,
        },
        {
          tag: "action",
          actions: [
            {
              tag: "button",
              text: { tag: "plain_text", content: "确认" },
              value: JSON.stringify({ confirmId: req.confirmId, decision: "approve" }),
            },
            {
              tag: "button",
              text: { tag: "plain_text", content: "拒绝" },
              value: JSON.stringify({ confirmId: req.confirmId, decision: "reject" }),
            },
          ],
        },
      ],
    },
  };
}

function nowIso() {
  return new Date().toISOString();
}

export function createConfirmationService({ dbPath, execute, notifyResult, sendCard } = {}) {
  // 数据库连接按路径每次操作时获取（getDb 单连接缓存，路径一致时零开销）：
  // 全局 getDb() 单连接按路径切换——其他服务（taskService 等走 data.db）切换会
  // 关闭本库连接，捕获引用会在切换后失效。按操作重新获取保证确认回调（卡片点击
  // → approve/reject）在任意服务切换后仍可用（与 sessionStore 同模式）。
  const storePath = dbPath ?? defaultDbPath();
  const db = () => getDb(storePath);

  function rowToConfirmation(row) {
    if (!row) return undefined;
    let args;
    try {
      args = JSON.parse(row.args || "{}");
    } catch {
      args = {};
    }
    return {
      confirmId: row.confirmId,
      sessionKey: row.sessionKey,
      command: row.command,
      args,
      riskLevel: row.riskLevel,
      status: row.status,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  function getRow(confirmId) {
    return db().prepare("SELECT * FROM agent_confirmations WHERE confirmId = ?").get(confirmId);
  }

  function setStatus(confirmId, status) {
    db().prepare("UPDATE agent_confirmations SET status = ?, updatedAt = ? WHERE confirmId = ?").run(
      status,
      nowIso(),
      confirmId
    );
  }

  // 入队（pending）+ 确认卡片（REQ-AGENT-016 标准 1）。同步完成（better-sqlite3）：
  // submit 立即返回 { status, replyText }，agent 该轮据此回复「操作待确认」。
  // sendCard 为 fire-and-forget（卡片发送失败不阻断入队——操作仍挂起，可稍后处理）。
  // confirmId 幂等：重复 submit 同一 confirmId → 返回既有状态，不重复入队/发卡。
  function submit(req) {
    if (!req || typeof req.confirmId !== "string" || req.confirmId === "") {
      throw Object.assign(new Error("E-CONFIRM-INVALID: confirmId 必填"), { code: "E-CONFIRM-INVALID" });
    }
    const existing = getRow(req.confirmId);
    if (existing) {
      return { status: existing.status, replyText: settledReply(existing.status) };
    }
    const ts = nowIso();
    db().prepare(
      `INSERT INTO agent_confirmations (confirmId, sessionKey, command, args, riskLevel, status, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)`
    ).run(req.confirmId, req.sessionKey ?? "", req.command ?? "", JSON.stringify(req.args ?? {}), req.riskLevel ?? "confirm", ts, ts);
    if (typeof sendCard === "function") {
      try {
        sendCard({ chatId: String(req.sessionKey ?? "").replace(/^feishu:/, ""), cardJson: buildConfirmationCard(req) });
      } catch (err) {
        // 卡片发送失败 → 告警不阻断（操作仍挂起可确认；E-CHANNEL-SEND 语义由通道层兜底）。
        console.error(`[confirmation] 确认卡片发送失败 confirmId=${req.confirmId}: ${err?.message ?? String(err)}`);
      }
    }
    return { status: "pending", replyText: pendingReply(req) };
  }

  // 确认回调 → 驱动同一命令模块执行（不经过 agent turn，REQ-AGENT-016 标准 2）：
  // - 非 pending（已处理/不存在）→ 幂等忽略（标准 4：同一回调只执行一次）；
  // - 执行结果经 notifyResult 注入会话（W-2：agent 生成自然语言回投）。
  async function approve(confirmId) {
    const row = getRow(confirmId);
    if (!row || row.status !== "pending") {
      return { status: row?.status ?? "not-found", executed: false };
    }
    setStatus(confirmId, "approved");
    let result;
    if (typeof execute === "function") {
      try {
        // args 回读为对象（agent_confirmations.args 存 JSON；执行层契约 = 对象，
        // 与工具路径 LLM 参数同形态）。
        result = await execute(row.command, rowToConfirmation(row).args);
      } catch (err) {
        // E-AGENT-CLI-ERROR：执行失败仍回投（错误结果 → agent 向用户说明）。
        result = {
          error: true,
          errorCode: err?.code ?? "E-AGENT-CLI-ERROR",
          errorMessage: err?.message ?? String(err),
        };
      }
    }
    if (typeof notifyResult === "function") {
      try {
        await notifyResult({ sessionKey: row.sessionKey, result });
      } catch {
        // 回投失败不阻断确认本身（会话侧自行处理）。
      }
    }
    return { status: "approved", executed: true, result };
  }

  // 拒绝 → 不执行 + 回投「已取消」（REQ-AGENT-016 标准 3）。
  async function reject(confirmId) {
    const row = getRow(confirmId);
    if (!row || row.status !== "pending") {
      return { status: row?.status ?? "not-found", executed: false };
    }
    setStatus(confirmId, "rejected");
    if (typeof notifyResult === "function") {
      try {
        await notifyResult({
          sessionKey: row.sessionKey,
          result: { cancelled: true, message: "操作已取消", command: row.command },
        });
      } catch {
        // 回投失败不阻断（会话侧自行处理）。
      }
    }
    return { status: "rejected", executed: false };
  }

  function get(confirmId) {
    return rowToConfirmation(getRow(confirmId));
  }

  function listPending() {
    return db()
      .prepare("SELECT * FROM agent_confirmations WHERE status = 'pending' ORDER BY createdAt")
      .all()
      .map(rowToConfirmation);
  }

  return { submit, approve, reject, get, listPending };
}
