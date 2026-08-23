// REQ-TRACE: 2026-08-22-tool-call-review/REQ-AGENT-127
// REQ-VERSION: v1-hash:cd8088309c498ee02824a8f9ff74c5d454bcfe3496be20777990ce134a267fa6
// CAPABILITY-TRACE: agent-dialogue
// ENTITY-TRACE: trajectory
// EXPECTED-TRACE: prd.md §6.3 T1, T2, T3, T4, R1, §8 error states, §10.4 contract 1
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// 动态载入待实现模块；在未实现时给出清晰 seam 提示
let createTrajectoryRecorder;
try {
  const mod = await import("../../../../../../src/agent/trajectoryRecorder.js");
  createTrajectoryRecorder = mod.createTrajectoryRecorder;
} catch {
  createTrajectoryRecorder = null;
}

describe("REQ-AGENT-127 轨迹落盘（sidecar 写入链）", () => {
  let tmpDir;
  let sessionDir;
  let sentEvents;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "traj-recorder-test-"));
    sessionDir = path.join(tmpDir, "sessions");
    fs.mkdirSync(sessionDir, { recursive: true });
    sentEvents = [];
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function getRecorder(options = {}) {
    assert.ok(createTrajectoryRecorder, "seam 未就绪：src/agent/trajectoryRecorder.js 尚未实现（REQ-AGENT-127）");
    let mockTime = options.initialTime || 1787472000000; // 2026-08-23T08:00:00.000Z
    return createTrajectoryRecorder({
      sessionDir,
      send: (msg) => sentEvents.push(msg),
      now: () => {
        if (options.getTime) return options.getTime();
        return mockTime;
      },
      ...options,
    });
  }

  function readSidecarLines(filename) {
    const filePath = path.join(sessionDir, filename);
    if (!fs.existsSync(filePath)) return [];
    const content = fs.readFileSync(filePath, "utf8").trim();
    if (!content) return [];
    return content.split("\n").map((line) => JSON.parse(line));
  }

  it("REQ-AGENT-127 AC1: 文件创建与格式合规（锚点 §6.3 T1）", () => {
    const recorder = getRecorder();
    const sessionKey = "ui:copilot:session_01";
    const safeKey = "ui_copilot_session_01";

    recorder.onTurnStart({ sessionKey, safeKey, turn: 1 });
    recorder.onUserMessage({ sessionKey, safeKey, text: "请列出当前项目" });
    recorder.onToolStart({ sessionKey, safeKey, toolCallId: "tc_01", toolName: "project list", args: { limit: 10 } });
    recorder.onToolEnd({ sessionKey, safeKey, toolCallId: "tc_01", result: { projects: ["proj_a"] }, isError: false });
    recorder.onToolStart({ sessionKey, safeKey, toolCallId: "tc_02", toolName: "settings get", args: { key: "theme" } });
    recorder.onToolEnd({ sessionKey, safeKey, toolCallId: "tc_02", result: { theme: "dark" }, isError: false });
    recorder.onTurnEnd({ sessionKey, safeKey });

    const lines = readSidecarLines(`${safeKey}.traj.jsonl`);
    assert.ok(lines.length >= 6, "至少应包含 turn_boundary、user_message 与 2 个工具的完整记录行");

    // 检查每行通用 schema
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      assert.equal(line.v, 1, `第 ${i + 1} 行 schema 版本 v 必须为 1`);
      assert.equal(line.seq, i + 1, `第 ${i + 1} 行 seq 必须单调递增（1..N）`);
      assert.ok(typeof line.ts === "string" && !Number.isNaN(Date.parse(line.ts)), `第 ${i + 1} 行 ts 必须为合法 ISO 8601 时间戳`);
      assert.ok(typeof line.type === "string", `第 ${i + 1} 行必须包含合法 type 枚举`);
    }

    const turnRow = lines.find((l) => l.type === "turn_boundary");
    assert.ok(turnRow, "必须包含 turn_boundary 记录行");
    assert.equal(turnRow.turn, 1);

    const toolRows = lines.filter((l) => l.type === "tool_call");
    assert.equal(toolRows.length, 2, "预期恰有 2 行 completed 工具记录（T1 锚点）");
    assert.equal(toolRows[0].status, "completed");
    assert.equal(toolRows[1].status, "completed");
  });

  it("REQ-AGENT-127 AC2: 工具调用记录完整性（锚点 §6.3 T2）", () => {
    let currentTime = 1787472000000;
    const recorder = getRecorder({
      getTime: () => currentTime,
    });
    const sessionKey = "ui:project:p1:sess_02";
    const safeKey = "ui_project_p1_sess_02";

    recorder.onTurnStart({ sessionKey, safeKey, turn: 1 });
    currentTime += 100;
    recorder.onToolStart({ sessionKey, safeKey, toolCallId: "tc_list_01", toolName: "project list", args: { limit: 100 } });
    currentTime += 42300; // 模拟耗时 42.3s
    recorder.onToolEnd({ sessionKey, safeKey, toolCallId: "tc_list_01", result: { ok: true }, isError: false });

    const lines = readSidecarLines(`${safeKey}.traj.jsonl`);
    const toolRow = lines.find((l) => l.type === "tool_call" && l.toolCallId === "tc_list_01");

    assert.ok(toolRow, "应生成对应 tool_call 记录行");
    assert.equal(toolRow.toolCallId, "tc_list_01");
    assert.equal(toolRow.name, "project_list", "工具名应规范化（空格转下划线/统一小写）");
    assert.equal(toolRow.status, "completed");
    assert.equal(toolRow.isError, false);
    assert.equal(toolRow.durationMs, 42300, "durationMs 必须为真实正数值（T2 锚点）");
    assert.deepEqual(toolRow.input, { limit: 100 });
    assert.deepEqual(toolRow.output, { ok: true });
  });

  it("REQ-AGENT-127 AC3: Assistant 时间片与 Token 用量（锚点 §6.3 T3）", () => {
    let currentTime = 1787472000000;
    const recorder = getRecorder({
      getTime: () => currentTime,
    });
    const sessionKey = "ui:copilot:sess_03";
    const safeKey = "ui_copilot_sess_03";

    recorder.onTurnStart({ sessionKey, safeKey, turn: 1 });
    currentTime += 830; // TTFT 830ms
    recorder.onFirstTextDelta({ sessionKey, safeKey, textPreview: "你好！" });
    currentTime += 2140; // decode 2140ms
    recorder.onAssistantMessageEnd({
      sessionKey,
      safeKey,
      usage: { input: 1842, output: 156, cacheRead: 512 },
    });
    recorder.onTurnEnd({ sessionKey, safeKey });

    const lines = readSidecarLines(`${safeKey}.traj.jsonl`);
    const assistantRow = lines.find((l) => l.type === "assistant_span");

    assert.ok(assistantRow, "应生成 assistant_span 记录行");
    assert.equal(assistantRow.ttftMs, 830, "ttftMs 必须精确记录首字延迟数值");
    assert.equal(assistantRow.decodeMs, 2140, "decodeMs 必须精确记录解码时长数值");
    assert.deepEqual(assistantRow.usage, { input: 1842, output: 156, cacheRead: 512 }, "usage 字典必须包含完整 token 字段（T3 锚点）");
  });

  it("REQ-AGENT-127 AC4: 中断收尾与零伪造时长（锚点 §6.3 T4）", () => {
    const recorder = getRecorder();
    const sessionKey = "ui:copilot:sess_04";
    const safeKey = "ui_copilot_sess_04";

    recorder.onTurnStart({ sessionKey, safeKey, turn: 1 });
    recorder.onToolStart({ sessionKey, safeKey, toolCallId: "tc_bash_01", toolName: "bash", args: { command: "sleep 10" } });
    // 中途触发停止/中断（未收到 toolEnd 即收 turnAbort/onTurnEnd）
    recorder.onTurnAbort({ sessionKey, safeKey, reason: "stop" });

    const lines = readSidecarLines(`${safeKey}.traj.jsonl`);
    const toolRow = lines.find((l) => l.toolCallId === "tc_bash_01");

    assert.ok(toolRow, "中断的工具记录应存在");
    assert.equal(toolRow.status, "interrupted", "in-flight 工具在中断时状态应收尾为 interrupted（T4 锚点）");
    assert.equal(toolRow.durationMs, undefined, "中断路径恒不伪造 durationMs 字段");
  });

  it("REQ-AGENT-127 AC5: 载体截断 ≤256KB 保护（PRD §10.4 接口 1）", () => {
    const recorder = getRecorder();
    const sessionKey = "ui:copilot:sess_05";
    const safeKey = "ui_copilot_sess_05";

    const largePayload = "X".repeat(300 * 1024); // 300KB 超出 256KB 上限
    recorder.onTurnStart({ sessionKey, safeKey, turn: 1 });
    recorder.onToolStart({ sessionKey, safeKey, toolCallId: "tc_large_01", toolName: "file read", args: { path: "big.txt" } });
    recorder.onToolEnd({ sessionKey, safeKey, toolCallId: "tc_large_01", result: { content: largePayload }, isError: false });

    const lines = readSidecarLines(`${safeKey}.traj.jsonl`);
    const toolRow = lines.find((l) => l.toolCallId === "tc_large_01");

    assert.ok(toolRow, "应生成工具记录行");
    assert.equal(toolRow.truncated, true, "超出 256KB 的载体写入时必须标注 truncated: true");
    const jsonStr = JSON.stringify(toolRow);
    assert.ok(jsonStr.length <= 265 * 1024, "截断后的整行 JSON 字符串大小应严格限制在合理范围内（≤256KB + meta 冗余）");
  });

  it("REQ-AGENT-127 AC6: 写入异常优雅降级（PRD §8 错误状态）", () => {
    // 构造一个只读目录以触发写磁盘异常
    const readonlySessionDir = path.join(tmpDir, "readonly-sessions");
    fs.mkdirSync(readonlySessionDir, { recursive: true, mode: 0o444 });

    let sendCalled = false;
    assert.ok(createTrajectoryRecorder);
    const recorder = createTrajectoryRecorder({
      sessionDir: readonlySessionDir,
      send: () => { sendCalled = true; },
      now: () => Date.now(),
    });

    const sessionKey = "ui:copilot:sess_06";
    const safeKey = "ui_copilot_sess_06";

    // 写入异常不应抛出未捕获阻断错误，同时出站推送仍可正常工作
    assert.doesNotThrow(() => {
      recorder.onTurnStart({ sessionKey, safeKey, turn: 1 });
    }, "磁盘写异常必须 Fail-Safe 捕获，不能阻断主执行链路");
  });
});
