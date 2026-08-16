// REQ-TRACE: 2026-08-16-deepen-execution-runner/REQ-FLOW-051
// REQ-VERSION: v1-hash:477d80d3adeafd5681b9742b555cc7372f75d76d54fcc01e46c2c0c2ac86e9bd
// CAPABILITY-TRACE: flow-orchestration
// ENTITY-TRACE: execution
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true (2026-08-16 assertion signoff)

// REQ-FLOW-051：嵌套执行收编——子执行写点纳入 generation 守卫（reset 中途子写被
// 拦截）、子日志写子 execution 行（不冒泡父行，含跨 flow 同名 node id "n1" 撞名）、
// execution:completed 事件补父子字段（additive）；既有嵌套行为保持。
// seam：startServer + 注入 fake executor（经 runner seam，slice 4 迁移后为
// runner.setAgentExecutorForTests）+ 含 callFlow 的 flow 执行 + eventBus 订阅。
//
// 签核断言（2026-08-16 门 1）：子行 trigger="subflow" 落库；子日志（"child-ran"）
// 写子行、父行 logs 不含子日志；子 completed 事件含 parentExecutionId/depth；
// reset 中途子完成写被拦截（子行保持 running）。
//
// fixture 说明：父流程 agent 节点 id="n1"（prompt=parent），子流程 agent 节点
// id="n1"（prompt=child）——跨 flow 同名 n1 撞名场景。executor 按 prompt 区分
// 调用来源，logs 携带 {node, message: prompt}。

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import { startServer, stopServer } from "../../../../../../src/http/server.js";
import { getDb } from "../../../../../../src/db.js";
import * as eventBus from "../../../../../../src/services/eventBus.js";
import { setAgentExecutorForTests, reset, recoverInterruptedExecutions } from "../../../../../../src/services/executionRunner.js";

const JSON_HEADERS = { "Content-Type": "application/json" };

// 带日志的 fake executor：按 node.config.prompt 区分父/子调用（生产契约同源——
// claudeAgentAdapter 即读 node.config.prompt），logs 携带 {node: node.id, message:
// prompt}——撞名节点 n1 的归属靠 prompt 内容区分。
const LOGGED_EXECUTOR = async ({ node }) => ({
  status: "success",
  output: `echo:${node.config.prompt}`,
  nodeRecords: [],
  logs: [{ node: node.id, message: node.config.prompt }],
});

async function createParentChildFlows(serverCtx) {
  const project = await (await fetch(`${serverCtx.baseUrl}/api/projects`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ name: "nested-demo", localPath: serverCtx.configDir }),
  })).json();

  // 子流程：flowInput(c1) → agent(n1, prompt=child) → flowOutput(c2)
  const child = await (await fetch(`${serverCtx.baseUrl}/api/flows`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ name: "child-flow", projectId: project.id }),
  })).json();
  await fetch(`${serverCtx.baseUrl}/api/flows/${child.id}`, {
    method: "PATCH",
    headers: JSON_HEADERS,
    body: JSON.stringify({
      nodeList: [
        { id: "c1", type: "flowInput", config: { inputVariables: [] } },
        { id: "n1", type: "agent", config: { prompt: "child" } },
        { id: "c2", type: "flowOutput", config: { outputVariables: [] } },
      ],
      edges: [
        { id: "e1", sourceNodeId: "c1", targetNodeId: "n1" },
        { id: "e2", sourceNodeId: "n1", targetNodeId: "c2" },
      ],
    }),
  });

  // 父流程：trigger(t1) → agent(n1, prompt=parent) → callFlow(n2)
  const parent = await (await fetch(`${serverCtx.baseUrl}/api/flows`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ name: "parent-flow", projectId: project.id }),
  })).json();
  await fetch(`${serverCtx.baseUrl}/api/flows/${parent.id}`, {
    method: "PATCH",
    headers: JSON_HEADERS,
    body: JSON.stringify({
      nodeList: [
        { id: "t1", type: "trigger", config: {} },
        { id: "n1", type: "agent", config: { prompt: "parent" } },
        { id: "n2", type: "callFlow", config: { targetFlowId: child.id, targetInputNodeId: "c1", inputMappings: [], outputMappings: [] } },
      ],
      edges: [
        { id: "e1", sourceNodeId: "t1", targetNodeId: "n1" },
        { id: "e2", sourceNodeId: "n1", targetNodeId: "n2" },
      ],
    }),
  });

  return { project, parent, child };
}

async function runParentFlow(serverCtx, projectId, parentId) {
  const res = await fetch(`${serverCtx.baseUrl}/api/executions`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ projectId, flowId: parentId, trigger: "manual", variables: {} }),
  });
  return (await res.json()).id;
}

// 轮询至父执行终态（观察窗 250ms + 父引擎 + 子引擎）
async function waitForParentTerminal(parentExecutionId, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  let row;
  while (Date.now() < deadline) {
    row = getDb().prepare("SELECT * FROM executions WHERE id = ?").get(parentExecutionId);
    if (row && row.status !== "queued" && row.status !== "running") return row;
    await new Promise((r) => setTimeout(r, 50));
  }
  return row;
}

describe("REQ-FLOW-051 嵌套执行收编", () => {
  let serverCtx;
  let projectId;
  let parentId;

  beforeEach(async () => {
    serverCtx = await startServer();
    await reset();
    setAgentExecutorForTests(LOGGED_EXECUTOR);
    const { project, parent } = await createParentChildFlows(serverCtx);
    projectId = project.id;
    parentId = parent.id;
  });

  afterEach(async () => {
    await stopServer(serverCtx);
  });

  it("AC2: 子日志写子 execution 行，不再冒泡进父 logs 列（跨 flow 同名 n1 撞名场景）", async () => {
    const parentExecutionId = await runParentFlow(serverCtx, projectId, parentId);
    const parentRow = await waitForParentTerminal(parentExecutionId);
    assert.ok(parentRow, "父执行应达终态");

    const children = getDb().prepare("SELECT * FROM executions WHERE trigger = 'subflow'").all();
    assert.ok(children.length >= 1, "子执行行应落库");

    // 签核：子日志（message="child"）写子行
    const childLogs = JSON.parse(children[0].logs || "[]");
    assert.ok(
      childLogs.some((l) => l.message === "child"),
      `子行 logs 应含子日志（child），实际 ${JSON.stringify(childLogs)}`
    );
    // 签核：父行 logs 含父日志（parent）但不含子日志（child）——n1 撞名下按
    // 执行归属而非 nodeId
    const parentLogs = JSON.parse(parentRow.logs || "[]");
    assert.ok(parentLogs.some((l) => l.message === "parent"), "父行 logs 应含父日志（parent）");
    assert.ok(
      !parentLogs.some((l) => l.message === "child"),
      `父行 logs 不应含子日志（child），实际 ${JSON.stringify(parentLogs)}`
    );
  });

  it("AC3: execution:completed 事件 payload 含 parentExecutionId/depth（additive）", async () => {
    const seen = [];
    const unsubscribe = eventBus.subscribe("execution:completed", (payload) => seen.push(payload));
    try {
      const parentExecutionId = await runParentFlow(serverCtx, projectId, parentId);
      await waitForParentTerminal(parentExecutionId);

      // 签核：子执行（parentExecutionId===父 id）的 completed 事件含 depth 且
      // 既有字段（executionId/status）不变
      const childEvents = seen.filter((p) => p.parentExecutionId === parentExecutionId);
      assert.ok(childEvents.length >= 1, "子执行应发 execution:completed 且带父子字段");
      assert.equal(typeof childEvents[0].depth, "number");
      assert.equal(childEvents[0].depth, 1);
      const parentEvents = seen.filter((p) => p.executionId === parentExecutionId);
      assert.ok(parentEvents.length >= 1, "父执行 completed 事件既有字段保持");
    } finally {
      unsubscribe();
    }
  });

  it("AC1: 守卫覆盖——reset 中途的子完成写被拦截（子行保持 running，不写已重置 DB）", async () => {
    // 第二次调用（子流程 agent）挂起：父 n1（call 1）快速过，子 n1（call 2）挂起
    let callCount = 0;
    const release = [];
    setAgentExecutorForTests(async (args) => {
      callCount++;
      if (callCount === 2) {
        await new Promise((r) => release.push(r));
      }
      return LOGGED_EXECUTOR(args);
    });

    const parentExecutionId = await runParentFlow(serverCtx, projectId, parentId);
    // 等待子行出现（子 INSERT 在子引擎运行前）→ 子 n1 挂起中
    let childRow = null;
    for (let i = 0; i < 100; i++) {
      childRow = getDb().prepare("SELECT * FROM executions WHERE trigger = 'subflow'").get();
      if (childRow) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.ok(childRow, "子执行行应在子引擎运行前落库");

    const resetPromise = reset();
    release.forEach((r) => r());
    await resetPromise;

    // 签核：子行未被晚写——完成写被 generation 守卫拦截，状态保持 running
    // （recoverInterruptedExecutions 兜底语义由既有启动恢复覆盖）
    const after = getDb().prepare("SELECT * FROM executions WHERE id = ?").get(childRow.id);
    assert.equal(after.status, "running", "reset 中途子完成写应被拦截（子行保持 running）");
    assert.equal(
      JSON.parse(after.logs || "[]").length,
      0,
      "reset 中途子日志也不应写入（子行 logs 为空）"
    );

    recoverInterruptedExecutions(getDb());
    const recovered = getDb().prepare("SELECT * FROM executions WHERE id = ?").get(childRow.id);
    assert.equal(recovered.status, "error");
  });

  it("AC4: 既有嵌套行为保持——子行 trigger=subflow + parentExecutionId 非空", async () => {
    const parentExecutionId = await runParentFlow(serverCtx, projectId, parentId);
    await waitForParentTerminal(parentExecutionId);

    const children = getDb().prepare("SELECT * FROM executions WHERE trigger = 'subflow'").all();
    assert.ok(children.length >= 1);
    for (const child of children) {
      assert.equal(typeof child.parentExecutionId, "string");
      assert.equal(child.parentExecutionId, parentExecutionId);
      assert.equal(child.depth, 1);
    }
  });
});
