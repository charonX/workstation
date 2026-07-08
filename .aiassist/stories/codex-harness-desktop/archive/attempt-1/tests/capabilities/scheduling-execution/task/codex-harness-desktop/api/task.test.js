// REQ-TRACE: codex-harness-desktop/REQ-011, codex-harness-desktop/REQ-013
// REQ-VERSION: v1-hash:2c79015bd970c381f96e90dfa5950a839b3fdf9b90606fadf73c07c381cbaad8
// CAPABILITY-TRACE: scheduling-execution
// ENTITY-TRACE: task
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: false

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  resetTasks,
  createTask,
  listExecutions,
  completeExecution,
  getExecutionDetailTabs,
  getDefaultDetailTab,
  addExecutionLog,
  setExecutionVariables,
  getExecution
} from "../../../../../../src/taskService.js";

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

  it("REQ-011: manual task accepts trigger option", () => {
    const manual = createTask({ projectId: "p1", flowId: "f1", trigger: "manual" });
    assert.equal(manual.trigger, "manual");
    const scheduled = createTask({ projectId: "p1", flowId: "f1", trigger: "schedule" });
    assert.equal(scheduled.trigger, "schedule");
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

  it("REQ-013: execution records branch path and iteration info", () => {
    const execution = createTask({ projectId: "p1", flowId: "f1" });
    completeExecution(execution.id, {
      duration: "12s",
      nodesRun: 6,
      output: { ok: true },
      branchPath: ["true", "false"],
      iterations: { w1: 3 }
    });
    const fromHistory = listExecutions()[0];
    assert.deepEqual(fromHistory.branchPath, ["true", "false"]);
    assert.deepEqual(fromHistory.iterations, { w1: 3 });
  });

  it("REQ-013: logs tab shows execution log entries", () => {
    const execution = createTask({ projectId: "p1", flowId: "f1" });
    addExecutionLog(execution.id, { node: "n1", status: "success", message: "done" });
    const detail = getExecution(execution.id);
    assert.ok(detail.logs.some(l => l.node === "n1" && l.message === "done"));
  });

  it("REQ-013: variables tab shows execution variables", () => {
    const execution = createTask({ projectId: "p1", flowId: "f1" });
    setExecutionVariables(execution.id, { target: "example.com" });
    const detail = getExecution(execution.id);
    assert.equal(detail.variables.target, "example.com");
  });

  it("REQ-013: output tab shows final output", () => {
    const execution = createTask({ projectId: "p1", flowId: "f1" });
    completeExecution(execution.id, { duration: "3s", nodesRun: 2, output: { result: 42 } });
    const detail = getExecution(execution.id);
    assert.deepEqual(detail.output, { result: 42 });
  });
});
