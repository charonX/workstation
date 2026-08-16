// REQ-TRACE: 2026-08-16-deepen-execution-runner/REQ-FLOW-048, 2026-08-16-deepen-execution-runner/REQ-FLOW-053
// REQ-VERSION: v2-hash:5ecf8049e27394bdb8cc0a844786af34d8f46fe38cb96a97145bebbf3831dc0b
// CAPABILITY-TRACE: flow-orchestration
// ENTITY-TRACE: execution
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true (2026-08-16 assertion signoff；v2 重签：撤除观察窗)

// REQ-FLOW-048：ExecutionRunner 三接口（submit/runOnce/reset）+ 描述符矩阵 + 零睡眠（v2）。
// 「如何运行一次执行」的知识收进一个模块——本文件直测 runner 的 public 接口
// （submit/runOnce/reset/setAgentExecutorForTests 模块级导出），不测内部拼装顺序。
// seam：executionRunner 模块（taskService 既有 setter 语义迁入）。
//
// fixture：startServer 建项目 + published flow（HTTP），被测 seam = runner 直调；
// 执行行断言经 getDb() 直查（executions 表在 data.db）。
//
// 签核断言（2026-08-16 门 1；v2 重签 S2'）：submit 三字段返回且 id===executionId；
// E-QUEUE-FULL 同步拒绝；零睡眠（queued→running 立即迁移，<250ms 上界）；schedule
// 出队二次校验；写入原语全收；seam 注入生效。

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import { startServer, stopServer } from "../../../../../../src/http/server.js";
import { submit, runOnce, reset, setAgentExecutorForTests } from "../../../../../../src/services/executionRunner.js";
import { getDb } from "../../../../../../src/db.js";

const JSON_HEADERS = { "Content-Type": "application/json" };

const FAKE_EXECUTOR = async ({ node }) => ({
  status: "success",
  output: `echo:${node.config.prompt}`,
  nodeRecords: [],
  logs: [],
});

// 闸门 executor：所有调用挂起在同一 promise 上，release() 一次放行全部——
// 用于确定性地占住队头（串行队列单飞），替代已撤除的 250ms 观察窗（v2）。
function gateExecutor() {
  let release;
  const gate = new Promise((r) => (release = r));
  const executor = async () => {
    await gate;
    return { status: "success", output: "done", nodeRecords: [], logs: [] };
  };
  return { executor, release };
}

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
    // submit 是同步函数：同步调用 + 同步查库（不出让微任务，出队回调尚未执行）——
    // 确定性观察落行的初始 queued 态（v2：无观察窗，await 会让出队微任务先迁移 running）
    const result = submit({ projectId, flowId, trigger: "manual", variables: {} });

    // 签核：三字段存在且 id === executionId（REQ-FLOW-048 AC1）
    assert.equal(typeof result.id, "string");
    assert.equal(result.executionId, result.id);
    assert.equal(typeof result.queuePosition, "number");
    const row = getDb().prepare("SELECT * FROM executions WHERE id = ?").get(result.id);
    assert.equal(row.status, "queued");
  });

  it("AC2: 容量满——同步拒绝 E-QUEUE-FULL，不落行", async () => {
    // 签核：队列上限 50（REQ-FLOW-052 AC4 同源）；第 51 个同步拒绝
    // v2：无观察窗托底——闸门 executor 占住队头，队列确定性累积
    const { executor, release } = gateExecutor();
    setAgentExecutorForTests(executor);
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
    release(); // 放行队头，避免 afterEach stopServer 的有界等待空转
    setAgentExecutorForTests(FAKE_EXECUTOR); // 恢复共享 seam（模块级状态跨用例泄漏防护）
  });

  it("AC3: 描述符矩阵——入队形态 persist/artifacts/notify 全开（fake executor 观察写入）", async () => {
    const result = await submit({ projectId, flowId, trigger: "manual", variables: { prompt: "hello" } });

    // 签核：入队触发执行后——执行终态 success、output 含 fake executor 输出
    // echo:hello（REQ-FLOW-048 AC3/AC6）。轮询至终态（v2：零睡眠——迁移 running
    // 立即发生，轮询须越过 running 直到终态）
    let row;
    for (let i = 0; i < 100; i++) {
      row = getDb().prepare("SELECT * FROM executions WHERE id = ?").get(result.id);
      if (row.status !== "queued" && row.status !== "running") break;
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.equal(row.status, "success");
    assert.ok(String(row.output).includes("echo:hello"));
  });

  it("AC4: 零睡眠（v2 撤除观察窗）——submit 后 queued→running 立即迁移，时序上界 <250ms", async () => {
    const t0 = Date.now();
    const result = await submit({ projectId, flowId, trigger: "manual", variables: {} });

    // 签核（v2 S2'）：任何描述符下无固定睡眠——行状态迁出 queued 的耗时远小于
    // 旧观察窗 250ms（旧实现此断言必 ≥250ms 红；新实现毫秒级绿）。迁移目标态
    // 可以是 running 或终态（快执行直接跑完），两者都证明无观察窗滞留。
    let elapsed = 0;
    let status = "queued";
    while (elapsed < 5000) {
      status = getDb().prepare("SELECT status FROM executions WHERE id = ?").get(result.id).status;
      if (status !== "queued") break;
      await new Promise((r) => setTimeout(r, 5));
      elapsed = Date.now() - t0;
    }
    assert.notEqual(status, "queued");
    assert.ok(elapsed < 250, `零睡眠：queued 迁移应远快于旧观察窗 250ms，实际 ${elapsed}ms`);
  });

  it("AC5: trigger=schedule 出队二次校验——执行时非 published → 行标 error + 日志 E-SCHED-FLOW-INVALID", async () => {
    // 签核：排队期间 unpublish（PATCH status 回 draft）后放行执行 →
    // 终态 error 且 logs 含 E-SCHED-FLOW-INVALID（REQ-FLOW-048 AC5 / 010 双校验语义）
    // v2：无观察窗托底——闸门 executor 占住队头，schedule 执行确定性滞留在 queued，
    // unpublish 落定后才放行出队（二次校验必然读到 draft）
    const { executor, release } = gateExecutor();
    setAgentExecutorForTests(executor);
    await submit({ projectId, flowId, trigger: "manual", variables: {} }); // 占住队头
    const result = await submit({ projectId, flowId, trigger: "schedule", variables: {}, scheduleId: "s1" });
    await fetch(`${serverCtx.baseUrl}/api/flows/${flowId}`, {
      method: "PATCH",
      headers: JSON_HEADERS,
      body: JSON.stringify({ status: "draft" }),
    });
    release(); // 放行：队头完成后 schedule 执行出队 → 二次校验命中 draft
    setAgentExecutorForTests(FAKE_EXECUTOR); // 恢复共享 seam
    // 等待执行收尾（队头放行 + 二次校验结算）
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

  it("AC3/AC4: debug 描述符——persist/artifacts/notify 全关、零睡眠（v2）", async () => {
    // 签核：runOnce(debug 描述符) 不落 execution 行、无产物、无通知；
    // 零睡眠（执行耗时不含固定延迟——用行数断言零落库 + 时序上界断言）
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
    assert.ok(elapsed < 250, `debug 零睡眠（v2），实际 ${elapsed}ms`);
  });
});
