// REQ-TRACE: 2026-07-19-media-production-line/REQ-SCHEDULE-005, 2026-07-19-media-production-line/REQ-SCHEDULE-006
// REQ-VERSION: v1-hash:de43bc8607a89efe5512712a188a5f24f259d8109cb31a7a476827dd0883fab9
// CAPABILITY-TRACE: scheduling-execution
// ENTITY-TRACE: schedule
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { startServer, stopServer } from "../../../../../../src/http/server.js";
import * as eventBus from "../../../../../../src/services/eventBus.js";
import { submit as runnerSubmit, setAgentExecutorForTests } from "../../../../../../src/services/executionRunner.js";

// 闸门 executor：所有调用挂起在同一 promise 上，release() 一次放行全部——占住队头
// 使后续执行确定性滞留 queued（execution-runner v2 撤除 250ms 观察窗后的观察模式：
// queued 可观察性由真实排队语义承载，断言文本不变）。

// 短周期 cron 注入：node-cron 六段表达式，每秒触发一次。
const EVERY_SECOND = "* * * * * *";
const TICK_WAIT_MS = 4000;

async function loadSchedulerService(t) {
  const mod = await import("../../../../../../src/services/schedulerService.js").catch(() => null);
  assert.ok(mod, "seam 未就绪：src/services/schedulerService.js 尚未实现（REQ-SCHEDULE-005）");
  assert.equal(typeof mod.loadAll, "function", "schedulerService 应导出 loadAll()");
  assert.equal(typeof mod.upsert, "function", "schedulerService 应导出 upsert(schedule)");
  assert.equal(typeof mod.remove, "function", "schedulerService 应导出 remove(scheduleId)");
  return mod;
}

async function waitForExecution(baseUrl, predicate, { timeoutMs = TICK_WAIT_MS, description = "schedule 触发的执行" } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const list = await (await fetch(`${baseUrl}/api/executions`)).json();
    const hit = list.find(predicate);
    if (hit) return hit;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  assert.fail(`timed out (${timeoutMs}ms) waiting for: ${description}`);
}

async function createProjectAndFlow(baseUrl, { publish = false } = {}) {
  const project = await (await fetch(`${baseUrl}/api/projects`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Sched Project", localPath: "/tmp/sched-project" })
  })).json();
  const flow = await (await fetch(`${baseUrl}/api/flows`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Sched Flow", projectId: project.id })
  })).json();
  if (publish) {
    // 发布走既有 PATCH /api/flows/:id（flowService.updateFlow 在 status=published 时落 published 快照）。
    const res = await fetch(`${baseUrl}/api/flows/${flow.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "published" })
    });
    assert.ok(res.ok, `publish flow 前置步骤失败: ${res.status}`);
  }
  return { project, flow };
}

describe("REQ-SCHEDULE-005/006: 调度接通与 schedule 变量", () => {
  let serverCtx;
  let schedulerService;

  beforeEach(async () => {
    serverCtx = await startServer();
  });

  afterEach(async () => {
    // 清理进程内 cron 任务与事件订阅，避免跨用例泄漏。
    if (schedulerService) {
      try { schedulerService.removeAll?.(); } catch { /* seam 未就绪时忽略 */ }
      schedulerService = undefined;
    }
    eventBus.clearSubscribers();
    await stopServer(serverCtx);
  });

  it("REQ-SCHEDULE-005 AC1: server 启动 loadAll 为全部 enabled schedule 注册 cron 任务（到点直调创建执行）", async () => {
    schedulerService = await loadSchedulerService();
    const { project, flow } = await createProjectAndFlow(serverCtx.baseUrl, { publish: true });
    await fetch(`${serverCtx.baseUrl}/api/schedules`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: project.id, flowId: flow.id, cron: EVERY_SECOND })
    });

    await schedulerService.loadAll();

    // REQ-SCHEDULE-010：到点直调 runner.submit（无 eventBus 一跳、无订阅）——可观察
    // 结果 = schedule 触发执行行出现
    await waitForExecution(serverCtx.baseUrl, (e) => e.flowId === flow.id && e.trigger === "schedule");
  });

  it("REQ-SCHEDULE-005 AC2: 到点直调创建 execution，variables 注入（payload 语义迁移自 schedule:triggered 事件）", async () => {
    schedulerService = await loadSchedulerService();
    const { project, flow } = await createProjectAndFlow(serverCtx.baseUrl, { publish: true });
    await fetch(`${serverCtx.baseUrl}/api/schedules`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: project.id, flowId: flow.id, cron: EVERY_SECOND, variables: { topic: "AI" } })
    });

    await schedulerService.loadAll();

    const execution = await waitForExecution(serverCtx.baseUrl, (e) => e.flowId === flow.id && e.trigger === "schedule");
    // 签核（迁移自旧 event payload 断言）：variables 经直调路径注入执行行
    assert.equal(execution.variables.topic, "AI");
  });

  it("REQ-SCHEDULE-005 AC2: 到点直调创建 execution（trigger=schedule，status=queued）", async () => {
    schedulerService = await loadSchedulerService();
    const { project, flow } = await createProjectAndFlow(serverCtx.baseUrl, { publish: true });

    // execution-runner v2：250ms 观察窗已撤除，空队列上 queued→running 立即迁移，
    // HTTP 轮询不再能稳定捕获 queued。断言文本不变（status=queued）——观察方式迁移
    // 为队头占用模式：闸门 executor 挂起同项目手动执行占住队头，schedule 到点执行
    // 确定性排队在后。
    let releaseGate;
    const gate = new Promise((r) => (releaseGate = r));
    setAgentExecutorForTests(async () => {
      await gate;
      return { status: "success", output: "done", nodeRecords: [], logs: [] };
    });
    const blockerFlow = await (await fetch(`${serverCtx.baseUrl}/api/flows`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Blocker Flow", projectId: project.id })
    })).json();
    await fetch(`${serverCtx.baseUrl}/api/flows/${blockerFlow.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nodeList: [{ id: "b1", type: "agent", config: { prompt: "block" } }], edges: [] })
    });
    runnerSubmit({ projectId: project.id, flowId: blockerFlow.id, trigger: "manual", variables: {} });

    await fetch(`${serverCtx.baseUrl}/api/schedules`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: project.id, flowId: flow.id, cron: EVERY_SECOND })
    });

    await schedulerService.loadAll();

    const execution = await waitForExecution(serverCtx.baseUrl, (e) => e.flowId === flow.id && e.trigger === "schedule");
    assert.equal(execution.trigger, "schedule");
    // REQ-SCHEDULE-007 契约：createTask 入队后初始 status=queued（队头被占时稳定可观察）。
    assert.equal(execution.status, "queued");

    releaseGate(); // 放行队头排空队列，避免 afterEach stopServer 有界等待空转
    setAgentExecutorForTests(null); // 恢复 seam 缺省（模块级状态跨用例泄漏防护）
  });

  it("REQ-SCHEDULE-005 AC3: schedule CRUD 成功后同进程同步 node-cron 任务（直调创建执行，无 loadAll）", async () => {
    schedulerService = await loadSchedulerService();
    const { project, flow } = await createProjectAndFlow(serverCtx.baseUrl, { publish: true });

    // 仅经 API 创建（不手动 loadAll）：CRUD 应直接同步 cron 注册。
    const schedule = await (await fetch(`${serverCtx.baseUrl}/api/schedules`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: project.id, flowId: flow.id, cron: EVERY_SECOND })
    })).json();

    await waitForExecution(serverCtx.baseUrl, (e) => e.flowId === flow.id && e.trigger === "schedule", {
      description: "CRUD 后 cron 自动生效（无 loadAll）"
    });

    // 删除后不再触发。
    const countOfFlow = async () =>
      (await (await fetch(`${serverCtx.baseUrl}/api/executions`)).json())
        .filter((e) => e.flowId === flow.id && e.trigger === "schedule").length;
    await fetch(`${serverCtx.baseUrl}/api/schedules/${schedule.id}`, { method: "DELETE" });
    const countAfterDelete = await countOfFlow();
    await new Promise((resolve) => setTimeout(resolve, 2200));
    assert.equal(await countOfFlow(), countAfterDelete, "DELETE 后 cron 任务应同步注销");
  });

  it("REQ-SCHEDULE-005 AC4: 到点时 flow 为 draft → 不建执行并记日志 E-SCHED-FLOW-INVALID", async () => {
    schedulerService = await loadSchedulerService();
    const { project, flow } = await createProjectAndFlow(serverCtx.baseUrl, { publish: false });
    await fetch(`${serverCtx.baseUrl}/api/schedules`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: project.id, flowId: flow.id, cron: EVERY_SECOND })
    });

    await schedulerService.loadAll();

    // 捕获日志输出，断言记日志码值（签核：全文统一 E-SCHED-FLOW-INVALID）。
    const logged = [];
    const origLog = console.log;
    const origError = console.error;
    console.log = (...args) => logged.push(args.map(String).join(" "));
    console.error = (...args) => logged.push(args.map(String).join(" "));
    try {
      // 等两个 tick 窗口。
      await new Promise((resolve) => setTimeout(resolve, 2500));
    } finally {
      console.log = origLog;
      console.error = origError;
    }

    // 仍不应有该 flow 的执行记录。
    const list = await (await fetch(`${serverCtx.baseUrl}/api/executions`)).json();
    assert.ok(!list.some((e) => e.flowId === flow.id && e.trigger === "schedule"), "draft flow 不应因 schedule 建执行");
    assert.match(logged.join("\n"), /E-SCHED-FLOW-INVALID/, "draft flow 到点应记日志 E-SCHED-FLOW-INVALID");
  });

  it("REQ-SCHEDULE-005 AC4: manual 触发不受 draft 限制", async () => {
    const { project, flow } = await createProjectAndFlow(serverCtx.baseUrl, { publish: false });
    const res = await fetch(`${serverCtx.baseUrl}/api/executions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: project.id, flowId: flow.id, trigger: "manual" })
    });
    assert.equal(res.status, 201, "manual 触发 draft flow 应被接受（使用已发布快照/draft 语义见契约）");
  });

  it("REQ-SCHEDULE-005 AC5: server 未运行期间的到点不补偿（loadAll 宽限期抑制）", async () => {
    schedulerService = await loadSchedulerService();
    const { project, flow } = await createProjectAndFlow(serverCtx.baseUrl, { publish: true });
    await fetch(`${serverCtx.baseUrl}/api/schedules`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: project.id, flowId: flow.id, cron: EVERY_SECOND })
    });

    await schedulerService.loadAll();

    // loadAll 后立即观察：宽限期（LOAD_GRACE_MS=500）内不应有任何补偿性创建
    // （直调路径的可观察结果 = 无执行行；旧 eventBus payload 断言为空真，迁移为实断言）
    await new Promise((resolve) => setTimeout(resolve, 500));
    const list = await (await fetch(`${serverCtx.baseUrl}/api/executions`)).json();
    assert.ok(
      !list.some((e) => e.flowId === flow.id && e.trigger === "schedule"),
      "loadAll 宽限期内不应创建补偿性执行"
    );
  });

  it("REQ-SCHEDULE-006 AC1: schedules.variables JSON 列 CRUD 透传", async () => {
    const { project, flow } = await createProjectAndFlow(serverCtx.baseUrl);
    const res = await fetch(`${serverCtx.baseUrl}/api/schedules`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: project.id, flowId: flow.id, cron: "0 8 * * *", variables: { topic: "AI 科技动态", limit: 20 } })
    });
    assert.equal(res.status, 201);
    const created = await res.json();
    assert.deepEqual(created.variables, { topic: "AI 科技动态", limit: 20 }, "创建响应应透传 variables");

    const list = await (await fetch(`${serverCtx.baseUrl}/api/schedules`)).json();
    const stored = list.find((s) => s.id === created.id);
    assert.deepEqual(stored?.variables, { topic: "AI 科技动态", limit: 20 }, "列表查询应透传 variables");
  });

  it("REQ-SCHEDULE-006 AC1: 非法 cron 报 E-SCHED-CRON", async () => {
    const { project, flow } = await createProjectAndFlow(serverCtx.baseUrl);
    // 注意（既有缺陷暴露）：当前实现在 writeHead(201) 之后才经 toListView→getCronDescription 抛错，
    // 响应头已发但 body 永不结束，请求会一直挂起。用 8s 超时把「挂起」转成可读失败；
    // REQ-SCHEDULE-006 落地（创建期校验 E-SCHED-CRON）后此用例按 400 断言。
    const res = await fetch(`${serverCtx.baseUrl}/api/schedules`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: project.id, flowId: flow.id, cron: "not-a-cron" }),
      signal: AbortSignal.timeout(8000)
    }).catch((err) => {
      assert.fail(`非法 cron 的 POST /api/schedules 挂起/异常（${err.name}: ${err.message}）——应在创建期校验并返回 400 E-SCHED-CRON`);
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    // 签核错误体形状：{ error: "E-SCHED-CRON", message }。
    assert.equal(body.error, "E-SCHED-CRON", `非法 cron 应报 E-SCHED-CRON，实际: ${JSON.stringify(body)}`);
  });

  it("REQ-SCHEDULE-006 AC2: 触发时 variables 注入 execution.variables", async () => {
    schedulerService = await loadSchedulerService();
    const { project, flow } = await createProjectAndFlow(serverCtx.baseUrl, { publish: true });
    await fetch(`${serverCtx.baseUrl}/api/schedules`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: project.id, flowId: flow.id, cron: EVERY_SECOND, variables: { topic: "AI" } })
    });

    // REQ-SCHEDULE-010：到点直调 runner.submit（无订阅）
    await schedulerService.loadAll();

    const execution = await waitForExecution(serverCtx.baseUrl, (e) => e.flowId === flow.id && e.trigger === "schedule");
    const detail = await (await fetch(`${serverCtx.baseUrl}/api/executions/${execution.id}`)).json();
    const variables = typeof detail.variables === "string" ? JSON.parse(detail.variables) : detail.variables;
    assert.equal(variables?.topic, "AI", "schedule.variables 应注入 execution.variables");
  });
});
