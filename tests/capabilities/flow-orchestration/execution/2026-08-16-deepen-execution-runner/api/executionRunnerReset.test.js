// REQ-TRACE: 2026-08-16-deepen-execution-runner/REQ-FLOW-052
// REQ-VERSION: v2-hash:5ecf8049e27394bdb8cc0a844786af34d8f46fe38cb96a97145bebbf3831dc0b
// CAPABILITY-TRACE: flow-orchestration
// ENTITY-TRACE: execution
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true (2026-08-16 assertion signoff；v2 重签：撤除观察窗)

// REQ-FLOW-052：reset 单一失效机制 + 竞态语义。旧 executionQueue.test.js 的
// 串行/容量/排水行为测试迁入本文件（透过 runner 三接口断言，不保留双份）。
// seam：executionRunner.reset() 与 submit/runOnce；在飞 run 用挂起 executor 制造；
// recoverInterruptedExecutions 随写入原语迁入 runner。
//
// 签核断言（2026-08-16 门 1；v2 重签 S4'）：queued 结算 error（QUEUE_DRAINED_REASON，
// v2 同步竞态触发）；running 弃置 + recoverInterruptedExecutions 兜底；串行 A→B；
// 容量 50 第 51 拒。

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import { startServer, stopServer } from "../../../../../../src/http/server.js";
import { submit, reset, recoverInterruptedExecutions, setAgentExecutorForTests } from "../../../../../../src/services/executionRunner.js";
import { getDb } from "../../../../../../src/db.js";

const JSON_HEADERS = { "Content-Type": "application/json" };

// 挂起 executor：不 resolve，直到测试放行——制造「在飞 run」。
function hangingExecutor({ release }) {
  return async () => {
    await new Promise((resolve) => release.push(resolve));
    return { status: "success", output: "done", nodeRecords: [], logs: [] };
  };
}

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

async function createProjectAndFlow(serverCtx) {
  const project = await (await fetch(`${serverCtx.baseUrl}/api/projects`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ name: "reset-demo", localPath: serverCtx.configDir }),
  })).json();
  const flow = await (await fetch(`${serverCtx.baseUrl}/api/flows`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ name: "reset-flow", projectId: project.id }),
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

describe("REQ-FLOW-052 reset 单一失效机制与竞态", () => {
  let serverCtx;
  let projectId;
  let flowId;

  beforeEach(async () => {
    serverCtx = await startServer();
    await reset();
    const { project, flow } = await createProjectAndFlow(serverCtx);
    projectId = project.id;
    flowId = flow.id;
  });

  afterEach(async () => {
    await stopServer(serverCtx);
  });

  it("AC1: 失效单一机制——reset() 一次调用完成 generation+1 + destroy + 等待", async () => {
    // 签核：reset 可 await；无在飞项时快速返回（<2s，无 5s drain 等待残留）
    const t0 = Date.now();
    await reset();
    assert.ok(Date.now() - t0 < 2000);
  });

  it("AC2: 竞态结算——reset 先于出队微任务执行，queued 行结算 error（QUEUE_DRAINED_REASON）", async () => {
    // 签核（v2 S4'）：submit 同步落行后同步调用 reset——出队回调挂在微任务队列上
    // 尚未执行，reset 先完成 generation+1 → runOnce 检查点①失配 → queued 行收尾为
    // error + 日志 QUEUE_DRAINED_REASON；reset resolve 时收尾写已完成
    //（v2：无观察窗，竞态由同步时序承载——submit 与 reset 之间不出让微任务）
    const result = submit({ projectId, flowId, trigger: "manual", variables: {} });
    await reset();
    const row = getDb().prepare("SELECT * FROM executions WHERE id = ?").get(result.id);
    assert.equal(row.status, "error");
    assert.ok(String(row.logs).includes("QUEUE_DRAINED_REASON"));
  });

  it("AC3: running 行弃置——reset 不写已重置 DB，recoverInterruptedExecutions 兜底", async () => {
    // 签核：在飞 run（挂起 executor）中 reset → 行保持 running（弃置不写）；
    // 随后 recoverInterruptedExecutions 将其标 error（reason=server-restart）
    const release = [];
    setAgentExecutorForTests(hangingExecutor({ release }));
    const result = await submit({ projectId, flowId, trigger: "manual", variables: {} });
    // 等待 run 进入引擎（executor 被调用即挂起——v2 确定性等待，无观察窗）
    while (release.length === 0) {
      await new Promise((r) => setTimeout(r, 10));
    }
    const resetPromise = reset();
    release.forEach((resolve) => resolve());
    await resetPromise;

    const row = getDb().prepare("SELECT * FROM executions WHERE id = ?").get(result.id);
    assert.equal(row.status, "running", "running 行被弃置，reset 不写");

    recoverInterruptedExecutions(getDb());
    const recovered = getDb().prepare("SELECT * FROM executions WHERE id = ?").get(result.id);
    assert.equal(recovered.status, "error");
    assert.equal(JSON.parse(recovered.variables || "{}").reason, "server-restart");
  });

  it("AC4a: 队列串行——同项目前项完成才启动后项（并发 submit）", async () => {
    const order = [];
    setAgentExecutorForTests(async ({ node }) => {
      order.push(node.config.prompt);
      await new Promise((r) => setTimeout(r, 50));
      return { status: "success", output: node.config.prompt, nodeRecords: [], logs: [] };
    });
    await submit({ projectId, flowId, trigger: "manual", variables: { prompt: "A" } });
    await submit({ projectId, flowId, trigger: "manual", variables: { prompt: "B" } });

    // 签核：同项目单飞——B 在 A 完成后才启动，order 严格 ["A","B"]
    await new Promise((r) => setTimeout(r, 1200));
    assert.deepEqual(order, ["A", "B"]);
  });

  it("AC4b: 容量 50 + E-QUEUE-FULL（旧 executionQueue.test.js 行为迁入）", async () => {
    // 签核：第 51 个提交同步拒绝 E-QUEUE-FULL（与 REQ-FLOW-048 AC2 同源，
    // 本用例保留排水后行为：reset 后队列可重新接受）
    // v2：无观察窗托底——闸门 executor 占住队头，队列确定性累积到 50
    const { executor, release } = gateExecutor();
    setAgentExecutorForTests(executor);
    let accepted = 0;
    let gotError = null;
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
    assert.equal(gotError.code, "E-QUEUE-FULL");

    release(); // 先放行队头，reset 的有界等待才能收束
    await reset();
    setAgentExecutorForTests(null); // 恢复 seam 缺省（模块级状态跨用例泄漏防护）
    const again = await submit({ projectId, flowId, trigger: "manual", variables: {} });
    assert.ok(again.executionId);
  });
});
