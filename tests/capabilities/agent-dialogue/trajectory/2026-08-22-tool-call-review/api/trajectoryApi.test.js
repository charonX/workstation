// REQ-TRACE: 2026-08-22-tool-call-review/REQ-AGENT-128
// REQ-VERSION: v1-hash:cd8088309c498ee02824a8f9ff74c5d454bcfe3496be20777990ce134a267fa6
// CAPABILITY-TRACE: agent-dialogue
// ENTITY-TRACE: trajectory
// EXPECTED-TRACE: prd.md §6.3 A1, A2, §7 input validation, §8 error states, §10.4 contract 2
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { getDb, closeDb } from "../../../../../../src/db.js";
import { startServer, stopServer } from "../../../../../../src/http/server.js";

async function getJson(baseUrl, urlPath) {
  const res = await fetch(`${baseUrl}${urlPath}`);
  return { status: res.status, body: await res.json().catch(() => null) };
}

describe("REQ-AGENT-128 轨迹读取 API（GET /api/agent/sessions/:spaceKey/trajectory）", () => {
  let workdir;
  let serverCtx;
  let savedConfigDir;
  let agentSessionsDbPath;
  let sessionDir;

  beforeEach(async () => {
    workdir = fs.mkdtempSync(path.join(os.tmpdir(), "traj-api-test-"));
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

  function seedSessionWithSidecar({ spaceKey, safeKey, sidecarLines = [] }) {
    const sessionRef = path.join(sessionDir, `${safeKey}.jsonl`);
    fs.writeFileSync(sessionRef, "", "utf8");

    const sidecarPath = path.join(sessionDir, `${safeKey}.traj.jsonl`);
    if (sidecarLines.length > 0) {
      const content = sidecarLines.map((l) => (typeof l === "string" ? l : JSON.stringify(l))).join("\n") + "\n";
      fs.writeFileSync(sidecarPath, content, "utf8");
    }

    const db = getDb(agentSessionsDbPath);
    db.prepare(`
      INSERT INTO agent_sessions (spaceKey, sessionRef, createdAt, lastActiveAt, title)
      VALUES (?, ?, ?, ?, ?)
    `).run(spaceKey, sessionRef, "2026-08-23T08:00:00.000Z", "2026-08-23T08:30:00.000Z", "轨迹测试会话");
  }

  it("REQ-AGENT-128 AC1: 游标分页基础读取（锚点 §6.3 A1）", async () => {
    const spaceKey = "ui:copilot:session_api_01";
    const safeKey = "ui_copilot_session_api_01";

    const records = [
      { v: 1, seq: 1, ts: "2026-08-23T08:00:01.000Z", type: "turn_boundary", turn: 1 },
      { v: 1, seq: 2, ts: "2026-08-23T08:00:02.000Z", type: "user_message", text: "hi" },
      { v: 1, seq: 3, ts: "2026-08-23T08:00:03.000Z", type: "tool_call", toolCallId: "tc_1", name: "project_list", status: "completed" },
      { v: 1, seq: 4, ts: "2026-08-23T08:00:04.000Z", type: "tool_call", toolCallId: "tc_2", name: "settings_get", status: "completed" },
      { v: 1, seq: 5, ts: "2026-08-23T08:00:05.000Z", type: "assistant_span", ttftMs: 200, decodeMs: 800, usage: { input: 10, output: 20 } },
    ];
    seedSessionWithSidecar({ spaceKey, safeKey, sidecarLines: records });

    const encoded = encodeURIComponent(spaceKey);
    const { status, body } = await getJson(serverCtx.baseUrl, `/api/agent/sessions/${encoded}/trajectory?limit=2`);

    assert.equal(status, 200, "GET /trajectory 应返回 200");
    assert.ok(body, "响应体不能为空");
    assert.equal(body.records.length, 2, "limit=2 预期恰好返回 2 条记录（A1 锚点）");
    assert.equal(body.hasMore, true, "总共 5 条取 2 条时 hasMore 必须为 true");
    assert.equal(typeof body.meta?.skipped, "number", "meta.skipped 必须为数值");

    // 默认尾部窗口：升序返回 seq 4 与 seq 5
    assert.equal(body.records[0].seq, 4);
    assert.equal(body.records[1].seq, 5);
  });

  it("REQ-AGENT-128 AC2: 游标 before 分页窗口（锚点 §6.3 A2）", async () => {
    const spaceKey = "ui:copilot:session_api_02";
    const safeKey = "ui_copilot_session_api_02";

    const records = [
      { v: 1, seq: 1, ts: "2026-08-23T08:00:01.000Z", type: "turn_boundary", turn: 1 },
      { v: 1, seq: 2, ts: "2026-08-23T08:00:02.000Z", type: "user_message", text: "hi" },
      { v: 1, seq: 3, ts: "2026-08-23T08:00:03.000Z", type: "tool_call", toolCallId: "tc_1", name: "project_list", status: "completed" },
      { v: 1, seq: 4, ts: "2026-08-23T08:00:04.000Z", type: "tool_call", toolCallId: "tc_2", name: "settings_get", status: "completed" },
      { v: 1, seq: 5, ts: "2026-08-23T08:00:05.000Z", type: "assistant_span", ttftMs: 200, decodeMs: 800, usage: { input: 10, output: 20 } },
    ];
    seedSessionWithSidecar({ spaceKey, safeKey, sidecarLines: records });

    const encoded = encodeURIComponent(spaceKey);
    // 请求严格早于 seq 4 的 2 条记录
    const { status, body } = await getJson(serverCtx.baseUrl, `/api/agent/sessions/${encoded}/trajectory?before=traj_4&limit=2`);

    assert.equal(status, 200);
    assert.equal(body.records.length, 2, "应返回 seq 2 与 seq 3");
    assert.equal(body.records[0].seq, 2);
    assert.equal(body.records[1].seq, 3);
    assert.equal(body.hasMore, true, "前面还有 seq 1，hasMore 为 true");
  });

  it("REQ-AGENT-128 AC3: 查询参数校验与归一化（PRD §7 表单与输入验证）", async () => {
    const spaceKey = "ui:copilot:session_api_03";
    const safeKey = "ui_copilot_session_api_03";

    const records = [
      { v: 1, seq: 1, ts: "2026-08-23T08:00:01.000Z", type: "turn_boundary", turn: 1 },
      { v: 1, seq: 2, ts: "2026-08-23T08:00:02.000Z", type: "user_message", text: "hello" },
    ];
    seedSessionWithSidecar({ spaceKey, safeKey, sidecarLines: records });

    const encoded = encodeURIComponent(spaceKey);

    // limit=0 / limit=invalid 静默归一为默认 200
    const res1 = await getJson(serverCtx.baseUrl, `/api/agent/sessions/${encoded}/trajectory?limit=0`);
    assert.equal(res1.status, 200);
    assert.equal(res1.body.records.length, 2);

    const res2 = await getJson(serverCtx.baseUrl, `/api/agent/sessions/${encoded}/trajectory?limit=abc`);
    assert.equal(res2.status, 200);
    assert.equal(res2.body.records.length, 2);

    // invalid before 游标作为无游标处理
    const res3 = await getJson(serverCtx.baseUrl, `/api/agent/sessions/${encoded}/trajectory?before=nonexistent_cursor`);
    assert.equal(res3.status, 200);
    assert.equal(res3.body.records.length, 2);
  });

  it("REQ-AGENT-128 AC4: 缺失文件空态与损坏行容错（PRD §6.2 异常 & §8 错误状态）", async () => {
    const spaceKey = "ui:copilot:session_empty_04";
    const safeKey = "ui_copilot_session_empty_04";

    // 种子会话但无 sidecar 文件
    seedSessionWithSidecar({ spaceKey, safeKey, sidecarLines: [] });

    const encoded = encodeURIComponent(spaceKey);
    const resEmpty = await getJson(serverCtx.baseUrl, `/api/agent/sessions/${encoded}/trajectory`);
    assert.equal(resEmpty.status, 200, "sidecar 缺失应返回 200 空态而非 404/500");
    assert.deepEqual(resEmpty.body.records, []);
    assert.equal(resEmpty.body.hasMore, false);
    assert.equal(resEmpty.body.meta.skipped, 0);

    // 种子会话含损坏 JSON 行
    const spaceKeyCorrupt = "ui:copilot:session_corrupt_05";
    const safeKeyCorrupt = "ui_copilot_session_corrupt_05";
    const corruptLines = [
      JSON.stringify({ v: 1, seq: 1, ts: "2026-08-23T08:00:01.000Z", type: "turn_boundary", turn: 1 }),
      "THIS_IS_NOT_VALID_JSON",
      JSON.stringify({ v: 1, seq: 3, ts: "2026-08-23T08:00:03.000Z", type: "user_message", text: "fine" }),
    ];
    seedSessionWithSidecar({ spaceKey: spaceKeyCorrupt, safeKey: safeKeyCorrupt, sidecarLines: corruptLines });

    const encodedCorrupt = encodeURIComponent(spaceKeyCorrupt);
    const resCorrupt = await getJson(serverCtx.baseUrl, `/api/agent/sessions/${encodedCorrupt}/trajectory`);
    assert.equal(resCorrupt.status, 200);
    assert.equal(resCorrupt.body.records.length, 2, "跳过坏行后应返回其余 2 条合法记录");
    assert.equal(resCorrupt.body.meta.skipped, 1, "meta.skipped 必须如实记录跳过 1 行损坏数据");
  });

  it("REQ-AGENT-128 AC5: 未知会话 404（PRD §8 错误状态）", async () => {
    const unknownKey = encodeURIComponent("ui:copilot:non_existent_sess");
    const { status, body } = await getJson(serverCtx.baseUrl, `/api/agent/sessions/${unknownKey}/trajectory`);

    assert.equal(status, 404, "未知会话应返回 404");
    assert.ok(body.error || body.message, "响应应包含标准错误信息");
  });
});
