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
let projectMessagesFromJsonl;
try {
  const mod = await import("../../../../../../src/agent/trajectoryRecorder.js");
  createTrajectoryRecorder = mod.createTrajectoryRecorder;
} catch {
  createTrajectoryRecorder = null;
}
try {
  const domainMod = await import("../../../../../../src/services/sessionDomain.js");
  projectMessagesFromJsonl = domainMod.projectMessagesFromJsonl;
} catch {
  projectMessagesFromJsonl = null;
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
    let prevSeq = 0;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      assert.equal(line.v, 1, `第 ${i + 1} 行 schema 版本 v 必须为 1`);
      assert.ok(line.seq >= prevSeq, `第 ${i + 1} 行 seq 必须单调递增/同 seq 原位更新（prev=${prevSeq}, curr=${line.seq}）`);
      prevSeq = line.seq;
      assert.ok(typeof line.ts === "string" && !Number.isNaN(Date.parse(line.ts)), `第 ${i + 1} 行 ts 必须为合法 ISO 8601 时间戳`);
      assert.ok(typeof line.type === "string", `第 ${i + 1} 行必须包含合法 type 枚举`);
    }

    const turnRow = lines.find((l) => l.type === "turn_boundary");
    assert.ok(turnRow, "必须包含 turn_boundary 记录行");
    assert.equal(turnRow.turn, 1);

    const completedTools = lines.filter((l) => l.type === "tool_call" && l.status === "completed");
    assert.equal(completedTools.length, 2, "预期恰有 2 行 completed 工具记录（T1 锚点）");
    const runningTools = lines.filter((l) => l.type === "tool_call" && l.status === "running");
    assert.equal(runningTools.length, 2, "预期恰有 2 行 running 工具记录（L2 锚点）");
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
    const toolRow = lines.findLast((l) => l.type === "tool_call" && l.toolCallId === "tc_list_01");

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
    const toolRow = lines.findLast((l) => l.toolCallId === "tc_bash_01");

    assert.ok(toolRow, "中断的工具记录应存在");
    assert.equal(toolRow.status, "interrupted", "in-flight 工具在中断时状态应收尾为 interrupted（T4 锚点）");
    assert.equal(toolRow.durationMs, undefined, "中断路径恒不伪造 durationMs 字段");
  });

  it("REQ-AGENT-127 AC5: 历史投影零污染（锚点 §6.3 R1）", () => {
    assert.ok(projectMessagesFromJsonl, "seam 未就绪：src/services/sessionDomain.js 尚未导出 projectMessagesFromJsonl");
    const recorder = getRecorder();
    const sessionKey = "ui:copilot:sess_r1";
    const safeKey = "ui_copilot_sess_r1";
    const mainJsonlPath = path.join(sessionDir, `${safeKey}.jsonl`);

    // 写入主会话 JSONL（标准 user/assistant 消息）
    const mainEntries = [
      JSON.stringify({ type: "message", id: "m1", timestamp: "2026-08-23T08:00:00.000Z", message: { role: "user", content: "列出项目" } }),
      JSON.stringify({ type: "message", id: "m2", timestamp: "2026-08-23T08:00:05.000Z", message: { role: "assistant", content: "已为您列出项目。" } }),
    ];
    fs.writeFileSync(mainJsonlPath, mainEntries.join("\n") + "\n", "utf8");

    // 触发轨迹记录器写入 sidecar 轨迹
    recorder.onTurnStart({ sessionKey, safeKey, turn: 1 });
    recorder.onUserMessage({ sessionKey, safeKey, text: "列出项目" });
    recorder.onToolStart({ sessionKey, safeKey, toolCallId: "tc_r1", toolName: "project list", args: {} });
    recorder.onToolEnd({ sessionKey, safeKey, toolCallId: "tc_r1", result: { ok: true }, isError: false });
    recorder.onTurnEnd({ sessionKey, safeKey });

    // 断言 sidecar 生成但主 JSONL 投影纯净，仅包含 user/assistant 文本，保持 BUG-009 契约
    const sidecarLines = readSidecarLines(`${safeKey}.traj.jsonl`);
    assert.ok(sidecarLines.length > 0, "sidecar 轨迹文件应正常写入");

    const projected = projectMessagesFromJsonl(mainJsonlPath);
    assert.equal(projected.length, 2, "历史投影应恰有 2 条消息");
    assert.equal(projected[0].role, "user");
    assert.equal(projected[0].text, "列出项目");
    assert.equal(projected[1].role, "assistant");
    assert.equal(projected[1].text, "已为您列出项目。");
    assert.ok(projected.every((m) => m.role === "user" || m.role === "assistant"), "历史投影绝不能包含任何 tool 类型条目（BUG-009 纯净契约）");
  });

  it("REQ-AGENT-127 AC5 (附加): 载体截断 ≤256KB 保护（PRD §10.4 接口 1）", () => {
    const recorder = getRecorder();
    const sessionKey = "ui:copilot:sess_05";
    const safeKey = "ui_copilot_sess_05";

    const largePayload = "X".repeat(300 * 1024); // 300KB 超出 256KB 上限
    recorder.onTurnStart({ sessionKey, safeKey, turn: 1 });
    recorder.onToolStart({ sessionKey, safeKey, toolCallId: "tc_large_01", toolName: "file read", args: { path: "big.txt" } });
    recorder.onToolEnd({ sessionKey, safeKey, toolCallId: "tc_large_01", result: { content: largePayload }, isError: false });

    const lines = readSidecarLines(`${safeKey}.traj.jsonl`);
    const toolRow = lines.findLast((l) => l.toolCallId === "tc_large_01");

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
    assert.equal(sendCalled, true, "写磁盘异常时出站 IPC 推送仍应执行");
  });

  it("REQ-AGENT-127 (C3 补强): watchdog 重启后惰性恢复 maxSeq 基线避免撞号", () => {
    const sessionKey = "ui:copilot:sess_restart";
    const safeKey = "ui_copilot_sess_restart";

    // 世代 1 / 崩溃前 worker 写入 seq 1, 2
    const recorder1 = getRecorder();
    recorder1.onTurnStart({ sessionKey, safeKey, turn: 1 });
    recorder1.onUserMessage({ sessionKey, safeKey, text: "第一次提问" });

    const linesBefore = readSidecarLines(`${safeKey}.traj.jsonl`);
    assert.equal(linesBefore.length, 2);
    assert.equal(linesBefore[0].seq, 1);
    assert.equal(linesBefore[1].seq, 2);

    // 模拟 watchdog 重启 worker（新 recorder 实例，内存状态全空）
    const recorder2 = getRecorder();
    recorder2.onTurnStart({ sessionKey, safeKey, turn: 2 });
    recorder2.onUserMessage({ sessionKey, safeKey, text: "重启后提问" });

    const linesAfter = readSidecarLines(`${safeKey}.traj.jsonl`);
    assert.equal(linesAfter.length, 4);
    assert.equal(linesAfter[2].seq, 3, "重启后首写应从 maxSeq + 1 (3) 开始递增，不得从 1 重撞");
    assert.equal(linesAfter[3].seq, 4);
  });

  it("REQ-AGENT-127 (C4 补强): onToolStart 产生 running 状态记录行（L2 锚点）且 end 时同 seq 回填", () => {
    const recorder = getRecorder();
    const sessionKey = "ui:copilot:sess_running";
    const safeKey = "ui_copilot_sess_running";

    recorder.onTurnStart({ sessionKey, safeKey, turn: 1 });
    const runRec = recorder.onToolStart({
      sessionKey,
      safeKey,
      toolCallId: "tc_run_01",
      toolName: "fetch_data",
      args: { url: "https://api.example.com" },
    });

    assert.equal(runRec.status, "running", "onToolStart 必须产出 status: running 记录");
    assert.equal(runRec.durationMs, undefined, "running 状态不得包含 durationMs（in-flight 零伪造时长）");

    const linesMid = readSidecarLines(`${safeKey}.traj.jsonl`);
    const runningRow = linesMid.find((l) => l.toolCallId === "tc_run_01" && l.status === "running");
    assert.ok(runningRow, "sidecar 中必须落盘 running 记录行");
    assert.equal(runningRow.seq, runRec.seq);

    // 工具完成，回填同 seq
    const endRec = recorder.onToolEnd({
      sessionKey,
      safeKey,
      toolCallId: "tc_run_01",
      result: { data: 123 },
      durationMs: 150,
      isError: false,
    });
    assert.equal(endRec.seq, runRec.seq, "onToolEnd 必须保持与 onToolStart 相同的 seq 进行原位更新");
    assert.equal(endRec.status, "completed");
    assert.equal(endRec.durationMs, 150);
  });

  it("REQ-AGENT-127: 多步 Assistant 交互回合中各步骤 assistant_span 独立且预览文本正确", () => {
    let currentTime = 1787472000000;
    const recorder = getRecorder({
      getTime: () => currentTime,
    });
    const sessionKey = "ui:copilot:sess_multistep";
    const safeKey = "ui_copilot_sess_multistep";

    // 1. 用户提问
    recorder.onTurnStart({ sessionKey, safeKey, turn: 1 });
    recorder.onUserMessage({ sessionKey, safeKey, text: "帮我查询系统状态并分析" });

    // 2. 第一步 Assistant 思考与调用工具
    currentTime += 500;
    recorder.onFirstTextDelta({ sessionKey, safeKey, textPreview: "我先查询一下系统状态" });
    currentTime += 1000;
    recorder.onAssistantMessageEnd({
      sessionKey,
      safeKey,
      usage: { input: 100, output: 20 },
      textPreview: "我先查询一下系统状态：",
    });

    // 3. 执行工具
    recorder.onToolStart({ sessionKey, safeKey, toolCallId: "tc_status_01", toolName: "dashboard_stats", args: {} });
    currentTime += 800;
    recorder.onToolEnd({ sessionKey, safeKey, toolCallId: "tc_status_01", result: { ok: true }, isError: false });

    // 4. 第二步 Assistant 根据工具结果给出最终回复
    currentTime += 400; // TTFT 400ms 从工具完成起算
    recorder.onFirstTextDelta({ sessionKey, safeKey, textPreview: "摸底完成，状态良好。" });
    currentTime += 1500;
    recorder.onAssistantMessageEnd({
      sessionKey,
      safeKey,
      usage: { input: 200, output: 80 },
      textPreview: "摸底完成，状态良好。以下是分析方案...",
    });
    recorder.onTurnEnd({ sessionKey, safeKey });

    const lines = readSidecarLines(`${safeKey}.traj.jsonl`);
    const assistantSpans = lines.filter((l) => l.type === "assistant_span");
    assert.equal(assistantSpans.length, 2, "多步调用中应恰好生成 2 个独立的 assistant_span");

    assert.equal(assistantSpans[0].textPreview, "我先查询一下系统状态：");
    assert.equal(assistantSpans[0].ttftMs, 500);
    assert.equal(assistantSpans[0].decodeMs, 1000);

    assert.equal(assistantSpans[1].textPreview, "摸底完成，状态良好。以下是分析方案...");
    assert.equal(assistantSpans[1].ttftMs, 400);
    assert.equal(assistantSpans[1].decodeMs, 1500);
  });

  it("REQ-AGENT-127: 重启/恢复后从既有侧车恢复 maxTurn，多回合序号单调递增且不重复发 turn_boundary", () => {
    const sessionKey = "ui:copilot:session_turn_recovery";
    const safeKey = "ui_copilot_session_turn_recovery";

    // 实例 1：运行 Turn 1
    const rec1 = getRecorder();
    rec1.onTurnStart({ sessionKey, safeKey });
    rec1.onUserMessage({ sessionKey, safeKey, text: "第一回合" });
    rec1.onAssistantMessageEnd({ sessionKey, safeKey, textPreview: "第一回合完成" });
    rec1.onTurnEnd({ sessionKey, safeKey });

    // 模拟 Worker 重启，实例化全新的 recorder
    const rec2 = getRecorder();
    rec2.onTurnStart({ sessionKey, safeKey });
    rec2.onUserMessage({ sessionKey, safeKey, text: "第二回合" });
    rec2.onAssistantMessageEnd({ sessionKey, safeKey, textPreview: "第二回合完成" });
    rec2.onTurnEnd({ sessionKey, safeKey });

    const lines = readSidecarLines(`${safeKey}.traj.jsonl`);
    const turnBoundaries = lines.filter((l) => l.type === "turn_boundary");
    assert.equal(turnBoundaries.length, 2, "两轮回合应恰好有 2 个 turn_boundary，不应多余生成");
    assert.equal(turnBoundaries[0].turn, 1);
    assert.equal(turnBoundaries[1].turn, 2, "重启后第二轮必须正确递增为 turn: 2");
  });
});

