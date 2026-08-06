// REQ-TRACE: 2026-08-02-ui-copilot/REQ-AGENT-034
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
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { startServer, stopServer } from "../../../../../../src/http/server.js";

// seam：HTTP server 全栈（startServer 临时 DB + 随机端口）+ 临时 CONFIG_DIR
// （agent-sessions.db / agent-sessions/ 落临时目录，server.js 既有接线）。
// 飞书会话行由通道侧产生，测试经 better-sqlite3 直插 agent_sessions 造数。
//
// seam：routes/agentSessions（tech-design「接口契约」）：
//   POST /api/agent/sessions/:spaceKey/messages —— feishu:* → 403 E-SESSION-READONLY
//   （后端兜底，REQ-AGENT-028 标准 3 同断言）。
async function ensureAgentSessionsRoute() {
  const mod = await import("../../../../../../src/http/routes/agentSessions.js").catch(() => null);
  assert.ok(mod, "seam 未就绪：src/http/routes/agentSessions.js 尚未实现（REQ-AGENT-034）");
  return mod;
}

const JSON_HEADERS = { "Content-Type": "application/json" };
const ROUTE_FILE = fileURLToPath(new URL("../../../../../../src/http/routes/agentSessions.js", import.meta.url));

async function postJson(baseUrl, urlPath, body) {
  const res = await fetch(`${baseUrl}${urlPath}`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(body ?? {})
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

// 直插一行 agent_sessions（含 JSONL 占位）。表不存在时按现行契约 DDL 自建
// （实现 CREATE IF NOT EXISTS 幂等，不自相覆盖）。
function seedSessionRow(agentSessionsDbPath, sessionDir, { spaceKey, lastActiveAt }) {
  const safeKey = String(spaceKey).replace(/[^a-zA-Z0-9_-]/g, "_");
  const sessionRef = path.join(sessionDir, `${safeKey}.jsonl`);
  fs.mkdirSync(sessionDir, { recursive: true });
  fs.writeFileSync(sessionRef, JSON.stringify({ type: "message_end", content: "飞书侧历史消息" }) + "\n", "utf8");
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
      "INSERT INTO agent_sessions (spaceKey, sessionRef, createdAt, lastActiveAt) VALUES (?, ?, ?, ?)"
    ).run(spaceKey, sessionRef, "2026-08-06T08:00:00.000Z", lastActiveAt);
  } finally {
    db.close();
  }
  return sessionRef;
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

describe("REQ-AGENT-034 飞书会话只读视图（后端兜底 + 无消息桥）", () => {
  let workdir;
  let serverCtx;
  let savedConfigDir;
  let agentSessionsDbPath;
  let sessionDir;

  beforeEach(async () => {
    workdir = fs.mkdtempSync(path.join(os.tmpdir(), "feishu-readonly-"));
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

  it("POST messages to a feishu:* spaceKey is rejected with 403 E-SESSION-READONLY", async () => {
    await ensureAgentSessionsRoute();

    // Arrange：既有飞书会话行（spaceKey 存在 → 不落入 404 分支）。
    seedSessionRow(agentSessionsDbPath, sessionDir, {
      spaceKey: "feishu:oc_readonly",
      lastActiveAt: "2026-08-06T09:00:00.000Z"
    });

    // Act
    const res = await postJson(serverCtx.baseUrl,
      `/api/agent/sessions/${encodeURIComponent("feishu:oc_readonly")}/messages`,
      { text: "UI 侧向飞书会话发送应被拒绝" });

    // Assert（REQ-AGENT-034 标准 2 / REQ-AGENT-028 标准 3）。
    assert.equal(res.status, 403,
      `feishu:* 发送应 403，实际 ${res.status}: ${JSON.stringify(res.body)}`);
    assert.equal(res.body?.error, "E-SESSION-READONLY",
      `错误码应为 E-SESSION-READONLY，实际: ${res.body?.error}`);
    // signoff 2026-08-06: assertion signed（裁决见 signoff.md）
    assert.ok(typeof res.body?.message === "string" && res.body.message.length > 0,
      "错误响应应含用户可读 message 文案");
    // signoff 2026-08-06: assertion signed（裁决见 signoff.md）
  });

  it("UI session endpoints never trigger a sendCard call to the feishu channel (no message bridge)", async () => {
    await ensureAgentSessionsRoute();

    // Assert（静态，REQ-AGENT-034 标准 4「代码审查」半）：UI 会话路由模块不得引用
    // 飞书发送面——无 sendCard / channelManager / cardRenderer 依赖（无消息桥）。
    const routeSource = fs.readFileSync(ROUTE_FILE, "utf8");
    assert.ok(!/\bsendCard\b/.test(routeSource), "routes/agentSessions.js 不得引用 sendCard（无消息桥）");
    assert.ok(!/channelManager/.test(routeSource), "routes/agentSessions.js 不得引用 channelManager（无消息桥）");
    assert.ok(!/cardRenderer/.test(routeSource), "routes/agentSessions.js 不得引用 cardRenderer（无消息桥）");

    // Arrange（集成半）：spy global.fetch 捕获任何飞往飞书开放平台的调用。
    // seam 选择说明：channelManager 是通道发送唯一入口（tech-design F1），其底层经
    // fetch 打 open.feishu.cn；主进程内任何自 UI 端点触发的 sendCard 都会穿过本 spy。
    // worker 子进程不经 global.fetch（独立进程），其工具面无飞书发送能力，不在本断言面。
    const feishuCalls = [];
    const originalFetch = global.fetch;
    global.fetch = async (url, init) => {
      if (String(url).includes("feishu.cn")) {
        feishuCalls.push({ url: String(url), method: init?.method ?? "GET" });
      }
      return originalFetch(url, init);
    };

    try {
      // Arrange：agent 已配置（FAUX）+ UI 通用会话全生命周期动作。
      await configureFauxAgent();
      const created = await postJson(serverCtx.baseUrl, "/api/agent/sessions", { spaceKind: "general" });
      assert.equal(created.status, 200, `前置：建会话应 200，实际 ${created.status}`);
      const spaceKey = created.body.spaceKey;

      // Act：发送消息并等完整对话回路落定（含回复持久化——若 UI 链路存在卡片桥，
      // 流式/回复事件是最可能的触发点）。
      const text = "UI 会话消息不应触达飞书通道";
      const sent = await postJson(serverCtx.baseUrl,
        `/api/agent/sessions/${encodeURIComponent(spaceKey)}/messages`, { text });
      assert.equal(sent.status, 202, `发送应 202，实际 ${sent.status}: ${JSON.stringify(sent.body)}`);
      await waitFor(() => {
        const db = new Database(agentSessionsDbPath, { readonly: true });
        try {
          const row = db.prepare("SELECT sessionRef FROM agent_sessions WHERE spaceKey = ?").get(spaceKey);
          return row && fs.existsSync(row.sessionRef) && fs.readFileSync(row.sessionRef, "utf8").includes(text);
        } finally {
          db.close();
        }
      }, { description: "对话回路落定（消息落盘 JSONL）" });
      // 列表 / 历史 / reset 全端点走一遍。
      const list = await fetch(`${serverCtx.baseUrl}/api/agent/sessions`);
      assert.equal(list.status, 200, "前置：列表端点可用");
      const history = await fetch(`${serverCtx.baseUrl}/api/agent/sessions/${encodeURIComponent(spaceKey)}/messages`);
      assert.equal(history.status, 200, "前置：历史端点可用");
      const reset = await postJson(serverCtx.baseUrl,
        `/api/agent/sessions/${encodeURIComponent(spaceKey)}/reset`);
      assert.equal(reset.status, 200, `前置：reset 应 200，实际 ${reset.status}`);

      // Assert（REQ-AGENT-034 标准 4）：全程零飞书通道发送调用。
      assert.deepEqual(feishuCalls, [],
        `UI 会话端点不应触发任何飞书通道调用（无消息桥），实际捕获: ${JSON.stringify(feishuCalls)}`);
    } finally {
      global.fetch = originalFetch;
    }
  });
});
