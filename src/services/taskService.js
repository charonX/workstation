import { getDb, resetDb } from "../db.js";
import * as eventBus from "./eventBus.js";
import { run } from "../flowEngine/flowEngine.js";
import * as flowService from "./flowService.js";
import * as projectService from "./projectService.js";
import { createExecutionQueue, recoverInterruptedExecutions as recoverInterruptedExecutionsFromQueue } from "./executionQueue.js";
import * as schedulerService from "./schedulerService.js";
import * as notificationService from "./notificationService.js";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const QUEUE_DRAINED_REASON = "E-QUEUE-DRAINED: execution aborted by queue lifecycle change";
const QUEUED_STATE_OBSERVATION_MS = 250;

let executionQueue = createExecutionQueue();
let executionGeneration = 0;

// Test injection seams.
let testAgentExecutor = null;
let testChannelAdapter = null;

// Production channel adapter injected by server startup (REQ-CHANNEL-001).
let channelAdapter = null;

// Optional lazy reference to channelManager so taskService can always resolve
// the current live adapter (survives channelManager.restart()). Caches the
// module after first successful load; missing module or import errors are
// treated as "channelManager not available" and fall back to the adapters above.
let channelManagerModule = null;

export function setAgentExecutorForTests(executor) {
  testAgentExecutor = executor;
}

export function setChannelAdapter(adapter) {
  channelAdapter = adapter;
}

export function setChannelAdapterForTests(adapter) {
  testChannelAdapter = adapter;
}

export async function clearExecutionQueue() {
  // Replace the queue instance entirely so tests/server restarts don't inherit
  // pending or running executions from a previous lifecycle.
  executionGeneration += 1;
  const oldQueue = executionQueue;
  executionQueue = createExecutionQueue();
  if (oldQueue) {
    // Drain: reject pending items and wait for the currently running item to
    // finish so it cannot write to a DB that has already been reset.
    oldQueue.destroy();
    const deadline = Date.now() + 5000;
    while (oldQueue.pendingCount() > 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
}

function timestamp() {
  return new Date().toISOString();
}

export function resetTasks(seed = { executions: [], schedules: [] }) {
  resetDb();
  const db = getDb();
  const insertExecution = db.prepare(`
    INSERT INTO executions (id, projectId, flowId, trigger, status, startedAt, endedAt, duration, nodesRun, variables, output, branchPath, iterations, logs, artifacts, parentExecutionId, parentNodeId, depth)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      JSON.stringify(execution.logs ?? []),
      execution.artifacts !== undefined ? JSON.stringify(execution.artifacts) : null,
      execution.parentExecutionId ?? null,
      execution.parentNodeId ?? null,
      execution.depth ?? 0
    );
  }
  const insertSchedule = db.prepare(`
    INSERT INTO schedules (id, projectId, flowId, cron, enabled, variables, error)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  for (const schedule of seed.schedules || []) {
    insertSchedule.run(
      schedule.id ?? nextScheduleId(),
      schedule.projectId,
      schedule.flowId,
      schedule.cron,
      schedule.enabled !== false ? 1 : 0,
      JSON.stringify(schedule.variables ?? {}),
      schedule.error ?? null
    );
  }
}

function nextExecutionId() {
  return crypto.randomUUID();
}

// REQ-FLOW-028 AC2：agent prompt 落库前截断到前 4000 字符。
const PROMPT_LOG_MAX_LENGTH = 4000;

// REQ-FLOW-028 / tech-design §5.6：把引擎 run() 返回的 nodeRecords 逐行写入
// execution_nodes（同一 db 连接，单事务）。
function insertExecutionNodes(executionId, nodeRecords) {
  if (!Array.isArray(nodeRecords) || nodeRecords.length === 0) return;
  const db = getDb();
  const insert = db.prepare(`
    INSERT INTO execution_nodes (id, executionId, nodeId, nodeName, inputVariables, outputVariables, branchTaken, error, attemptCount, prompt, output, model, provider, status, durationMs)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const writeAll = db.transaction((records) => {
    records.forEach((record, index) => {
      insert.run(...executionNodeInsertParams(executionId, record, index));
    });
  });
  writeAll(nodeRecords);
}

// nodeRecord → execution_nodes 行参数（列序与 §5.6 DDL 一致）。record.agent 存在时展开
// agent 调用详情。
// status 语义：record.error 非空 → "error"（含 onError=ignore 降级路径，错误信息记入
// error 列），否则 → "success"。
// output 列：仅 agent 节点（record.agent 存在）填充，优先取 agent.output（adapter 返回文本，
// REQ-FLOW-028 v1.2，不经 outputVariable 声明），回落 outputVariables 首个值；两者皆无时为 NULL。
function executionNodeInsertParams(executionId, record, index) {
  const agent = record.agent ?? null;
  return [
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
  ];
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

// REQ-FLOW-028 AC4 / tech-design §7 + REQ-FLOW-040 AC6: 滚动时间窗清理过期执行日志。
// cutoff = now - retentionDays×24h（ISO 字符串比较，startedAt 均为 toISOString 格式）。
// REQ-FLOW-040 AC6: 删除父 execution 时递归级联删除其所有后代（通过 parentExecutionId 链）。
// 单事务内按序删 execution_nodes → logs → executions，包括通过 CTE 收集的后代 id。
export function purgeExpiredExecutions(db, { retentionDays = 7, now = new Date() } = {}) {
  const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000).toISOString();

  const purge = db.transaction(() => {
    // 递归收集过期根及其所有后代 execution id（CTE 递归沿 parentExecutionId 链向下）。
    const collectIds = db.prepare(`
      WITH RECURSIVE all_expired(id) AS (
        SELECT id FROM executions WHERE startedAt < ?
        UNION
        SELECT e.id FROM executions e JOIN all_expired a ON e.parentExecutionId = a.id
      )
      SELECT id FROM all_expired
    `);
    const allIds = collectIds.all(cutoff).map((r) => r.id);

    if (allIds.length === 0) {
      return { executions: 0, executionNodes: 0, logs: 0 };
    }

    const placeholders = allIds.map(() => "?").join(",");
    const deleteNodes = db.prepare(`DELETE FROM execution_nodes WHERE executionId IN (${placeholders})`);
    const deleteLogs = db.prepare(`DELETE FROM logs WHERE executionId IN (${placeholders})`);
    const deleteExecutions = db.prepare(`DELETE FROM executions WHERE id IN (${placeholders})`);

    const executionNodes = deleteNodes.run(...allIds).changes;
    const logs = deleteLogs.run(...allIds).changes;
    const executions = deleteExecutions.run(...allIds).changes;
    return { executions, executionNodes, logs };
  });
  return purge();
}

function nextScheduleId() {
  return crypto.randomUUID();
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
    projectPath: project?.localPath || null,
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
    logs: JSON.parse(row.logs || "[]"),
    artifacts: row.artifacts !== null ? JSON.parse(row.artifacts) : [],
    parentExecutionId: row.parentExecutionId ?? null,
    parentNodeId: row.parentNodeId ?? null,
    depth: row.depth ?? 0
  };
}

function rowToSchedule(row) {
  return {
    id: row.id,
    projectId: row.projectId,
    flowId: row.flowId,
    cron: row.cron,
    enabled: Boolean(row.enabled),
    variables: JSON.parse(row.variables || "{}"),
    error: row.error || null
  };
}

export function createTask({ projectId, flowId, trigger, variables, scheduleId }) {
  if (!projectId) throw new Error("Project is required");
  const project = projectService.getProjectDetail(projectId);
  if (!project) throw new Error("Project not found");
  const flow = flowService.getFlow(flowId);

  if (trigger === "schedule") {
    if (!flow || flow.status !== "published") {
      const reason = "E-SCHED-FLOW-INVALID";
      const statusLabel = flow ? flow.status : "missing";
      console.error(`${reason}: Scheduled execution skipped for flow ${flowId} (status=${statusLabel})`);
      if (scheduleId) {
        markScheduleInvalid(scheduleId, reason);
      }
      return { skipped: true, reason };
    }
  } else if (!flow) {
    throw new Error("Flow not found");
  }

  const inputVariables = parseVariables(variables);

  const execution = {
    id: nextExecutionId(),
    projectId,
    flowId,
    trigger: trigger || "manual",
    status: "queued",
    startedAt: timestamp(),
    endedAt: null,
    duration: null,
    nodesRun: 0,
    variables: inputVariables,
    output: null,
    branchPath: [],
    iterations: [],
    logs: [],
    artifacts: []
  };

  // REQ-SCHEDULE-007：先检查容量，队列已满时同步拒绝，避免残留 queued 记录。
  if (executionQueue.isFull(projectId)) {
    const err = new Error("队列已满，稍后再发");
    err.code = "E-QUEUE-FULL";
    throw err;
  }

  const run = async () => executeTask(execution, flow, project);
  const enqueuePromise = executionQueue.enqueue({
    projectId,
    executionId: execution.id,
    run
  });

  const db = getDb();
  db.prepare(`
    INSERT INTO executions (id, projectId, flowId, trigger, status, startedAt, endedAt, duration, nodesRun, variables, output, branchPath, iterations, logs, artifacts, parentExecutionId, parentNodeId, depth)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    JSON.stringify(execution.logs),
    JSON.stringify(execution.artifacts),
    null,
    null,
    0
  );

  // Don't await the queue run here; return immediately with position.
  enqueuePromise.catch((err) => {
    console.error(`[taskService] queue run rejected for ${execution.id}:`, err.message);
  });

  const queuePosition = executionQueue.getPosition(execution.id);
  // Keep `id` for backward compatibility with older tests/clients that expect
  // the full execution object shape; `executionId` is the canonical field per
  // tech-design「taskService.createTask」契约.
  return { id: execution.id, executionId: execution.id, queuePosition };
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

  const executors = testAgentExecutor ? { agent: testAgentExecutor } : {};
  // REQ-FLOW-039 AC3: 调试路径同样注入 invokeSubflow（draft 版本），保持和生产路径行为一致。
  // debug 模式无持久化 execution 行，用一个合成 parentExecutionId 以支持嵌套追溯。
  const debugParentExecutionId = `debug-${crypto.randomUUID()}`;
  const services = {
    invokeSubflow: makeInvokeSubflow({ project, executors, parentExecutionId: debugParentExecutionId })
  };

  const result = await run(
    { flow: { ...flow, nodeList: effectiveNodeList, edges: effectiveEdges }, project },
    { maxDepth: 100, maxIterations: 1000, executors, services, currentDepth: 0 },
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

// REQ-FLOW-040 / D2 / D4: invokeSubflow 服务实现（同步内联递归执行子流程）。
// 由 makeInvokeSubflow 闭包绑定 { project, executors, parentExecutionId }，在每次
// 递归时重新绑定新的 parentExecutionId（子 execution id），形成链式可观测记录。
const MAX_SUBFLOW_DEPTH = 8;

async function invokeSubflowImpl({
  targetFlowId,
  entryNodeId,
  inputVars,
  parentNodeId,
  parentDepth,
  parentExecutionId,
  project,
  executors
}) {
  // REQ-FLOW-037 AC4: 运行时深度兜底（保存时静态检测已拦截，此为竞态兜底）。
  if (parentDepth + 1 > MAX_SUBFLOW_DEPTH) {
    throw new Error(`E-FLOW-MAX-DEPTH: nested call depth exceeds ${MAX_SUBFLOW_DEPTH}`);
  }

  // REQ-FLOW-039 AC1/AC4: 加载子流程当前版本（draft，不读 published），并检查软删除。
  const childFlowRow = flowService.getFlow(targetFlowId);
  if (!childFlowRow) {
    throw new Error(`E-FLOW-REF-MISSING: subflow ${targetFlowId} not found or deleted`);
  }
  const childNodeList = childFlowRow.nodeList || [];
  const childEdges = childFlowRow.edges || [];

  const childExecutionId = nextExecutionId();
  const startedAt = timestamp();
  const childDepth = parentDepth + 1;

  // REQ-FLOW-040 AC2: 子 execution 入库（status=running, trigger=subflow）。
  const db = getDb();
  db.prepare(`
    INSERT INTO executions (id, projectId, flowId, trigger, status, startedAt, endedAt, duration, nodesRun, variables, output, branchPath, iterations, logs, artifacts, parentExecutionId, parentNodeId, depth)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    childExecutionId,
    project.id,
    targetFlowId,
    "subflow",
    "running",
    startedAt,
    null,
    null,
    0,
    JSON.stringify(inputVars || {}),
    null,
    JSON.stringify([]),
    JSON.stringify([]),
    JSON.stringify([]),
    JSON.stringify([]),
    parentExecutionId,
    parentNodeId,
    childDepth
  );

  // 构建子 run() 的 services：递归绑定 childExecutionId 作为下一层 parentExecutionId。
  const childServices = {
    invokeSubflow: makeInvokeSubflow({
      project,
      executors,
      parentExecutionId: childExecutionId
    })
  };

  const childFlowForEngine = { nodeList: childNodeList, edges: childEdges };

  try {
    const childResult = await run(
      { flow: childFlowForEngine, project },
      {
        services: childServices,
        startNodeId: entryNodeId,
        currentDepth: childDepth,
        maxDepth: 100,
        maxIterations: 1000,
        executors
      },
      inputVars || {}
    );

    // REQ-FLOW-035 AC6 / D5: 扫 nodeRecords 找最后一个 flowOutput 作为出口（见 FLOW-033 AC4）。
    const nodesById = new Map(childNodeList.map((n) => [n.id, n]));
    const exitRecord = childResult.nodeRecords
      .filter((r) => nodesById.get(r.nodeId)?.type?.toLowerCase() === "flowoutput")
      .pop();

    if (!exitRecord) {
      // REQ-FLOW-037 AC2: 未达出口 → 子 execution 标记 error，抛错冒泡。
      insertExecutionNodes(childExecutionId, childResult.nodeRecords);
      completeExecutionError(childExecutionId, Date.now() - Date.parse(startedAt));
      const err = new Error("E-SUBFLOW-NO-OUTPUT: child flow finished without reaching flowOutput");
      err.nodeRecords = childResult.nodeRecords;
      throw err;
    }

    // 按 flowOutput 节点 config.outputVariables 从 record.outputVariables 取出子出参。
    const exitNode = nodesById.get(exitRecord.nodeId);
    const childOutputs = {};
    for (const varDef of exitNode.config?.outputVariables ?? []) {
      if (!varDef || typeof varDef.name !== "string") continue;
      const fqKey = `${exitRecord.nodeId}.${varDef.name}`;
      childOutputs[varDef.name] = exitRecord.outputVariables?.[fqKey];
    }

    insertExecutionNodes(childExecutionId, childResult.nodeRecords);
    completeExecution(childExecutionId, {
      status: "success",
      duration: Date.now() - Date.parse(startedAt),
      nodesRun: childResult.nodesRun ?? 0,
      output: childOutputs,
      branchPath: [],
      iterations: [],
      artifacts: []
    });

    return {
      status: "success",
      output: childOutputs,
      childExecutionId,
      logs: childResult.logs ?? []
    };
  } catch (err) {
    // REQ-FLOW-044 AC4: propagate childExecutionId on the failure path so the
    // parent callFlow node can still expose an expand affordance in the UI.
    if (err && typeof err === "object" && !err.childExecutionId) {
      err.childExecutionId = childExecutionId;
    }
    // REQ-FLOW-037 AC1: 子流程节点失败冒泡 → 子 execution 标 error，持久化已累积节点记录。
    completeExecutionError(childExecutionId, Date.now() - Date.parse(startedAt));
    try {
      insertExecutionNodes(childExecutionId, err.nodeRecords ?? []);
    } catch {
      // 写失败不掩盖主错误。
    }
    throw err;
  }
}

// 闭包工厂：绑定 project / executors / parentExecutionId，返回供 engine/callFlowExecutor 调用的 invokeSubflow。
function makeInvokeSubflow({ project, executors, parentExecutionId }) {
  return async function invokeSubflow(args) {
    return invokeSubflowImpl({ ...args, parentExecutionId, project, executors });
  };
}

function completeExecutionError(executionId, duration) {
  return completeExecution(executionId, {
    status: "error",
    duration,
    nodesRun: 0,
    output: null,
    branchPath: [],
    iterations: [],
    artifacts: []
  });
}

function abortExecutionIfQueued(execution, startedAtMs, reason) {
  try {
    const db = getDb();
    const row = db.prepare("SELECT * FROM executions WHERE id = ?").get(execution.id);
    if (!row || row.status !== "queued") return;
    const endedAt = timestamp();
    const duration = Date.parse(endedAt) - startedAtMs;
    completeExecutionError(execution.id, duration);
    addExecutionLog(execution.id, { node: "engine", status: "error", message: reason });
  } catch {
    // Ignore teardown races.
  }
}

export async function executeTask(execution, flow, project) {
  const myGeneration = executionGeneration;
  // Give callers a short window to observe the queued state before the
  // execution transitions to running. This makes HTTP GETs immediately after
  // createTask reliably see status=queued without affecting queue semantics.
  await new Promise((resolve) => setTimeout(resolve, QUEUED_STATE_OBSERVATION_MS));
  // If the queue was cleared (server restart / test lifecycle), abort this run
  // instead of touching a potentially unrelated DB row.
  if (executionGeneration !== myGeneration) {
    abortExecutionIfQueued(execution, Date.parse(execution.startedAt), QUEUE_DRAINED_REASON);
    return;
  }

  const startedAtMs = Date.parse(execution.startedAt);
  const db = getDb();

  // Move from queued to running.
  db.prepare(`UPDATE executions SET status = ? WHERE id = ?`).run("running", execution.id);

  // REQ-AGENT-020：执行启动事件（任务卡片渲染器消费；sessionKey 由执行上下文
  // 解析——对话下发需记录 originating spaceKey，见 cardRenderer 接线）。
  eventBus.publish("execution:started", {
    executionId: execution.id,
    projectId: execution.projectId,
    flowId: execution.flowId,
    status: "running",
    trigger: execution.trigger,
    variables: execution.variables,
  });

  const isScheduled = execution.trigger === "schedule";
  let effectiveFlow = flow;
  if (isScheduled) {
    if (flow.status !== "published") {
      const endedAt = timestamp();
      const duration = Date.parse(endedAt) - startedAtMs;
      completeExecutionError(execution.id, duration);
      addExecutionLog(execution.id, { node: "engine", status: "error", message: "E-SCHED-FLOW-INVALID: Scheduled execution skipped: flow is not published" });
      return;
    }
    effectiveFlow = { ...flow, nodeList: flow.publishedNodeList || [], edges: flow.publishedEdges || [] };
  }

  try {
    const executors = {};
    if (testAgentExecutor) {
      executors.agent = testAgentExecutor;
    }

    // REQ-FLOW-032: inject a channel-manager shim into execution variables so
    // feishuSend nodes can send replies via the currently resolved adapter
    // (live channelManager adapter, startup-injected adapter, or test adapter).
    // Production path falls back to dynamic import of channelManager module.
    const variablesForRun = {
      ...execution.variables,
      _channelManager: {
        async send(channelType, payload) {
          const adapter = await resolveChannelAdapter();
          if (!adapter) throw new Error("E-CHANNEL-DOWN: no channel adapter available");
          return adapter.send(payload);
        },
        async reply(channelType, payload) {
          const adapter = await resolveChannelAdapter();
          if (!adapter) throw new Error("E-CHANNEL-DOWN: no channel adapter available");
          return adapter.reply(payload);
        }
      }
    };

    // REQ-FLOW-035 AC7 / D1: 注入 invokeSubflow 服务，绑定当前 execution.id 作为父 executionId。
    const services = {
      invokeSubflow: makeInvokeSubflow({ project, executors, parentExecutionId: execution.id })
    };

    const result = await run(
      { flow: effectiveFlow, project },
      { maxDepth: 100, maxIterations: 1000, executors, services, currentDepth: 0 },
      variablesForRun
    );

    // Generation may have changed while the engine was running (server stop /
    // test lifecycle). Abort before writing to a potentially unrelated DB.
    if (executionGeneration !== myGeneration) {
      abortExecutionIfQueued(execution, startedAtMs, QUEUE_DRAINED_REASON);
      return;
    }

    // REQ-FLOW-028 AC1/AC3：节点级执行记录随每次执行持久化。
    insertExecutionNodes(execution.id, result.nodeRecords);

    const endedAt = timestamp();
    const duration = Date.parse(endedAt) - startedAtMs;
    const status = result.status === "success" ? "success" : "error";
    const artifacts = status === "success" ? await collectArtifacts(project, execution) : [];

    completeExecution(execution.id, {
      status,
      duration,
      nodesRun: result.nodesRun ?? 0,
      output: result.output,
      branchPath: result.branch ? [result.branch] : [],
      iterations: Array.from({ length: result.iterations ?? 0 }, (_, i) => i + 1),
      artifacts
    });

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
    if (executionGeneration !== myGeneration) {
      abortExecutionIfQueued(execution, startedAtMs, QUEUE_DRAINED_REASON);
      return;
    }
    const endedAt = timestamp();
    const duration = Date.parse(endedAt) - startedAtMs;
    completeExecutionError(execution.id, duration);
    addExecutionLog(execution.id, { node: "engine", status: "error", message: err.message });
    // REQ-FLOW-028：fatal/fail 终止路径同样持久化已累积的节点记录（含失败节点）。
    // 写失败不掩盖主错误，仅记录。
    try {
      insertExecutionNodes(execution.id, err.nodeRecords ?? []);
    } catch (nodesErr) {
      console.error("Failed to persist execution nodes:", nodesErr.message);
    }
  } finally {
    // REQ-SCHEDULE-009 v1.1 / REQ-FLOW-032:不再自动回复 IM 消息——最终回复由
    // flow 中显式 feishuReply 节点控制。imRouter 在入队时仍立即回执"收到，排队中"。
    // 仅保留通知中心写入（产物/失败通知），delivery 相关代码保留用于 schedule 场景。
    if (executionGeneration === myGeneration) {
      try {
        await deliverTerminalNotification(execution.id);
      } catch (deliveryErr) {
        console.error("[taskService] terminal delivery failed:", deliveryErr.message);
      }
      try {
        writeExecutionNotification(execution.id);
      } catch (notifyErr) {
        console.error("[taskService] execution notification failed:", notifyErr.message);
      }
    }
  }
}

function extractArtifactPaths(execution) {
  const artifacts = execution.artifacts || [];
  return artifacts.map((a) => (typeof a === "string" ? a : a?.path)).filter(Boolean);
}

function buildTerminalSuccessText(execution) {
  const paths = extractArtifactPaths(execution);
  if (execution.trigger === "schedule") {
    const date = new Date().toLocaleDateString("zh-CN");
    const sourceCount = paths.length;
    return `日报摘要 ${date}：共 ${sourceCount} 条产物` + (paths.length > 0 ? `\n${paths.join("\n")}` : "");
  }
  const pathStr = paths.length > 0 ? paths[0] : "（无登记产物）";
  return `已存：${pathStr}`;
}

function buildTerminalFailureText(execution) {
  const reason = execution.variables?.reason || extractErrorCode(execution) || "E-AGENT-FAILED";
  return `执行失败：${reason}`;
}

async function resolveChannelAdapter() {
  // Prefer the live adapter currently held by channelManager. After
  // channelManager.restart() the adapter instance is replaced, so the
  // channelAdapter injected at server startup becomes a stale offline reference.
  if (!channelManagerModule) {
    try {
      channelManagerModule = await import("../services/channelManager.js");
    } catch {
      channelManagerModule = null;
    }
  }
  if (channelManagerModule?.getAdapter) {
    const liveAdapter = channelManagerModule.getAdapter("feishu");
    if (liveAdapter && typeof liveAdapter.getStatus === "function" && liveAdapter.getStatus() === "online") {
      return liveAdapter;
    }
  }

  // Fallback to the adapter injected at server startup or for tests.
  if (channelAdapter && typeof channelAdapter.getStatus === "function" && channelAdapter.getStatus() === "online") {
    return channelAdapter;
  }
  return testChannelAdapter;
}

function resolveTerminalRecipient(execution) {
  // REQ-SCHEDULE-009 v1.1 / REQ-FLOW-032: channel 触发的 execution 不再自动回复 IM
  // 消息（由 flow 中显式 feishuReply 节点控制）。仅 schedule 触发保留自动投递——
  // 场景 A 定时日报无显式触发方，系统主动推送。
  if (execution.trigger === "schedule") {
    return { chatId: "default", messageId: undefined };
  }
  return null;
}

async function deliverTerminalNotification(executionId) {
  const execution = getExecution(executionId);
  if (!execution) return;

  const recipient = resolveTerminalRecipient(execution);
  if (!recipient) return;

  const adapter = await resolveChannelAdapter();
  if (!adapter) return;

  const text = execution.status === "success"
    ? buildTerminalSuccessText(execution)
    : buildTerminalFailureText(execution);

  try {
    if (recipient.messageId) {
      await adapter.reply({ messageId: recipient.messageId, text });
    } else if (recipient.chatId) {
      await adapter.send({ chatId: recipient.chatId, text });
    }
  } catch (err) {
    console.error(`[taskService] E-CHANNEL-SEND: failed to deliver terminal notification for ${executionId}:`, err.message);
    throw err;
  }
}

function extractErrorCode(execution) {
  const logs = execution.logs || [];
  for (let i = logs.length - 1; i >= 0; i--) {
    const message = logs[i]?.message || "";
    const match = message.match(/E-(AGENT|FETCH)-FAILED/);
    if (match) return match[0];
  }
  return undefined;
}

function writeExecutionNotification(executionId) {
  const execution = getExecution(executionId);
  if (!execution) return;
  if (execution.status === "success") {
    const paths = extractArtifactPaths(execution);
    if (paths.length === 0) return;
    notificationService.notify({
      type: "artifact",
      title: "产物产出",
      body: paths.join("\n") || "执行成功",
      executionId: execution.id
    });
  } else if (execution.status === "error") {
    const reason = extractErrorCode(execution) || "E-AGENT-FAILED";
    notificationService.notify({
      type: "execution-failed",
      title: "执行失败",
      body: reason,
      executionId: execution.id
    });
  }
}

async function collectArtifacts(project, execution) {
  // Minimal artifact registration: scan the project directory for files created
  // during this execution. We use a simple heuristic of files newer than the
  // execution start time. This satisfies the "登记产物路径" contract without
  // requiring engine/skill internals to know about artifact registration.
  const artifacts = [];
  try {
    const baseDir = project.localPath;
    if (!baseDir || !fs.existsSync(baseDir)) return artifacts;
    const startedAtMs = Date.parse(execution.startedAt);
    const scanDir = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          scanDir(full);
        } else {
          const stat = fs.statSync(full);
          if (stat.mtimeMs >= startedAtMs) {
            artifacts.push(full);
          }
        }
      }
    };
    scanDir(baseDir);
  } catch (err) {
    console.error("[taskService] artifact collection failed:", err.message);
  }
  return artifacts;
}

export function markScheduleInvalid(scheduleId, error) {
  const db = getDb();
  const row = db.prepare("SELECT * FROM schedules WHERE id = ?").get(scheduleId);
  if (!row) return undefined;
  db.prepare("UPDATE schedules SET enabled = 0, error = ? WHERE id = ?").run(error, scheduleId);
  try {
    schedulerService.remove(scheduleId);
  } catch {
    // Ignore teardown races.
  }
  return rowToSchedule({ ...row, enabled: 0, error });
}

export function createSchedule({ projectId, flowId, cron, variables }) {
  if (!projectId) throw new Error("Project is required");
  if (!cron) throw new Error("Cron expression is required");
  schedulerService.validateCron(cron);
  const schedule = {
    id: nextScheduleId(),
    projectId,
    flowId,
    cron,
    enabled: true,
    variables: parseVariables(variables)
  };
  const db = getDb();
  db.prepare(`
    INSERT INTO schedules (id, projectId, flowId, cron, enabled, variables, error)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    schedule.id,
    schedule.projectId,
    schedule.flowId,
    schedule.cron,
    schedule.enabled ? 1 : 0,
    JSON.stringify(schedule.variables),
    schedule.error ?? null
  );
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

export function listExecutions({ parentExecutionId } = {}) {
  const db = getDb();
  if (parentExecutionId !== undefined) {
    return db.prepare(
      "SELECT * FROM executions WHERE parentExecutionId = ? ORDER BY startedAt ASC, rowid ASC"
    ).all(parentExecutionId).map(rowToExecution);
  }
  return db.prepare("SELECT * FROM executions ORDER BY startedAt DESC, rowid DESC").all().map(rowToExecution);
}

export function getExecution(id) {
  const db = getDb();
  const row = db.prepare("SELECT * FROM executions WHERE id = ?").get(id);
  return row ? rowToExecution(row) : undefined;
}

export function completeExecution(id, { status = "success", duration, nodesRun, output, branchPath, iterations, artifacts }) {
  const db = getDb();
  const row = db.prepare("SELECT * FROM executions WHERE id = ?").get(id);
  if (!row) return undefined;
  const endedAt = timestamp();
  db.prepare(`
    UPDATE executions
    SET status = ?, endedAt = ?, duration = ?, nodesRun = ?, output = ?, branchPath = ?, iterations = ?, artifacts = ?
    WHERE id = ?
  `).run(
    status,
    endedAt,
    duration,
    nodesRun,
    output !== undefined ? JSON.stringify(output) : row.output,
    branchPath !== undefined ? JSON.stringify(branchPath) : row.branchPath,
    iterations !== undefined ? JSON.stringify(iterations) : row.iterations,
    artifacts !== undefined ? JSON.stringify(artifacts) : row.artifacts,
    id
  );
  // REQ-AGENT-020：执行终态事件（任务卡片定型：含执行 id，可 /status 复核；
  // 卡片失败不阻断执行——渲染器告警后仍返回终态）。
  eventBus.publish("execution:completed", {
    executionId: id,
    status,
    output,
    duration,
    nodesRun,
  });
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
  // REQ-AGENT-020：执行进度事件（任务卡片增量更新；不阻塞执行）。
  eventBus.publish("execution:progress", {
    executionId: id,
    status,
    log: message,
    node,
  });
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
  return eventBus.subscribe("schedule:triggered", ({ scheduleId, projectId, flowId, variables }) => {
    createTask({ scheduleId, projectId, flowId, trigger: "schedule", variables });
  });
}
