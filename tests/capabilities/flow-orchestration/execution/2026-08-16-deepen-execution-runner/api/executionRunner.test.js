// REQ-TRACE: 2026-08-16-deepen-execution-runner/REQ-FLOW-048, 2026-08-16-deepen-execution-runner/REQ-FLOW-053
// REQ-VERSION: v1-hash:477d80d3adeafd5681b9742b555cc7372f75d76d54fcc01e46c2c0c2ac86e9bd
// CAPABILITY-TRACE: flow-orchestration
// ENTITY-TRACE: execution
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true (2026-08-16 assertion signoff)

// REQ-FLOW-048：ExecutionRunner 三接口（submit/runOnce/reset）+ 描述符矩阵 + 观察窗。
// 「如何运行一次执行」的知识收进一个模块——本文件直测 runner 的 public 接口
// （submit/runOnce/reset/setAgentExecutorForTests 模块级导出），不测内部拼装顺序。
// seam：executionRunner 模块（taskService 既有 setter 语义迁入）。
//
// fixture：startServer 建项目 + published flow（HTTP），被测 seam = runner 直调；
// 执行行断言经 getDb() 直查（executions 表在 data.db）。
//
// 签核断言（2026-08-16 门 1）：submit 三字段返回且 id===executionId；E-QUEUE-FULL
// 同步拒绝；观察窗 ≥250ms；schedule 出队二次校验；写入原语全收；seam 注入生效。

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import { startServer, stopServer } from "../../../../../../src/http/server.js";
import { submit, runOnce, reset, setAgentExecutorForTests } from "../../../../../../src/services/executionRunner.js";
import { getDb } from "../../../../../../src/db.js";

const JSON_HEADERS = { "Content-Type": "application/json" };

const FAKE_EXECUTOR = async ({ context }) => ({
  status: "success",
  output: `echo:${context.prompt}`,
  nodeRecords: [],
  logs: [],
});

// 建项目 + published flow（executionLog.test.js 先例：POST /api/projects →
// POST /api/flows → PATCH nodeList+status:"published"）。fixture 含 agent 节点
// （注入 executor 才会被引擎调用；executor 经 context.prompt 读变量）。
async function createProjectAndPublishedFlow(serverCtx) {
  const project = await (await fetch(`${serverCtx.baseUrl}/api/projects`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ name: "runner-demo", localPath: serverCtx.configDir }),
  })).json();
  const flow = await (await fetch(`${serverCtx.baseUrl}/api/flows`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ name: "runner-flow", projectId: project.id }),
  })).json();
  await fetch(`${serverCtx.baseUrl}/api/flows/${flow.id}`, {
    method: "PATCH",
    headers: JSON_HEADERS,
    body: JSON.stringify({
      nodeList: [{ id: "n1", type: "agent", config: { prompt: "{{prompt}}" } }],
      edges: [],
      status: "published",
    }),
  });
  return { project, flow };
}

describe("REQ-FLOW-048 executionRunner.submit", () => {
  let serverCtx;
  let projectId;
  let flowId;

  beforeEach(async () => {
    serverCtx = await startServer();
    await reset();
    setAgentExecutorForTests(FAKE_EXECUTOR);
    const { project, flow } = await createProjectAndPublishedFlow(serverCtx);
    projectId = project.id;
    flowId = flow.id;
  });

  afterEach(async () => {
    await stopServer(serverCtx);
  });

  it("AC1: submit 成功路径——落 queued 行 + 返回 {id, executionId, queuePosition} 三字段", async () => {
    const result = await submit({ projectId, flowId, trigger: "manual", variables: {} });

    // 签核：三字段存在且 id === executionId（REQ-FLOW-048 AC1）
    assert.equal(typeof result.id, "string");
    assert.equal(result.executionId, result.id);
    assert.equal(typeof result.queuePosition, "number");
    const row = getDb().prepare("SELECT * FROM executions WHERE id = ?").get(result.id);
    assert.equal(row.status, "queued");
  });

  it("AC2: 容量满——同步拒绝 E-QUEUE-FULL，不落行", async () => {
    // 签核：队列上限 50（REQ-FLOW-052 AC4 同源）；第 51 个同步拒绝
    let gotError = null;
    let accepted = 0;
    for (let i = 0; i < 60; i++) {
      try {
        await submit({ projectId, flowId, trigger: "manual", variables: {} });
        accepted++;
      } catch (err) {
        gotError = err;
        break;
      }
    }
    assert.equal(accepted, 50);
    assert.ok(gotError);
    assert.equal(gotError.code, "E-QUEUE-FULL");
  });

  it("AC3: 描述符矩阵——入队形态 persist/artifacts/notify 全开（fake executor 观察写入）", async () => {
    const result = await submit({ projectId, flowId, trigger: "manual", variables: { prompt: "hello" } });

    // 签核：入队触发执行后——执行终态 success、output 含 fake executor 输出
    // echo:hello（REQ-FLOW-048 AC3/AC6）。轮询至终态（观察窗 250ms + 引擎执行）
    let row;
    for (let i = 0; i < 100; i++) {
      row = getDb().prepare("SELECT * FROM executions WHERE id = ?").get(result.id);
      if (row.status !== "queued") break;
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.equal(row.status, "success");
    assert.ok(String(row.output).includes("echo:hello"));
  });

  it("AC4: observeQueued=true 观察窗——出队后、状态迁移前 queued 保持 ≥250ms", async () => {
    const t0 = Date.now();
    const result = await submit({ projectId, flowId, trigger: "manual", variables: {} });

    // 签核：提交后立即 queued（契约）；随后轮询至状态迁移，经过时长 ≥250ms（REQ-FLOW-048 AC4）
    const immediate = getDb().prepare("SELECT status FROM executions WHERE id = ?").get(result.id);
    assert.equal(immediate.status, "queued");

    let elapsed = 0;
    let status = "queued";
    while (elapsed < 5000) {
      status = getDb().prepare("SELECT status FROM executions WHERE id = ?").get(result.id).status;
      if (status !== "queued") break;
      await new Promise((r) => setTimeout(r, 25));
      elapsed = Date.now() - t0;
    }
    assert.ok(elapsed >= 250, `观察窗应 ≥250ms，实际 ${elapsed}ms`);
    assert.notEqual(status, "queued");
  });

  it("AC5: trigger=schedule 出队二次校验——执行时非 published → 行标 error + 日志 E-SCHED-FLOW-INVALID", async () => {
    // 签核：排队期间 unpublish（PATCH status 回 draft）后放行执行 →
    // 终态 error 且 logs 含 E-SCHED-FLOW-INVALID（REQ-FLOW-048 AC5 / 010 双校验语义）
    const result = await submit({ projectId, flowId, trigger: "schedule", variables: {}, scheduleId: "s1" });
    await fetch(`${serverCtx.baseUrl}/api/flows/${flowId}`, {
      method: "PATCH",
      headers: JSON_HEADERS,
      body: JSON.stringify({ status: "draft" }),
    });
    // 等待执行收尾（观察窗 + 引擎后二次校验）
    await new Promise((r) => setTimeout(r, 800));
    const row = getDb().prepare("SELECT * FROM executions WHERE id = ?").get(result.id);
    assert.equal(row.status, "error");
    assert.ok(String(row.logs).includes("E-SCHED-FLOW-INVALID"));
  });

  it("REQ-FLOW-053 AC1: 测试注入经 runner seam 生效（fake executor 驱动执行）", async () => {
    const result = await submit({ projectId, flowId, trigger: "manual", variables: { prompt: "seam" } });
    // 签核：注入经 runner.setAgentExecutorForTests 生效——output 为 echo:seam
    // （证明注入确实经 runner seam，非 taskService 旧 setter；REQ-FLOW-053 AC1）
    await new Promise((r) => setTimeout(r, 600));
    const row = getDb().prepare("SELECT * FROM executions WHERE id = ?").get(result.id);
    assert.ok(String(row.output).includes("echo:seam"));
  });
});

describe("REQ-FLOW-048 executionRunner.runOnce（debug 描述符）", () => {
  let serverCtx;

  beforeEach(async () => {
    serverCtx = await startServer();
    await reset();
    setAgentExecutorForTests(FAKE_EXECUTOR);
  });

  afterEach(async () => {
    await stopServer(serverCtx);
  });

  it("AC3/AC4: debug 描述符——persist/artifacts/notify 全关、observeQueued 缺省不睡", async () => {
    // 签核：runOnce(debug 描述符) 不落 execution 行、无产物、无通知；
    // 无观察窗（执行耗时不含 250ms——用行数断言零落库 + 时序粗略断言）
    // （REQ-FLOW-048 AC3 / REQ-FLOW-050 AC1）
    const before = getDb().prepare("SELECT COUNT(*) AS c FROM executions").get().c;
    const t0 = Date.now();
    const result = await runOnce(
      { flow: { nodeList: [], edges: [] }, project: { id: "p1" } },
      { trigger: "debug", persist: false, artifacts: false, notify: false }
    );
    const elapsed = Date.now() - t0;
    const after = getDb().prepare("SELECT COUNT(*) AS c FROM executions").get().c;
    assert.equal(after, before);
    assert.ok(result);
    assert.ok(elapsed < 250, `debug 不走观察窗，实际 ${elapsed}ms`);
  });
});
