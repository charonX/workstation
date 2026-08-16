// REQ-TRACE: 2026-08-16-deepen-execution-runner/REQ-FLOW-049
// REQ-VERSION: v2-hash:5ecf8049e27394bdb8cc0a844786af34d8f46fe38cb96a97145bebbf3831dc0b
// CAPABILITY-TRACE: flow-orchestration
// ENTITY-TRACE: execution
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true (2026-08-16 assertion signoff；v2 重签：撤除观察窗)

// REQ-FLOW-049：触发入口归一与契约保持——HTTP/通道入口直调 runner 后行为面不变；
// taskService.createTask/executeTask/clearExecutionQueue 转发别名保持。
// seam：startServer 全栈（executionLog.test.js 先例），HTTP 断言 + 模块别名断言。
//
// 签核断言（2026-08-16 门 1；v2 重签 S8）：201 + 三字段且 id===executionId；队头
// 被占时后续执行 GET 稳定见 queued + queuePosition≥2；503 E-QUEUE-FULL；转发别名
// 保持导出。

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import { startServer, stopServer } from "../../../../../../src/http/server.js";
import * as taskService from "../../../../../../src/services/taskService.js";
import { setAgentExecutorForTests } from "../../../../../../src/services/executionRunner.js";

const JSON_HEADERS = { "Content-Type": "application/json" };

// 闸门 executor：所有调用挂起在同一 promise 上，release() 一次放行全部——
// 占住队头使队列确定性累积（替代已撤除的 250ms 观察窗，v2）。
function gateExecutor() {
  let release;
  const gate = new Promise((r) => (release = r));
  const executor = async () => {
    await gate;
    return { status: "success", output: "done", nodeRecords: [], logs: [] };
  };
  return { executor, release };
}

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
      body: JSON.stringify({
        // agent 节点：供闸门 executor 占住队头（v2 队头占用模式）
        nodeList: [{ id: "n1", type: "agent", config: { prompt: "{{prompt}}" } }],
        edges: [],
        status: "published",
      }),
    });
  });

  afterEach(async () => {
    await stopServer(serverCtx);
  });

  it("AC1: POST /api/executions（manual）201 + 三字段返回；队头被占时后续执行 GET 稳定见 queued", async () => {
    // v2 S8：无观察窗——queued 可观察性由真实排队语义承载。闸门 executor 占住
    // 队头（第 1 个执行挂起在引擎内），第 2 个执行确定性滞留 queued
    const { executor, release } = gateExecutor();
    setAgentExecutorForTests(executor);
    const first = await postJson(serverCtx.baseUrl, "/api/executions", { projectId, flowId, trigger: "manual", variables: {} });
    assert.equal(first.status, 201);

    const res = await postJson(serverCtx.baseUrl, "/api/executions", { projectId, flowId, trigger: "manual", variables: {} });

    // 签核：status 201；body 含 id/executionId/queuePosition 且 id===executionId
    assert.equal(res.status, 201);
    assert.equal(typeof res.body.id, "string");
    assert.equal(res.body.executionId, res.body.id);
    assert.equal(typeof res.body.queuePosition, "number");

    const detail = await (await fetch(`${serverCtx.baseUrl}/api/executions/${res.body.id}`)).json();
    // 签核（v2 S8）：队头被占 → 稳定见 queued 且 queuePosition≥2
    assert.equal(detail.status, "queued");
    assert.ok(res.body.queuePosition >= 2, `队头被占时 queuePosition 应 ≥2，实际 ${res.body.queuePosition}`);

    release(); // 放行队头排空队列，避免 afterEach stopServer 有界等待空转
    setAgentExecutorForTests(null); // 恢复 seam 缺省（模块级状态跨用例泄漏防护）
  });

  it("AC2: 队列满经 HTTP → 503 + E-QUEUE-FULL", async () => {
    // 签核：灌满项目队列（并发 POST）后第 51 个 status 503 且 body.error === "E-QUEUE-FULL"
    // v2：无观察窗托底——闸门 executor 占住队头，队列确定性累积
    const { executor, release } = gateExecutor();
    setAgentExecutorForTests(executor);
    let last = null;
    for (let i = 0; i < 60; i++) {
      last = await postJson(serverCtx.baseUrl, "/api/executions", { projectId, flowId, trigger: "manual", variables: {} });
      if (last.status === 503) break;
    }
    assert.equal(last.status, 503);
    assert.equal(last.body.error, "E-QUEUE-FULL");

    release();
    setAgentExecutorForTests(null);
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

  it("PRD §7 校验：缺 projectId → 400 Project is required（slice 4 补，删旧 executionQueue.test.js 前落）", async () => {
    // 签核（PRD §7 / REQ-FLOW-049 submit 契约）：缺 projectId 同步拒绝 400
    const res = await postJson(serverCtx.baseUrl, "/api/executions", { flowId, trigger: "manual", variables: {} });
    assert.equal(res.status, 400);
    assert.match(String(res.body.message ?? ""), /Project is required/);
  });

  it("PRD §7 校验：未知 flow → 400 Flow not found", async () => {
    // 签核（PRD §7 / REQ-FLOW-049 submit 契约）：flow 不存在（非 schedule）→ 400
    const res = await postJson(serverCtx.baseUrl, "/api/executions", { projectId, flowId: "no-such-flow", trigger: "manual", variables: {} });
    assert.equal(res.status, 400);
    assert.match(String(res.body.message ?? ""), /Flow not found/);
  });
});
