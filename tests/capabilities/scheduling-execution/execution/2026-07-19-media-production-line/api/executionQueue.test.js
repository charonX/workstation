// REQ-TRACE: 2026-07-19-media-production-line/REQ-SCHEDULE-007
// REQ-VERSION: v1-hash:de43bc8607a89efe5512712a188a5f24f259d8109cb31a7a476827dd0883fab9
// CAPABILITY-TRACE: scheduling-execution
// ENTITY-TRACE: execution
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { startServer, stopServer } from "../../../../../../src/http/server.js";

// seam：REQ-SCHEDULE-007 的 per-project 串行队列（tech-design「executionQueue」契约：
// enqueue({projectId, run}) / getPosition(executionId)，单 project 上限 50）。
async function loadExecutionQueue() {
  const mod = await import("../../../../../../src/services/executionQueue.js").catch(() => null);
  assert.ok(mod, "seam 未就绪：src/services/executionQueue.js 尚未实现（REQ-SCHEDULE-007）");
  const create = mod.createExecutionQueue || mod.createQueue;
  assert.equal(typeof create, "function", "executionQueue 应导出 createExecutionQueue() 工厂");
  return create;
}

/** 可手动释放的 run() 闸门。 */
function gate() {
  let release;
  const promise = new Promise((resolve) => { release = resolve; });
  return { promise, release };
}

describe("REQ-SCHEDULE-007: 执行队列", () => {
  describe("队列语义（executionQueue seam）", () => {
    let createExecutionQueue;

    beforeEach(async () => {
      createExecutionQueue = await loadExecutionQueue();
    });

    it("同一 projectId 的执行严格串行", async () => {
      const queue = createExecutionQueue();
      const events = [];
      const first = gate();

      const run1Done = queue.enqueue({
        projectId: "p1",
        run: async () => {
          events.push("run1:start");
          await first.promise;
          events.push("run1:end");
        }
      });
      const run2Done = queue.enqueue({
        projectId: "p1",
        run: async () => { events.push("run2:start"); }
      });

      // run1 未释放期间，run2 不得开始。
      await new Promise((resolve) => setTimeout(resolve, 150));
      assert.deepEqual(events, ["run1:start"], "同项目第二个执行应排队等待");

      first.release();
      await Promise.all([run1Done, run2Done]);
      assert.deepEqual(events, ["run1:start", "run1:end", "run2:start"], "同项目执行应严格串行");
    });

    it("不同 projectId 可并行", async () => {
      const queue = createExecutionQueue();
      const events = [];
      const gateA = gate();
      const gateB = gate();

      const doneA = queue.enqueue({
        projectId: "pa",
        run: async () => { events.push("a:start"); await gateA.promise; events.push("a:end"); }
      });
      const doneB = queue.enqueue({
        projectId: "pb",
        run: async () => { events.push("b:start"); await gateB.promise; events.push("b:end"); }
      });

      await new Promise((resolve) => setTimeout(resolve, 150));
      assert.ok(events.includes("a:start") && events.includes("b:start"), "不同项目的执行应并行启动");

      gateA.release();
      gateB.release();
      await Promise.all([doneA, doneB]);
    });

    it("getPosition 返回正确排队位置", async () => {
      const queue = createExecutionQueue();
      const blocker = gate();
      const ids = [];
      const done = [];
      done.push(queue.enqueue({
        projectId: "p1",
        executionId: "exec-1",
        run: async () => { await blocker.promise; }
      }));
      ids.push("exec-1");
      for (const id of ["exec-2", "exec-3"]) {
        ids.push(id);
        done.push(queue.enqueue({ projectId: "p1", executionId: id, run: async () => {} }));
      }

      await new Promise((resolve) => setTimeout(resolve, 100));
      // 排队位置口径（签核）：运行中的为第 1 位、其后依次为 2/3（通道回执「第 N 位」与此一致）。
      assert.equal(queue.getPosition("exec-1"), 1);
      assert.equal(queue.getPosition("exec-2"), 2);
      assert.equal(queue.getPosition("exec-3"), 3);

      blocker.release();
      await Promise.all(done);
    });

    it("单 project 排队上限 50，超出拒绝（E-QUEUE-FULL）", async () => {
      const queue = createExecutionQueue();
      const blocker = gate();
      const pending = [];
      for (let i = 0; i < 50; i++) {
        pending.push(queue.enqueue({ projectId: "p1", executionId: `exec-${i}`, run: async () => { await blocker.promise; } }));
      }
      // 第 51 个入队应被拒绝（签核错误码 E-QUEUE-FULL；通道场景回执文案「队列已满，稍后再发」）。
      await assert.rejects(
        () => queue.enqueue({ projectId: "p1", executionId: "exec-overflow", run: async () => {} }),
        /E-QUEUE-FULL/,
        "超出单 project 排队上限 50 应报 E-QUEUE-FULL"
      );

      blocker.release();
      await Promise.allSettled(pending);
    });

    it("单个执行抛错不影响队列后续执行", async () => {
      const queue = createExecutionQueue();
      const events = [];
      const failing = queue.enqueue({
        projectId: "p1",
        run: async () => { events.push("failing:start"); throw new Error("boom"); }
      });
      const following = queue.enqueue({
        projectId: "p1",
        run: async () => { events.push("following:start"); }
      });

      await assert.rejects(() => failing, /boom/);
      await following;
      assert.deepEqual(events, ["failing:start", "following:start"], "前序执行抛错后，后续执行应继续");
    });
  });

  describe("server 启动恢复（孤儿执行处理）", () => {
    it("启动时将 status∈{queued,running} 的 execution 标记 error（reason=server-restart），不重跑", async () => {
      const dbMod = await import("../../../../../../src/db.js");
      const db = dbMod.getDb(":memory:");
      db.prepare(`INSERT INTO executions (id, projectId, flowId, trigger, status, startedAt, variables)
                  VALUES (?, ?, ?, ?, ?, ?, ?)`).run("exec-queued", "p1", "f1", "schedule", "queued", new Date().toISOString(), "{}");
      db.prepare(`INSERT INTO executions (id, projectId, flowId, trigger, status, startedAt, variables)
                  VALUES (?, ?, ?, ?, ?, ?, ?)`).run("exec-running", "p1", "f1", "manual", "running", new Date().toISOString(), "{}");
      db.prepare(`INSERT INTO executions (id, projectId, flowId, trigger, status, startedAt, variables)
                  VALUES (?, ?, ?, ?, ?, ?, ?)`).run("exec-success", "p1", "f1", "manual", "success", new Date().toISOString(), "{}");

      // seam：启动恢复入口（建议 executionQueue.recoverInterruptedExecutions(db) 或 taskService 侧等价函数）。
      const queueMod = await import("../../../../../../src/services/executionQueue.js").catch(() => null);
      const taskMod = await import("../../../../../../src/services/taskService.js");
      const recover = queueMod?.recoverInterruptedExecutions || taskMod.recoverInterruptedExecutions;
      assert.equal(typeof recover, "function", "seam 未就绪：孤儿执行启动恢复入口尚未实现（REQ-SCHEDULE-007 AC3）");
      recover(db);

      const queued = db.prepare("SELECT * FROM executions WHERE id = ?").get("exec-queued");
      const running = db.prepare("SELECT * FROM executions WHERE id = ?").get("exec-running");
      const success = db.prepare("SELECT * FROM executions WHERE id = ?").get("exec-success");

      assert.equal(queued.status, "error", "queued 孤儿执行应置 error");
      assert.equal(running.status, "error", "running 孤儿执行应置 error");
      // 签核：executions 表记录 reason=server-restart。
      assert.match(JSON.stringify(queued), /server-restart/, "孤儿执行应记录 reason=server-restart");
      assert.match(JSON.stringify(running), /server-restart/, "孤儿执行应记录 reason=server-restart");
      assert.equal(success.status, "success", "已终态的执行不应被改动");
      dbMod.closeDb();
    });
  });

  describe("createTask 入队契约（API 层）", () => {
    let serverCtx;

    beforeEach(async () => {
      serverCtx = await startServer();
    });

    afterEach(async () => {
      await stopServer(serverCtx);
    });

    it("POST /api/executions 返回 {executionId, queuePosition} 且初始 status=queued", async () => {
      const project = await (await fetch(`${serverCtx.baseUrl}/api/projects`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Queue Project", localPath: "/tmp/queue-project" })
      })).json();
      const flow = await (await fetch(`${serverCtx.baseUrl}/api/flows`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Queue Flow", projectId: project.id })
      })).json();

      const res = await fetch(`${serverCtx.baseUrl}/api/executions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: project.id, flowId: flow.id, trigger: "manual" })
      });
      assert.equal(res.status, 201);
      const data = await res.json();
      // tech-design「taskService.createTask」契约：输出 {executionId, queuePosition}，execution 初始 status=queued。
      assert.ok(data.executionId, "createTask 应返回 executionId");
      assert.equal(typeof data.queuePosition, "number", "createTask 应返回 queuePosition");
      const detail = await (await fetch(`${serverCtx.baseUrl}/api/executions/${data.executionId}`)).json();
      assert.equal(detail.status, "queued");
    });
  });
});
