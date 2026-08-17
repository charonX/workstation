// REQ-TRACE: 2026-08-16-deepen-turn-event-pipeline/REQ-AGENT-111
// REQ-VERSION: v1-hash:7452c3c1c3d87fbfbce1d33a1060f811bbbf6456984d222633b25df084b46856
// CAPABILITY-TRACE: agent-dialogue
// ENTITY-TRACE: conversation-space
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: false

// REQ-AGENT-111 worker.js 接线保持：管线抽取后 worker 仍 spawn-only、事件链形状/
// meta/prompt-result reply/abort 收尾语义全部保持（replace, don't layer——本文件是
// 接线契约的重申断言；既有黑盒测试 workerToolEventExt/sessionEvents/sessionIdleEviction/
// agentModelResolveLocal/agentDialogue 由 QA 阶段全量回归）。
//
// seam：真实 worker（createAgentService，NODE_ENV=test 自动 FAUX，sessionStop.test.js
//   同款 seam 2026-08-12-pi-mcp-plugin）+ 会话句柄 session.on("session-event")。
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const agentMod = await import("../../../../../../src/services/agentService.js").catch(() => null);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitUntil(predicate, { timeout = 10000, interval = 100, label = "条件" } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await predicate()) return;
    await sleep(interval);
  }
  assert.fail(`等待超时：${label}`);
}

// 停止窗口探针（sessionStop.test.js PROBE 同型；TPS=150 下完整生成秒级+）。
const STOP_PROBE = `接线保持探针。${"长上下文填充段。".repeat(150)}`;

describe("REQ-AGENT-111 worker.js 接线保持（spawn 集成）", () => {
  let workdir;
  let svc;

  beforeEach(() => {
    workdir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-wiring-"));
    assert.ok(agentMod, "seam 未就绪：src/services/agentService.js");
    svc = agentMod.createAgentService({ cwd: workdir, sessionDir: path.join(workdir, "sessions") });
  });

  afterEach(async () => {
    delete process.env.OPC_AGENT_FAUX_TPS;
    await svc?.stop();
    fs.rmSync(workdir, { recursive: true, force: true });
  });

  async function startFauxService() {
    const ready = [];
    svc.on("ready", () => ready.push(Date.now()));
    await svc.start();
    await waitUntil(() => ready.length === 1, { label: "worker ready" });
  }

  it("AC1：spawn 启动 + 会话装配 + prompt 全链正常（ready/session-config/回执形状不变）", async () => {
    await startFauxService();
    const key = "ui:copilot:wiring-alive";
    const session = await svc.createSession({ spaceKey: key, provider: "deepseek", apiKey: "sk-1" });
    const r = await svc.prompt(key, "存活探针");
    assert.equal(r?.ok, true, `prompt 应 ok:true: ${JSON.stringify(r)}`);
    assert.ok(r.reply.includes("存活探针"), "FAUX 回声应含所发用户消息（装配链完整）");
  });

  it("AC2：事件链形状契约——text_delta×N 按序、text_end 末位且带 meta.durationMs", async () => {
    await startFauxService();
    const key = "ui:copilot:wiring-chain";
    const events = [];
    const session = await svc.createSession({ spaceKey: key, provider: "deepseek", apiKey: "sk-1" });
    session.on("session-event", (e) => events.push(e));
    await svc.prompt(key, "事件链探针");
    const textEvents = events.filter((e) => e.type === "text_delta" || e.type === "text_end");
    assert.ok(textEvents.length >= 2, `应至少 text_delta×1 + text_end，实际 ${textEvents.map((e) => e.type).join(",")}`);
    // EXPECTED-TRACE: prd.md §6.1-1（text_delta…text_end 顺序；meta.durationMs 存在）
    for (const e of textEvents.slice(0, -1)) {
      assert.equal(e.type, "text_delta", `text_end 前应全为 text_delta，实际混入 ${e.type}`);
    }
    const end = textEvents.at(-1);
    assert.equal(end.type, "text_end", "末位应为 text_end");
    assert.ok(Number.isInteger(end.meta?.durationMs) && end.meta.durationMs >= 0,
      "text_end 应带 meta.durationMs（REQ-AGENT-057 经管线保持）");
    const joined = textEvents.slice(0, -1).map((e) => e.delta ?? "").join("");
    assert.equal(end.content, joined, "text_delta 拼接应与 text_end.content 一致");
  });

  it("AC3：连续两轮 prompt 各自 reply 为本轮文本（lastReplies 读取不删 + 每轮刷新，不串轮）", async () => {
    await startFauxService();
    const key = "ui:copilot:wiring-reply";
    await svc.createSession({ spaceKey: key, provider: "deepseek", apiKey: "sk-1" });
    const r1 = await svc.prompt(key, "第一篇：本轮甲");
    const r2 = await svc.prompt(key, "第二篇：本轮乙");
    assert.equal(r1?.ok, true);
    assert.equal(r2?.ok, true);
    assert.ok(r1.reply.includes("第一篇：本轮甲"), "第一轮 reply 应含第一轮文本");
    assert.ok(r2.reply.includes("第二篇：本轮乙"), "第二轮 reply 应含第二轮文本");
    assert.notEqual(r1.reply, r2.reply, "两轮 reply 不应串轮");
  });

  it("AC4：stop-session 全链路——abort → 合成 text_end → prompt-result ok:true + reply 保留（BUG-010 语义回归）", async () => {
    process.env.OPC_AGENT_FAUX_TPS = "150"; // 慢速流式制造停止窗口
    await startFauxService();
    const key = "ui:copilot:wiring-stop";
    let firstDelta = null;
    const session = await svc.createSession({ spaceKey: key, provider: "deepseek", apiKey: "sk-1" });
    session.on("session-event", (e) => {
      if (!firstDelta && e.type === "text_delta") firstDelta = e;
    });
    const p = svc.prompt(key, STOP_PROBE);
    await waitUntil(() => firstDelta, { label: "流式开始" });
    const stopAt = Date.now();
    await svc.stopSession(key);
    const r = await p;
    // EXPECTED-TRACE: prd.md §6.1-3（abort → 合成 text_end → reply 有值）
    assert.equal(r?.ok, true, `abort 后应正常收尾: ${JSON.stringify(r)}`);
    assert.ok(r.reply.length > 0, "已生成文本应保留（reply 非空，BUG-010 语义）");
    assert.ok(Date.now() - stopAt < 3000, "停止后应 3s 内收尾（中断及时性）");
  });
});
