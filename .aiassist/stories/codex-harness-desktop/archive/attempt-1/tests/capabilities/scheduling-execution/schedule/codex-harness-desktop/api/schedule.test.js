// REQ-TRACE: codex-harness-desktop/REQ-012
// REQ-VERSION: v1-hash:2c79015bd970c381f96e90dfa5950a839b3fdf9b90606fadf73c07c381cbaad8
// CAPABILITY-TRACE: scheduling-execution
// ENTITY-TRACE: schedule
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: false

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  resetTasks,
  createSchedule,
  toggleSchedule,
  listSchedules
} from "../../../../../../src/taskService.js";
import * as taskService from "../../../../../../src/taskService.js";

describe("Schedules", () => {
  beforeEach(() => {
    resetTasks();
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

  it("REQ-012: schedule list shows project, cron and enabled state", () => {
    createSchedule({ projectId: "p1", flowId: "f1", cron: "0 8 * * *" });
    const schedules = listSchedules();
    assert.equal(schedules.length, 1);
    assert.equal(schedules[0].projectId, "p1");
    assert.equal(schedules[0].cron, "0 8 * * *");
    assert.equal(schedules[0].enabled, true);
  });

  it("REQ-012: schedule shows a human-readable cron description", () => {
    assert.equal(typeof taskService.getCronDescription, "function");
    const description = taskService.getCronDescription("0 8 * * *");
    assert.equal(description, "At 08:00 AM");
  });
});
