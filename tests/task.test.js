// REQ-TRACE: REQ-011, REQ-012, REQ-013
// REQ-VERSION: v1-hash:2ac6ee56bb4da537ba3e109f9a72e2aa36febb15beac6bdda04cbc2f9be68045
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  resetTasks,
  createTask,
  createSchedule,
  toggleSchedule,
  listSchedules,
  listExecutions,
  completeExecution,
  getExecutionDetailTabs,
  getDefaultDetailTab
} from "../src/taskService.js";

describe("Tasks", () => {
  beforeEach(() => {
    resetTasks();
  });

  it("REQ-011: creates a manual task and starts running", () => {
    const execution = createTask({ projectId: "p1", flowId: "f1", trigger: "manual" });
    assert.equal(execution.projectId, "p1");
    assert.equal(execution.flowId, "f1");
    assert.equal(execution.trigger, "manual");
    assert.equal(execution.status, "running");
    assert.equal(listExecutions().length, 1);
  });

  it("REQ-011: rejects task without project", () => {
    assert.throws(() => createTask({ flowId: "f1" }), /Project is required/);
  });

  it("REQ-011: completed execution shows duration and node count", () => {
    const execution = createTask({ projectId: "p1", flowId: "f1" });
    const completed = completeExecution(execution.id, { duration: "12s", nodesRun: 6 });
    assert.equal(completed.status, "success");
    assert.equal(completed.duration, "12s");
    assert.equal(completed.nodesRun, 6);
    assert.ok(completed.endedAt);
  });

  it("REQ-012: creates a schedule", () => {
    const schedule = createSchedule({
      projectId: "p1",
      flowId: "f1",
      cron: "0 8 * * *"
    });
    assert.equal(schedule.projectId, "p1");
    assert.equal(schedule.cron, "0 8 * * *");
    assert.equal(schedule.enabled, true);
  });

  it("REQ-012: rejects schedule without cron", () => {
    assert.throws(() => createSchedule({ projectId: "p1", flowId: "f1" }), /Cron expression is required/);
  });

  it("REQ-012: toggles schedule enabled state", () => {
    const schedule = createSchedule({ projectId: "p1", flowId: "f1", cron: "0 8 * * *" });
    const disabled = toggleSchedule(schedule.id);
    assert.equal(disabled.enabled, false);
    assert.equal(listSchedules()[0].enabled, false);
  });

  it("REQ-013: execution history is ordered newest first", () => {
    const first = createTask({ projectId: "p1", flowId: "f1" });
    const second = createTask({ projectId: "p2", flowId: "f2" });
    const history = listExecutions();
    assert.equal(history[0].id, second.id);
    assert.equal(history[1].id, first.id);
  });

  it("REQ-013: execution detail exposes logs, variables and output tabs", () => {
    assert.deepEqual(getExecutionDetailTabs(), ["logs", "variables", "output"]);
    assert.equal(getDefaultDetailTab(), "logs");
  });
});
