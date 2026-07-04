import { getDb, resetDb } from "./db.js";
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
      JSON.stringify(execution.iterations ?? {}),
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
    iterations: JSON.parse(row.iterations || "{}"),
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
    iterations: {},
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

export function toggleSchedule(id) {
  const db = getDb();
  const row = db.prepare("SELECT * FROM schedules WHERE id = ?").get(id);
  if (!row) return undefined;
  const enabled = row.enabled ? 0 : 1;
  db.prepare("UPDATE schedules SET enabled = ? WHERE id = ?").run(enabled, id);
  return rowToSchedule({ ...row, enabled });
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

export function completeExecution(id, { duration, nodesRun, output }) {
  const db = getDb();
  const row = db.prepare("SELECT * FROM executions WHERE id = ?").get(id);
  if (!row) return undefined;
  const endedAt = timestamp();
  db.prepare(`
    UPDATE executions
    SET status = ?, endedAt = ?, duration = ?, nodesRun = ?, output = ?
    WHERE id = ?
  `).run(
    "success",
    endedAt,
    duration,
    nodesRun,
    output !== undefined ? JSON.stringify(output) : row.output,
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

export function subscribeToScheduleTriggers() {
  return eventBus.subscribe("schedule:triggered", ({ projectId, flowId }) => {
    createTask({ projectId, flowId, trigger: "schedule" });
  });
}
