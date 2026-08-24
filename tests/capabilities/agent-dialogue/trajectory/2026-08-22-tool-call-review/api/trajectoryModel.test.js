// REQ-TRACE: 2026-08-22-tool-call-review/REQ-AGENT-134, 2026-08-22-tool-call-review/REQ-AGENT-132
// REQ-VERSION: v1-hash:cd8088309c498ee02824a8f9ff74c5d454bcfe3496be20777990ce134a267fa6
// CAPABILITY-TRACE: agent-dialogue
// ENTITY-TRACE: trajectory
// EXPECTED-TRACE: prd.md §6.3 S1, TL1, TL2, §10.2 trajectoryModel.js, §10.4 contract 3, §10.5 D4
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true

import { describe, it } from "node:test";
import assert from "node:assert/strict";

// 动态载入纯函数模型模块（node 环境可执行，用于 SSR 自验与双数据源一致性断言）
let createTrajectoryState;
let applyTrajectoryRecord;
let prependTrajectoryRecords;
let filterRecordsByTimeRange;
let calculateTimelineSegments;

let filterVisibleLedgerRecords;
let extractTurnNumbers;

try {
  const mod = await import("../../../../../../src/renderer/components/trajectory/trajectoryModel.js");
  createTrajectoryState = mod.createTrajectoryState;
  applyTrajectoryRecord = mod.applyTrajectoryRecord;
  prependTrajectoryRecords = mod.prependTrajectoryRecords;
  filterRecordsByTimeRange = mod.filterRecordsByTimeRange;
  calculateTimelineSegments = mod.calculateTimelineSegments;
  filterVisibleLedgerRecords = mod.filterVisibleLedgerRecords;
  extractTurnNumbers = mod.extractTurnNumbers;
} catch {
  createTrajectoryState = null;
  applyTrajectoryRecord = null;
  prependTrajectoryRecords = null;
  filterRecordsByTimeRange = null;
  calculateTimelineSegments = null;
  filterVisibleLedgerRecords = null;
  extractTurnNumbers = null;
}

describe("REQ-AGENT-134 & REQ-AGENT-132 trajectoryModel 纯函数数据模型与状态演化", () => {
  function checkSeam() {
    assert.ok(createTrajectoryState, "seam 未就绪：src/renderer/components/trajectory/trajectoryModel.js 尚未实现（REQ-AGENT-134）");
  }

  it("REQ-AGENT-134 AC2: 初始状态构建与按 seq 升序排列", () => {
    checkSeam();
    const initialRecords = [
      { v: 1, seq: 1, ts: "2026-08-23T08:00:01.000Z", type: "turn_boundary", turn: 1 },
      { v: 1, seq: 2, ts: "2026-08-23T08:00:02.000Z", type: "user_message", text: "hi" },
    ];
    const state = createTrajectoryState(initialRecords);

    assert.equal(state.records.length, 2);
    assert.equal(state.records[0].seq, 1);
    assert.equal(state.records[1].seq, 2);
    assert.equal(state.maxSeq, 2);
  });

  it("REQ-AGENT-134 AC2: live 工具 running → completed 状态原位更新与键稳定性", () => {
    checkSeam();
    let state = createTrajectoryState([]);

    // 1. live 收到 running 工具事件
    const runningTool = {
      v: 1,
      seq: 3,
      ts: "2026-08-23T08:00:03.000Z",
      type: "tool_call",
      toolCallId: "tc_bash_01",
      name: "bash",
      status: "running",
      input: { command: "ls" },
    };
    state = applyTrajectoryRecord(state, runningTool);

    assert.equal(state.records.length, 1);
    assert.equal(state.records[0].status, "running");
    assert.equal(state.records[0].key, "traj_3", "行 key 必须由 seq 稳定派生");

    // 2. live 收到同一 seq 的 completed 事件（原位收尾更新）
    const completedTool = {
      v: 1,
      seq: 3,
      ts: "2026-08-23T08:00:03.000Z",
      type: "tool_call",
      toolCallId: "tc_bash_01",
      name: "bash",
      status: "completed",
      input: { command: "ls" },
      output: { stdout: "file.txt" },
      durationMs: 120,
      isError: false,
    };
    state = applyTrajectoryRecord(state, completedTool);

    assert.equal(state.records.length, 1, "同一 seq 更新不应新增行，必须原位更新");
    assert.equal(state.records[0].status, "completed");
    assert.equal(state.records[0].durationMs, 120);
    assert.equal(state.records[0].key, "traj_3", "更新前后 React key 必须完全一致");
  });

  it("REQ-AGENT-134 AC2: 重复 seq 幂等处理与乱序保护", () => {
    checkSeam();
    let state = createTrajectoryState([
      { v: 1, seq: 1, ts: "2026-08-23T08:00:01.000Z", type: "turn_boundary", turn: 1 },
      { v: 1, seq: 2, ts: "2026-08-23T08:00:02.000Z", type: "user_message", text: "test" },
    ]);

    // 收到已存在的 seq=2 记录
    state = applyTrajectoryRecord(state, {
      v: 1,
      seq: 2,
      ts: "2026-08-23T08:00:02.000Z",
      type: "user_message",
      text: "test updated",
    });

    assert.equal(state.records.length, 2, "重复 seq 不应产生新行");
    assert.equal(state.records[1].text, "test updated");
  });

  it("REQ-AGENT-134 AC2: 顶部触底加载历史页（prependTrajectoryRecords）合并保序", () => {
    checkSeam();
    // 当前内存中只有较新的 seq 4..5
    let state = createTrajectoryState([
      { v: 1, seq: 4, ts: "2026-08-23T08:00:04.000Z", type: "tool_call", toolCallId: "tc_2" },
      { v: 1, seq: 5, ts: "2026-08-23T08:00:05.000Z", type: "assistant_span" },
    ]);

    // 触顶拉取更早一页 seq 1..3
    const earlierRecords = [
      { v: 1, seq: 1, ts: "2026-08-23T08:00:01.000Z", type: "turn_boundary", turn: 1 },
      { v: 1, seq: 2, ts: "2026-08-23T08:00:02.000Z", type: "user_message", text: "hi" },
      { v: 1, seq: 3, ts: "2026-08-23T08:00:03.000Z", type: "tool_call", toolCallId: "tc_1" },
    ];

    state = prependTrajectoryRecords(state, earlierRecords);

    assert.equal(state.records.length, 5);
    assert.deepEqual(state.records.map((r) => r.seq), [1, 2, 3, 4, 5], "prepend 后数组必须严格维持全局升序");
  });

  it("REQ-AGENT-132 AC2: 时间域换算与选区过滤（filterRecordsByTimeRange）", () => {
    checkSeam();
    const records = [
      { v: 1, seq: 1, ts: "2026-08-23T08:00:00.000Z", type: "turn_boundary", turn: 1 },
      { v: 1, seq: 2, ts: "2026-08-23T08:00:01.000Z", type: "tool_call", toolCallId: "tc_1", durationMs: 1000 }, // 08:00:01 - 08:00:02
      { v: 1, seq: 3, ts: "2026-08-23T08:00:05.000Z", type: "tool_call", toolCallId: "tc_2", durationMs: 2000 }, // 08:00:05 - 08:00:07
      { v: 1, seq: 4, ts: "2026-08-23T08:00:10.000Z", type: "assistant_span", ttftMs: 500, decodeMs: 1500 },     // 08:00:10 - 08:00:12
    ];

    // 过滤区间：08:00:04 至 08:00:08（仅包含 tc_2）
    const rangeStart = new Date("2026-08-23T08:00:04.000Z").getTime();
    const rangeEnd = new Date("2026-08-23T08:00:08.000Z").getTime();

    const filtered = filterRecordsByTimeRange(records, rangeStart, rangeEnd);
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0].toolCallId, "tc_2", "预期仅过滤出 tc_2 记录（TL2 锚点）");
  });

  it("REQ-AGENT-132 AC1: Assistant 片段拆分计算（calculateTimelineSegments）", () => {
    checkSeam();
    const assistantRecord = {
      v: 1,
      seq: 4,
      ts: "2026-08-23T08:00:10.000Z",
      type: "assistant_span",
      ttftMs: 500,
      decodeMs: 1500,
    };

    const segments = calculateTimelineSegments(assistantRecord);
    assert.equal(segments.length, 2, "assistant 片段必须拆为 ttft 与 decode 两段（TL1 锚点）");
    assert.equal(segments[0].type, "ttft");
    assert.equal(segments[0].durationMs, 500);
    assert.equal(segments[1].type, "decode");
    assert.equal(segments[1].durationMs, 1500);
  });

  it("长对话性能优化: filterVisibleLedgerRecords 支持按回合收起与展开", () => {
    checkSeam();
    const records = [
      // Turn 1 (含 3 条子记录)
      { v: 1, seq: 1, ts: "2026-08-23T08:00:00.000Z", type: "turn_boundary", turn: 1 },
      { v: 1, seq: 2, ts: "2026-08-23T08:00:01.000Z", type: "user_message", text: "提问 1" },
      { v: 1, seq: 3, ts: "2026-08-23T08:00:02.000Z", type: "tool_call", toolCallId: "tc_1" },
      { v: 1, seq: 4, ts: "2026-08-23T08:00:03.000Z", type: "assistant_span" },
      // Turn 2 (含 2 条子记录)
      { v: 1, seq: 5, ts: "2026-08-23T08:05:00.000Z", type: "turn_boundary", turn: 2 },
      { v: 1, seq: 6, ts: "2026-08-23T08:05:01.000Z", type: "user_message", text: "提问 2" },
      { v: 1, seq: 7, ts: "2026-08-23T08:05:02.000Z", type: "assistant_span" },
    ];

    const allTurns = extractTurnNumbers(records);
    assert.deepEqual(allTurns, [1, 2]);

    // 1. 无折叠时，全量输出
    const full = filterVisibleLedgerRecords(records, new Set());
    assert.equal(full.length, 7);

    // 2. 收起 Turn 1，仅保留 Turn 1 的 boundary 单行，跳过其 3 条子记录
    const collapsedTurn1 = filterVisibleLedgerRecords(records, new Set([1]));
    assert.equal(collapsedTurn1.length, 4, "Turn 1 折叠后应只有 boundary 1 行 + Turn 2 的 3 行");
    assert.equal(collapsedTurn1[0].type, "turn_boundary");
    assert.equal(collapsedTurn1[0].isCollapsed, true);
    assert.equal(collapsedTurn1[0].subRecordCount, 3);
    assert.equal(collapsedTurn1[1].type, "turn_boundary");
    assert.equal(collapsedTurn1[1].turn, 2);
    assert.equal(collapsedTurn1[1].isCollapsed, false);
  });
});
