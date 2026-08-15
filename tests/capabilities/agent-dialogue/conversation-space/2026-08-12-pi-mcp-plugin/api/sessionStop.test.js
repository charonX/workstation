// REQ-TRACE: 2026-08-12-pi-mcp-plugin/REQ-AGENT-091
// REQ-VERSION: v1-hash:6c7fd998525a697ef21587c808800edfb15182b428d588f83c9ae835acf09243
// CAPABILITY-TRACE: agent-dialogue
// ENTITY-TRACE: conversation-space
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true (2026-08-13 assertion signoff)

// BUG-010 回归：REQ-AGENT-091 对话手动停止（req-gap 就地补全 2026-08-15）。
// 「对话没办法手动停止」——pi SDK AgentSession.abort() 存在但 worker/HTTP/UI 全链路未接。
//
// seam 1（HTTP 面）：startServer 全栈（sessionReset.test.js 先例）——
//   POST /api/agent/sessions/:spaceKey/stop → 202 受理；idle/不存在 → 202 no-op（不报错）。
// seam 2（worker 集成）：createAgentService 默认入口 = 真实 worker（NODE_ENV=test 自动
//   FAUX，agentHeartbeatBusy.test.js 先例）；OPC_AGENT_FAUX_TPS 调慢流式制造停止窗口。
//
// 断言来源（REQ-091 已签语义边界）：中断后 prompt 正常收尾（事件即结果）、已生成
// 文本保留（reply 非空）、停止后会话存活可再发（回声含第二篇用户消息）、未知 key
// 静默 no-op（不发 session-error）。

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { startServer, stopServer } from "../../../../../../src/http/server.js";

const JSON_HEADERS = { "Content-Type": "application/json" };

async function postJson(baseUrl, urlPath, body) {
  const res = await fetch(`${baseUrl}${urlPath}`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function configureFauxAgent() {
  const settings = await import("../../../../../../src/services/settingsService.js");
  settings.saveAgentConfig({ provider: "deepseek", apiKey: "sk-faux-stop-test" });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitUntil(predicate, { timeout = 10000, interval = 100, label = "条件" } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await predicate()) return;
    await sleep(interval);
  }
  assert.fail(`等待超时：${label}`);
}

// ---------------------------------------------------------------- HTTP 面

describe("REQ-AGENT-091 对话手动停止——HTTP 面（202 受理 / no-op 语义）", () => {
  let workdir;
  let serverCtx;
  let savedConfigDir;

  beforeEach(async () => {
    workdir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-stop-http-"));
    savedConfigDir = process.env.OPC_WORKSTATION_CONFIG_DIR;
    process.env.OPC_WORKSTATION_CONFIG_DIR = workdir;
    serverCtx = await startServer({ port: 0 });
    await configureFauxAgent();
  });

  afterEach(async () => {
    await stopServer(serverCtx);
    if (savedConfigDir === undefined) delete process.env.OPC_WORKSTATION_CONFIG_DIR;
    else process.env.OPC_WORKSTATION_CONFIG_DIR = savedConfigDir;
    fs.rmSync(workdir, { recursive: true, force: true });
  });

  it("标准 2a：idle 会话（未在生成）stop → 202 no-op", async () => {
    const created = await postJson(serverCtx.baseUrl, "/api/agent/sessions", { spaceKind: "general" });
    assert.equal(created.status, 200, `前置：建会话应 200，实际 ${created.status}`);
    const key = created.body.spaceKey;

    const res = await postJson(serverCtx.baseUrl, `/api/agent/sessions/${encodeURIComponent(key)}/stop`);
    assert.equal(res.status, 202, `idle stop 应 202 no-op，实际 ${res.status}: ${JSON.stringify(res.body)}`);
  });

  it("标准 2b：不存在的会话 stop → 202 no-op（停止是幂等安全操作，非用户错误）", async () => {
    const res = await postJson(
      serverCtx.baseUrl,
      `/api/agent/sessions/${encodeURIComponent("ui:copilot:ghost-none")}/stop`
    );
    assert.equal(res.status, 202, `不存在会话 stop 应 202 no-op，实际 ${res.status}: ${JSON.stringify(res.body)}`);
  });
});

// ---------------------------------------------------------------- worker 集成面

describe("REQ-AGENT-091 对话手动停止——worker 集成（SDK abort 接线）", () => {
  let workdir;
  let agentService;

  beforeEach(() => {
    workdir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-stop-worker-"));
    agentService = null;
    // FAUX 慢速流式（对齐 assistantChat E2E 的 TPS=200 先例）：KB 级回声完整生成
    // 需秒级~十几秒，留出稳定停止窗口；又不至于慢到拖垮套件。
    process.env.OPC_AGENT_FAUX_TPS = "200";
  });

  afterEach(async () => {
    delete process.env.OPC_AGENT_FAUX_TPS;
    await agentService?.stop();
    fs.rmSync(workdir, { recursive: true, force: true });
  });

  async function startFauxService() {
    const mod = await import("../../../../../../src/services/agentService.js").catch(() => null);
    assert.ok(mod, "seam 未就绪：src/services/agentService.js");
    agentService = mod.createAgentService({ cwd: workdir, sessionDir: path.join(workdir, "sessions") });
    const readyEvents = [];
    agentService.on("ready", () => readyEvents.push(Date.now()));
    await agentService.start();
    await waitUntil(() => readyEvents.length === 1, { label: "worker ready" });
  }

  it("标准 1+5：流式中停止 → 回复截短为完整回声前缀 + 及时收尾 + 停止后可再发", async () => {
    await startFauxService();
    const probe = "停止回归探针文本";
    // 对照组：会话 A 同上下文完整生成，拿到完整回声（FAUX 确定性回声：同上下文
    // 同序列——assistantChat.test.cjs 头注释）。
    const keyA = "ui:copilot:stop-full";
    await agentService.createSession({ spaceKey: keyA, provider: "deepseek", apiKey: "sk-1" });
    const full = await agentService.prompt(keyA, probe);
    assert.equal(full?.ok, true, `对照组应成功: ${JSON.stringify(full)}`);
    assert.ok(full.reply.length > 0, "对照组回声非空");

    // 实验组：会话 B 同首条消息，流式中段停止。
    const keyB = "ui:copilot:stop-mid";
    await agentService.createSession({ spaceKey: keyB, provider: "deepseek", apiKey: "sk-1" });
    let first = null;
    const p1 = agentService
      .prompt(keyB, probe)
      .then((r) => { first = { settled: "resolved", value: r }; })
      .catch((e) => { first = { settled: "rejected", error: e }; });
    await sleep(600); // 流式中段（tps=200 已累积约百余 token，远未完整）
    const stopAt = Date.now();
    assert.equal(
      typeof agentService.stopSession,
      "function",
      "seam 未就绪：agentService.stopSession(spaceKey) 尚未实现（REQ-AGENT-091）"
    );
    await agentService.stopSession(keyB);
    await p1;
    const settledMs = Date.now() - stopAt;

    assert.ok(first, "prompt 应有终态");
    assert.equal(first.settled, "resolved", `停止后 prompt 应正常收尾（事件即结果），而非 reject: ${first.error}`);
    assert.equal(first.value?.ok, true, `收尾应 ok=true: ${JSON.stringify(first.value)}`);
    assert.ok(settledMs < 3000, `停止后应 3s 内收尾（中断及时性），实际 ${settledMs}ms`);
    const partial = first.value?.reply ?? "";
    assert.ok(partial.length > 0, "已生成文本应保留（reply 非空）");
    assert.ok(partial.length < full.reply.length, "中断回复应截短于完整回声");
    assert.ok(full.reply.startsWith(partial), "中断回复应为完整回声的前缀（逐 token 保留）");

    // 会话不损坏：再 prompt 正常回复（FAUX 回声确定性含用户消息文本）。
    const r2 = await agentService.prompt(keyB, "第二篇：停止后再发");
    assert.equal(r2?.ok, true, `第二轮应成功: ${JSON.stringify(r2)}`);
    assert.ok(r2.reply.includes("第二篇：停止后再发"), "第二轮回声应含所发用户消息");
  });

  it("标准 3：未知 key 的 stop → 静默 no-op（不抛、服务健康、后续会话正常）", async () => {
    await startFauxService();
    assert.equal(typeof agentService.stopSession, "function", "seam 未就绪：agentService.stopSession");
    await agentService.stopSession("ui:copilot:ghost-noop"); // 不抛即 no-op
    // 服务仍健康：真实会话建/发正常（worker 未因未知 key 消息崩溃/卡死）。
    await agentService.createSession({ spaceKey: "ui:copilot:stop-alive", provider: "deepseek", apiKey: "sk-1" });
    const r = await agentService.prompt("ui:copilot:stop-alive", "存活探针");
    assert.equal(r?.ok, true, `后续会话应正常: ${JSON.stringify(r)}`);
    assert.ok(r.reply.includes("存活探针"), "回声应含所发用户消息");
  });
});
