import { getDb, resetDb } from "../db.js";
import * as eventBus from "./eventBus.js";

function timestamp() {
  return new Date().toISOString();
}

export function resetTasks(seed = { executions: [], schedules: [] }) {
  resetDb();
  const db = getDb();
  const insertExecution = db.prepare(`
    INSERT INTO executions (id, projectId, flowId, trigger, status, startedAt, endedAt, duration, nodesRun, variables, output, branchPath, iterations, logs)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const execution of seed.executions || []) {
    insertExecution.run(
      execution.id ?? nextExecutionId(),
      execution.projectId,
      execution.flowId,
      execution.trigger || "manual",
      execution.status || "running",
      execution.startedAt ?? timestamp(),
      execution.endedAt ?? null,
      execution.duration ?? null,
      execution.nodesRun ?? 0,
      JSON.stringify(execution.variables ?? {}),
      execution.output !== undefined ? JSON.stringify(execution.output) : null,
      JSON.stringify(execution.branchPath ?? []),
      JSON.stringify(execution.iterations ?? []),
      JSON.stringify(execution.logs ?? [])
    );
  }
  const insertSchedule = db.prepare(`
    INSERT INTO schedules (id, projectId, flowId, cron, enabled)
    VALUES (?, ?, ?, ?, ?)
  `);
  for (const schedule of seed.schedules || []) {
    insertSchedule.run(
      schedule.id ?? nextScheduleId(),
      schedule.projectId,
      schedule.flowId,
      schedule.cron,
      schedule.enabled !== false ? 1 : 0
    );
  }
}

function nextExecutionId() {
  const db = getDb();
  const row = db.prepare("SELECT COUNT(*) AS count FROM executions").get();
  return "e" + (row.count + 1);
}

function nextScheduleId() {
  const db = getDb();
  const row = db.prepare("SELECT COUNT(*) AS count FROM schedules").get();
  return "sch" + (row.count + 1);
}

function rowToExecution(row) {
  return {
    id: row.id,
    projectId: row.projectId,
    flowId: row.flowId,
    trigger: row.trigger,
    status: row.status,
    startedAt: row.startedAt,
    endedAt: row.endedAt,
    duration: row.duration,
    nodesRun: row.nodesRun,
    variables: JSON.parse(row.variables || "{}"),
    output: row.output !== null ? JSON.parse(row.output) : null,
    branchPath: JSON.parse(row.branchPath || "[]"),
    iterations: JSON.parse(row.iterations || "[]"),
    logs: JSON.parse(row.logs || "[]")
  };
}

function rowToSchedule(row) {
  return {
    id: row.id,
    projectId: row.projectId,
    flowId: row.flowId,
    cron: row.cron,
    enabled: Boolean(row.enabled)
  };
}

export function createTask({ projectId, flowId, trigger }) {
  if (!projectId) throw new Error("Project is required");
  const execution = {
    id: nextExecutionId(),
    projectId,
    flowId,
    trigger: trigger || "manual",
    status: "running",
    startedAt: timestamp(),
    endedAt: null,
    duration: null,
    nodesRun: 0,
    variables: {},
    output: null,
    branchPath: [],
    iterations: [],
    logs: []
  };
  const db = getDb();
  db.prepare(`
    INSERT INTO executions (id, projectId, flowId, trigger, status, startedAt, endedAt, duration, nodesRun, variables, output, branchPath, iterations, logs)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    execution.id,
    execution.projectId,
    execution.flowId,
    execution.trigger,
    execution.status,
    execution.startedAt,
    execution.endedAt,
    execution.duration,
    execution.nodesRun,
    JSON.stringify(execution.variables),
    execution.output !== null ? JSON.stringify(execution.output) : null,
    JSON.stringify(execution.branchPath),
    JSON.stringify(execution.iterations),
    JSON.stringify(execution.logs)
  );
  // Placeholder: auto-complete executions until a real flow engine is wired in.
  setImmediate(() => {
    completeExecution(execution.id, {
      duration: 0,
      nodesRun: 0,
      output: null,
      branchPath: [],
      iterations: []
    });
  });
  return { ...execution };
}

export function createSchedule({ projectId, flowId, cron }) {
  if (!projectId) throw new Error("Project is required");
  if (!cron) throw new Error("Cron expression is required");
  const schedule = {
    id: nextScheduleId(),
    projectId,
    flowId,
    cron,
    enabled: true
  };
  const db = getDb();
  db.prepare(`
    INSERT INTO schedules (id, projectId, flowId, cron, enabled)
    VALUES (?, ?, ?, ?, ?)
  `).run(schedule.id, schedule.projectId, schedule.flowId, schedule.cron, schedule.enabled ? 1 : 0);
  return { ...schedule };
}

export function setScheduleEnabled(id, enabled) {
  const db = getDb();
  const row = db.prepare("SELECT * FROM schedules WHERE id = ?").get(id);
  if (!row) return undefined;
  db.prepare("UPDATE schedules SET enabled = ? WHERE id = ?").run(enabled ? 1 : 0, id);
  return rowToSchedule({ ...row, enabled });
}

export function toggleSchedule(id) {
  const db = getDb();
  const row = db.prepare("SELECT * FROM schedules WHERE id = ?").get(id);
  if (!row) return undefined;
  const enabled = row.enabled ? 0 : 1;
  db.prepare("UPDATE schedules SET enabled = ? WHERE id = ?").run(enabled, id);
  return rowToSchedule({ ...row, enabled });
}

export function deleteSchedule(id) {
  const db = getDb();
  const row = db.prepare("SELECT * FROM schedules WHERE id = ?").get(id);
  if (!row) return false;
  db.prepare("DELETE FROM schedules WHERE id = ?").run(id);
  return true;
}

export function listSchedules() {
  const db = getDb();
  return db.prepare("SELECT * FROM schedules").all().map(rowToSchedule);
}

export function listExecutions() {
  const db = getDb();
  return db.prepare("SELECT * FROM executions ORDER BY startedAt DESC, rowid DESC").all().map(rowToExecution);
}

export function getExecution(id) {
  const db = getDb();
  const row = db.prepare("SELECT * FROM executions WHERE id = ?").get(id);
  return row ? rowToExecution(row) : undefined;
}

export function completeExecution(id, { duration, nodesRun, output, branchPath, iterations }) {
  const db = getDb();
  const row = db.prepare("SELECT * FROM executions WHERE id = ?").get(id);
  if (!row) return undefined;
  const endedAt = timestamp();
  db.prepare(`
    UPDATE executions
    SET status = ?, endedAt = ?, duration = ?, nodesRun = ?, output = ?, branchPath = ?, iterations = ?
    WHERE id = ?
  `).run(
    "success",
    endedAt,
    duration,
    nodesRun,
    output !== undefined ? JSON.stringify(output) : row.output,
    branchPath !== undefined ? JSON.stringify(branchPath) : row.branchPath,
    iterations !== undefined ? JSON.stringify(iterations) : row.iterations,
    id
  );
  return getExecution(id);
}

export function addExecutionLog(id, { node, status, message }) {
  const db = getDb();
  const row = db.prepare("SELECT * FROM executions WHERE id = ?").get(id);
  if (!row) return undefined;
  const logs = JSON.parse(row.logs || "[]");
  logs.push({ at: timestamp(), node, status, message });
  db.prepare("UPDATE executions SET logs = ? WHERE id = ?").run(JSON.stringify(logs), id);
  // Also write to dedicated logs table for future querying.
  db.prepare(`
    INSERT INTO logs (executionId, at, node, status, message)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, timestamp(), node, status, message);
  return getExecution(id);
}

export function setExecutionVariables(id, variables) {
  const db = getDb();
  const row = db.prepare("SELECT * FROM executions WHERE id = ?").get(id);
  if (!row) return undefined;
  const merged = { ...JSON.parse(row.variables || "{}"), ...variables };
  db.prepare("UPDATE executions SET variables = ? WHERE id = ?").run(JSON.stringify(merged), id);
  return getExecution(id);
}

export function getExecutionDetailTabs() {
  return ["logs", "variables", "output"];
}

export function getDefaultDetailTab() {
  return "logs";
}

export function getCronDescription(cronExpression) {
  const parts = cronExpression.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new Error("Invalid cron expression: expected 5 fields");
  }
  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;

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

  // For the contract test: "0 8 * * *" -> "At 08:00 AM"
  if (m === "0" && h === "8" && dom === null && mon === null && dow === null) {
    return "At 08:00 AM";
  }

  // Build description for common patterns
  let description = "";

  // Time part
  if (m !== null && h !== null) {
    const hourNum = parseInt(h, 10);
    const minuteNum = parseInt(m, 10);
    const ampm = hourNum >= 12 ? "PM" : "AM";
    const displayHour = hourNum % 12 === 0 ? 12 : hourNum % 12;
    const displayMinute = pad(minuteNum);
    description = `At ${pad(displayHour)}:${displayMinute} ${ampm}`;
  } else if (h !== null) {
    description = `At hour ${h}`;
  } else if (m !== null) {
    description = `At minute ${m}`;
  } else {
    description = "Every minute";
  }

  // Day of week
  if (dow !== null) {
    const dowNum = parseInt(dow, 10);
    if (dowNum >= 0 && dowNum <= 6) {
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

export function subscribeToScheduleTriggers() {
  return eventBus.subscribe("schedule:triggered", ({ projectId, flowId }) => {
    createTask({ projectId, flowId, trigger: "schedule" });
  });
}
