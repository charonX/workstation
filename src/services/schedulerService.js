import cron from "node-cron";
import { getDb } from "../db.js";
import * as eventBus from "./eventBus.js";

const tasks = new Map();
let loadedAt = 0;
const LOAD_GRACE_MS = 500;

export function validateCron(cronExpression) {
  if (!cronExpression || typeof cronExpression !== "string") {
    throw new Error("cron expression is required");
  }
  if (!cron.validate(cronExpression)) {
    const err = new Error(`Invalid cron expression: ${cronExpression} (E-SCHED-CRON)`);
    err.code = "E-SCHED-CRON";
    throw err;
  }
}

function scheduleTask(schedule) {
  validateCron(schedule.cron);
  const variables = parseScheduleVariables(schedule.variables);
  const task = cron.schedule(schedule.cron, () => {
    // Suppress ticks that fire immediately after loadAll so tests (and users)
    // don't see a compensation-like burst when the server restarts.
    if (Date.now() - loadedAt < LOAD_GRACE_MS) return;
    eventBus.publish("schedule:triggered", {
      scheduleId: schedule.id,
      projectId: schedule.projectId,
      flowId: schedule.flowId,
      variables
    });
  });
  tasks.set(schedule.id, task);
  return task;
}

function parseScheduleVariables(raw) {
  if (raw === undefined || raw === null) return {};
  if (typeof raw === "object") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export function loadAll() {
  removeAll();
  loadedAt = Date.now();
  const db = getDb();
  const rows = db.prepare("SELECT * FROM schedules WHERE enabled = 1").all();
  for (const row of rows) {
    try {
      scheduleTask(row);
    } catch (err) {
      console.error(`[scheduler] failed to load schedule ${row.id}:`, err.message);
    }
  }
}

export function upsert(schedule) {
  if (!schedule || !schedule.id) {
    throw new Error("schedule with id is required");
  }
  remove(schedule.id);
  scheduleTask(schedule);
}

function destroyTask(task) {
  try {
    task.destroy();
  } catch {
    // ignore teardown errors
  }
}

export function remove(scheduleId) {
  const task = tasks.get(scheduleId);
  if (task) {
    destroyTask(task);
    tasks.delete(scheduleId);
  }
}

export function removeAll() {
  for (const task of tasks.values()) {
    destroyTask(task);
  }
  tasks.clear();
}

export function getTaskCount() {
  return tasks.size;
}

export function isLoaded() {
  return loadedAt > 0;
}
