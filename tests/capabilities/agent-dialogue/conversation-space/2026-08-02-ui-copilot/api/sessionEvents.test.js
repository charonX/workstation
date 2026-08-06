// REQ-TRACE: 2026-08-02-ui-copilot/REQ-AGENT-028
// REQ-VERSION: v1-hash:8432c0cff25d5ef4a71d5c8fd95b3045977d65430eb968d7063be5fc81d67012
// CAPABILITY-TRACE: agent-dialogue
// ENTITY-TRACE: conversation-space
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true

// seam：SSE 事件流端点（tech-design 接口契约表 + 数据流 F2，D4 流式 = SSE）：
//   GET /api/agent/sessions/:spaceKey/events → text/event-stream
//   事件 = agentService session-event 原样（≤256KB 契约沿用）+ confirmation-pending（REQ-AGENT-030）。
// 新路由落点 src/http/routes/agentSessions.js（server.js handleRequest 挂接，tech-design 模块表）。
// FAUX provider seam：NODE_ENV=test 时 agentService 自动注入 OPC_AGENT_FAUX=1（零网络，
// src/services/agentService.js spawnChild）；OPC_AGENT_FAUX_TPS 可调流式速率（本套件默认即可，
// 确定性回声 = 上下文序列化回传，src/agent/worker.js fauxEchoFor）。
// setup 依赖契约 seam：POST /api/agent/sessions（REQ-AGENT-027）+ POST .../messages（REQ-AGENT-028
// 标准 1，sessionMessage.test.js 覆盖其契约，此处仅作流式触发手段）。
//
// confirmation-pending 事件类型（REQ-AGENT-028 标准 2 后半句）不在本套件断言：
// 其结构断言与触发全链由 uiConfirmation.test.js（REQ-AGENT-030 标准 1）覆盖，此处仅注释预留。

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { startServer, stopServer } from "../../../../../../src/http/server.js";

const JSON_HEADERS = { "Content-Type": "application/json" };
const SSE_FRAME_LIMIT = 256 * 1024; // enforceSizeLimit 契约（MAX_IPC_BYTES，src/services/agentService.js）

// seam 就绪门：路由文件不存在时给出清晰失败（而非把一切读成 404）。
async function loadSessionsRouteSeam() {
  const mod = await import("../../../../../../src/http/routes/agentSessions.js").catch(() => null);
  assert.ok(mod, "seam 未就绪：src/http/routes/agentSessions.js 尚未实现（REQ-AGENT-028，tech-design 模块表）");
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

// 发送消息（流式触发手段；202 契约本身由 sessionMessage.test.js 覆盖）。
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

// —— SSE 客户端 ——
// 传输方式选型：Node 18+ 全局 fetch + Web ReadableStream 读流（本项目 Node ≥18，
// confirmation.test.js 已用全局 fetch；EventSource 在 Node 运行时非内置，不引入依赖）。
// 协议解析：帧以 \n\n 分隔；data: 行拼接为载荷（心跳/注释帧跳过）；载荷为 JSON
// （session-event 原样 + confirmation-pending）。
function createSseStream(res) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const frames = []; // 已到达未消费帧 { event, rawBytes }
  const waiters = []; // 等待下一帧的 { resolve, reject }
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
    // 取下一帧（带超时；超时即测试失败——流式事件必须到达）。
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
    // 向前扫描直至指定类型事件到达（跳过其他类型帧）。
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

describe("REQ-AGENT-028 SSE 事件流（GET .../events，标准 2/5/6）", () => {
  let serverCtx;
  let sseClients;

  async function openSse(spaceKey) {
    const url = eventsUrl(serverCtx.baseUrl, spaceKey);
    const res = await fetch(url);
    assert.equal(
      res.status,
      200,
      `seam 未就绪或端点异常：GET .../events 应 200，实际 ${res.status}（REQ-AGENT-028 标准 2）`
    );
    assert.match(
      res.headers.get("content-type") ?? "",
      /text\/event-stream/,
      `SSE 端点 Content-Type 应为 text/event-stream，实际 ${res.headers.get("content-type")}`
    );
    const client = createSseStream(res);
    sseClients.push(client);
    return client;
  }

  beforeEach(async () => {
    serverCtx = await startServer();
    await configureAgent();
    sseClients = [];
  });

  afterEach(async () => {
    // 先收 SSE 连接再停 server：打开的流式响应会阻塞 server.close()。
    for (const c of sseClients) await c.close();
    await stopServer(serverCtx);
  });

  it("GET events 端点返回 text/event-stream", async () => {
    await loadSessionsRouteSeam();
    const spaceKey = await createUiSession(serverCtx.baseUrl);

    const sse = await openSse(spaceKey); // 200 + Content-Type 由 openSse 断言

    await sse.close();
  });

  it("FAUX 流式：text_start → text_delta×N → text_end 按序推送且增量拼接与最终内容一致", async () => {
    await loadSessionsRouteSeam();
    const spaceKey = await createUiSession(serverCtx.baseUrl);
    const sse = await openSse(spaceKey);

    await postMessage(serverCtx.baseUrl, spaceKey, "给我讲讲这个应用");

    const textEvents = [];
    for (;;) {
      const frame = await sse.next(30000, "text_end 到达");
      if (["text_start", "text_delta", "text_end"].includes(frame.event?.type)) textEvents.push(frame.event);
      if (frame.event?.type === "text_end") break;
    }
    assert.ok(
      textEvents.length >= 3,
      `FAUX 流式应至少产生 text_start + 1×text_delta + text_end，实际文本事件 ${textEvents.length} 条：${textEvents.map((e) => e.type).join(",")}`
    );
    assert.equal(textEvents[0].type, "text_start", "首个文本事件应为 text_start（REQ-AGENT-028 标准 2）");
    assert.equal(textEvents.at(-1).type, "text_end", "末个文本事件应为 text_end");
    for (const e of textEvents.slice(1, -1)) {
      assert.equal(e.type, "text_delta", `text_start 与 text_end 之间应为连续 text_delta，实际混入 ${e.type}`);
    }
    const joined = textEvents.slice(1, -1).map((e) => e.delta ?? "").join("");
    const finalContent = textEvents.at(-1).content ?? "";
    assert.equal(finalContent, joined, "text_delta 按序拼接应与 text_end.content 一致（顺序与内容一致，REQ-AGENT-028 标准 2）");
    // signoff 2026-08-06: assertion signed（裁决见 signoff.md）
  });

  it("SSE 单帧不超过 256KB（enforceSizeLimit 截断契约轻量回归）", async () => {
    await loadSessionsRouteSeam();
    const spaceKey = await createUiSession(serverCtx.baseUrl);
    const sse = await openSse(spaceKey);

    await postMessage(serverCtx.baseUrl, spaceKey, "聊聊架构");

    // 既有覆盖：agentDialogue.test.js「单条 IPC 消息 ≤ 256KB，超限截断或降级文件引用」
    // （内存内核 enforceSizeLimit，src/services/agentService.js）。本用例为 SSE 传输面轻量回归
    // （REQ-AGENT-028 标准 6：沿用契约跑通即可）：任意 data 帧 ≤ 256KB。
    // 超长输出（截断标记必然出现）的确定性构造依赖输入上限精确值
    // （sessionMessage.test.js 超限用例 TODO），故此处不断言 truncated 标记出现。
    const frames = [];
    for (;;) {
      const frame = await sse.next(30000, "text_end 到达");
      frames.push(frame);
      if (frame.event?.type === "text_end") break;
    }
    assert.ok(frames.length >= 1, "应收到流式帧");
    for (const f of frames) {
      assert.ok(f.rawBytes <= SSE_FRAME_LIMIT, `SSE 单帧应 ≤ 256KB（enforceSizeLimit 契约），实际 ${f.rawBytes} bytes`);
    }
  });

  it("流式进行中客户端断开后服务不崩、后续消息仍受理", async () => {
    await loadSessionsRouteSeam();
    const spaceKey = await createUiSession(serverCtx.baseUrl);
    const sse = await openSse(spaceKey);
    await postMessage(serverCtx.baseUrl, spaceKey, "写一段介绍");
    await sse.next(30000, "首个流式事件"); // 确认流式已开始

    await sse.close(); // 客户端主动断开（EventSource 断线等价）

    const res = await fetch(`${serverCtx.baseUrl}/api/agent/sessions/${spaceKey}/messages`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ text: "还在吗" })
    });
    const body = await res.json().catch(() => ({}));
    assert.equal(res.status, 202, `客户端断开后后续消息应仍受理（202），实际 ${res.status}：${JSON.stringify(body)}`);
    // 断线重连的全量对齐（先 GET .../messages 再续流）为渲染层行为，E2E 覆盖
    // （assistantChat.test.cjs，REQ-AGENT-028 标准 5）；本套件仅断言端点级健壮性。
  });

  it("断开后重连可再建 SSE 流并收到后续流式事件", async () => {
    await loadSessionsRouteSeam();
    const spaceKey = await createUiSession(serverCtx.baseUrl);
    const first = await openSse(spaceKey);
    await first.close(); // 先断开

    const second = await openSse(spaceKey); // 重连再建（200 + text/event-stream 已由 openSse 断言）

    await postMessage(serverCtx.baseUrl, spaceKey, "重连后再聊聊");
    const frame = await second.waitForType("text_end", 30000, "重连后 text_end");
    assert.ok(
      typeof frame.event.content === "string" && frame.event.content.length > 0,
      "重连后的新 SSE 流应收到完整流式回复（REQ-AGENT-028 标准 5 端点侧语义）"
    );
  });
});
