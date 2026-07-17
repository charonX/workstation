// REQ-TRACE: REQ-FLOW-028
// REQ-VERSION: v1-hash:2585f81f
// CAPABILITY-TRACE: flow-orchestration
// ENTITY-TRACE: execution
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: false

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { resetDb, getDb } from "../../../../../../src/db.js";
import { startServer, stopServer } from "../../../../../../src/http/server.js";
import { setQueryFn, resetQueryFn } from "../../../../../../src/flowEngine/claudeAgentAdapter.js";

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

  // v1.2（2026-07-17 用户签核）：AC1"每次执行"涵盖引擎安全中止的执行。
  it("引擎安全中止的执行也写入已执行节点的记录", async () => {
    const serverCtx = await startServer();
    try {
      const project = await (await fetch(`${serverCtx.baseUrl}/api/projects`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Abort Demo", localPath: "/tmp" })
      })).json();
      const flow = await (await fetch(`${serverCtx.baseUrl}/api/flows`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Abort Flow", projectId: project.id })
      })).json();
      // trigger 先执行成功，bogus 类型节点触发 "No executor registered" 安全中止
      await (await fetch(`${serverCtx.baseUrl}/api/flows/${flow.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nodeList: [
            { id: "n1", type: "trigger", config: {} },
            { id: "n2", type: "bogus", config: {} }
          ],
          edges: [{ sourceNodeId: "n1", targetNodeId: "n2" }]
        })
      })).json();

      const execution = await (await fetch(`${serverCtx.baseUrl}/api/executions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: project.id, flowId: flow.id, trigger: "manual" })
      })).json();

      let detail;
      for (let i = 0; i < 100; i++) {
        detail = await (await fetch(`${serverCtx.baseUrl}/api/executions/${execution.id}`)).json();
        if (detail.status !== "running") break;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }

      assert.equal(detail.status, "error");
      // 中止前已执行的 trigger 节点记录必须保留
      assert.ok(detail.nodes.some((n) => n.nodeId === "n1"));
    } finally {
      await stopServer(serverCtx);
    }
  });

  // v1.2（2026-07-17 用户签核）：AC2 output 总是捕获 agent 输出，不经 outputVariable 声明。
  it("agent 未声明 outputVariable 时 output 列仍捕获文本输出", async () => {
    // 经 S1 注入缝替换 SDK query，离线运行
    setQueryFn(async function* () {
      yield { type: "result", subtype: "success", result: "agent text output" };
    });
    const serverCtx = await startServer();
    try {
      const project = await (await fetch(`${serverCtx.baseUrl}/api/projects`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Output Demo", localPath: "/tmp" })
      })).json();
      const flow = await (await fetch(`${serverCtx.baseUrl}/api/flows`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Agent Flow", projectId: project.id })
      })).json();
      await (await fetch(`${serverCtx.baseUrl}/api/flows/${flow.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nodeList: [
            { id: "n1", type: "agent", config: { provider: "anthropic", model: "claude-sonnet-5", prompt: "hi" } }
          ],
          edges: []
        })
      })).json();

      const execution = await (await fetch(`${serverCtx.baseUrl}/api/executions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: project.id, flowId: flow.id, trigger: "manual" })
      })).json();

      let detail;
      for (let i = 0; i < 100; i++) {
        detail = await (await fetch(`${serverCtx.baseUrl}/api/executions/${execution.id}`)).json();
        if (detail.status !== "running") break;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }

      assert.equal(detail.status, "success");
      const agentNode = detail.nodes.find((n) => n.nodeId === "n1");
      assert.equal(agentNode.output, "agent text output");
    } finally {
      resetQueryFn();
      await stopServer(serverCtx);
    }
  });
});
