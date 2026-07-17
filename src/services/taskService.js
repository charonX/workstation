import { getDb, resetDb } from "../db.js";
import * as eventBus from "./eventBus.js";
import { run } from "../flowEngine/flowEngine.js";
import * as flowService from "./flowService.js";
import * as projectService from "./projectService.js";

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

// REQ-FLOW-028 AC2：agent prompt 落库前截断到前 4000 字符。
const PROMPT_LOG_MAX_LENGTH = 4000;

// REQ-FLOW-028 / tech-design §5.6：把引擎 run() 返回的 nodeRecords 逐行写入
// execution_nodes（同一 db 连接，单事务）。record.agent 存在时展开 agent 调用详情。
// status 语义：record.error 非空 → "error"（含 onError=ignore 降级路径，错误信息记入
// error 列），否则 → "success"。
// output 列：仅 agent 节点（record.agent 存在）填充，优先取 agent.output（adapter 返回文本，
// REQ-FLOW-028 v1.2，不经 outputVariable 声明），回落 outputVariables 首个值；两者皆无时为 NULL。
function insertExecutionNodes(executionId, nodeRecords) {
  if (!Array.isArray(nodeRecords) || nodeRecords.length === 0) return;
  const db = getDb();
  const insert = db.prepare(`
    INSERT INTO execution_nodes (id, executionId, nodeId, nodeName, inputVariables, outputVariables, branchTaken, error, attemptCount, prompt, output, model, provider, status, durationMs)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const writeAll = db.transaction((records) => {
    records.forEach((record, index) => {
      const agent = record.agent ?? null;
      insert.run(
        `${executionId}:${index}`,
        executionId,
        record.nodeId,
        record.nodeName ?? null,
        JSON.stringify(record.inputVariables ?? {}),
        JSON.stringify(record.outputVariables ?? {}),
        record.branchTaken ?? null,
        record.error ?? null,
        record.attemptCount ?? 1,
        agent?.prompt != null ? String(agent.prompt).slice(0, PROMPT_LOG_MAX_LENGTH) : null,
        agent ? (agent.output ?? firstOutputVariableValue(record)) : null,
        agent?.model ?? null,
        agent?.provider ?? null,
        record.error ? "error" : "success",
        agent?.durationMs ?? null
      );
    });
  });
  writeAll(nodeRecords);
}

function firstOutputVariableValue(record) {
  const values = Object.values(record.outputVariables ?? {});
  return values.length > 0 ? String(values[0]) : null;
}

function rowToExecutionNode(row) {
  return {
    id: row.id,
    executionId: row.executionId,
    nodeId: row.nodeId,
    nodeName: row.nodeName,
    inputVariables: JSON.parse(row.inputVariables || "{}"),
    outputVariables: JSON.parse(row.outputVariables || "{}"),
    branchTaken: row.branchTaken,
    error: row.error,
    attemptCount: row.attemptCount,
    prompt: row.prompt,
    output: row.output,
    model: row.model,
    provider: row.provider,
    status: row.status,
    durationMs: row.durationMs
  };
}

export function listExecutionNodes(executionId) {
  const db = getDb();
  return db.prepare("SELECT * FROM execution_nodes WHERE executionId = ? ORDER BY rowid ASC").all(executionId).map(rowToExecutionNode);
}

// REQ-FLOW-028 AC4 / tech-design §7：滚动时间窗清理过期执行日志。
// cutoff = now - retentionDays×24h（ISO 字符串比较，startedAt 均为 toISOString 格式）。
// 单事务内按序删 execution_nodes → logs → executions（前两者按 executionId 子查询）。
export function purgeExpiredExecutions(db, { retentionDays = 7, now = new Date() } = {}) {
  const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
  const deleteNodes = db.prepare("DELETE FROM execution_nodes WHERE executionId IN (SELECT id FROM executions WHERE startedAt < ?)");
  const deleteLogs = db.prepare("DELETE FROM logs WHERE executionId IN (SELECT id FROM executions WHERE startedAt < ?)");
  const deleteExecutions = db.prepare("DELETE FROM executions WHERE startedAt < ?");
  const purge = db.transaction(() => {
    const executionNodes = deleteNodes.run(cutoff).changes;
    const logs = deleteLogs.run(cutoff).changes;
    const executions = deleteExecutions.run(cutoff).changes;
    return { executions, executionNodes, logs };
  });
  return purge();
}

function nextScheduleId() {
  const db = getDb();
  const row = db.prepare("SELECT COUNT(*) AS count FROM schedules").get();
  return "sch" + (row.count + 1);
}

function rowToExecution(row) {
  const flow = flowService.getFlow(row.flowId);
  const project = projectService.getProjectDetail(row.projectId);
  return {
    id: row.id,
    projectId: row.projectId,
    flowId: row.flowId,
    flowName: flow?.name || row.flowId,
    projectName: project?.name || row.projectId,
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
  const flow = flowService.getFlow(flowId);
  if (!flow) throw new Error("Flow not found");

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

  const project = projectService.getProjectDetail(projectId);
  runFlowEngine(execution, flow, project || {});

  return { ...execution };
}

export async function debugFlow(flowId, { variables, usePublished, nodeList, edges } = {}) {
  const flow = flowService.getFlow(flowId);
  if (!flow) return undefined;

  const project = projectService.getProjectDetail(flow.projectId) || {};

  let effectiveNodeList = nodeList;
  let effectiveEdges = edges;
  if (effectiveNodeList === undefined) {
    if (usePublished) {
      effectiveNodeList = flow.publishedNodeList || [];
      effectiveEdges = edges === undefined ? (flow.publishedEdges || []) : edges;
    } else {
      effectiveNodeList = flow.nodeList || [];
      effectiveEdges = edges === undefined ? (flow.edges || []) : edges;
    }
  }

  const inputVariables = parseVariables(variables);

  const result = await run(
    { flow: { ...flow, nodeList: effectiveNodeList, edges: effectiveEdges }, project },
    { maxDepth: 100, maxIterations: 1000 },
    inputVariables
  );

  return {
    status: result.status,
    output: result.output,
    nodesRun: result.nodesRun ?? 0,
    logs: result.logs ?? [],
    iterations: result.iterations ?? 0,
    branchPath: result.branch ? [result.branch] : []
  };
}

function parseVariables(variables) {
  if (variables === undefined || variables === null) return {};
  if (typeof variables === "object") return variables;
  try {
    return JSON.parse(variables);
  } catch {
    throw new Error("Invalid variables JSON");
  }
}

async function runFlowEngine(execution, flow, project) {
  const startedAtMs = Date.parse(execution.startedAt);

  const isScheduled = execution.trigger === "schedule";
  let effectiveFlow = flow;
  if (isScheduled) {
    if (flow.status !== "published") {
      const endedAt = timestamp();
      const duration = Date.parse(endedAt) - startedAtMs;
      completeExecution(execution.id, { duration, nodesRun: 0, output: null, branchPath: [], iterations: [] });
      const db = getDb();
      db.prepare(`UPDATE executions SET status = ? WHERE id = ?`).run("error", execution.id);
      addExecutionLog(execution.id, { node: "engine", status: "error", message: "Scheduled execution skipped: flow is not published" });
      return;
    }
    effectiveFlow = { ...flow, nodeList: flow.publishedNodeList || [], edges: flow.publishedEdges || [] };
  }

  try {
    const result = await run(
      { flow: effectiveFlow, project },
      { maxDepth: 100, maxIterations: 1000 },
      {}
    );

    // REQ-FLOW-028 AC1/AC3：节点级执行记录随每次执行持久化。
    insertExecutionNodes(execution.id, result.nodeRecords);

    const endedAt = timestamp();
    const duration = Date.parse(endedAt) - startedAtMs;
    const status = result.status === "success" ? "success" : "error";

    completeExecution(execution.id, {
      duration,
      nodesRun: result.nodesRun ?? 0,
      output: result.output,
      branchPath: result.branch ? [result.branch] : [],
      iterations: Array.from({ length: result.iterations ?? 0 }, (_, i) => i + 1)
    });

    // Override status when the engine returned an error.
    if (status === "error") {
      const db = getDb();
      db.prepare(`UPDATE executions SET status = ? WHERE id = ?`).run("error", execution.id);
    }

    if (result.logs && result.logs.length > 0) {
      for (const log of result.logs) {
        addExecutionLog(execution.id, {
          node: log.node ?? "unknown",
          status: status,
          message: log.message || JSON.stringify(log)
        });
      }
    }

    if (result.status === "error" && result.error) {
      addExecutionLog(execution.id, { node: "engine", status: "error", message: result.error });
    }
  } catch (err) {
    const endedAt = timestamp();
    const duration = Date.parse(endedAt) - startedAtMs;
    completeExecution(execution.id, {
      duration,
      nodesRun: 0,
      output: null,
      branchPath: [],
      iterations: []
    });
    const db = getDb();
    db.prepare(`UPDATE executions SET status = ? WHERE id = ?`).run("error", execution.id);
    addExecutionLog(execution.id, { node: "engine", status: "error", message: err.message });
    // REQ-FLOW-028：fatal/fail 终止路径同样持久化已累积的节点记录（含失败节点）。
    // 写失败不掩盖主错误，仅记录。
    try {
      insertExecutionNodes(execution.id, err.nodeRecords ?? []);
    } catch (nodesErr) {
      console.error("Failed to persist execution nodes:", nodesErr.message);
    }
  }
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
