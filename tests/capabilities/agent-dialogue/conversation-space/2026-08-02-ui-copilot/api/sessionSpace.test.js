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

// seam：HTTP server 全栈（startServer 临时 DB + 随机端口，同 channel 套件 agentRoute.test.js
// 的模式）。UI 会话 REST 委托 sessionStore——store 库落 OPC_WORKSTATION_CONFIG_DIR 下
// agent-sessions.db、JSONL 会话文件落 agent-sessions/（server.js 既有接线），测试把
// CONFIG_DIR 指到临时目录后直读 SQLite/文件系统断言落盘真相。
//
// seam：routes/agentSessions（tech-design「接口契约」HTTP 会话端点表）。
// 建议落点 src/http/routes/agentSessions.js，挂接 server.js resource="agent"、
// subPath[0]="sessions"：
//   POST /api/agent/sessions { spaceKind: "general" | "project", projectId? } → 200 { spaceKey }；
//   projectId 无效 → 400（错误码 E-SESSION-CREATE，见接口契约表）。
async function ensureAgentSessionsRoute() {
  const mod = await import("../../../../../../src/http/routes/agentSessions.js").catch(() => null);
  assert.ok(mod, "seam 未就绪：src/http/routes/agentSessions.js 尚未实现（REQ-AGENT-027）");
  return mod;
}

const JSON_HEADERS = { "Content-Type": "application/json" };

async function postJson(baseUrl, urlPath, body) {
  const res = await fetch(`${baseUrl}${urlPath}`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(body)
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

// 直读 agent_sessions 行（store 库 = CONFIG_DIR/agent-sessions.db，server.js 既有接线）。
// 库文件/表尚不存在（seam 未建行）时返回 undefined，让断言给出可读失败而非抛错。
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

async function waitFor(condition, { timeoutMs = 15000, intervalMs = 150, description = "condition" } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const value = await condition();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  assert.fail(`timed out (${timeoutMs}ms) waiting for: ${description}`);
}

// 配置 agent（FAUX）：NODE_ENV=test 下 agentService 给 worker 注入 OPC_AGENT_FAUX=1
// （agentService.js 既有 seam），prompt 零网络走 fauxProvider。
async function configureFauxAgent() {
  const settings = await import("../../../../../../src/services/settingsService.js");
  settings.saveAgentConfig({ provider: "deepseek", apiKey: "sk-faux-ui-copilot-test" });
}

// 发送一条用户消息并等其经 PI JSONL 落盘（message 持久化是 REQ-AGENT-008 既有契约）。
async function sendUserMessage(baseUrl, dbPath, spaceKey, text) {
  const res = await postJson(baseUrl, `/api/agent/sessions/${encodeURIComponent(spaceKey)}/messages`, { text });
  assert.equal(res.status, 202, `发送用户消息应 202，实际 ${res.status}: ${JSON.stringify(res.body)}`);
  const row = readSessionRow(dbPath, spaceKey);
  assert.ok(row?.sessionRef, `发送后 agent_sessions 应有 sessionRef（spaceKey=${spaceKey}）`);
  await waitFor(
    () => fs.existsSync(row.sessionRef) && fs.readFileSync(row.sessionRef, "utf8").includes(text),
    { description: `用户消息落盘 JSONL（${text.slice(0, 12)}…）` }
  );
  return row;
}

describe("REQ-AGENT-027 空间 = 会话模型与新对话归属（创建/title/迁移）", () => {
  let workdir;
  let serverCtx;
  let savedConfigDir;
  let agentSessionsDbPath;

  beforeEach(async () => {
    workdir = fs.mkdtempSync(path.join(os.tmpdir(), "ui-copilot-space-"));
    savedConfigDir = process.env.OPC_WORKSTATION_CONFIG_DIR;
    process.env.OPC_WORKSTATION_CONFIG_DIR = workdir;
    agentSessionsDbPath = path.join(workdir, "agent-sessions.db");
    serverCtx = await startServer({ port: 0 });
  });

  afterEach(async () => {
    await stopServer(serverCtx);
    if (savedConfigDir === undefined) delete process.env.OPC_WORKSTATION_CONFIG_DIR;
    else process.env.OPC_WORKSTATION_CONFIG_DIR = savedConfigDir;
    fs.rmSync(workdir, { recursive: true, force: true });
  });

  it("POST /api/agent/sessions with spaceKind general returns a ui:copilot spaceKey, creates the agent_sessions row and the JSONL placeholder", async () => {
    await ensureAgentSessionsRoute();

    // Arrange + Act
    const res = await postJson(serverCtx.baseUrl, "/api/agent/sessions", { spaceKind: "general" });

    // Assert：响应契约（200 + spaceKey 前缀，REQ-AGENT-027 标准 1）。
    assert.equal(res.status, 200, `创建通用会话应 200，实际 ${res.status}: ${JSON.stringify(res.body)}`);
    assert.ok(typeof res.body?.spaceKey === "string", "响应应含 spaceKey");
    assert.match(res.body.spaceKey, /^ui:copilot:.+/, `通用会话 spaceKey 应匹配 ^ui:copilot:.+，实际: ${res.body.spaceKey}`);

    // Assert：agent_sessions 建行 + JSONL 占位落盘（SQLite/文件系统为真相）。
    const row = readSessionRow(agentSessionsDbPath, res.body.spaceKey);
    assert.ok(row, `agent_sessions 应有该行（spaceKey=${res.body.spaceKey}）`);
    assert.ok(row.sessionRef?.endsWith(".jsonl"), `sessionRef 应为 JSONL 路径，实际: ${row.sessionRef}`);
    assert.ok(fs.existsSync(row.sessionRef), `JSONL 占位文件应落盘: ${row.sessionRef}`);
  });

  it("POST /api/agent/sessions with spaceKind project and a valid projectId returns a ui:project:<pid> spaceKey", async () => {
    await ensureAgentSessionsRoute();

    // Arrange：项目数据走既有项目服务端点建行（projects 表 = 项目真相）。
    const projectRes = await postJson(serverCtx.baseUrl, "/api/projects", {
      name: "UI Copilot 项目",
      localPath: path.join(workdir, "proj")
    });
    assert.equal(projectRes.status, 201, `前置：建项目应 201，实际 ${projectRes.status}`);
    const projectId = projectRes.body.id;

    // Act
    const res = await postJson(serverCtx.baseUrl, "/api/agent/sessions", { spaceKind: "project", projectId });

    // Assert（REQ-AGENT-027 标准 2 前半）。
    assert.equal(res.status, 200, `创建项目会话应 200，实际 ${res.status}: ${JSON.stringify(res.body)}`);
    assert.match(res.body?.spaceKey ?? "", new RegExp(`^ui:project:${projectId}:.+`),
      `项目会话 spaceKey 应匹配 ^ui:project:<pid>:.+，实际: ${res.body?.spaceKey}`);
    const row = readSessionRow(agentSessionsDbPath, res.body.spaceKey);
    assert.ok(row, "项目会话应建 agent_sessions 行");
    assert.ok(fs.existsSync(row.sessionRef), "项目会话 JSONL 占位应落盘");
  });

  it("POST /api/agent/sessions with an unknown projectId is rejected with 400", async () => {
    await ensureAgentSessionsRoute();

    // Act（Arrange：不建任何项目，projectId 必不存在）。
    const res = await postJson(serverCtx.baseUrl, "/api/agent/sessions", {
      spaceKind: "project",
      projectId: "proj-does-not-exist"
    });

    // Assert（REQ-AGENT-027 标准 2 后半）。
    assert.equal(res.status, 400, `无效 projectId 应 400，实际 ${res.status}: ${JSON.stringify(res.body)}`);
    // signoff 2026-08-06: assertion signed（裁决见 signoff.md）
    assert.equal(res.body?.error, "E-SESSION-CREATE", `错误码应为 E-SESSION-CREATE，实际: ${res.body?.error}`);
    // 拒绝不得建行。
    const row = readSessionRow(agentSessionsDbPath, "ui:project:proj-does-not-exist:anything");
    assert.equal(row, undefined, "无效 projectId 不应建 agent_sessions 行");
  });

  it("the first user message sets the session title to its <=40-char truncation and a later message does not change it", async () => {
    await ensureAgentSessionsRoute();

    // Arrange：agent 已配置（FAUX，零网络）+ 通用会话。
    await configureFauxAgent();
    const created = await postJson(serverCtx.baseUrl, "/api/agent/sessions", { spaceKind: "general" });
    assert.equal(created.status, 200, `前置：建会话应 200，实际 ${created.status}`);
    const spaceKey = created.body.spaceKey;
    // T-1（test-gap 修复）：fixture 由 36 字加长至 54 字（补长句尾，中文语义完整），
    // 与前置断言 firstText.length > 40 一致——首条消息超过 40 字才能覆盖 title 截断。
    const firstText = "请帮我分析一下这个项目最近三次执行失败的根本原因并给出具体的改进建议清单，并列出每一步的操作建议与预期收益。";
    // signoff 2026-08-06: assertion signed（裁决见 signoff.md）
    const expectedTitle = firstText.slice(0, 40);
    assert.ok(firstText.length > 40, "前置：首条消息应超过 40 字以覆盖截断");

    // Act：发送首条用户消息。
    await sendUserMessage(serverCtx.baseUrl, agentSessionsDbPath, spaceKey, firstText);

    // Assert：title = 首条消息截断（写入时机允许异步，轮询至出现）。
    await waitFor(() => readSessionRow(agentSessionsDbPath, spaceKey)?.title, { description: "首条消息后 title 写入" });
    const titled = readSessionRow(agentSessionsDbPath, spaceKey);
    assert.equal(titled.title, expectedTitle, `title 应为首条用户消息截断（≤40 字），实际: ${titled.title}`);

    // Act：发送第二条消息并等落盘。
    const secondText = "第二条消息不应改写标题";
    await sendUserMessage(serverCtx.baseUrl, agentSessionsDbPath, spaceKey, secondText);

    // Assert：title 不被后续消息更新（REQ-AGENT-027 标准 3 后半）。
    const after = readSessionRow(agentSessionsDbPath, spaceKey);
    assert.equal(after.title, expectedTitle, "第二条消息不应改写 title");
  });
});

describe("REQ-AGENT-027 标准 6 表迁移（既有 feishu:* 行无损 + title NULL 兼容）", () => {
  let workdir;
  let serverCtx;
  let savedConfigDir;
  let agentSessionsDbPath;
  let sessionDir;

  beforeEach(async () => {
    workdir = fs.mkdtempSync(path.join(os.tmpdir(), "ui-copilot-migrate-"));
    savedConfigDir = process.env.OPC_WORKSTATION_CONFIG_DIR;
    process.env.OPC_WORKSTATION_CONFIG_DIR = workdir;
    agentSessionsDbPath = path.join(workdir, "agent-sessions.db");
    sessionDir = path.join(workdir, "agent-sessions");

    // Arrange：server 启动前预置旧 schema（无 title 列）的 agent-sessions.db + 一条
    // feishu:* 既有行 + 对应 JSONL（模拟 builtin-agent story 时代的生产库）。
    fs.mkdirSync(sessionDir, { recursive: true });
    const legacyRef = path.join(sessionDir, "feishu_oc_legacy.jsonl");
    fs.writeFileSync(legacyRef, JSON.stringify({ type: "message_end", content: "迁移前历史" }) + "\n", "utf8");
    const legacyDb = new Database(agentSessionsDbPath);
    legacyDb.exec(`
      CREATE TABLE agent_sessions (
        spaceKey TEXT PRIMARY KEY,
        sessionRef TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        lastActiveAt TEXT NOT NULL,
        summaryRef TEXT
      );
    `);
    legacyDb.prepare(
      "INSERT INTO agent_sessions (spaceKey, sessionRef, createdAt, lastActiveAt, summaryRef) VALUES (?, ?, ?, ?, ?)"
    ).run("feishu:oc_legacy", legacyRef, "2026-08-02T00:00:00.000Z", "2026-08-02T00:00:00.000Z", null);
    legacyDb.close();

    serverCtx = await startServer({ port: 0 });
  });

  afterEach(async () => {
    await stopServer(serverCtx);
    if (savedConfigDir === undefined) delete process.env.OPC_WORKSTATION_CONFIG_DIR;
    else process.env.OPC_WORKSTATION_CONFIG_DIR = savedConfigDir;
    fs.rmSync(workdir, { recursive: true, force: true });
  });

  it("migrating a pre-story agent_sessions db keeps existing feishu:* rows intact and tolerates NULL title", async () => {
    await ensureAgentSessionsRoute();

    // Act：触发惰性 sessionStore 初始化/迁移（列表端点 = 首个 store 消费方）。
    const res = await fetch(`${serverCtx.baseUrl}/api/agent/sessions`);
    assert.equal(res.status, 200, `迁移后列表端点应可用，实际 ${res.status}`);

    // Assert：既有 feishu:* 行无损（sessionRef/createdAt 不变，JSONL 不丢）。
    const db = new Database(agentSessionsDbPath, { readonly: true });
    let row;
    let cols;
    try {
      cols = db.prepare("PRAGMA table_info(agent_sessions)").all().map((c) => c.name);
      row = db.prepare("SELECT * FROM agent_sessions WHERE spaceKey = ?").get("feishu:oc_legacy");
    } finally {
      db.close();
    }
    assert.ok(row, "迁移后既有 feishu:* 行应保留");
    assert.ok(row.sessionRef.endsWith("feishu_oc_legacy.jsonl"), `sessionRef 不应被迁移改写，实际: ${row.sessionRef}`);
    assert.equal(row.createdAt, "2026-08-02T00:00:00.000Z", "createdAt 不应被迁移改写");
    assert.ok(fs.existsSync(row.sessionRef), "既有 JSONL 会话文件不应丢失");

    // Assert：title 附加列经迁移补齐，旧行 title = NULL（NULL 兼容，REQ-AGENT-027 标准 6）。
    assert.ok(cols.includes("title"), `迁移后 agent_sessions 应含 title 附加列，实际列: ${cols.join(",")}`);
    assert.equal(row.title ?? null, null, "旧行 title 应为 NULL（NULL 兼容）");
  });
});
