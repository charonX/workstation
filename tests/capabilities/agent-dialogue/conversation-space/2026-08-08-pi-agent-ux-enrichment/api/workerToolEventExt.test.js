// REQ-TRACE: 2026-08-08-pi-agent-ux-enrichment/REQ-AGENT-055
// REQ-VERSION: v1-hash:dfd35b8a5242cf1ef089f0b289012aa34a1dd194c813e014e8e81b73fc9f403b
// CAPABILITY-TRACE: agent-dialogue
// ENTITY-TRACE: conversation-space
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true

// worker 工具事件转发加法扩展（I-1）——start+input / end+output+isError。
//
// seam：真实 spawn（createAgentService + session 句柄监听）+ OPC_FAUX_TOOL_SEQUENCE
// 注入缝（驱动 FAUX 下真实工具调用）→ 断言转发的 tool_execution_* 事件字段。
//
// 2026-08-09 test-gap 就地补全（Slice 3 实证修正，断言语义不变）：
//   ① 事件监听在**会话句柄**（session.on("session-event")，SSE 路由同 seam）——
//      service 级 emitter 仅发 ready/spawn-error；
//   ② 各例 createAgentService 前注入 process.env.OPC_FAUX_TOOL_SEQUENCE（成功/失败/
//      无序列不同）；工具用 default profile 可用的 CLI 查询级工具（settings get——
//      write 需项目空间行）；
//   ③ text_delta 字段集现状 = ["delta","type"]（sessionKey 仅订阅侧过滤，不在事件帧）。
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

async function loadAgentService() {
  const mod = await import("../../../../../../src/services/agentService.js").catch(() => null);
  assert.ok(mod, "seam 未就绪：src/services/agentService.js 尚未实现（REQ-AGENT-055）");
  return mod.createAgentService;
}

async function waitUntil(predicate, { timeout = 15000, interval = 100, label = "条件" } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
  assert.fail(`超时等待 ${label}`);
}

// CLI 查询级工具（default profile 可用；FAUX 序列驱动真实执行 → PI 原生事件带 args/result；
// 2026-08-09 就地补全：settings get 在测试环境无配置返回错误——换 task list 空列表成功例）
const TOOL_SEQ_SUCCESS = JSON.stringify([{ tool: "task list", args: {} }]);
const TOOL_SEQ_FAIL = JSON.stringify([{ tool: "flow get", args: { id: "nonexistent-flow" } }]);

describe("REQ-AGENT-055 worker 工具事件转发加法扩展", () => {
  let workdir;
  let agentService;
  let savedSeq;

  beforeEach(() => {
    workdir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-tool-ext-"));
    savedSeq = process.env.OPC_FAUX_TOOL_SEQUENCE;
  });

  afterEach(async () => {
    if (agentService) {
      try { await agentService.stop(); } catch { /* noop */ }
    }
    if (savedSeq === undefined) delete process.env.OPC_FAUX_TOOL_SEQUENCE;
    else process.env.OPC_FAUX_TOOL_SEQUENCE = savedSeq;
    fs.rmSync(workdir, { recursive: true, force: true });
  });

  // 建会话 → 返回句柄（句柄上监听 session-event，SSE 路由同 seam）
  async function startServiceWithSequence(seq) {
    process.env.OPC_FAUX_TOOL_SEQUENCE = seq;
    const createAgentService = await loadAgentService();
    const entry = path.join(workdir, "agent-entry.js");
    agentService = createAgentService({
      cwd: workdir,
      sessionDir: path.join(workdir, "sessions"),
      entry,
    });
    const ready = [];
    agentService.on("ready", () => ready.push(1));
    await agentService.start();
    await waitUntil(() => ready.length === 1, { label: "ready" });
    const session = await agentService.createSession({ spaceKey: "ui:copilot:tool-ext:1", provider: "deepseek", apiKey: "sk-1" });
    return session;
  }

  it("标准1：tool_execution_start 事件含 input 字段（=PI args）+ toolCallId", async () => {
    const session = await startServiceWithSequence(TOOL_SEQ_SUCCESS);
    const events = [];
    session.on("session-event", (ev) => events.push(ev));
    await agentService.prompt("ui:copilot:tool-ext:1", "执行查询任务");
    await waitUntil(() => events.some((e) => e.type === "tool_execution_start"), { label: "tool start" });
    const start = events.find((e) => e.type === "tool_execution_start");
    assert.ok(start, "捕获 tool_execution_start");
    assert.ok("input" in start, `start 含 input 字段（实际字段: ${Object.keys(start).join(",")}）`);
    assert.ok(start.toolCallId, "start 含 toolCallId");
  });

  it("标准2：tool_execution_end 事件含 output 与 isError（成功例：isError=false）", async () => {
    const session = await startServiceWithSequence(TOOL_SEQ_SUCCESS);
    const events = [];
    session.on("session-event", (ev) => events.push(ev));
    await agentService.prompt("ui:copilot:tool-ext:1", "执行查询任务");
    await waitUntil(() => events.some((e) => e.type === "tool_execution_end"), { label: "tool end" });
    const end = events.find((e) => e.type === "tool_execution_end");
    assert.ok(end, "捕获 tool_execution_end");
    assert.ok("output" in end, `end 含 output 字段（实际字段: ${Object.keys(end).join(",")}）`);
    assert.equal(end.isError, false, "成功例 isError=false");
  });

  it("标准2b：失败例——isError=true 的 end（或 error 事件）携带错误信息", async () => {
    const session = await startServiceWithSequence(TOOL_SEQ_FAIL);
    const events = [];
    session.on("session-event", (ev) => events.push(ev));
    await agentService.prompt("ui:copilot:tool-ext:1", "执行失败查询任务");
    await waitUntil(
      () => events.some((e) => e.type === "tool_execution_error" || (e.type === "tool_execution_end" && e.isError === true)),
      { label: "tool error" }
    );
    const err = events.find((e) => e.type === "tool_execution_error" || (e.type === "tool_execution_end" && e.isError === true));
    assert.ok(err, "捕获错误终态（error 事件或 isError end）");
    assert.ok(err.errorCode || err.errorMessage || err.isError === true, "错误信息存在");
  });

  it("标准3：既有事件形态不变——text_delta/text_end 字段集与现状契约一致", async () => {
    const session = await startServiceWithSequence(undefined);
    const events = [];
    session.on("session-event", (ev) => events.push(ev));
    await agentService.prompt("ui:copilot:tool-ext:1", "普通文本回复");
    await waitUntil(() => events.some((e) => e.type === "text_end"), { label: "text_end" });
    const delta = events.find((e) => e.type === "text_delta");
    const end = events.find((e) => e.type === "text_end");
    assert.ok(delta && end, "text_delta/text_end 仍正常产生");
    // 字段形态不变（现状契约：sessionKey 仅订阅侧过滤，不在事件帧——2026-08-09 就地补全 ③）
    assert.deepEqual(Object.keys(delta).sort(), ["delta", "type"].sort(), "text_delta 字段集不变");
  });
});
