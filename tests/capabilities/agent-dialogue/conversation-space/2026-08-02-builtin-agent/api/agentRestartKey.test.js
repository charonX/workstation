// REQ-TRACE: 2026-08-02-builtin-agent/REQ-AGENT-009
// REQ-VERSION: v1-hash:16f30c7bbd781fb9f86f573f3c92dc0c96a1aa38aecf3bd08c54caa0cdb712f4
// CAPABILITY-TRACE: agent-dialogue
// ENTITY-TRACE: conversation-space
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true

// BUG-005（code-defect）回归：应用重启后按 agent_sessions 水合会话时，必须把
// 解密后的 API key 注入 keySecrets，使下发的 session-config 携带 apiKey。
//
// 根因：createSession 路径有 `if (apiKey) keySecrets.set(keyRef, apiKey)`，
// 但 ready 水合路径（按 agent_sessions 行重建会话）只创建句柄、从不注入 key →
// buildConfigMessage 下发 apiKey=undefined → worker resolveModel 不 setRuntimeApiKey
// → LLM 调用报「No API key found for <provider>」（REQ-AGENT-009 标准 1：恢复后
// 会话应可继续对话）。
//
// 为什么既有测试全绿：agentService 测试跑 FAUX 模式（OPC_AGENT_FAUX=1），
// worker resolveModel 直接返回 faux 模型、不校验 key → key 缺失被掩盖。
// 本回归测试绕开 FAUX：自建 fake worker（不做 LLM，只捕获收到的 session-config），
// 断言重启水合后下发的 session-config 携带 apiKey。
//
// seam：createAgentService({ cwd, sessionDir, entry }) —— entry 指向自建 fake
// worker 脚本，经真实 spawn 走完整 ready→水合→session-config 下发路径。
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// settings 持久化（水合从 settings 读 apiKeyEncrypted 解密）：
// 测试把 OPC_WORKSTATION_CONFIG_DIR 指向临时目录，用 saveAgentConfig 持久化 key，
// 模拟生产「key 加密落 settings.json」的形态。
const SETTINGS_KEY = "sk-secret-123";

// fake worker：真实 spawn 的子进程入口。不做 LLM，只把收到的 session-config
// 记录到 CAPTURE 文件并回 config-ack（协议最小实现：ready/ping/pong/shutdown）。
const FAKE_WORKER_SRC = `import fs from "node:fs";
import readline from "node:readline";
const captureFile = process.env.OPC_FAKE_CAPTURE;
const rl = readline.createInterface({ input: process.stdin });
process.stdout.write(JSON.stringify({ type: "ready", pid: process.pid }) + "\\n");
rl.on("line", (line) => {
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  if (msg.type === "session-config") {
    if (captureFile) {
      fs.appendFileSync(captureFile, JSON.stringify({
        type: "session-config",
        sessionKey: msg.sessionKey,
        provider: msg.provider,
        model: msg.model,
        hasApiKey: !!msg.apiKey,
        apiKey: typeof msg.apiKey === "string" ? msg.apiKey : null,
      }) + "\\n");
    }
    process.stdout.write(JSON.stringify({ type: "config-ack", sessionKey: msg.sessionKey }) + "\\n");
  } else if (msg.type === "ping") {
    process.stdout.write(JSON.stringify({ type: "pong" }) + "\\n");
  } else if (msg.type === "shutdown") {
    process.exit(0);
  }
});
`;

async function loadAgentService() {
  const mod = await import("../../../../../../src/services/agentService.js").catch(() => null);
  assert.ok(mod, "seam 未就绪：src/services/agentService.js 尚未实现（REQ-AGENT-009）");
  assert.equal(typeof mod.createAgentService, "function", "agentService 应导出 createAgentService()");
  return mod.createAgentService;
}

async function waitUntil(predicate, { timeout = 10000, interval = 100, label = "条件" } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
  assert.fail(`等待超时：${label}`);
}

describe("BUG-005 回归：重启水合会话必须携带 API key（REQ-AGENT-009）", () => {
  let workdir;
  let sessionDir;
  let configDir;
  let entry;
  let captureFile;
  let agentService;

  beforeEach(() => {
    workdir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-restart-key-"));
    sessionDir = path.join(workdir, "sessions");
    configDir = path.join(workdir, "config");
    fs.mkdirSync(configDir, { recursive: true });
    entry = path.join(workdir, "fake-worker.mjs");
    captureFile = path.join(workdir, "capture.jsonl");
    fs.writeFileSync(entry, FAKE_WORKER_SRC);
    // 测试隔离：settings 落临时目录（不污染真实用户配置）。
    process.env.OPC_WORKSTATION_CONFIG_DIR = configDir;
    process.env.OPC_FAKE_CAPTURE = captureFile;
    agentService = null;
  });

  afterEach(async () => {
    delete process.env.OPC_FAKE_CAPTURE;
    delete process.env.OPC_WORKSTATION_CONFIG_DIR;
    await agentService?.stop();
    fs.rmSync(workdir, { recursive: true, force: true });
  });

  function readConfigs() {
    if (!fs.existsSync(captureFile)) return [];
    return fs
      .readFileSync(captureFile, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l))
      .filter((m) => m.type === "session-config");
  }

  it("重启后水合下发的 session-config 携带 API key（修复前红：key 缺失 → hasApiKey=false）", async () => {
    const createAgentService = await loadAgentService();
    // 模拟生产：key 加密持久化到 settings.json（saveAgentConfig → encryptSecret）。
    const settingsMod = await import("../../../../../../src/services/settingsService.js");
    settingsMod.saveAgentConfig({ provider: "deepseek", apiKey: SETTINGS_KEY });

    // 第一次启动：创建会话（与生产 createSession 带 apiKey 一致）。
    agentService = createAgentService({ cwd: workdir, sessionDir, entry });
    const ev1 = [];
    agentService.on("ready", () => ev1.push(1));
    await agentService.start();
    await waitUntil(() => ev1.length === 1, { label: "第一次 ready" });
    agentService.createSession({ spaceKey: "feishu:oc_1", provider: "deepseek", apiKey: SETTINGS_KEY });
    await waitUntil(() => readConfigs().length >= 1, { label: "第一次 session-config 下发" });
    await agentService.stop();

    // 重启（模拟应用/子进程重启）：ready 后按 agent_sessions 水合会话。
    const before = readConfigs().length;
    agentService = createAgentService({ cwd: workdir, sessionDir, entry });
    const ev2 = [];
    agentService.on("ready", () => ev2.push(1));
    await agentService.start();
    await waitUntil(() => ev2.length === 1, { label: "第二次 ready" });
    await waitUntil(() => readConfigs().length >= before + 1, { label: "重启水合 session-config 下发" });

    const configs = readConfigs();
    const hydrated = configs[configs.length - 1]; // 最后一次 = 水合路径下发
    assert.equal(hydrated.sessionKey, "feishu:oc_1", "水合应针对已存会话下发 session-config");
    assert.equal(
      hydrated.hasApiKey,
      true,
      `重启水合下发的 session-config 必须携带 API key（否则 worker 报 No API key found for deepseek）。实际: ${JSON.stringify(hydrated)}`
    );
    assert.equal(hydrated.apiKey, SETTINGS_KEY, "水合应注入 settings 中持久化的解密 key");
  });
});
