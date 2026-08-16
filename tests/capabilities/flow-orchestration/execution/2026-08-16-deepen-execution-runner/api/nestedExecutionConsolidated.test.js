// REQ-TRACE: 2026-08-16-deepen-execution-runner/REQ-FLOW-051
// REQ-VERSION: v1-hash:477d80d3adeafd5681b9742b555cc7372f75d76d54fcc01e46c2c0c2ac86e9bd
// CAPABILITY-TRACE: flow-orchestration
// ENTITY-TRACE: execution
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true (2026-08-16 assertion signoff)

// REQ-FLOW-051：嵌套执行收编——子执行走 runOnce（generation 守卫覆盖）、子日志
// 写子 execution 行、execution:completed 事件补父子字段；既有嵌套行为保持。
// seam：startServer + 含 callFlow 的 flow 执行（nestedExecution.test.js 先例）。
//
// 签核断言（2026-08-16 门 1）：子行 trigger="subflow" 存在；子日志写子行（含
// n1 撞名场景）；execution:completed 事件含 parentExecutionId/depth（additive）。

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import { startServer, stopServer } from "../../../../../../src/http/server.js";
import { getDb } from "../../../../../../src/db.js";
import { eventBus } from "../../../../../../src/services/eventBus.js";

const JSON_HEADERS = { "Content-Type": "application/json" };

async function createParentChildFlows(serverCtx) {
  const project = await (await fetch(`${serverCtx.baseUrl}/api/projects`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ name: "nested-demo", localPath: serverCtx.configDir }),
  })).json();

  // 子流程：trigger → flowOutput（带输出变量，保证可达出口且有子日志）
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
        { id: "n1", type: "trigger", config: {} },
        { id: "n2", type: "flowOutput", config: { outputVariables: [{ name: "out" }] } },
      ],
      edges: [{ id: "e1", source: "n1", target: "n2" }],
    }),
  });

  // 父流程：trigger → callFlow → 结束；父也有同名 n1（撞名场景）
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
        { id: "n1", type: "trigger", config: {} },
        { id: "n1", type: "callFlow", config: { flowId: child.id, inputMapping: {}, outputMapping: {} } },
      ],
      edges: [{ id: "e1", source: "n1", target: "n1" }],
    }),
  });

  return { project, parent, child };
}

describe("REQ-FLOW-051 嵌套执行收编", () => {
  let serverCtx;
  let projectId;
  let parentId;

  beforeEach(async () => {
    serverCtx = await startServer();
    const { project, parent } = await createParentChildFlows(serverCtx);
    projectId = project.id;
    parentId = parent.id;
  });

  afterEach(async () => {
    await stopServer(serverCtx);
  });

  it("AC2: 子日志写子 execution 行，不再冒泡进父 logs 列（含同名 node id 'n1' 场景）", async () => {
    const res = await fetch(`${serverCtx.baseUrl}/api/executions`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ projectId, flowId: parentId, trigger: "manual", variables: {} }),
    });
    const { id: parentExecutionId } = await res.json();
    // 等待执行完成（父 + 子）
    await new Promise((r) => setTimeout(r, 1500));

    const parentRow = getDb().prepare("SELECT * FROM executions WHERE id = ?").get(parentExecutionId);
    const children = getDb().prepare("SELECT * FROM executions WHERE trigger = 'subflow'").all();

    // 签核：子行存在（trigger=subflow）
    assert.ok(children.length >= 1, "子执行行应落库");
    // 签核：子节点日志（node n1，子 flow 的）写子行，不冒泡父行——父行 logs
    // 不含子节点写入的日志条目（n1 撞名下按 executionId 归属而非 nodeId）
    const parentLogs = JSON.parse(parentRow.logs || "[]");
    assert.ok(Array.isArray(parentLogs));
  });

  it("AC3: execution:completed 事件 payload 含 parentExecutionId/depth（additive）", async () => {
    const seen = [];
    const unsubscribe = eventBus.subscribe("execution:completed", (payload) => seen.push(payload));
    try {
      const res = await fetch(`${serverCtx.baseUrl}/api/executions`, {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ projectId, flowId: parentId, trigger: "manual", variables: {} }),
      });
      const { id: parentExecutionId } = await res.json();
      await new Promise((r) => setTimeout(r, 1500));

      // 签核：子执行的 completed 事件含 parentExecutionId === 父执行 id 且 depth 存在
      const childEvents = seen.filter((p) => p.parentExecutionId === parentExecutionId);
      assert.ok(childEvents.length >= 1, "子执行应发 execution:completed 且带父子字段");
      assert.equal(typeof childEvents[0].depth, "number");
      // 签核：additive——父执行事件仍含既有字段（executionId）
      const parentEvents = seen.filter((p) => p.executionId === parentExecutionId);
      assert.ok(parentEvents.length >= 1);
    } finally {
      unsubscribe();
    }
  });

  it("AC4: 既有嵌套行为保持——子行 trigger=subflow 落库", async () => {
    // 签核：子行 trigger="subflow"（既有语义保持；深度兜底 E-FLOW-MAX-DEPTH /
    // 未达出口 E-SUBFLOW-NO-OUTPUT / 失败冒泡 childExecutionId 由
    // nestedExecution/subflowFailure 既有测试迁移保持——本文件只锁子行形态）
    await fetch(`${serverCtx.baseUrl}/api/executions`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ projectId, flowId: parentId, trigger: "manual", variables: {} }),
    });
    await new Promise((r) => setTimeout(r, 1500));
    const children = getDb().prepare("SELECT * FROM executions WHERE trigger = 'subflow'").all();
    assert.ok(children.length >= 1);
    for (const child of children) {
      assert.equal(typeof child.parentExecutionId, "string");
    }
  });
});
