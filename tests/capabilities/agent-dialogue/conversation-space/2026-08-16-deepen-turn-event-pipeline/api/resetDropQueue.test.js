// REQ-TRACE: 2026-08-16-deepen-turn-event-pipeline/REQ-AGENT-109
// REQ-VERSION: v3-hash:ca25405beeb7fa4d05153f0ace4169ca21d3d09dbaa7bc601c000d36c2eea11b
// CAPABILITY-TRACE: agent-dialogue
// ENTITY-TRACE: conversation-space
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: false

// REQ-AGENT-109 AC4（v2，review B1 撤销 E-AGENT-RESET）：reset 语义保持。
//
// 实证背景（review B1，2026-08-17）：worker IPC 为**全局串行队列**
// （messageQueue.enqueue(() => handleMessage(msg))，worker.js:1663-1697；prompt 与
// reset-session 都走此队，仅 ping/confirm-ack/permission-decision/stop-session 带外）
// → reset-session 永远排在在途 prompt 之后处理，会话队列深度恒 ≤1——「排队中、
// 未开始的 prompt 被 reset 丢弃」场景**不存在**，E-AGENT-RESET 回执契约已撤销。
//
// 本测试断言 reset 语义保持 + 注册表 reset 清理（clearSessionState 接入
// handleResetSession）后会话流无回归：
//   ① prompt1 流式中 store.reset(key) → prompt1 照常按序完成（reset 不掐断在途
//      生成——串行队列保证 reset-session 排在 prompt 之后处理）；
//   ② reset 后会话重建（新 session-config）→ 后续 prompt 正常。
// 注册表 reset 清理的单元面（清计数/toolContexts/sessionQueues 等登记项）由
// turnEventPipeline.test.js AC1-3 覆盖。
//
// seam：真实 worker（createAgentService，NODE_ENV=test 自动 FAUX）+ 显式 sessionStore
//   （createSessionStore，dbPath/sessionDir 隔离）——store.reset(key) 走生产路径：
//   sessionStore.reset → agentService handleReset → IPC reset-session（同队列按序）
//   → worker handleResetSession → clearSessionState → 新 session-config 重建。
//   FAUX TPS 调慢制造「流式中 reset」窗口（sessionStop.test.js 同款 seam 先例）。
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const agentMod = await import("../../../../../../src/services/agentService.js").catch(() => null);
const storeMod = await import("../../../../../../src/services/sessionStore.js").catch(() => null);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitUntil(predicate, { timeout = 10000, interval = 100, label = "条件" } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await predicate()) return;
    await sleep(interval);
  }
  assert.fail(`等待超时：${label}`);
}

// 长探针：FAUX 回声 = system prompt + 消息序列化（探针文本进回声）——撑出秒级
// 流式窗口（sessionStop.test.js PROBE 同型；TPS=60 → ~700 字符 ≈ 12s）。
const LONG_PROBE = `重置保持探针。${"长上下文填充段。".repeat(40)}`;
const AFTER_RESET_MARK = "AFTER-RESET-重建探针文本";

describe("REQ-AGENT-109 AC4 reset 语义保持（worker 集成，v2）", () => {
  let workdir;
  let svc;
  let store;

  beforeEach(() => {
    workdir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-reset-keep-"));
    process.env.OPC_AGENT_FAUX_TPS = "60"; // 慢速流式制造「流式中 reset」窗口
    assert.ok(agentMod, "seam 未就绪：src/services/agentService.js");
    assert.ok(storeMod, "seam 未就绪：src/services/sessionStore.js");
    store = storeMod.createSessionStore({
      dbPath: path.join(workdir, "test.db"),
      sessionDir: path.join(workdir, "sessions"),
    });
    svc = agentMod.createAgentService({
      cwd: workdir,
      sessionDir: path.join(workdir, "sessions"),
      sessionStore: store,
    });
  });

  afterEach(async () => {
    delete process.env.OPC_AGENT_FAUX_TPS;
    await svc?.stop();
    fs.rmSync(workdir, { recursive: true, force: true });
  });

  it("AC4：流式中 reset → prompt1 按序完成 + 会话重建后新 prompt 正常（注册表清理接入无回归）", async () => {
    const ready = [];
    // ready 监听必须在 start 之前挂（start() 内部用 once 消费首个 ready，
    // 之后挂监听永不触发——workerWiring 同 seam 先例；test-gap 修正 2026-08-17）。
    svc.on("ready", () => ready.push(Date.now()));
    await svc.start();
    await waitUntil(() => ready.length === 1, { label: "worker ready" });

    const key = "ui:copilot:reset-keep";
    const events = [];
    const session = await svc.createSession({ spaceKey: key, provider: "deepseek", apiKey: "sk-1" });
    session.on("session-event", (e) => events.push(e));

    // prompt1：慢速流式（长探针撑窗口），不 await
    const p1 = svc.prompt(key, LONG_PROBE);
    await waitUntil(() => events.some((e) => e.type === "text_delta"), { label: "prompt1 流式开始" });

    // 流式中走生产重置路径（store.reset = feishu /reset 命令同款，REQ-AGENT-010）
    store.reset(key);

    // ① prompt1 按序完成（reset-session 在全局串行队列中排在 prompt1 之后——
    //   不掐断在途生成；E-AGENT-RESET 已撤销，无取消回执）
    const r1 = await Promise.race([
      p1,
      new Promise((_, reject) => setTimeout(() => reject(new Error("prompt1 未在限期内收尾（reset 不应阻塞在途生成）")), 20000)),
    ]);
    assert.equal(r1?.ok, true, `prompt1 应照常完成: ${JSON.stringify(r1)}`);
    assert.ok(r1.reply.includes("重置保持探针"), "prompt1 回声应含其文本（按序完整执行）");

    // ② reset 后会话重建（新 session-config）→ 后续 prompt 正常
    const r2 = await svc.prompt(key, AFTER_RESET_MARK);
    assert.equal(r2?.ok, true, `reset 后新 prompt 应正常: ${JSON.stringify(r2)}`);
    assert.ok(r2.reply.includes(AFTER_RESET_MARK), "重建后回声应含所发用户消息");

    // 事件流无错误事件（reset 语义保持 = 无取消/session-error 噪音）
    assert.ok(!events.some((e) => e.type === "error"), "reset 保持语义下不应产生 session-error 事件");
  });
});
