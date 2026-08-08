// REQ-TRACE: 2026-08-08-pi-agent-ux-enrichment/REQ-AGENT-055
// REQ-VERSION: v1-hash:dfd35b8a5242cf1ef089f0b289012aa34a1dd194c813e014e8e81b73fc9f403b
// CAPABILITY-TRACE: agent-dialogue
// ENTITY-TRACE: conversation-space
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true

// worker 工具事件转发加法扩展（I-1）——start+input / end+output+isError。
//
// seam：fake worker 捕获 IPC（上 story workerAssembly 同型）+ 注入缝
//（OPC_FAUX_TOOL_SEQUENCE 驱动真实工具调用 → 捕获转发的 tool_execution_* 事件）。
// 断言：start 含 input（=PI args）、end 含 output + isError 透传；
// 既有事件形态不变（text_delta/text_end/confirmation-pending 零感知）。
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

async function waitUntil(predicate, { timeout = 10000, interval = 100, label = "条件" } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
  assert.fail(`超时等待 ${label}`);
}

describe("REQ-AGENT-055 worker 工具事件转发加法扩展", () => {
  let workdir;
  let agentService;

  beforeEach(() => {
    workdir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-tool-ext-"));
  });

  afterEach(async () => {
    if (agentService) {
      try { await agentService.stop(); } catch { /* noop */ }
    }
    fs.rmSync(workdir, { recursive: true, force: true });
  });

  it("标准1：tool_execution_start 事件含 input 字段（=PI args）", async () => {
    const createAgentService = await loadAgentService();
    const entry = path.join(workdir, "agent-entry.js");
    agentService = createAgentService({
      cwd: workdir,
      sessionDir: path.join(workdir, "sessions"),
      entry,
    });
    const events = [];
    agentService.on("session-event", (ev) => events.push(ev));
    const ready = [];
    agentService.on("ready", () => ready.push(1));
    await agentService.start();
    await waitUntil(() => ready.length === 1, { label: "ready" });
    await agentService.createSession({ spaceKey: "ui:project:tool-ext:1", provider: "deepseek", apiKey: "sk-1" });
    // 经注入缝驱动真实工具调用（FAUX 序列）
    await agentService.prompt("ui:project:tool-ext:1", "执行写入任务");
    await waitUntil(() => events.some((e) => e.type === "tool_execution_start"), { label: "tool start" });
    const start = events.find((e) => e.type === "tool_execution_start");
    assert.ok(start, "捕获 tool_execution_start");
    assert.ok("input" in start, `start 含 input 字段（实际字段: ${Object.keys(start).join(",")}）`);
    assert.ok(start.toolCallId, "start 含 toolCallId");
  });

  it("标准2：tool_execution_end 事件含 output 与 isError（成功例：isError=false 或缺省）", async () => {
    const createAgentService = await loadAgentService();
    const entry = path.join(workdir, "agent-entry.js");
    agentService = createAgentService({
      cwd: workdir,
      sessionDir: path.join(workdir, "sessions"),
      entry,
    });
    const events = [];
    agentService.on("session-event", (ev) => events.push(ev));
    const ready = [];
    agentService.on("ready", () => ready.push(1));
    await agentService.start();
    await waitUntil(() => ready.length === 1, { label: "ready" });
    await agentService.createSession({ spaceKey: "ui:project:tool-ext:2", provider: "deepseek", apiKey: "sk-1" });
    await agentService.prompt("ui:project:tool-ext:2", "执行写入任务");
    await waitUntil(() => events.some((e) => e.type === "tool_execution_end"), { label: "tool end" });
    const end = events.find((e) => e.type === "tool_execution_end");
    assert.ok(end, "捕获 tool_execution_end");
    assert.ok("output" in end, `end 含 output 字段（实际字段: ${Object.keys(end).join(",")}）`);
    assert.ok("isError" in end, "end 含 isError 字段");
  });

  it("标准2b：失败例——isError=true 的 end（或 error 事件）携带错误信息", async () => {
    const createAgentService = await loadAgentService();
    const entry = path.join(workdir, "agent-entry.js");
    agentService = createAgentService({
      cwd: workdir,
      sessionDir: path.join(workdir, "sessions"),
      entry,
    });
    const events = [];
    agentService.on("session-event", (ev) => events.push(ev));
    const ready = [];
    agentService.on("ready", () => ready.push(1));
    await agentService.start();
    await waitUntil(() => ready.length === 1, { label: "ready" });
    await agentService.createSession({ spaceKey: "ui:project:tool-ext:3", provider: "deepseek", apiKey: "sk-1" });
    // 注入失败工具调用（write 到无权限路径）
    await agentService.prompt("ui:project:tool-ext:3", "执行失败写入任务");
    await waitUntil(
      () => events.some((e) => e.type === "tool_execution_error" || (e.type === "tool_execution_end" && e.isError === true)),
      { label: "tool error" }
    );
    const err = events.find((e) => e.type === "tool_execution_error" || (e.type === "tool_execution_end" && e.isError === true));
    assert.ok(err, "捕获错误终态（error 事件或 isError end）");
    assert.ok(err.errorCode || err.errorMessage, "错误信息存在");
  });

  it("标准3：既有事件形态不变——text_delta/text_end 无字段变更（零感知）", async () => {
    const createAgentService = await loadAgentService();
    const entry = path.join(workdir, "agent-entry.js");
    agentService = createAgentService({
      cwd: workdir,
      sessionDir: path.join(workdir, "sessions"),
      entry,
    });
    const events = [];
    agentService.on("session-event", (ev) => events.push(ev));
    const ready = [];
    agentService.on("ready", () => ready.push(1));
    await agentService.start();
    await waitUntil(() => ready.length === 1, { label: "ready" });
    await agentService.createSession({ spaceKey: "ui:copilot:tool-ext:4", provider: "deepseek", apiKey: "sk-1" });
    await agentService.prompt("ui:copilot:tool-ext:4", "普通文本回复");
    await waitUntil(() => events.some((e) => e.type === "text_end"), { label: "text_end" });
    const delta = events.find((e) => e.type === "text_delta");
    const end = events.find((e) => e.type === "text_end");
    assert.ok(delta && end, "text_delta/text_end 仍正常产生");
    // 字段形态不变（无新字段混入既有消费方——字段集与既有契约一致）
    assert.deepEqual(Object.keys(delta).sort(), ["delta", "sessionKey", "type"].sort(), "text_delta 字段集不变");
  });
});
