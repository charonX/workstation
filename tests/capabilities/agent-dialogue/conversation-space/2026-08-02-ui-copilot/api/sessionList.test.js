// REQ-TRACE: 2026-08-02-ui-copilot/REQ-AGENT-029
// REQ-VERSION: v1-hash:8432c0cff25d5ef4a71d5c8fd95b3045977d65430eb968d7063be5fc81d67012
// CAPABILITY-TRACE: agent-dialogue
// ENTITY-TRACE: conversation-space
// BUG-TRACE: BUG-003
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
// 孤儿/飞书会话行无法经 POST 端点合法创建（无效 projectId 被 400 拒绝、飞书空间
// 由通道侧产生），测试经 better-sqlite3 直插 agent_sessions 造数（表缺失时自建，
// DDL 与 db.js initSchema 同构 + title 附加列）。
//
// seam：routes/agentSessions（tech-design「接口契约」）：
//   GET /api/agent/sessions → { general: [...], projects: [{ projectId, projectName, orphan, sessions: [...] }], feishu: [...] }；
//   GET /api/agent/sessions/:spaceKey/messages?limit&before → 历史消息（JSONL 投影，默认 limit=100）。
async function ensureAgentSessionsRoute() {
  const mod = await import("../../../../../../src/http/routes/agentSessions.js").catch(() => null);
  assert.ok(mod, "seam 未就绪：src/http/routes/agentSessions.js 尚未实现（REQ-AGENT-029）");
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

async function getJson(baseUrl, urlPath) {
  const res = await fetch(`${baseUrl}${urlPath}`);
  return { status: res.status, body: await res.json().catch(() => null) };
}

// 直插一行 agent_sessions（含 JSONL 占位），供孤儿/飞书/排序测试造数。
// 表不存在时按现行契约 DDL 自建（实现 CREATE IF NOT EXISTS 幂等，不自相覆盖）。
function seedSessionRow(agentSessionsDbPath, sessionDir, { spaceKey, lastActiveAt, title = null }) {
  const safeKey = String(spaceKey).replace(/[^a-zA-Z0-9_-]/g, "_");
  const sessionRef = path.join(sessionDir, `${safeKey}.jsonl`);
  fs.mkdirSync(sessionDir, { recursive: true });
  fs.closeSync(fs.openSync(sessionRef, "a"));
  const db = new Database(agentSessionsDbPath);
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS agent_sessions (
        spaceKey TEXT PRIMARY KEY,
        sessionRef TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        lastActiveAt TEXT NOT NULL,
        summaryRef TEXT,
        title TEXT
      );
    `);
    db.prepare(
      "INSERT INTO agent_sessions (spaceKey, sessionRef, createdAt, lastActiveAt, title) VALUES (?, ?, ?, ?, ?)"
    ).run(spaceKey, sessionRef, "2026-08-06T08:00:00.000Z", lastActiveAt, title);
  } finally {
    db.close();
  }
  return sessionRef;
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

describe("REQ-AGENT-029 分组会话列表与历史回看", () => {
  let workdir;
  let serverCtx;
  let savedConfigDir;
  let agentSessionsDbPath;
  let sessionDir;

  beforeEach(async () => {
    workdir = fs.mkdtempSync(path.join(os.tmpdir(), "ui-copilot-list-"));
    savedConfigDir = process.env.OPC_WORKSTATION_CONFIG_DIR;
    process.env.OPC_WORKSTATION_CONFIG_DIR = workdir;
    agentSessionsDbPath = path.join(workdir, "agent-sessions.db");
    sessionDir = path.join(workdir, "agent-sessions");
    serverCtx = await startServer({ port: 0 });
  });

  afterEach(async () => {
    await stopServer(serverCtx);
    if (savedConfigDir === undefined) delete process.env.OPC_WORKSTATION_CONFIG_DIR;
    else process.env.OPC_WORKSTATION_CONFIG_DIR = savedConfigDir;
    fs.rmSync(workdir, { recursive: true, force: true });
  });

  it("GET /api/agent/sessions returns sessions grouped into general, projects and feishu", async () => {
    await ensureAgentSessionsRoute();

    // Arrange：通用会话 + 项目会话（项目经既有项目服务建行）+ 飞书会话行（直插，
    // 模拟飞书通道既有空间）。
    const general = await postJson(serverCtx.baseUrl, "/api/agent/sessions", { spaceKind: "general" });
    assert.equal(general.status, 200, `前置：建通用会话应 200，实际 ${general.status}`);
    const projectRes = await postJson(serverCtx.baseUrl, "/api/projects", {
      name: "UI Copilot 列表项目",
      localPath: path.join(workdir, "proj")
    });
    assert.equal(projectRes.status, 201, `前置：建项目应 201，实际 ${projectRes.status}`);
    const projectId = projectRes.body.id;
    const projectSession = await postJson(serverCtx.baseUrl, "/api/agent/sessions", { spaceKind: "project", projectId });
    assert.equal(projectSession.status, 200, `前置：建项目会话应 200，实际 ${projectSession.status}`);
    seedSessionRow(agentSessionsDbPath, sessionDir, {
      spaceKey: "feishu:oc_grouped",
      lastActiveAt: "2026-08-06T09:00:00.000Z"
    });

    // Act
    const res = await getJson(serverCtx.baseUrl, "/api/agent/sessions");

    // Assert：三组结构（REQ-AGENT-029 标准 1）。
    assert.equal(res.status, 200, `列表端点应 200，实际 ${res.status}: ${JSON.stringify(res.body)}`);
    const body = res.body;
    assert.ok(Array.isArray(body?.general), "响应应含 general 数组");
    assert.ok(Array.isArray(body?.projects), "响应应含 projects 数组");
    assert.ok(Array.isArray(body?.feishu), "响应应含 feishu 数组");
    assert.ok(body.general.some((s) => s.spaceKey === general.body.spaceKey),
      `general 组应含通用会话 ${general.body.spaceKey}，实际: ${JSON.stringify(body.general)}`);
    // 项目组：join projects 表取名（REQ-AGENT-029 标准 1）。
    const group = body.projects.find((p) => p.projectId === projectId);
    assert.ok(group, `projects 组应含 projectId=${projectId} 的分组，实际: ${JSON.stringify(body.projects)}`);
    assert.equal(group.projectName, "UI Copilot 列表项目", "项目组应 join projects 表取名");
    assert.equal(group.orphan, false, "存在项目的分组 orphan 应为 false");
    assert.ok(group.sessions.some((s) => s.spaceKey === projectSession.body.spaceKey),
      "项目组 sessions 应含项目会话");
    // 飞书组。
    assert.ok(body.feishu.some((s) => s.spaceKey === "feishu:oc_grouped"),
      `feishu 组应含飞书会话，实际: ${JSON.stringify(body.feishu)}`);
    // signoff 2026-08-06: assertion signed（裁决见 signoff.md）
    const entry = body.general.find((s) => s.spaceKey === general.body.spaceKey);
    assert.ok("title" in entry, "会话条目应含 title 字段（可为 null）");
    assert.ok(typeof entry.lastActiveAt === "string", "会话条目应含 lastActiveAt");
  });

  it("a session whose projectId no longer exists in projects is grouped with orphan: true", async () => {
    await ensureAgentSessionsRoute();

    // Arrange：直插一行指向不存在项目的项目会话（POST 端点对无效 projectId 400，
    // 孤儿态只能经项目删除/库漂移产生——直插模拟该终态）。
    seedSessionRow(agentSessionsDbPath, sessionDir, {
      spaceKey: "ui:project:proj-gone:sess-1",
      lastActiveAt: "2026-08-06T09:00:00.000Z"
    });

    // Act
    const res = await getJson(serverCtx.baseUrl, "/api/agent/sessions");

    // Assert（REQ-AGENT-029 标准 2）。
    assert.equal(res.status, 200, `列表端点应 200，实际 ${res.status}`);
    const orphanGroup = (res.body?.projects ?? []).find((p) => p.projectId === "proj-gone");
    assert.ok(orphanGroup, `孤儿项目会话应仍出现在 projects 组，实际: ${JSON.stringify(res.body?.projects)}`);
    assert.equal(orphanGroup.orphan, true, "projectId 在 projects 不存在时该组 orphan 应为 true");
    assert.ok(orphanGroup.sessions.some((s) => s.spaceKey === "ui:project:proj-gone:sess-1"),
      "孤儿组应含该会话");
    // signoff 2026-08-06: assertion signed（裁决见 signoff.md）
    // T-2（test-gap 修复）：收紧为 === null（signoff 裁决 16：孤儿 projectName 不回填 pid）——
    // 原 `null || string` 弱断言无法捕获裁决 16 回归。
    assert.equal(orphanGroup.projectName, null, "孤儿组 projectName 应为 null（裁决 16，不回填 pid）");
  });

  it("sessions within a group are ordered by lastActiveAt descending", async () => {
    await ensureAgentSessionsRoute();

    // Arrange：两条通用会话，直写 lastActiveAt 固定值消除时序偶然性。
    const s1 = await postJson(serverCtx.baseUrl, "/api/agent/sessions", { spaceKind: "general" });
    const s2 = await postJson(serverCtx.baseUrl, "/api/agent/sessions", { spaceKind: "general" });
    assert.equal(s1.status, 200, "前置：建会话 1");
    assert.equal(s2.status, 200, "前置：建会话 2");
    const db = new Database(agentSessionsDbPath);
    try {
      db.prepare("UPDATE agent_sessions SET lastActiveAt = ? WHERE spaceKey = ?")
        .run("2026-08-06T10:00:00.000Z", s1.body.spaceKey);
      db.prepare("UPDATE agent_sessions SET lastActiveAt = ? WHERE spaceKey = ?")
        .run("2026-08-06T12:00:00.000Z", s2.body.spaceKey);
    } finally {
      db.close();
    }

    // Act
    const res = await getJson(serverCtx.baseUrl, "/api/agent/sessions");

    // Assert（REQ-AGENT-029 标准 3）：组内 lastActiveAt 倒序。
    assert.equal(res.status, 200, `列表端点应 200，实际 ${res.status}`);
    const keys = (res.body?.general ?? []).map((s) => s.spaceKey);
    const i1 = keys.indexOf(s1.body.spaceKey);
    const i2 = keys.indexOf(s2.body.spaceKey);
    assert.ok(i1 !== -1 && i2 !== -1, `两条会话都应在 general 组，实际: ${JSON.stringify(keys)}`);
    assert.ok(i2 < i1, `lastActiveAt 较新的会话应排在前面（倒序），顺序: ${JSON.stringify(keys)}`);
  });

  it("BUG-003: a project without any sessions still appears in the projects group with an empty sessions array", async () => {
    await ensureAgentSessionsRoute();

    // Arrange：建一个项目，但不创建任何 ui:project:* 会话（无会话项目——从未对话，
    // 左导「项目」分组须仍显示它，行内＋/「没有聊天」空态由此可达，UX 原型语义）。
    const projectRes = await postJson(serverCtx.baseUrl, "/api/projects", {
      name: "无会话项目",
      localPath: path.join(workdir, "proj-nosession")
    });
    assert.equal(projectRes.status, 201, `前置：建项目应 201，实际 ${projectRes.status}`);
    const projectId = projectRes.body.id;

    // Act
    const res = await getJson(serverCtx.baseUrl, "/api/agent/sessions");

    // Assert（REQ-AGENT-029 标准 1 项目分组 = 所有现存项目；BUG-003 修复前该项目不出现）。
    assert.equal(res.status, 200, `列表端点应 200，实际 ${res.status}`);
    const group = (res.body?.projects ?? []).find((p) => p.projectId === projectId);
    assert.ok(group, `无会话项目应出现在 projects 组，实际: ${JSON.stringify(res.body?.projects)}`);
    assert.equal(group.projectName, "无会话项目", "无会话项目应 join projects 表取名");
    assert.equal(group.orphan, false, "现存项目分组 orphan 应为 false");
    assert.ok(Array.isArray(group.sessions) && group.sessions.length === 0,
      "无会话项目 sessions 应为空数组（前端渲染「没有聊天」空态）");
  });

  it("GET .../messages paginates with limit and before, and defaults to returning the full history within the 100 cap", async () => {
    await ensureAgentSessionsRoute();

    // Arrange：agent 已配置（FAUX）+ 会话内 3 轮用户消息（含 agent 回复，共 ≥4 条历史）。
    await configureFauxAgent();
    const created = await postJson(serverCtx.baseUrl, "/api/agent/sessions", { spaceKind: "general" });
    assert.equal(created.status, 200, "前置：建会话");
    const spaceKey = created.body.spaceKey;
    for (const text of ["第一条历史消息", "第二条历史消息", "第三条历史消息"]) {
      await sendUserMessage(serverCtx.baseUrl, agentSessionsDbPath, spaceKey, text);
    }

    // Act：全量（默认参数）。
    const full = await getJson(serverCtx.baseUrl, `/api/agent/sessions/${encodeURIComponent(spaceKey)}/messages`);

    // Assert：默认返回全部历史（总量 ≤100 时默认 limit=100 不产生截断）。
    // signoff 2026-08-06: assertion signed（裁决见 signoff.md）
    assert.equal(full.status, 200, `历史端点应 200，实际 ${full.status}`);
    // signoff 2026-08-06: assertion signed（裁决见 signoff.md）
    const fullMessages = full.body?.messages;
    assert.ok(Array.isArray(fullMessages), `历史响应应含 messages 数组，实际: ${JSON.stringify(full.body)}`);
    assert.ok(fullMessages.length >= 4, `3 轮对话应产生 ≥4 条历史（用户+agent），实际 ${fullMessages.length}`);
    const fullText = JSON.stringify(fullMessages);
    for (const text of ["第一条历史消息", "第二条历史消息", "第三条历史消息"]) {
      assert.ok(fullText.includes(text), `默认参数应返回全部历史（含「${text}」）`);
    }
    // Assert：按时间序返回（REQ-AGENT-029 标准 4）——时间戳非递减。
    const stamps = fullMessages.map((m) => m.createdAt ?? m.timestamp ?? m.at);
    assert.ok(stamps.every((s) => typeof s === "string" && s.length > 0),
      `每条消息应带时间戳字段，实际: ${JSON.stringify(fullMessages[0])}`);
    for (let i = 1; i < stamps.length; i += 1) {
      assert.ok(stamps[i] >= stamps[i - 1], `历史应按时间序返回，第 ${i} 条乱序: ${stamps[i - 1]} -> ${stamps[i]}`);
    }

    // Act：limit=2 第一页。
    const page1 = await getJson(serverCtx.baseUrl,
      `/api/agent/sessions/${encodeURIComponent(spaceKey)}/messages?limit=2`);

    // Assert：分页参数生效。
    // signoff 2026-08-06: assertion signed（裁决见 signoff.md）
    assert.equal(page1.status, 200, `limit 分页应 200，实际 ${page1.status}`);
    const p1 = page1.body?.messages;
    assert.ok(Array.isArray(p1) && p1.length === 2, `limit=2 应返回 2 条，实际: ${JSON.stringify(page1.body)}`);
    assert.deepEqual(p1, fullMessages.slice(-2), "limit=2 应返回最新 2 条（时间升序）");

    // Act：before 翻页（取上一页首条为游标，向更早翻）。
    // signoff 2026-08-06: assertion signed（裁决见 signoff.md）
    const cursor = p1[0].messageId;
    assert.ok(cursor, `消息条目应含 messageId 供 before 游标，实际: ${JSON.stringify(p1[0])}`);
    const page2 = await getJson(serverCtx.baseUrl,
      `/api/agent/sessions/${encodeURIComponent(spaceKey)}/messages?limit=2&before=${encodeURIComponent(cursor)}`);

    // Assert：before 生效——返回严格早于游标的窗口。
    assert.equal(page2.status, 200, `before 翻页应 200，实际 ${page2.status}`);
    const p2 = page2.body?.messages;
    assert.ok(Array.isArray(p2) && p2.length === 2, `before+limit=2 应返回 2 条，实际: ${JSON.stringify(page2.body)}`);
    assert.deepEqual(p2, fullMessages.slice(-4, -2), "before 应向更早翻页（紧邻窗口）");
  });

  it("feishu sessions appear in the feishu group with the chat display name from channel metadata", async () => {
    await ensureAgentSessionsRoute();

    // Arrange：飞书会话行 + 通道元数据 chat 名。
    // signoff 2026-08-06: assertion signed（裁决见 signoff.md）
    seedSessionRow(agentSessionsDbPath, sessionDir, {
      spaceKey: "feishu:oc_named",
      lastActiveAt: "2026-08-06T09:00:00.000Z"
    });
    const db = new Database(agentSessionsDbPath);
    let metaSeeded = true;
    try {
      db.exec("CREATE TABLE IF NOT EXISTS agent_space_meta (spaceKey TEXT PRIMARY KEY, displayName TEXT)");
      db.prepare("INSERT INTO agent_space_meta (spaceKey, displayName) VALUES (?, ?)")
        .run("feishu:oc_named", "产品讨论群");
    } catch {
      metaSeeded = false;
    } finally {
      db.close();
    }
    assert.ok(metaSeeded, "seam 未就绪：chat 元数据注入 seam 未定（REQ-AGENT-029 标准 5，见 TODO HUMAN ASSERTION）");

    // Act
    const res = await getJson(serverCtx.baseUrl, "/api/agent/sessions");

    // Assert（REQ-AGENT-029 标准 5）：显示名取通道元数据 chat 名。
    assert.equal(res.status, 200, `列表端点应 200，实际 ${res.status}`);
    const entry = (res.body?.feishu ?? []).find((s) => s.spaceKey === "feishu:oc_named");
    assert.ok(entry, `feishu 组应含 feishu:oc_named，实际: ${JSON.stringify(res.body?.feishu)}`);
    assert.equal(entry.displayName, "产品讨论群",
      `飞书会话显示名应取通道元数据 chat 名，实际: ${entry.displayName ?? entry.title ?? "(缺字段)"}`);
  });
});
