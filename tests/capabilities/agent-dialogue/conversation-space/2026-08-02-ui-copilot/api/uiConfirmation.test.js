// REQ-TRACE: 2026-08-02-ui-copilot/REQ-AGENT-030
// REQ-VERSION: v1-hash:8432c0cff25d5ef4a71d5c8fd95b3045977d65430eb968d7063be5fc81d67012
// CAPABILITY-TRACE: agent-dialogue
// ENTITY-TRACE: conversation-space
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true

// seam：UI 空间内联高危确认（tech-design 数据流 F3 + 里程碑 M1「命令保险层分类直桥」）：
//   CLI 高危命令（既有命令保险层 confirm 分类，src/agent/toolAdapter.js TOOL_DEFS riskLevel）
//   在 UI 空间触发 → 授权桥/确认服务创建挂起行（agent_confirmations，SQLite 真相）
//   → SSE 推送 confirmation-pending 事件（含确认 id、操作描述）
//   → 既有端点 POST /api/agent/confirmations/:id/approve|reject（复用，REQ-AGENT-016）
//   → 确认回调驱动同一命令模块执行 → 结果以 agent 消息经 SSE 流式呈现。
// 触发 seam：测试经 server._opcConfirmationServiceFactory 替换为生产等价接线后直接 submit
// （confirmation.test.js 同型）——等价 M1 直桥入队点（worker 工具面 confirm 级命令 → IPC
// confirm-request → 主进程确认服务 submit，src/services/agentService.js confirm-request 案 /
// server.js onConfirmRequest 接线）。SSE 层契约：凡为某 UI 空间新建的挂起行，该空间事件流
// 须发出 confirmation-pending（不依赖特定入队路径）。
// 生产等价接线与 server.js 的差异仅在 sendCard 置 no-op：生产卡片渲染目标为飞书通道（测试
// 环境无通道适配器），确认服务语义明确卡片发送失败不阻断入队；UI 空间确认卡经 SSE
// confirmation-pending 呈现（即本套件断言对象）。
// FAUX provider seam：NODE_ENV=test 时 agentService 自动注入 OPC_AGENT_FAUX=1（零网络）；
// 回投文本 = FAUX 确定性回声（含 notify-result 注入提示词，src/agent/worker.js handleNotifyResult）。

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { startServer, stopServer } from "../../../../../../src/http/server.js";

const JSON_HEADERS = { "Content-Type": "application/json" };

// seam 就绪门：路由文件不存在时给出清晰失败（而非把一切读成 404）。
async function loadSessionsRouteSeam() {
  const mod = await import("../../../../../../src/http/routes/agentSessions.js").catch(() => null);
  assert.ok(mod, "seam 未就绪：src/http/routes/agentSessions.js 尚未实现（REQ-AGENT-030，tech-design 模块表）");
  return mod;
}

// REQ-AGENT-027 契约 seam（本套件 setup）：创建通用 UI 空间。
async function createUiSession(baseUrl) {
  const res = await fetch(`${baseUrl}/api/agent/sessions`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ spaceKind: "general" })
  });
  const body = await res.json().catch(() => ({}));
  assert.equal(
    res.status,
    200,
    `seam 未就绪：POST /api/agent/sessions 应 200（REQ-AGENT-027 标准 1，本套件 setup 依赖），实际 ${res.status}：${JSON.stringify(body)}`
  );
  return body.spaceKey;
}

// agent 配置注入（生产等价：设置页保存 provider+key；FAUX 模式 key 不触网）。
async function configureAgent() {
  const settingsMod = await import("../../../../../../src/services/settingsService.js");
  settingsMod.saveAgentConfig({ provider: "deepseek", apiKey: "sk-test-faux" });
}

// 确认服务生产等价接线（confirmation.test.js 同型 seam：替换 server 惰性工厂，ADR-009）。
// execute / notifyResult 与 server.js 生产接线一致（真命令模块执行 / 真 agentService 回投）；
// sendCard 置 no-op（见文件头注释）。executions 记录执行调用（拒绝/幂等断言用）。
async function installConfirmationService(serverCtx) {
  const { createConfirmationService } = await import("../../../../../../src/services/confirmationService.js");
  const { executeToolCommand } = await import("../../../../../../src/agent/toolAdapter.js");
  const settingsMod = await import("../../../../../../src/services/settingsService.js");
  const executions = [];
  const svc = createConfirmationService({
    // 挂起队列与 agent_sessions 同库（tech-design 模块图：SQLite 为真相）。
    dbPath: path.join(settingsMod.configDir(), "agent-sessions.db"),
    execute: async (command, args) => {
      executions.push({ command, args });
      return executeToolCommand(command, args, { baseUrl: serverCtx.baseUrl });
    },
    notifyResult: async ({ sessionKey, result }) => {
      // 生产等价：server.js notifyResult → getAgentService().notifyResult（惰性创建后
      // 句柄挂在 server._opcAgentService）；会话句柄不存在时 notifyResult 自身跳过。
      const agentSvc = serverCtx.server._opcAgentService;
      if (agentSvc) await agentSvc.notifyResult(sessionKey, result);
    },
    sendCard: async () => {}
  });
  serverCtx.server._opcConfirmationServiceFactory = () => svc;
  return { svc, executions };
}

// M1 直桥入队点（见文件头注释）：UI 空间 sessionKey 承载空间归属。
function submitUiConfirmation(svc, spaceKey, { command, args }) {
  const confirmId = crypto.randomUUID();
  const result = svc.submit({ confirmId, sessionKey: spaceKey, command, args, riskLevel: "confirm" });
  assert.equal(result.status, "pending", "setup：确认请求应入队 pending");
  return confirmId;
}

async function postConfirmAction(baseUrl, confirmId, action) {
  const res = await fetch(`${baseUrl}/api/agent/confirmations/${confirmId}/${action}`, { method: "POST" });
  const body = await res.json().catch(() => ({}));
  return { res, body };
}

// 发送消息（会话句柄物化手段；202 契约本身由 sessionMessage.test.js 覆盖）。
// agentService 会话句柄在首条消息时创建（F1），是 notify-result 回投的前提
// （src/services/agentService.js notifyResult 要求 sessions.has(sessionKey)）。
async function postMessage(baseUrl, spaceKey, text) {
  const res = await fetch(`${baseUrl}/api/agent/sessions/${spaceKey}/messages`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ text })
  });
  const body = await res.json().catch(() => ({}));
  assert.equal(res.status, 202, `setup：发送消息应 202，实际 ${res.status}：${JSON.stringify(body)}`);
  return body;
}

function eventsUrl(baseUrl, spaceKey) {
  return `${baseUrl}/api/agent/sessions/${spaceKey}/events`;
}

// —— SSE 客户端（与 sessionEvents.test.js 同型）——
// 传输方式选型：Node 18+ 全局 fetch + Web ReadableStream 读流（EventSource 在 Node 运行时
// 非内置，不引入依赖）。协议解析：帧以 \n\n 分隔；data: 行拼接为载荷（心跳/注释帧跳过）。
function createSseStream(res) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const frames = [];
  const waiters = [];
  let buffer = "";
  let failure = null;
  const deliver = (frame) => {
    const w = waiters.shift();
    if (w) w.resolve(frame);
    else frames.push(frame);
  };
  const pump = (async () => {
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let sep;
        while ((sep = buffer.indexOf("\n\n")) >= 0) {
          const rawFrame = buffer.slice(0, sep);
          buffer = buffer.slice(sep + 2);
          const data = rawFrame
            .split("\n")
            .filter((l) => l.startsWith("data:"))
            .map((l) => l.slice(5).replace(/^ /, ""))
            .join("\n");
          if (data === "") continue; // 心跳/注释帧
          let event;
          try {
            event = JSON.parse(data);
          } catch {
            event = { type: "__unparsed__", raw: data };
          }
          deliver({ event, rawBytes: Buffer.byteLength(data) });
        }
      }
    } catch (err) {
      failure = err;
    } finally {
      while (waiters.length > 0) waiters.shift().reject(failure ?? new Error("SSE 流已结束"));
    }
  })();
  return {
    next(timeoutMs, label) {
      if (frames.length > 0) return Promise.resolve(frames.shift());
      return new Promise((resolve, reject) => {
        const waiter = {
          resolve: (f) => { clearTimeout(timer); resolve(f); },
          reject: (e) => { clearTimeout(timer); reject(e); }
        };
        const timer = setTimeout(() => {
          const i = waiters.indexOf(waiter);
          if (i >= 0) waiters.splice(i, 1);
          reject(new Error(`等待 SSE 事件超时（${timeoutMs}ms）：${label}`));
        }, timeoutMs);
        waiters.push(waiter);
      });
    },
    async waitForType(type, timeoutMs = 30000, label = type) {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const frame = await this.next(Math.max(1, deadline - Date.now()), label);
        if (frame.event?.type === type) return frame;
      }
    },
    async close() {
      try { await reader.cancel(); } catch { /* 忽略断开异常 */ }
      try { await pump; } catch { /* 忽略断开异常 */ }
    }
  };
}

describe("REQ-AGENT-030 内联高危确认卡（UI 空间，标准 1/3/4/5）", () => {
  let serverCtx;
  let sseClients;
  let svc;
  let executions;

  async function openSse(spaceKey) {
    const res = await fetch(eventsUrl(serverCtx.baseUrl, spaceKey));
    assert.equal(res.status, 200, `seam 未就绪或端点异常：GET .../events 应 200，实际 ${res.status}`);
    assert.match(res.headers.get("content-type") ?? "", /text\/event-stream/, "SSE Content-Type 应为 text/event-stream");
    const client = createSseStream(res);
    sseClients.push(client);
    return client;
  }

  beforeEach(async () => {
    serverCtx = await startServer();
    await configureAgent();
    ({ svc, executions } = await installConfirmationService(serverCtx));
    sseClients = [];
  });

  afterEach(async () => {
    // 先收 SSE 连接再停 server：打开的流式响应会阻塞 server.close()。
    for (const c of sseClients) await c.close();
    await stopServer(serverCtx);
  });

  it("UI 空间触发 CLI 高危命令后创建挂起确认行并推送 SSE confirmation-pending 事件", async () => {
    await loadSessionsRouteSeam();
    const spaceKey = await createUiSession(serverCtx.baseUrl);
    const sse = await openSse(spaceKey);
    await postMessage(serverCtx.baseUrl, spaceKey, "帮我删掉那个旧流程");
    await sse.waitForType("text_end", 30000, "首条消息流式完成（会话句柄物化）");

    const confirmId = submitUiConfirmation(svc, spaceKey, { command: "flow delete", args: { id: "flow_old" } });

    const row = svc.get(confirmId);
    assert.equal(row.status, "pending", "挂起确认行应创建为 pending（agent_confirmations，SQLite 真相）");
    assert.equal(row.sessionKey, spaceKey, "确认行应记录来源 UI 空间（spaceKey）");
    assert.equal(row.command, "flow delete", "确认行应记录高危命令（既有命令保险层 confirm 分类）");

    const frame = await sse.waitForType("confirmation-pending", 30000, "confirmation-pending 事件");
    const payload = JSON.stringify(frame.event);
    assert.ok(payload.includes(confirmId), "confirmation-pending 事件应含确认 id（REQ-AGENT-030 标准 1）");
    assert.ok(payload.includes("flow delete"), "confirmation-pending 事件应含操作描述（REQ-AGENT-030 标准 1）");
    // signoff 2026-08-06: assertion signed（裁决见 signoff.md）
  });

  it("approve 后执行结果以 agent 消息经 SSE 流式呈现", async () => {
    await loadSessionsRouteSeam();
    const spaceKey = await createUiSession(serverCtx.baseUrl);
    const sse = await openSse(spaceKey);
    await postMessage(serverCtx.baseUrl, spaceKey, "把主题切到暗色");
    await sse.waitForType("text_end", 30000, "首条消息流式完成");
    // settings set 为既有命令保险层 confirm 级（TOOL_DEFS），执行确定性成功（临时 settings 隔离）。
    const confirmId = submitUiConfirmation(svc, spaceKey, { command: "settings set", args: { theme: "dark" } });
    await sse.waitForType("confirmation-pending", 30000, "confirmation-pending 事件");

    const { res, body } = await postConfirmAction(serverCtx.baseUrl, confirmId, "approve");

    assert.equal(res.status, 200, `approve 端点应 200（既有端点复用），实际 ${res.status}：${JSON.stringify(body)}`);
    assert.equal(body.status, "approved", "确认状态应转 approved");
    assert.equal(body.executed, true, "approve 应驱动同一命令模块执行（不经过 agent turn，解耦执行）");
    assert.deepEqual(executions, [{ command: "settings set", args: { theme: "dark" } }], "应执行同一命令模块一次");

    const frame = await sse.waitForType("text_end", 30000, "approve 后 agent 回投 text_end");
    assert.ok(
      typeof frame.event.content === "string" && frame.event.content.includes("执行结果已就绪"),
      `执行结果应以 agent 消息经 SSE 呈现（FAUX 确定性回声含 notify-result 注入文本），实际: ${String(frame.event.content).slice(0, 120)}`
    );
    // signoff 2026-08-06: assertion signed（裁决见 signoff.md）
  });

  it("reject 后不执行并以 agent 消息告知已取消", async () => {
    await loadSessionsRouteSeam();
    const spaceKey = await createUiSession(serverCtx.baseUrl);
    const sse = await openSse(spaceKey);
    await postMessage(serverCtx.baseUrl, spaceKey, "帮我删掉那个旧流程");
    await sse.waitForType("text_end", 30000, "首条消息流式完成");
    const confirmId = submitUiConfirmation(svc, spaceKey, { command: "flow delete", args: { id: "flow_old" } });
    await sse.waitForType("confirmation-pending", 30000, "confirmation-pending 事件");

    const { res, body } = await postConfirmAction(serverCtx.baseUrl, confirmId, "reject");

    assert.equal(res.status, 200, `reject 端点应 200（既有端点复用），实际 ${res.status}：${JSON.stringify(body)}`);
    assert.equal(body.status, "rejected", "确认状态应转 rejected");
    assert.equal(body.executed, false, "reject 不应执行");
    assert.equal(executions.length, 0, "reject 后不应驱动任何命令执行");
    assert.equal(svc.get(confirmId).status, "rejected", "挂起行状态应为 rejected（SQLite 真相）");

    const frame = await sse.waitForType("text_end", 30000, "reject 后 agent 告知 text_end");
    assert.ok(
      typeof frame.event.content === "string" && frame.event.content.includes("操作已取消"),
      `应以 agent 消息告知已取消（FAUX 回声含 cancel 注入文本），实际: ${String(frame.event.content).slice(0, 120)}`
    );
    // signoff 2026-08-06: assertion signed（裁决见 signoff.md）
  });

  it("暂不处理的挂起确认稍后 approve 仍有效（确认与执行解耦）", async () => {
    // 队列级解耦断言：不依赖 SSE 连接与 agent 会话（挂起队列 = SQLite 真相，
    // REQ-AGENT-030 标准 3 后半句）；「卡片保留在历史中」为渲染层行为，E2E 覆盖
    // （assistantConfirm.test.cjs，标准 3 前半句）。
    const confirmId = submitUiConfirmation(svc, "ui:copilot:defer-1", { command: "settings set", args: { theme: "dark" } });

    const listRes = await fetch(`${serverCtx.baseUrl}/api/agent/confirmations`);
    const list = await listRes.json();
    assert.ok(
      list.pending.some((p) => p.confirmId === confirmId && p.sessionKey === "ui:copilot:defer-1"),
      "暂不处理的挂起项应在队列中保留可见（GET /api/agent/confirmations）"
    );
    assert.equal(executions.length, 0, "未裁决前不应执行");

    await new Promise((r) => setTimeout(r, 200)); // 稍后（挂起与回调时机解耦）
    const { res, body } = await postConfirmAction(serverCtx.baseUrl, confirmId, "approve");

    assert.equal(res.status, 200, `稍后 approve 端点仍应受理，实际 ${res.status}`);
    assert.equal(body.status, "approved", "稍后 approve 仍应生效");
    assert.equal(body.executed, true, "稍后 approve 仍应驱动执行（确认与执行解耦）");
    assert.equal(executions.length, 1, "挂起项应仅执行一次");
  });

  it("重复 approve 回调幂等返回已处理且不重复执行", async () => {
    const confirmId = submitUiConfirmation(svc, "ui:copilot:idem-1", { command: "settings set", args: { theme: "dark" } });
    const first = await postConfirmAction(serverCtx.baseUrl, confirmId, "approve");
    assert.equal(first.body.status, "approved", "setup：首次 approve 应生效");
    assert.equal(first.body.executed, true, "setup：首次 approve 应执行");

    const { res, body } = await postConfirmAction(serverCtx.baseUrl, confirmId, "approve"); // 重复回调

    assert.equal(res.status, 200, `重复回调端点仍应 200（幂等受理），实际 ${res.status}`);
    assert.equal(body.status, "approved", "重复回调应报告已处理状态（REQ-AGENT-030 标准 4）");
    assert.equal(body.executed, false, "重复回调不应重复执行（既有幂等语义回归，REQ-AGENT-016 标准 4）");
    assert.equal(executions.length, 1, "同一 confirmId 应只执行一次");
    // signoff 2026-08-06: assertion signed（裁决见 signoff.md）
  });

  it("UI 空间与飞书空间确认项同队列共存且状态机互不干扰", async () => {
    // 飞书路径回归（REQ-AGENT-030 标准 5）：同一挂起队列（agent_confirmations），
    // 飞书全链由既有 confirmation.test.js 套件覆盖（不重复），此处仅断言跨空间共存语义。
    const uiConfirmId = submitUiConfirmation(svc, "ui:copilot:coexist-1", { command: "settings set", args: { theme: "dark" } });
    const feishuConfirmId = submitUiConfirmation(svc, "feishu:oc_coexist_1", { command: "flow delete", args: { id: "flow_x" } });

    const listRes = await fetch(`${serverCtx.baseUrl}/api/agent/confirmations`);
    const list = await listRes.json();
    const pendingIds = list.pending.map((p) => p.confirmId);
    assert.ok(pendingIds.includes(uiConfirmId), "UI 空间确认项应在挂起队列");
    assert.ok(pendingIds.includes(feishuConfirmId), "飞书空间确认项应在同一挂起队列（共存）");

    const { body } = await postConfirmAction(serverCtx.baseUrl, uiConfirmId, "approve");
    assert.equal(body.status, "approved", "UI 空间确认项可独立裁决");
    assert.equal(svc.get(feishuConfirmId).status, "pending", "UI 空间裁决不应影响飞书空间挂起项（状态机互不干扰）");
  });
});
