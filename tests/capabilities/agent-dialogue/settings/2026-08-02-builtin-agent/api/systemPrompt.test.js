// REQ-TRACE: 2026-08-02-builtin-agent/REQ-AGENT-003, 2026-08-02-builtin-agent/REQ-AGENT-004
// REQ-VERSION: v1-hash:4ed3c67befef393165738dafca1a9a153b278661403fc6cc06025a430d1bab87
// CAPABILITY-TRACE: agent-dialogue
// ENTITY-TRACE: settings
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { startServer, stopServer } from "../../../../../../src/http/server.js";

// seam：agent 适配层（session-config 消息注入断言）+ settings HTTP API。
// 依赖：agent 适配层在测试中可用内存版 IPC（不 spawn 真子进程）快速路径。

// seam：agentService（tech-design「agentService（主进程）」）。
// 建议落点 src/services/agentService.js，导出 createAgentService({ ipc })，
// 内存版 IPC 快速路径：svc.createSession({ spaceKey, provider, apiKey, identity }) →
// ipc.sent 收到 session-config { sessionKey, provider, model, keyRef, systemPrompt }（tech-design IPC 表），
// 子进程回 config-ack 收进 ipc.acks。
async function loadAgentService() {
  const mod = await import("../../../../../../src/services/agentService.js").catch(() => null);
  assert.ok(mod, "seam 未就绪：src/services/agentService.js 尚未实现（REQ-AGENT-003/004）");
  assert.equal(typeof mod.createAgentService, "function", "agentService 应导出 createAgentService()");
  return mod.createAgentService;
}

// 内存版 IPC fake：记录主进程 → 子进程消息（session-config 等）与子进程 → 主进程回执（config-ack）。
function createFakeIpc() {
  const sent = [];
  const acks = [];
  return { sent, acks };
}

describe("REQ-AGENT-003 内置基础身份", () => {
  let server;
  let baseUrl;
  let workdir;

  beforeEach(async () => {
    workdir = fs.mkdtempSync(path.join(os.tmpdir(), "system-prompt-"));
    process.env.OPC_WORKSTATION_CONFIG_DIR = workdir;
    ({ server, baseUrl } = await startServer({ port: 0 }));
  });

  afterEach(async () => {
    await stopServer({ server });
    fs.rmSync(workdir, { recursive: true, force: true });
  });

  it("内置 system prompt 恒注入（身份 + 工具面 + 行为规则）", async () => {
    const createAgentService = await loadAgentService();
    const ipc = createFakeIpc();
    const svc = createAgentService({ ipc });
    svc.createSession({ spaceKey: "feishu:oc_1", provider: "deepseek", apiKey: "sk-test-injected" });
    const config = ipc.sent.find((m) => m.type === "session-config" && m.sessionKey === "feishu:oc_1");
    assert.ok(config, "创建会话应下发 session-config（REQ-AGENT-003 标准 2）");
    const sp = config.systemPrompt;
    assert.ok(typeof sp === "string" && sp.length > 0, "systemPrompt 应为非空字符串");
    // REQ-AGENT-003 标准 1：平台助手身份 + 工具面说明 + 行为规则。
    assert.match(sp, /助手|平台/, "应含平台助手身份");
    assert.match(sp, /命令|工具/, "应含工具面说明（CLI 命令清单与用法）");
    assert.match(sp, /授权|边界/, "应含授权边界规则");
    assert.match(sp, /确认/, "应含高危需确认规则");
    assert.match(sp, /流式|汇报/, "应含进度流式汇报规则");
    assert.match(sp, /查询/, "应含查询优先规则");
  });

  it("内置身份不含 secret", async () => {
    const createAgentService = await loadAgentService();
    const ipc = createFakeIpc();
    const svc = createAgentService({ ipc });
    svc.createSession({ spaceKey: "feishu:oc_1", provider: "deepseek", apiKey: "sk-secret-abc123" });
    const config = ipc.sent.find((m) => m.type === "session-config" && m.sessionKey === "feishu:oc_1");
    assert.ok(config, "应下发 session-config");
    assert.ok(!config.systemPrompt.includes("sk-secret-abc123"), "system prompt 不得含 key 值（REQ-AGENT-003 标准 3 / 签核决策 5）");
  });
});

describe("REQ-AGENT-004 全局自定义身份", () => {
  let server;
  let baseUrl;
  let workdir;

  beforeEach(async () => {
    workdir = fs.mkdtempSync(path.join(os.tmpdir(), "system-prompt-"));
    process.env.OPC_WORKSTATION_CONFIG_DIR = workdir;
    ({ server, baseUrl } = await startServer({ port: 0 }));
  });

  afterEach(async () => {
    await stopServer({ server });
    fs.rmSync(workdir, { recursive: true, force: true });
  });

  it("自定义身份保存与校验（≤2000 字符，可空）", async () => {
    // 超长 → E-CONFIG-INVALID（签核决策 4）。
    const longRes = await fetch(`${baseUrl}/api/settings/agent`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "deepseek", apiKey: "sk-1", identity: "x".repeat(2001) })
    });
    assert.ok(longRes.status >= 400, `超长身份应报错，实际 ${longRes.status}`);
    assert.ok(JSON.stringify(await longRes.json()).includes("E-CONFIG-INVALID"), "超长身份错误应含 E-CONFIG-INVALID");

    // 空 = 仅内置身份。
    const emptyRes = await fetch(`${baseUrl}/api/settings/agent`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "deepseek", apiKey: "sk-1", identity: "" })
    });
    assert.equal(emptyRes.status, 200, "空身份（仅内置）应可保存");

    const customRes = await fetch(`${baseUrl}/api/settings/agent`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "deepseek", apiKey: "sk-1", identity: "你叫小飞，语气简洁" })
    });
    assert.equal(customRes.status, 200, "自定义身份应可保存");
    const saved = await (await fetch(`${baseUrl}/api/settings/agent`)).json();
    assert.equal(saved.identity, "你叫小飞，语气简洁", "保存后应可读回");
  });

  it("保存后 session-config 热更新存量会话（config-ack），不重建上下文", async () => {
    const createAgentService = await loadAgentService();
    const ipc = createFakeIpc();
    const svc = createAgentService({ ipc });
    const session = svc.createSession({ spaceKey: "feishu:oc_1", provider: "deepseek", apiKey: "sk-1" });
    const refBefore = session.sessionRef; // JSONL 引用：不重建上下文则应不变
    assert.ok(refBefore, "会话应有 sessionRef");
    // 改自定义身份 → 存量会话热更新。
    const res = await fetch(`${baseUrl}/api/settings/agent`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identity: "新身份测试" })
    });
    assert.equal(res.status, 200, "身份保存应成功");
    const config = ipc.sent.filter((m) => m.type === "session-config" && m.sessionKey === "feishu:oc_1").at(-1);
    assert.ok(config?.systemPrompt?.includes("新身份测试"), "热更新应下发含新身份的 session-config");
    assert.ok(ipc.acks.some((m) => m.type === "config-ack"), "子进程应回 config-ack（REQ-AGENT-004 标准 2）");
    // provider/key 未变 → 不重建会话上下文。
    assert.equal(session.sessionRef, refBefore, "provider/key 未变不应重建会话上下文");
  });

  it("provider/key 变更 → 会话重建（sessionRef 换代）+ 新 key 注入（数据流 7）", async () => {
    const createAgentService = await loadAgentService();
    const ipc = createFakeIpc();
    const svc = createAgentService({ ipc });
    const session = svc.createSession({ spaceKey: "feishu:oc_1", provider: "deepseek", apiKey: "sk-old" });
    const refBefore = session.sessionRef;
    const keyRefBefore = session.keyRef;
    const ackCountBefore = ipc.acks.filter((m) => m.type === "config-ack").length;
    assert.ok(refBefore, "会话应有 sessionRef");
    // 换 provider/key → 存量会话上下文重建（tech-design 数据流 7：sessionRef 换代 + 新 key 注入）。
    const res = await fetch(`${baseUrl}/api/settings/agent`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "moonshotai", apiKey: "sk-new" })
    });
    assert.equal(res.status, 200, "provider/key 保存应成功");
    assert.notEqual(session.sessionRef, refBefore, "provider/key 变更应重建会话：sessionRef 换代（数据流 7）");
    assert.notEqual(session.keyRef, keyRefBefore, "重建应生成新 keyRef");
    const config = ipc.sent.filter((m) => m.type === "session-config" && m.sessionKey === "feishu:oc_1").at(-1);
    assert.ok(config, "重建后应重新下发 session-config");
    assert.equal(config.keyRef, session.keyRef, "重建 config 应引用新 keyRef");
    assert.equal(config.apiKey, "sk-new", "重建应一次性注入新 key（数据流 7）");
    assert.ok(
      ipc.acks.filter((m) => m.type === "config-ack").length > ackCountBefore,
      "重建后子进程应回 config-ack（每次 session-config 均有回执）"
    );
  });

  it("保存相同 provider/key 值 → 不重建（REQ-AGENT-004 AC2：未变不重建）", async () => {
    const createAgentService = await loadAgentService();
    const ipc = createFakeIpc();
    const svc = createAgentService({ ipc });
    const session = svc.createSession({ spaceKey: "feishu:oc_1", provider: "deepseek", apiKey: "sk-1" });
    const refBefore = session.sessionRef;
    assert.ok(refBefore, "会话应有 sessionRef");
    // 相同 provider/apiKey 值再次保存 → 不应触发重建（REQ-AGENT-004 AC2）。
    const res = await fetch(`${baseUrl}/api/settings/agent`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "deepseek", apiKey: "sk-1" })
    });
    assert.equal(res.status, 200, "相同配置应可保存");
    assert.equal(session.sessionRef, refBefore, "provider/key 未变不应重建会话（REQ-AGENT-004 AC2）");
  });

  it("内置在前、自定义在后拼接顺序固定", async () => {
    const createAgentService = await loadAgentService();
    const ipc = createFakeIpc();
    const svc = createAgentService({ ipc });
    svc.createSession({ spaceKey: "feishu:oc_1", provider: "deepseek", apiKey: "sk-1", identity: "自定义尾部" });
    const config = ipc.sent.find((m) => m.type === "session-config" && m.sessionKey === "feishu:oc_1");
    assert.ok(config, "应下发 session-config");
    const sp = config.systemPrompt;
    const builtInIdx = sp.search(/助手|平台/);
    const customIdx = sp.indexOf("自定义尾部");
    assert.ok(builtInIdx !== -1 && customIdx !== -1, "最终 systemPrompt 应同时含内置与自定义内容");
    assert.ok(builtInIdx < customIdx, "内置身份应在自定义身份之前（签核决策 4：拼接顺序固定）");
  });
});
