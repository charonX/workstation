// REQ-TRACE: 2026-08-02-ui-copilot/REQ-AGENT-027
// REQ-VERSION: v1-hash:8432c0cff25d5ef4a71d5c8fd95b3045977d65430eb968d7063be5fc81d67012
// CAPABILITY-TRACE: agent-dialogue
// ENTITY-TRACE: conversation-space
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import Database from "better-sqlite3";
import { startServer, stopServer } from "../../../../../../src/http/server.js";

// seam：HTTP server 全栈（startServer 临时 DB + 随机端口）+ 临时 CONFIG_DIR
// （agent-sessions.db / agent-sessions/ 落临时目录，server.js 既有接线）。
//
// seam：routes/agentSessions 的 reset 端点（tech-design「接口契约」）：
//   POST /api/agent/sessions/:spaceKey/reset → { spaceKey: 新 }（F4 语义：UI 空间
//   /reset = 同分组新建会话并切换，新行、旧行保留；不触发世代机制——世代留给飞书
//   空间与 provider/key 变更重建）。
async function ensureAgentSessionsRoute() {
  const mod = await import("../../../../../../src/http/routes/agentSessions.js").catch(() => null);
  assert.ok(mod, "seam 未就绪：src/http/routes/agentSessions.js 尚未实现（REQ-AGENT-027）");
  return mod;
}

// seam：sessionStore（既有，REQ-AGENT-008~010）——feishu:* /reset 世代制回归在
// store 层断言（复用 builtin-agent sessionStore.test.js 的断言风格）。
async function loadSessionStoreModule() {
  const mod = await import("../../../../../../src/services/sessionStore.js").catch(() => null);
  assert.ok(mod, "seam 未就绪：src/services/sessionStore.js 尚未实现（REQ-AGENT-027 标准 5 回归）");
  assert.equal(typeof mod.createSessionStore, "function", "sessionStore 应导出 createSessionStore()");
  return mod;
}

const JSON_HEADERS = { "Content-Type": "application/json" };

async function postJson(baseUrl, urlPath, body) {
  const res = await fetch(`${baseUrl}${urlPath}`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(body ?? {})
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

function readSessionRow(dbPath, spaceKey) {
  if (!fs.existsSync(dbPath)) return undefined;
  const db = new Database(dbPath, { readonly: true });
  try {
    return db.prepare("SELECT * FROM agent_sessions WHERE spaceKey = ?").get(spaceKey);
  } catch {
    return undefined;
  } finally {
    db.close();
  }
}

function countSessionRows(dbPath, spaceKeyPrefix) {
  if (!fs.existsSync(dbPath)) return 0;
  const db = new Database(dbPath, { readonly: true });
  try {
    const { c } = db.prepare("SELECT COUNT(*) AS c FROM agent_sessions WHERE spaceKey LIKE ?").get(`${spaceKeyPrefix}%`);
    return c;
  } catch {
    return 0;
  } finally {
    db.close();
  }
}

async function waitFor(condition, { timeoutMs = 15000, intervalMs = 150, description = "condition" } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const value = await condition();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  assert.fail(`timed out (${timeoutMs}ms) waiting for: ${description}`);
}

async function configureFauxAgent() {
  const settings = await import("../../../../../../src/services/settingsService.js");
  settings.saveAgentConfig({ provider: "deepseek", apiKey: "sk-faux-ui-copilot-test" });
}

async function sendUserMessage(baseUrl, dbPath, spaceKey, text) {
  const res = await postJson(baseUrl, `/api/agent/sessions/${encodeURIComponent(spaceKey)}/messages`, { text });
  assert.equal(res.status, 202, `发送用户消息应 202，实际 ${res.status}: ${JSON.stringify(res.body)}`);
  const row = readSessionRow(dbPath, spaceKey);
  assert.ok(row?.sessionRef, `agent_sessions 应有 sessionRef（spaceKey=${spaceKey}）`);
  await waitFor(
    () => fs.existsSync(row.sessionRef) && fs.readFileSync(row.sessionRef, "utf8").includes(text),
    { description: `用户消息落盘 JSONL（${text.slice(0, 12)}…）` }
  );
}

describe("REQ-AGENT-027 标准 4 UI 空间 /reset = 同分组新建会话", () => {
  let workdir;
  let serverCtx;
  let savedConfigDir;
  let agentSessionsDbPath;

  beforeEach(async () => {
    workdir = fs.mkdtempSync(path.join(os.tmpdir(), "ui-copilot-reset-"));
    savedConfigDir = process.env.OPC_WORKSTATION_CONFIG_DIR;
    process.env.OPC_WORKSTATION_CONFIG_DIR = workdir;
    agentSessionsDbPath = path.join(workdir, "agent-sessions.db");
    serverCtx = await startServer({ port: 0 });
    await configureFauxAgent();
  });

  afterEach(async () => {
    await stopServer(serverCtx);
    if (savedConfigDir === undefined) delete process.env.OPC_WORKSTATION_CONFIG_DIR;
    else process.env.OPC_WORKSTATION_CONFIG_DIR = savedConfigDir;
    fs.rmSync(workdir, { recursive: true, force: true });
  });

  it("resetting a UI session returns a new spaceKey in the same group with a new row while the old row is retained", async () => {
    await ensureAgentSessionsRoute();

    // Arrange：通用会话 + 一条历史消息（reset 前有真实上下文）。
    const created = await postJson(serverCtx.baseUrl, "/api/agent/sessions", { spaceKind: "general" });
    assert.equal(created.status, 200, `前置：建会话应 200，实际 ${created.status}`);
    const oldKey = created.body.spaceKey;
    await sendUserMessage(serverCtx.baseUrl, agentSessionsDbPath, oldKey, "reset 前的历史消息");

    // Act
    const res = await postJson(serverCtx.baseUrl, `/api/agent/sessions/${encodeURIComponent(oldKey)}/reset`);

    // Assert：返回新 spaceKey——同分组前缀、不同 sessionId（REQ-AGENT-027 标准 4）。
    assert.equal(res.status, 200, `UI 空间 reset 应 200，实际 ${res.status}: ${JSON.stringify(res.body)}`);
    const newKey = res.body?.spaceKey;
    assert.ok(typeof newKey === "string", "reset 响应应含新 spaceKey");
    assert.match(newKey, /^ui:copilot:.+/, `新 spaceKey 应与旧会话同分组（ui:copilot:*），实际: ${newKey}`);
    assert.notEqual(newKey, oldKey, "reset 应返回新会话（不同 sessionId），不是世代换代");

    // Assert：新行建立（JSONL 占位落盘）；旧行保留（sessionRef 不被改写、历史文件不丢）。
    const newRow = readSessionRow(agentSessionsDbPath, newKey);
    assert.ok(newRow, `新会话应建 agent_sessions 行（spaceKey=${newKey}）`);
    assert.ok(fs.existsSync(newRow.sessionRef), "新会话 JSONL 占位应落盘");
    const oldRow = readSessionRow(agentSessionsDbPath, oldKey);
    assert.ok(oldRow, "旧会话行应保留（reset 不删行）");
    assert.ok(fs.existsSync(oldRow.sessionRef), "旧会话 JSONL 历史文件应保留");
    assert.notEqual(oldRow.sessionRef, newRow.sessionRef, "新旧会话应各持独立 JSONL");
  });

  it("the old session's message history remains readable after reset", async () => {
    await ensureAgentSessionsRoute();

    // Arrange
    const created = await postJson(serverCtx.baseUrl, "/api/agent/sessions", { spaceKind: "general" });
    const oldKey = created.body.spaceKey;
    const historyText = "这条历史在 reset 后仍应可读";
    await sendUserMessage(serverCtx.baseUrl, agentSessionsDbPath, oldKey, historyText);

    // Act：reset 后读旧会话历史。
    await postJson(serverCtx.baseUrl, `/api/agent/sessions/${encodeURIComponent(oldKey)}/reset`);
    const res = await fetch(`${serverCtx.baseUrl}/api/agent/sessions/${encodeURIComponent(oldKey)}/messages`);

    // Assert（REQ-AGENT-027 标准 4：旧行历史仍可读）。
    assert.equal(res.status, 200, `旧会话历史应仍可读（200），实际 ${res.status}`);
    const body = await res.json();
    // signoff 2026-08-06: assertion signed（裁决见 signoff.md）
    const messages = body?.messages;
    assert.ok(Array.isArray(messages), `历史响应应含 messages 数组，实际: ${JSON.stringify(body)}`);
    assert.ok(JSON.stringify(messages).includes(historyText), "旧会话历史应包含 reset 前的用户消息");
  });

  it("the old session still accepts new messages after reset (endpoint does not reject it)", async () => {
    await ensureAgentSessionsRoute();

    // Arrange
    const created = await postJson(serverCtx.baseUrl, "/api/agent/sessions", { spaceKind: "general" });
    const oldKey = created.body.spaceKey;
    await sendUserMessage(serverCtx.baseUrl, agentSessionsDbPath, oldKey, "reset 前消息");

    // Act：reset 后向旧会话继续发送（不断言执行结果，只断言端点不拒）。
    await postJson(serverCtx.baseUrl, `/api/agent/sessions/${encodeURIComponent(oldKey)}/reset`);
    const res = await postJson(serverCtx.baseUrl, `/api/agent/sessions/${encodeURIComponent(oldKey)}/messages`, {
      text: "reset 后向旧会话继续发送"
    });

    // Assert（REQ-AGENT-027 标准 4：旧会话可继续发送——端点不 4xx 拒绝）。
    assert.equal(res.status, 202, `旧会话 reset 后应仍可发送（202），实际 ${res.status}: ${JSON.stringify(res.body)}`);
  });
});

describe("REQ-AGENT-027 标准 5 feishu:* /reset 世代制回归（store 层）", () => {
  let workdir;
  let sessionDir;
  let dbPath;
  let store;
  let sessionStoreMod;
  let savedDbPath;

  beforeEach(async () => {
    workdir = fs.mkdtempSync(path.join(os.tmpdir(), "feishu-reset-"));
    sessionDir = path.join(workdir, "sessions");
    dbPath = path.join(workdir, "store.db");
    savedDbPath = process.env.DB_PATH;
    process.env.DB_PATH = dbPath;
    sessionStoreMod = await loadSessionStoreModule();
    store = sessionStoreMod.createSessionStore({ dbPath, sessionDir });
  });

  afterEach(() => {
    if (savedDbPath === undefined) delete process.env.DB_PATH;
    else process.env.DB_PATH = savedDbPath;
    fs.rmSync(workdir, { recursive: true, force: true });
  });

  it("store.reset on a feishu:* space bumps the JSONL generation and rotates sessionRef (existing semantics unchanged)", async () => {
    // Arrange：既有空间（复用 builtin-agent sessionStore.test.js 的断言风格）。
    const s1 = store.getOrCreate("feishu:oc_1", { sessionDir });
    assert.equal(s1.created, true, "前置：首次建空间");
    const genBefore = sessionStoreMod.generationFromRef(s1.sessionRef);

    // Act
    const reset = store.reset("feishu:oc_1");

    // Assert：世代 +1、sessionRef 换代、spaceKey 不变（世代制，非 UI 新行语义）。
    assert.ok(reset, "feishu:* reset 应返回换代信息");
    assert.equal(reset.spaceKey, "feishu:oc_1", "feishu:* reset 不换 spaceKey（世代制，区别于 UI 新行语义）");
    assert.equal(sessionStoreMod.generationFromRef(reset.sessionRef), genBefore + 1, "reset 后 JSONL 世代应 +1");
    assert.notEqual(reset.sessionRef, s1.sessionRef, "reset 后 sessionRef 应换代");
    assert.ok(fs.existsSync(reset.sessionRef), "新世代 JSONL 应落盘");
    // 同一空间仍只有一行（世代制不建行）。
    const { getDb } = await import("../../../../../../src/db.js");
    const { c } = getDb().prepare("SELECT COUNT(*) AS c FROM agent_sessions WHERE spaceKey = ?").get("feishu:oc_1");
    assert.equal(c, 1, "feishu:* reset 世代制不应新建 agent_sessions 行");
  });
});

describe("REQ-AGENT-027 标准 5 feishu:* HTTP reset 不套用 UI 新行语义", () => {
  let workdir;
  let serverCtx;
  let savedConfigDir;
  let agentSessionsDbPath;

  beforeEach(async () => {
    workdir = fs.mkdtempSync(path.join(os.tmpdir(), "feishu-http-reset-"));
    savedConfigDir = process.env.OPC_WORKSTATION_CONFIG_DIR;
    process.env.OPC_WORKSTATION_CONFIG_DIR = workdir;
    agentSessionsDbPath = path.join(workdir, "agent-sessions.db");

    // Arrange：server 启动前在 store 库预置一条 feishu:* 行（旧 schema 直插，
    // 模拟飞书通道既有对话空间；title 附加列由迁移补齐，不在本测试断言面）。
    const sessionDir = path.join(workdir, "agent-sessions");
    fs.mkdirSync(sessionDir, { recursive: true });
    const ref = path.join(sessionDir, "feishu_oc_http_reset.jsonl");
    fs.writeFileSync(ref, JSON.stringify({ type: "message_end", content: "飞书历史" }) + "\n", "utf8");
    const seedDb = new Database(agentSessionsDbPath);
    seedDb.exec(`
      CREATE TABLE IF NOT EXISTS agent_sessions (
        spaceKey TEXT PRIMARY KEY,
        sessionRef TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        lastActiveAt TEXT NOT NULL,
        summaryRef TEXT
      );
    `);
    seedDb.prepare(
      "INSERT INTO agent_sessions (spaceKey, sessionRef, createdAt, lastActiveAt) VALUES (?, ?, ?, ?)"
    ).run("feishu:oc_http_reset", ref, "2026-08-02T00:00:00.000Z", "2026-08-02T00:00:00.000Z");
    seedDb.close();

    serverCtx = await startServer({ port: 0 });
  });

  afterEach(async () => {
    await stopServer(serverCtx);
    if (savedConfigDir === undefined) delete process.env.OPC_WORKSTATION_CONFIG_DIR;
    else process.env.OPC_WORKSTATION_CONFIG_DIR = savedConfigDir;
    fs.rmSync(workdir, { recursive: true, force: true });
  });

  it("the HTTP reset endpoint must not create a new-row/new-spaceKey session for a feishu:* space", async () => {
    // 不变量：UI 的「reset = 同分组新行」语义不得套用到 feishu 空间（世代制与
    // provider/key 重建共用；REQ-AGENT-027 标准 5 + tech-design F4「不触发世代机制
    // ——世代留给飞书空间」的分界）。
    // signoff 2026-08-06: assertion signed（裁决见 signoff.md）
    await ensureAgentSessionsRoute();

    // Act
    const res = await postJson(
      serverCtx.baseUrl,
      `/api/agent/sessions/${encodeURIComponent("feishu:oc_http_reset")}/reset`
    );

    // Assert：无论 A/B，不得返回不同 spaceKey 的「新会话」，不得建行。
    if (res.status === 200) {
      assert.equal(res.body?.spaceKey, "feishu:oc_http_reset",
        `feishu:* HTTP reset 不得套用 UI 新行语义（返回不同 spaceKey），实际: ${res.body?.spaceKey}`);
    } else {
      assert.equal(res.status, 403,
        `feishu:* HTTP reset 若拒绝应为 403 E-SESSION-READONLY，实际 ${res.status}: ${JSON.stringify(res.body)}`);
      assert.equal(res.body?.error, "E-SESSION-READONLY", `错误码应为 E-SESSION-READONLY，实际: ${res.body?.error}`);
    }
    assert.equal(countSessionRows(agentSessionsDbPath, "feishu:oc_http_reset"), 1,
      "feishu:* HTTP reset 不得新建 agent_sessions 行");
    const row = readSessionRow(agentSessionsDbPath, "feishu:oc_http_reset");
    assert.ok(row?.sessionRef.includes("feishu_oc_http_reset"),
      `feishu:* 行 sessionRef 应保持世代命名（不迁目录/不改 key 段），实际: ${row?.sessionRef}`);
  });
});
