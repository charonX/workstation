// REQ-TRACE: 2026-08-16-deepen-execution-runner/REQ-FLOW-050
// REQ-VERSION: v1-hash:477d80d3adeafd5681b9742b555cc7372f75d76d54fcc01e46c2c0c2ac86e9bd
// CAPABILITY-TRACE: flow-orchestration
// ENTITY-TRACE: execution
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true (2026-08-16 assertion signoff)

// REQ-FLOW-050：debug 描述符零落库——debug 运行（含 subflow 子树）全链路不产生
// 任何 execution 行；合成 debug-<uuid> parentExecutionId 废止。
// seam：startServer + 调试端点（POST /api/flows/:id/debug）+ 查库断言。
//
// 签核断言（2026-08-16 门 1）：debug 运行后 executions/notifications 计数不变；
// 无 parentExecutionId LIKE 'debug-%' 行（含子树）；调试响应含 status/output。

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import { startServer, stopServer } from "../../../../../../src/http/server.js";
import { getDb } from "../../../../../../src/db.js";

const JSON_HEADERS = { "Content-Type": "application/json" };

async function createProjectAndFlows(serverCtx) {
  const project = await (await fetch(`${serverCtx.baseUrl}/api/projects`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ name: "debug-demo", localPath: serverCtx.configDir }),
  })).json();

  // 子流程：flowInput → flowOutput（保证子流程可达出口）
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
        { id: "n1", type: "flowInput", config: { inputVariables: [] } },
        { id: "n2", type: "flowOutput", config: { outputVariables: [] } },
      ],
      edges: [{ id: "e1", source: "n1", target: "n2" }],
    }),
  });

  // 父流程：trigger → callFlow（指向子流程）
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
        { id: "n2", type: "callFlow", config: { flowId: child.id, inputMapping: {}, outputMapping: {} } },
      ],
      edges: [{ id: "e1", source: "n1", target: "n2" }],
    }),
  });

  return { project, parent, child };
}

describe("REQ-FLOW-050 debug 描述符零落库", () => {
  let serverCtx;
  let parentId;

  beforeEach(async () => {
    serverCtx = await startServer();
    const { parent } = await createProjectAndFlows(serverCtx);
    parentId = parent.id;
  });

  afterEach(async () => {
    await stopServer(serverCtx);
  });

  it("AC1: debug 运行后无任何 execution 行（顶层 + 子树全链路零落库）", async () => {
    const before = getDb().prepare("SELECT COUNT(*) AS c FROM executions").get().c;
    const res = await fetch(`${serverCtx.baseUrl}/api/flows/${parentId}/debug`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ variables: {}, usePublished: false }),
    });
    assert.equal(res.status, 200);
    const after = getDb().prepare("SELECT COUNT(*) AS c FROM executions").get().c;
    // 签核：debug 含 callFlow 子树运行后，executions 零新增（REQ-FLOW-050 AC1）
    assert.equal(after, before);
  });

  it("AC2: debug 不收集产物、不写终态通知", async () => {
    const before = getDb().prepare("SELECT COUNT(*) AS c FROM notifications").get().c;
    await fetch(`${serverCtx.baseUrl}/api/flows/${parentId}/debug`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ variables: {}, usePublished: false }),
    });
    const after = getDb().prepare("SELECT COUNT(*) AS c FROM notifications").get().c;
    // 签核：debug 运行不产生通知（REQ-FLOW-050 AC2）
    assert.equal(after, before);
  });

  it("AC3: persist 传播——无合成 debug-<uuid> 父行", async () => {
    await fetch(`${serverCtx.baseUrl}/api/flows/${parentId}/debug`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ variables: {}, usePublished: false }),
    });
    const rows = getDb().prepare("SELECT * FROM executions WHERE parentExecutionId LIKE 'debug-%'").all();
    // 签核：debug 子树不再产生合成父 id 行（REQ-FLOW-050 AC3，含子树零落库的
    // 同源断言——若子树落库，此处会看到带 debug- 父 id 的行）
    assert.equal(rows.length, 0);
  });

  it("AC4: debug 运行返回 status/output 供调试弹窗消费（行为不变）", async () => {
    const res = await fetch(`${serverCtx.baseUrl}/api/flows/${parentId}/debug`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ variables: {}, usePublished: false }),
    });
    const body = await res.json();
    // 签核：调试响应含 status 与 output 字段（现状 debugFlow 返回形状，REQ-FLOW-050 AC4）
    assert.ok("status" in body);
    assert.ok("output" in body);
  });
});
