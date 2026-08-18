// src/services/permissionAdjudicator.js
// 权限裁决器领域工厂（2026-08-16-deepen-permission-adjudication，ADR-032）。
//
// 职责：
// - Per-Instance 领域实例：所有内存决议 Promise（pendingDecisions）与标记（notifySettleFlags）
//   封闭在实例闭包内，模块级零全局 Map，保证并发测试与多实例互不污染；
// - 唯一执行者不变量（BUG-001）：授权桥行（riskLevel="permission" 或 notifyOnSettle=false）
//   的 approve 仅更新 DB 状态并向 Worker 发送 allow 决策，主进程 100% 跳过 execute；
// - 内存 Promise 注册表即时唤醒：waitForDecision 通过内存 Promise 即时响应 approve/reject，
//   彻底消灭 20ms 定时器轮询；
// - 空间分流与向后兼容：ui:* 空间发 SSE confirmation-pending，feishu:* 发卡片。

import { getDb, defaultDbPath } from "../db.js";
import { publish } from "./eventBus.js";

function nowIso() {
  return new Date().toISOString();
}

function isUiSpaceKey(sessionKey) {
  return String(sessionKey ?? "").startsWith("ui:");
}

function buildPendingDescription(req) {
  const argsText = JSON.stringify(req.args ?? {});
  return argsText === "{}" ? `${req.command}` : `${req.command}（参数：${argsText}）`;
}

function publishPending(req) {
  publish("confirmation-pending", {
    sessionKey: req.sessionKey,
    confirmId: req.confirmId,
    operation: req.command,
    description: buildPendingDescription(req),
  });
}

function pendingReply(req) {
  return `操作待确认（${req.riskLevel ?? "confirm"}）：${req.command}，请在确认卡片中完成确认（E-CONFIRM-PENDING）`;
}

function settledReply(status) {
  return status === "approved" ? "操作已确认并执行" : status === "rejected" ? "操作已取消" : `操作已处理（${status}）`;
}

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

export function createPermissionAdjudicator({
  dbPath,
  execute,
  notifyResult,
  sendCard,
  defaultTimeoutMs,
} = {}) {
  const storePath = dbPath ?? defaultDbPath();
  const db = () => getDb(storePath);

  // Per-Instance 内存注册表
  const pendingDecisions = new Map(); // confirmId -> { resolve, timer }
  const notifySettleFlags = new Map(); // confirmId -> boolean

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
      // 兼容下划线字段名
      confirm_id: row.confirmId,
      session_key: row.sessionKey,
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

  function claimPending(confirmId, status) {
    const row = getRow(confirmId);
    if (!row || row.status !== "pending") {
      return { ok: false, status: row?.status ?? "not-found", row };
    }
    setStatus(confirmId, status);
    return { ok: true, row };
  }

  async function notifyIfPresent(payload, confirmId) {
    if (notifySettleFlags.get(confirmId) === false) {
      notifySettleFlags.delete(confirmId);
      return;
    }
    if (typeof notifyResult !== "function") return;
    try {
      await notifyResult(payload);
    } catch {
      // 忽略
    }
  }

  function cleanupDecision(confirmId) {
    const entry = pendingDecisions.get(confirmId);
    if (entry) {
      if (entry.timer) clearTimeout(entry.timer);
      pendingDecisions.delete(confirmId);
    }
    notifySettleFlags.delete(confirmId);
  }

  function waitForDecision(confirmId) {
    const row = getRow(confirmId);
    if (row && row.status === "approved") {
      return Promise.resolve({ kind: "allow" });
    }
    if (row && row.status === "rejected") {
      return Promise.resolve({ kind: "deny", reason: "操作已取消（用户拒绝）" });
    }

    return new Promise((resolve) => {
      const existing = pendingDecisions.get(confirmId);
      if (existing) {
        // 若已存在，包裹链式调用
        const oldResolve = existing.resolve;
        existing.resolve = (decision) => {
          oldResolve(decision);
          resolve(decision);
        };
        return;
      }

      let timer = null;
      if (defaultTimeoutMs && defaultTimeoutMs > 0) {
        timer = setTimeout(() => {
          cleanupDecision(confirmId);
          resolve({ kind: "deny", reason: "操作确认超时已自动拒绝" });
        }, defaultTimeoutMs);
        timer.unref?.();
      }

      pendingDecisions.set(confirmId, { resolve, timer });
    });
  }

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

    if (req.notifyOnSettle === false) {
      notifySettleFlags.set(req.confirmId, false);
    }

    if (isUiSpaceKey(req.sessionKey)) {
      publishPending(req);
    } else if (typeof sendCard === "function") {
      try {
        sendCard({ chatId: String(req.sessionKey ?? "").replace(/^feishu:/, ""), cardJson: buildConfirmationCard(req) });
      } catch (err) {
        console.error(`[confirmation] 确认卡片发送失败 confirmId=${req.confirmId}: ${err?.message ?? String(err)}`);
      }
    }
    return { status: "pending", replyText: pendingReply(req) };
  }

  async function approve(confirmId) {
    let claim;
    try {
      claim = claimPending(confirmId, "approved");
    } catch (err) {
      return { success: false, status: "error", error: err?.message };
    }

    const pending = pendingDecisions.get(confirmId);
    if (pending) {
      pending.resolve({ kind: "allow" });
    }
    cleanupDecision(confirmId);

    if (!claim.ok) {
      return { success: true, status: claim.status, executed: false };
    }

    const { row } = claim;
    const isBridgeRow = row.riskLevel === "permission" || notifySettleFlags.get(confirmId) === false;
    let result;
    if (!isBridgeRow && typeof execute === "function") {
      try {
        result = await execute(row.command, rowToConfirmation(row).args);
      } catch (err) {
        result = {
          error: true,
          errorCode: err?.code ?? "E-AGENT-CLI-ERROR",
          errorMessage: err?.message ?? String(err),
        };
      }
      await notifyIfPresent({
        sessionKey: row.sessionKey,
        confirmId,
        decision: "approved",
        command: row.command,
        result,
      }, confirmId);
    }

    return { success: true, status: "approved", executed: !isBridgeRow && typeof execute === "function", result };
  }

  async function reject(confirmId, reason) {
    let claim;
    try {
      claim = claimPending(confirmId, "rejected");
    } catch (err) {
      return { success: false, status: "error", error: err?.message };
    }

    const denyReason = reason || "操作已取消（用户拒绝）";
    const pending = pendingDecisions.get(confirmId);
    if (pending) {
      pending.resolve({ kind: "deny", reason: denyReason });
    }
    cleanupDecision(confirmId);

    if (!claim.ok) {
      return { success: true, status: claim.status, executed: false };
    }

    const { row } = claim;
    const isBridgeRow = row.riskLevel === "permission" || notifySettleFlags.get(confirmId) === false;
    if (!isBridgeRow) {
      await notifyIfPresent({
        sessionKey: row.sessionKey,
        confirmId,
        decision: "rejected",
        command: row.command,
        reason: denyReason,
      }, confirmId);
    }

    return { success: true, status: "rejected", executed: false };
  }

  function get(confirmId) {
    return rowToConfirmation(getRow(confirmId));
  }

  function listPending(sessionKey) {
    const rows = sessionKey
      ? db().prepare("SELECT * FROM agent_confirmations WHERE status = 'pending' AND sessionKey = ? ORDER BY createdAt ASC").all(sessionKey)
      : db().prepare("SELECT * FROM agent_confirmations WHERE status = 'pending' ORDER BY createdAt ASC").all();
    return rows.map(rowToConfirmation);
  }

  return {
    submit,
    approve,
    reject,
    get,
    listPending,
    waitForDecision,
  };
}
