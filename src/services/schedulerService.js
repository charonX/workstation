import cron from "node-cron";
import { getDb } from "../db.js";
import * as runner from "./executionRunner.js";
import * as taskService from "./taskService.js";
import * as flowService from "./flowService.js";

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

export function getCronDescription(cronExpression) {
  if (!cronExpression || typeof cronExpression !== "string") {
    throw new Error("Invalid cron expression: expected 5 or 6 fields");
  }
  const parts = cronExpression.trim().split(/\s+/);
  if (parts.length !== 5 && parts.length !== 6) {
    throw new Error("Invalid cron expression: expected 5 or 6 fields");
  }
  // Support both 5-field and 6-field (with seconds) cron; ignore seconds for description.
  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts.length === 6 ? parts.slice(1) : parts;

  // Helper: pad number to two digits
  const pad = (n) => String(n).padStart(2, "0");

  // Helper: parse a field, returning null for *
  const parseField = (field) => (field === "*" ? null : field);

  const m = parseField(minute);
  const h = parseField(hour);
  const dom = parseField(dayOfMonth);
  const mon = parseField(month);
  const dow = parseField(dayOfWeek);

  const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

  const formatHour = (val) => {
    const num = parseInt(val, 10);
    return !isNaN(num) && String(num) === String(val) ? pad(num) : val;
  };
  const formatMinute = (val) => {
    const num = parseInt(val, 10);
    return !isNaN(num) && String(num) === String(val) ? pad(num) : val;
  };

  // Build description for common patterns
  let description = "";

  // Time part (24-hour format)
  if (m !== null && h !== null) {
    const hourNum = parseInt(h, 10);
    const minuteNum = parseInt(m, 10);
    if (!isNaN(hourNum) && !isNaN(minuteNum)) {
      description = `At ${pad(hourNum)}:${pad(minuteNum)}`;
    } else {
      description = `At ${h}:${m}`;
    }
  } else if (h !== null) {
    description = `At hour ${formatHour(h)}`;
  } else if (m !== null) {
    description = `At minute ${formatMinute(m)}`;
  } else {
    description = "Every minute";
  }

  // Day of week
  if (dow !== null) {
    const dowNum = parseInt(dow, 10);
    if (dowNum >= 0 && dowNum <= 6 && String(dowNum) === String(dow)) {
      description += `, only on ${dayNames[dowNum]}`;
    } else {
      description += `, only on day ${dow}`;
    }
  }

  // Day of month
  if (dom !== null && dow === null) {
    description += `, on day ${dom} of the month`;
  }

  // Month
  if (mon !== null) {
    description += `, in month ${mon}`;
  }

  return description;
}


function scheduleTask(schedule) {
  validateCron(schedule.cron);
  const variables = parseScheduleVariables(schedule.variables);
  const task = cron.schedule(schedule.cron, () => {
    // Suppress ticks that fire immediately after loadAll so tests (and users)
    // don't see a compensation-like burst when the server restarts.
    if (Date.now() - loadedAt < LOAD_GRACE_MS) return;
    // REQ-SCHEDULE-010：到点直调 runner.submit（删 eventBus 一跳与 server.js
    // 订阅接线——schedulerService → runner.submit 单向，模块图无环）。
    let result;
    try {
      result = runner.submit({
        projectId: schedule.projectId,
        flowId: schedule.flowId,
        trigger: "schedule",
        variables,
        scheduleId: schedule.id
      });
    } catch (err) {
      console.error(`[scheduler] scheduled execution submit failed for schedule ${schedule.id}:`, err.message);
      return;
    }
    // submit 只返回 {skipped:true}；skip 反应（日志 + markScheduleInvalid + 注销
    // cron 任务）归本模块执行（taskService 不再承载 schedulerService.remove——
    // taskService 不 import schedulerService，模块图无环）。
    if (result && result.skipped) {
      reactToSkippedSubmit(schedule, result);
    }
  });
  tasks.set(schedule.id, task);
  return task;
}

// skip 反应（S6 / REQ-SCHEDULE-010）：runner.submit 返回 {skipped:true}（到点 flow
// 非 published）时执行三连——日志 E-SCHED-FLOW-INVALID（含当前 flow 状态标签）+
// taskService.markScheduleInvalid（schedule 行落 error + enabled=0）+ 注销本 cron
// 任务（remove）。日志文案与标记时机为既有契约（scheduleTriggers 回归断言）。
function reactToSkippedSubmit(schedule, result) {
  const flow = flowService.getFlow(schedule.flowId);
  const statusLabel = flow ? flow.status : "missing";
  console.error(`E-SCHED-FLOW-INVALID: Scheduled execution skipped for flow ${schedule.flowId} (status=${statusLabel})`);
  try {
    taskService.markScheduleInvalid(schedule.id, result.reason ?? "E-SCHED-FLOW-INVALID");
  } catch (err) {
    console.error(`[scheduler] markScheduleInvalid failed for schedule ${schedule.id}:`, err.message);
  }
  remove(schedule.id);
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
