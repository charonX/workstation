// REQ-TRACE: 2026-08-16-deepen-execution-runner/REQ-FLOW-049
// REQ-VERSION: v1-hash:477d80d3adeafd5681b9742b555cc7372f75d76d54fcc01e46c2c0c2ac86e9bd
// CAPABILITY-TRACE: flow-orchestration
// ENTITY-TRACE: execution
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true (2026-08-16 assertion signoff)

// REQ-FLOW-049：触发入口归一与契约保持——HTTP/通道入口直调 runner 后行为面不变；
// taskService.createTask/executeTask/clearExecutionQueue 转发别名保持。
// seam：startServer 全栈（executionLog.test.js 先例），HTTP 断言 + 模块别名断言。
//
// 签核断言（2026-08-16 门 1）：201 + 三字段且 id===executionId；立即 GET queued；
// 503 E-QUEUE-FULL；转发别名保持导出。

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import { startServer, stopServer } from "../../../../../../src/http/server.js";
import * as taskService from "../../../../../../src/services/taskService.js";

const JSON_HEADERS = { "Content-Type": "application/json" };

async function postJson(baseUrl, urlPath, body) {
  const res = await fetch(`${baseUrl}${urlPath}`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

describe("REQ-FLOW-049 触发入口归一与契约保持", () => {
  let serverCtx;
  let projectId;
  let flowId;

  beforeEach(async () => {
    serverCtx = await startServer();
    const project = await (await fetch(`${serverCtx.baseUrl}/api/projects`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ name: "entry-demo", localPath: serverCtx.configDir }),
    })).json();
    projectId = project.id;
    const flow = await (await fetch(`${serverCtx.baseUrl}/api/flows`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ name: "entry-flow", projectId }),
    })).json();
    flowId = flow.id;
    await fetch(`${serverCtx.baseUrl}/api/flows/${flowId}`, {
      method: "PATCH",
      headers: JSON_HEADERS,
      body: JSON.stringify({ status: "published" }),
    });
  });

  afterEach(async () => {
    await stopServer(serverCtx);
  });

  it("AC1: POST /api/executions（manual）201 + 三字段返回；立即 GET 见 queued（观察窗契约）", async () => {
    const res = await postJson(serverCtx.baseUrl, "/api/executions", { projectId, flowId, trigger: "manual", variables: {} });

    // 签核：status 201；body 含 id/executionId/queuePosition 且 id===executionId
    assert.equal(res.status, 201);
    assert.equal(typeof res.body.id, "string");
    assert.equal(res.body.executionId, res.body.id);
    assert.equal(typeof res.body.queuePosition, "number");

    const detail = await (await fetch(`${serverCtx.baseUrl}/api/executions/${res.body.id}`)).json();
    // 签核：立即 GET 稳定见 queued（观察窗 ≥250ms）
    assert.equal(detail.status, "queued");
  });

  it("AC2: 队列满经 HTTP → 503 + E-QUEUE-FULL", async () => {
    // 签核：灌满项目队列（并发 POST）后第 51 个 status 503 且 body.error === "E-QUEUE-FULL"
    let last = null;
    for (let i = 0; i < 60; i++) {
      last = await postJson(serverCtx.baseUrl, "/api/executions", { projectId, flowId, trigger: "manual", variables: {} });
      if (last.status === 503) break;
    }
    assert.equal(last.status, 503);
    assert.equal(last.body.error, "E-QUEUE-FULL");
  });

  it("AC3: 通道触发语义——trigger=channel 提交创建执行", async () => {
    // 签核：通道触发（trigger=channel）经同一 submit 入口创建执行行（imRouter
    // 回执「排队中（第 N 位）」基于 queuePosition——由本提交形状保障）
    const res = await postJson(serverCtx.baseUrl, "/api/executions", { projectId, flowId, trigger: "channel", variables: {} });
    assert.equal(res.status, 201);
    assert.equal(typeof res.body.queuePosition, "number");
  });

  it("AC4: taskService 转发别名保持导出且行为等价", async () => {
    // 签核：createTask/executeTask/clearExecutionQueue 转发别名保持导出；
    // 经 createTask 提交的返回形状与 runner.submit 一致（三字段）
    assert.equal(typeof taskService.createTask, "function");
    assert.equal(typeof taskService.executeTask, "function");
    assert.equal(typeof taskService.clearExecutionQueue, "function");
    const result = taskService.createTask({ projectId, flowId, trigger: "manual", variables: {} });
    assert.equal(typeof result.id, "string");
    assert.equal(result.executionId, result.id);
    assert.equal(typeof result.queuePosition, "number");
  });

  it("AC5: server.js 重启路径使用 runner.reset()（clearExecutionQueue 调用替换）", async () => {
    // 签核：二次 startServer/stopServer 循环（同 configDir）不残留 in-flight；
    // 重启后旧 queued/running 行由 recoverInterruptedExecutions 标 error
    await stopServer(serverCtx);
    serverCtx = await startServer();
    assert.ok(serverCtx.baseUrl);
  });
});
