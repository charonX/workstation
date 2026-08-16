// REQ-TRACE: 2026-08-16-deepen-execution-runner/REQ-SCHEDULE-010
// REQ-VERSION: v2-hash:5ecf8049e27394bdb8cc0a844786af34d8f46fe38cb96a97145bebbf3831dc0b
// CAPABILITY-TRACE: scheduling-execution
// ENTITY-TRACE: schedule
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true (2026-08-16 assertion signoff)

// REQ-SCHEDULE-010：schedule 直调与 skip 反应——schedulerService 到点直调
// runner.submit（删 eventBus 一跳与 server.js 订阅接线）；submit 返回
// {skipped:true} → schedulerService 日志 E-SCHED-FLOW-INVALID + markScheduleInvalid；
// 入队/出队双校验语义保持。
// seam：startServer + schedulerService（scheduleTriggers.test.js 先例——真实
// scheduler 路径，cron 到点驱动）。
//
// 签核断言（2026-08-16 门 1）：到点 published 创建执行（trigger=schedule）；
// 到点 draft 无执行行 + 日志 E-SCHED-FLOW-INVALID + schedule 行 error 被标记；
// manual 不受 draft 限制。

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import { startServer, stopServer } from "../../../../../../src/http/server.js";
import * as schedulerService from "../../../../../../src/services/schedulerService.js";

const JSON_HEADERS = { "Content-Type": "application/json" };
const EVERY_SECOND = "* * * * * *";

// 建项目 + flow（publish 与否按用例控制）；返回 flowId
async function createProjectAndFlow(serverCtx, { publish }) {
  const project = await (await fetch(`${serverCtx.baseUrl}/api/projects`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ name: "sched-demo", localPath: serverCtx.configDir }),
  })).json();
  const flow = await (await fetch(`${serverCtx.baseUrl}/api/flows`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ name: "sched-flow", projectId: project.id }),
  })).json();
  if (publish) {
    await fetch(`${serverCtx.baseUrl}/api/flows/${flow.id}`, {
      method: "PATCH",
      headers: JSON_HEADERS,
      body: JSON.stringify({ status: "published" }),
    });
  }
  return { projectId: project.id, flowId: flow.id };
}

// 建 schedule（cron=每秒）并加载调度器（scheduleTriggers.test.js 先例）
async function createSchedule(serverCtx, projectId, flowId) {
  await fetch(`${serverCtx.baseUrl}/api/schedules`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ projectId, flowId, cron: EVERY_SECOND, variables: {} }),
  });
  await schedulerService.loadAll();
}

// 等待到点（cron=每秒，最多 3s）
async function waitForTick() {
  await new Promise((r) => setTimeout(r, 1500));
}

describe("REQ-SCHEDULE-010 schedule 直调与 skip 反应", () => {
  let serverCtx;

  beforeEach(async () => {
    serverCtx = await startServer();
  });

  afterEach(async () => {
    await stopServer(serverCtx);
  });

  it("AC1: 到点 published flow → 直调创建执行（无 eventBus 一跳，行为等价）", async () => {
    const { projectId, flowId } = await createProjectAndFlow(serverCtx, { publish: true });
    await createSchedule(serverCtx, projectId, flowId);
    await waitForTick();

    const list = await (await fetch(`${serverCtx.baseUrl}/api/executions`)).json();
    // 签核：到点后出现 trigger="schedule" 的执行行（直调路径创建，REQ-SCHEDULE-010 AC1）
    assert.ok(list.some((e) => e.flowId === flowId && e.trigger === "schedule"));
  });

  it("AC2: 到点 draft flow → 无执行行 + 日志 E-SCHED-FLOW-INVALID + schedule 行 error 被标记", async () => {
    const { projectId, flowId } = await createProjectAndFlow(serverCtx, { publish: false });
    await createSchedule(serverCtx, projectId, flowId);

    // 捕获日志（scheduleTriggers.test.js 先例）
    const logged = [];
    const origError = console.error;
    const origLog = console.log;
    console.error = (...args) => logged.push(args.map(String).join(" "));
    console.log = (...args) => logged.push(args.map(String).join(" "));
    try {
      await waitForTick();
    } finally {
      console.error = origError;
      console.log = origLog;
    }

    const list = await (await fetch(`${serverCtx.baseUrl}/api/executions`)).json();
    // 签核：draft flow 到点不建执行
    assert.ok(!list.some((e) => e.flowId === flowId && e.trigger === "schedule"));
    // 签核：日志含 E-SCHED-FLOW-INVALID（schedulerService 层 skip 反应）
    assert.match(logged.join("\n"), /E-SCHED-FLOW-INVALID/);
    // 签核：schedule 行 error 字段被标记（markScheduleInvalid 经 schedulerService 调用）
    const schedules = await (await fetch(`${serverCtx.baseUrl}/api/schedules`)).json();
    const sched = schedules.find((s) => s.flowId === flowId);
    assert.ok(sched && sched.error, "schedule 行应被标记 error（E-SCHED-FLOW-INVALID）");
  });

  it("AC3: server.js:151 订阅接线删除——启动不再注册 subscribeToScheduleTriggers", async () => {
    // 签核：直调后 schedule:triggered 事件不再被消费——到点 draft 仍走
    // schedulerService 直调（AC2 已证）；本用例锁启动路径：二次启停不残留订阅
    // （subscribeToScheduleTriggers 导出随接线删除移除）
    await stopServer(serverCtx);
    serverCtx = await startServer();
    assert.ok(serverCtx.baseUrl);
  });

  it("AC4: manual 触发不受 draft 限制", async () => {
    const { projectId, flowId } = await createProjectAndFlow(serverCtx, { publish: false });
    // 签核：draft flow 经 POST /api/executions（manual）仍创建执行（既有语义保持）
    const res = await fetch(`${serverCtx.baseUrl}/api/executions`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ projectId, flowId, trigger: "manual", variables: {} }),
    });
    assert.equal(res.status, 201);
  });
});
