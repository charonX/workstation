// REQ-TRACE: 2026-08-19-feishu-reset-history-archive/REQ-AGENT-125, 2026-08-19-feishu-reset-history-archive/REQ-AGENT-126
// REQ-VERSION: v2-hash:507ffe922e1d620d7fe0d6382a3c2d3b359d27085338c3b76769d794f7df5dc1
// CAPABILITY-TRACE: agent-dialogue
// ENTITY-TRACE: conversation-space
// EXPECTED-TRACE: prd.md §6.3 row 3, row 4, row 7, §8 row 1, row 3, §10.4 contract 1
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { getDb, closeDb } from "../../../../../../src/db.js";
import { startServer, stopServer } from "../../../../../../src/http/server.js";

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

describe("REQ-AGENT-125 & REQ-AGENT-126 归档会话列表可见与只读回看守护", () => {
  let workdir;
  let serverCtx;
  let savedConfigDir;
  let agentSessionsDbPath;
  let sessionDir;

  beforeEach(async () => {
    workdir = fs.mkdtempSync(path.join(os.tmpdir(), "feishu-archive-http-"));
    savedConfigDir = process.env.OPC_WORKSTATION_CONFIG_DIR;
    process.env.OPC_WORKSTATION_CONFIG_DIR = workdir;
    agentSessionsDbPath = path.join(workdir, "agent-sessions.db");
    sessionDir = path.join(workdir, "agent-sessions");
    fs.mkdirSync(sessionDir, { recursive: true });
    serverCtx = await startServer({ port: 0 });
  });

  afterEach(async () => {
    if (serverCtx) {
      await stopServer(serverCtx);
    }
    if (savedConfigDir !== undefined) {
      process.env.OPC_WORKSTATION_CONFIG_DIR = savedConfigDir;
    } else {
      delete process.env.OPC_WORKSTATION_CONFIG_DIR;
    }
    closeDb(agentSessionsDbPath);
    fs.rmSync(workdir, { recursive: true, force: true });
  });

  function seedRow({ spaceKey, sessionRef, createdAt, lastActiveAt, title, messages = [] }) {
    if (sessionRef) {
      fs.mkdirSync(path.dirname(sessionRef), { recursive: true });
      const lines = messages.map((m, idx) => JSON.stringify({
        type: "message",
        id: `msg_${idx + 1}`,
        timestamp: m.createdAt || "2026-08-19T10:00:00.000Z",
        message: { role: m.role || "user", content: m.content || "hello" }
      }));
      fs.writeFileSync(sessionRef, lines.length ? lines.join("\n") + "\n" : "", "utf8");
    }

    const db = getDb(agentSessionsDbPath);
    db.prepare(`
      INSERT INTO agent_sessions (spaceKey, sessionRef, createdAt, lastActiveAt, title)
      VALUES (?, ?, ?, ?, ?)
    `).run(spaceKey, sessionRef, createdAt || "2026-08-19T09:00:00.000Z", lastActiveAt || "2026-08-19T09:30:00.000Z", title ?? null);
  }

  function seedSpaceMeta(spaceKey, displayName) {
    const db = getDb(agentSessionsDbPath);
    db.prepare("INSERT OR REPLACE INTO agent_space_meta (spaceKey, displayName) VALUES (?, ?)")
      .run(spaceKey, displayName);
  }

  it("REQ-AGENT-125 AC1: GET /api/agent/sessions 列表包含归档条目并按 lastActiveAt 倒序", async () => {
    const gen2Ref = path.join(sessionDir, "feishu_oc_123.2.jsonl");
    const gen3Ref = path.join(sessionDir, "feishu_oc_123.3.jsonl");

    seedRow({
      spaceKey: "feishu:oc_123:gen2",
      sessionRef: gen2Ref,
      createdAt: "2026-08-19T09:00:00.000Z",
      lastActiveAt: "2026-08-19T09:30:00.000Z",
      title: "历史问题排查"
    });
    seedRow({
      spaceKey: "feishu:oc_123",
      sessionRef: gen3Ref,
      createdAt: "2026-08-19T10:00:00.000Z",
      lastActiveAt: "2026-08-19T10:05:00.000Z",
      title: null
    });

    const { status, body } = await getJson(serverCtx.baseUrl, "/api/agent/sessions");

    // EXPECTED-TRACE: prd.md §6.3 row 3
    assert.equal(status, 200);
    assert.ok(body && Array.isArray(body.feishu));
    assert.equal(body.feishu.length, 2, "feishu 分组应有 2 条会话");

    assert.equal(body.feishu[0].spaceKey, "feishu:oc_123");
    assert.equal(body.feishu[0].title, null);

    assert.equal(body.feishu[1].spaceKey, "feishu:oc_123:gen2");
    assert.equal(body.feishu[1].title, "历史问题排查");
  });

  it("REQ-AGENT-125 AC2: 归档条目 title 为空时 displayName fallback 逆解析查 spaceMeta", async () => {
    const archiveRef = path.join(sessionDir, "feishu_oc_grp.jsonl");
    seedRow({
      spaceKey: "feishu:oc_grp:gen1",
      sessionRef: archiveRef,
      title: null,
      lastActiveAt: "2026-08-19T09:00:00.000Z"
    });
    seedSpaceMeta("feishu:oc_grp", "开发支持群");

    // EXPECTED-TRACE: prd.md §10.4 contract 1 reverse parsing
    const { status, body } = await getJson(serverCtx.baseUrl, "/api/agent/sessions");
    assert.equal(status, 200);
    assert.ok(body && Array.isArray(body.feishu));
    const session = body.feishu.find((s) => s.spaceKey === "feishu:oc_grp:gen1");
    assert.ok(session);
    assert.equal(session.displayName, "开发支持群");
  });

  it("REQ-AGENT-125 AC3: 归档条目 JSONL 文件被删除时 GET /api/agent/sessions 依然正常返回", async () => {
    const missingRef = path.join(sessionDir, "feishu_oc_deleted.jsonl");
    seedRow({
      spaceKey: "feishu:oc_deleted:gen1",
      sessionRef: missingRef,
      title: "文件已删"
    });
    // 确保文件不存在
    if (fs.existsSync(missingRef)) fs.unlinkSync(missingRef);

    // EXPECTED-TRACE: prd.md §8 row 3
    const { status, body } = await getJson(serverCtx.baseUrl, "/api/agent/sessions");
    assert.equal(status, 200);
    assert.ok(body && Array.isArray(body.feishu));
    const session = body.feishu.find((s) => s.spaceKey === "feishu:oc_deleted:gen1");
    assert.ok(session);
  });

  it("REQ-AGENT-126 AC1: GET /api/agent/sessions/:spaceKey/messages 历史消息只读回看", async () => {
    const archiveRef = path.join(sessionDir, "feishu_oc_history.2.jsonl");
    seedRow({
      spaceKey: "feishu:oc_history:gen2",
      sessionRef: archiveRef,
      title: "历史",
      messages: [
        { role: "user", content: "请帮我统计本月数据", createdAt: "2026-08-19T08:00:00.000Z" },
        { role: "assistant", content: "好的，统计如下...", createdAt: "2026-08-19T08:00:05.000Z" }
      ]
    });

    const encodedKey = encodeURIComponent("feishu:oc_history:gen2");
    const { status, body } = await getJson(serverCtx.baseUrl, `/api/agent/sessions/${encodedKey}/messages`);

    // EXPECTED-TRACE: prd.md §6.3 row 4
    assert.equal(status, 200);
    assert.ok(body && Array.isArray(body.messages));
    assert.equal(body.messages.length, 2);
    assert.equal(body.messages[0].role, "user");
    assert.equal(body.messages[0].text, "请帮我统计本月数据");
    assert.equal(body.messages[1].role, "assistant");
    assert.equal(body.messages[1].text, "好的，统计如下...");
    // EXPECTED-TRACE: prd.md §6.3 row 4（回看消息保持 messageId/createdAt 与 reset 前一致）
    assert.equal(body.messages[0].messageId, "msg_1", "回读消息应保持 messageId");
    assert.equal(body.messages[0].createdAt, "2026-08-19T08:00:00.000Z", "回读消息应保持 createdAt");
    assert.equal(body.messages[1].messageId, "msg_2");
    assert.equal(body.messages[1].createdAt, "2026-08-19T08:00:05.000Z");
  });

  it("REQ-AGENT-126 AC2: 缺失 JSONL 文件回看降级为空数组", async () => {
    const missingRef = path.join(sessionDir, "feishu_oc_nonexist.jsonl");
    seedRow({
      spaceKey: "feishu:oc_nonexist:gen1",
      sessionRef: missingRef,
      title: "无文件"
    });
    if (fs.existsSync(missingRef)) fs.unlinkSync(missingRef);

    const encodedKey = encodeURIComponent("feishu:oc_nonexist:gen1");
    const { status, body } = await getJson(serverCtx.baseUrl, `/api/agent/sessions/${encodedKey}/messages`);

    // EXPECTED-TRACE: prd.md §8 row 3
    assert.equal(status, 200);
    assert.deepEqual(body, { messages: [] });
  });

  it("REQ-AGENT-126 AC3: 归档条目 POST 写操作端点全部返回 403 E-SESSION-READONLY", async () => {
    const archiveRef = path.join(sessionDir, "feishu_oc_ro.jsonl");
    seedRow({ spaceKey: "feishu:oc_ro:gen1", sessionRef: archiveRef });

    const encodedKey = encodeURIComponent("feishu:oc_ro:gen1");

    // EXPECTED-TRACE: prd.md §6.3 row 7, §8 row 1
    const postMessageRes = await postJson(serverCtx.baseUrl, `/api/agent/sessions/${encodedKey}/messages`, { text: "新消息" });
    assert.equal(postMessageRes.status, 403);
    assert.equal(postMessageRes.body?.error, "E-SESSION-READONLY");

    const postResetRes = await postJson(serverCtx.baseUrl, `/api/agent/sessions/${encodedKey}/reset`);
    assert.equal(postResetRes.status, 403);
    assert.equal(postResetRes.body?.error, "E-SESSION-READONLY");

    const postProviderRes = await postJson(serverCtx.baseUrl, `/api/agent/sessions/${encodedKey}/provider`, { provider: "deepseek" });
    assert.equal(postProviderRes.status, 403);
    assert.equal(postProviderRes.body?.error, "E-SESSION-READONLY");

    const postModeRes = await postJson(serverCtx.baseUrl, `/api/agent/sessions/${encodedKey}/mode`, { mode: "architect" });
    assert.equal(postModeRes.status, 403);
    assert.equal(postModeRes.body?.error, "E-SESSION-READONLY");
  });
});
