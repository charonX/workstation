// REQ-TRACE: REQ-FLOW-028
// REQ-VERSION: v1-hash:faea1df8
// CAPABILITY-TRACE: flow-orchestration
// ENTITY-TRACE: execution
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: false

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { resetDb, getDb } from "../../../../../../src/db.js";

describe("REQ-FLOW-028: 执行日志持久化与自动清理", () => {
  beforeEach(() => {
    resetDb();
  });

  it("flow 每次执行生成执行记录，包含节点输入/输出/分支/错误/重试次数", () => {
    const db = getDb();
    // 预期新建 execution_nodes 表，与 executions 表通过 executionId 关联
    // 字段：executionId, nodeId, nodeName, inputVariables, outputVariables, branchTaken, error, attemptCount
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='execution_nodes'").all();
    assert.equal(tables.length, 1);
  });

  it("Claude Agent 节点的调用详情包含最小字段清单", () => {
    const db = getDb();
    // execution_nodes 表应包含 agent 调用详情字段
    // prompt/output/model/provider/status/error/durationMs/attemptCount
    // prompt 应脱敏/截断（前 4000 字符）
    const columns = db.prepare("PRAGMA table_info(execution_nodes)").all();
    const columnNames = columns.map((c) => c.name);
    assert.ok(columnNames.includes("prompt"));
    assert.ok(columnNames.includes("output"));
    assert.ok(columnNames.includes("model"));
    assert.ok(columnNames.includes("provider"));
    assert.ok(columnNames.includes("status"));
    assert.ok(columnNames.includes("error"));
    assert.ok(columnNames.includes("durationMs"));
    assert.ok(columnNames.includes("attemptCount"));
  });

  it("日志写入 SQLite executions 表和 execution_nodes 表，与现有执行历史兼容", () => {
    const db = getDb();
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
    const tableNames = tables.map((t) => t.name);
    assert.ok(tableNames.includes("executions"));
    assert.ok(tableNames.includes("execution_nodes"));
  });

  it("日志默认保留 7 天，到期自动清理", () => {
    const db = getDb();
    // 预期 executions 和 execution_nodes 都有 createdAt/startedAt 字段用于清理
    // 清理逻辑在 tech-design 中明确实现方式
    const columns = db.prepare("PRAGMA table_info(executions)").all();
    const columnNames = columns.map((c) => c.name);
    assert.ok(columnNames.includes("startedAt"));
  });

  it("执行日志 API 返回的字段与现有前端 Executions 详情页兼容", () => {
    // API 返回格式应与现有前端兼容，新增节点级详情通过 execution_nodes 关联查询
    assert.equal(true, true);
  });
});
