// REQ-TRACE: 2026-08-16-deepen-turn-event-pipeline/REQ-AGENT-109
// REQ-VERSION: v1-hash:7452c3c1c3d87fbfbce1d33a1060f811bbbf6456984d222633b25df084b46856
// CAPABILITY-TRACE: agent-dialogue
// ENTITY-TRACE: conversation-space
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: false

// REQ-AGENT-109 AC4：reset 丢排队操作（人拍板 A）+ E-AGENT-RESET 失败回执（人拍板 1）。
//
// seam：真实 worker（createAgentService，NODE_ENV=test 自动 FAUX）+ 显式 sessionStore
//   （createSessionStore，dbPath/sessionDir 隔离）——store.reset(key) 走生产路径：
//   sessionStore.reset → agentService handleReset → IPC reset-session → worker
//   handleResetSession → clearSessionState（sessionQueues 登记项删除）→ 排队中的
//   prompt 收 prompt-result {ok:false, error:{code:"E-AGENT-RESET"}}。
//
// 实证背景（test-author）：worker enqueueSession 的 promise 链不因 Map delete 取消
//   （回调照跑）→ 被丢弃的排队 fn 必须显式回执；主进程 pendingPrompts 无超时兜底，
//   不回执 = 永久悬挂。E-AGENT-RESET 语义：不发 session-error（取消不是会话错误）。
//
// 时序：IPC FIFO 保证 prompt2 先于 reset-session 到达 worker（排队 → 再清）。
//   FAUX TPS 调慢（OPC_AGENT_FAUX_TPS）制造 prompt1 流式窗口（sessionStop.test.js
//   同款 seam，先例 2026-08-12-pi-mcp-plugin）。
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
// 流式窗口（sessionStop.test.js PROBE 同型；TPS=60 → ~700 字符 ≈ 12s，留足窗口）。
const LONG_PROBE = `重置排队探针。${"长上下文填充段。".repeat(40)}`;
const QUEUED_MARK = "QUEUED-AFTER-RESET-探针文本";

describe("REQ-AGENT-109 AC4 reset 丢排队操作 + E-AGENT-RESET 回执（worker 集成）", () => {
  let workdir;
  let svc;
  let store;

  beforeEach(() => {
    workdir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-reset-drop-"));
    process.env.OPC_AGENT_FAUX_TPS = "60"; // 慢速流式制造排队窗口
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

  it("AC4：prompt1 流式中 reset → prompt2（排队中）收 E-AGENT-RESET 失败回执、无 LLM 事件、无 session-error", async () => {
    await svc.start();
    const ready = [];
    svc.on("ready", () => ready.push(Date.now()));
    await waitUntil(() => ready.length === 1, { label: "worker ready" });

    const key = "ui:copilot:reset-drop";
    const events = [];
    const session = await svc.createSession({ spaceKey: key, provider: "deepseek", apiKey: "sk-1" });
    session.on("session-event", (e) => events.push(e));

    // prompt1：慢速流式（长探针撑窗口），不 await
    const p1 = svc.prompt(key, LONG_PROBE);
    await waitUntil(() => events.some((e) => e.type === "text_delta"), { label: "prompt1 流式开始" });

    // prompt2：同空间排队（prompt1 占队列）
    const p2 = svc.prompt(key, QUEUED_MARK);
    await sleep(300); // p2 的 IPC 已发出（FIFO：先于下面 reset 到达 worker）

    // 生产重置路径：store.reset（feishu /reset 命令同款，REQ-AGENT-010）
    store.reset(key);

    // prompt2 应收明确失败回执（resolve 非 reject——事件即结果语义，REQ-AGENT-007 标准 1）
    const r2 = await p2;
    // EXPECTED-TRACE: prd.md §8 reset 行（ok:false + code E-AGENT-RESET + reason「会话已重置，排队中的消息已取消」）
    assert.equal(r2.ok, false, `排队中的 prompt 应收到失败回执: ${JSON.stringify(r2)}`);
    assert.equal(r2.error?.code, "E-AGENT-RESET", "回执 code 应为 E-AGENT-RESET");
    assert.match(r2.error?.reason ?? "", /已重置/, "回执 reason 应含「已重置」");

    // prompt2 无任何 LLM 事件（FAUX 回声含用户文本——事件流不应出现其文本）
    const text = events
      .filter((e) => e.type === "text_delta" || e.type === "text_end")
      .map((e) => e.delta ?? e.content ?? "")
      .join("");
    assert.ok(!text.includes(QUEUED_MARK), "排队中的 prompt2 不应产生任何 LLM 事件（其文本不应出现在事件流）");

    // 不发 session-error（取消不是会话错误）
    assert.ok(!events.some((e) => e.type === "error"), "reset 丢弃不应发 session-error 事件");

    // prompt1 终态不悬挂（有回执；内容可能被 dispose 截断，不断言 reply 值）
    await p1;
  });
});
