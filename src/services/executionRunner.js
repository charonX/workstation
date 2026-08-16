// ExecutionRunner — 「如何运行一次执行」的唯一属主（ADR-028 / prd.md §10）。
//
// 本模块收编一次 flow 执行的生命周期知识：submit（入队触发唯一入口）/ runOnce
// （直跑执行器，描述符参数化）/ reset（单一失效机制：generation+1 + 队列 destroy
// + 有界等待）三接口 + 内部队列（executionQueue 接口私有化，本模块是其唯一消费者）
// + 执行写入原语全收（节点记录/完成态/日志/产物/终态通知/queued 结算/通道适配器
// 解析/executor 装配/观察窗）。
//
// 契约来源（逐点等价拷贝，非重新发明）：taskService.createTask / executeTask /
// clearExecutionQueue / 写入原语 —— 相同 SQL、相同事件、相同错误码。本模块不 import
// taskService（模块图无环：schedulerService → runner.submit 单向）。
//
// 描述符（runOnce 第二参）：{trigger, persist, artifacts, notify, observeQueued}；
// subflow 附加 {parentExecutionId, parentNodeId, depth, entryNodeId}（经 services
// bag 绑定，见 makeInvokeSubflow）。persist=false → 纯内存运行（debug 路径，零落库）。

import { getDb } from "../db.js";
import * as eventBus from "./eventBus.js";
import { run } from "../flowEngine/flowEngine.js";
import * as flowService from "./flowService.js";
import * as projectService from "./projectService.js";
import { createExecutionQueue, recoverInterruptedExecutions } from "./executionQueue.js";
import * as notificationService from "./notificationService.js";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const QUEUE_DRAINED_REASON = "E-QUEUE-DRAINED: execution aborted by queue lifecycle change (QUEUE_DRAINED_REASON)";
const QUEUED_STATE_OBSERVATION_MS = 250;
const MAX_SUBFLOW_DEPTH = 8;
// REQ-FLOW-028 AC2：agent prompt 落库前截断到前 4000 字符。
const PROMPT_LOG_MAX_LENGTH = 4000;

// 模块内部状态：队列实例 + generation（与现状 taskService 同模式——reset 是唯一
// 失效机制；队列实例整体替换，旧实例 destroy + 有界等待在飞项 settle）。
let executionQueue = createExecutionQueue();
let executionGeneration = 0;

// Test injection seams（REQ-FLOW-053：注入经 runner seam 生效）。
let testAgentExecutor = null;
let testChannelAdapter = null;

// Production channel adapter injected by server startup (REQ-CHANNEL-001)——
// resolveChannelAdapter 三级回退的中间层（live channelManager online → 生产注入 →
// test 注入，对齐 taskService 原三级；server.js startFeishuChannel 接线，裁决②）。
let channelAdapter = null;

// Optional lazy reference to channelManager so the runner can always resolve
// the current live adapter (survives channelManager.restart()). Caches the
// module after first successful load; missing module or import errors are
// treated as "channelManager not available" and fall back to the adapters above.
let channelManagerModule = null;

export function setAgentExecutorForTests(executor) {
  testAgentExecutor = executor;
}

export function setChannelAdapterForTests(adapter) {
  testChannelAdapter = adapter;
}

export function setChannelAdapter(adapter) {
  channelAdapter = adapter;
}

function timestamp() {
  return new Date().toISOString();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function nextExecutionId() {
  return crypto.randomUUID();
}

// 接口契约（REQ-FLOW-048）：submit({projectId, flowId, trigger, variables,
// scheduleId?}) → {id, executionId, queuePosition}；trigger=schedule 且 flow
// 缺失/非 published → {skipped:true, reason, scheduleId}（只返回 skipped——
// 不调 markScheduleInvalid、不写日志；skip 反应归 schedulerService，slice 2）。
// 容量满同步拒绝 E-QUEUE-FULL（第 51 个，复用 executionQueue.isFull + enqueue
// 拒绝）。落 queued 行后入队，立即返回（观察窗在 runOnce 出队启动时，不阻塞 submit）。
export function submit({ projectId, flowId, trigger, variables, scheduleId }) {
  if (!projectId) throw new Error("Project is required");
  const project = projectService.getProjectDetail(projectId);
  if (!project) throw new Error("Project not found");
  const flow = flowService.getFlow(flowId);

  if (trigger === "schedule") {
    if (!flow || flow.status !== "published") {
      const reason = "E-SCHED-FLOW-INVALID";
      // 入队时校验：skip 反应（日志 + markScheduleInvalid）由 schedulerService
      // 触发路径执行（REQ-SCHEDULE-010），submit 只返回 skipped。
      return { skipped: true, reason, scheduleId };
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

  const descriptor = {
    trigger: execution.trigger,
    persist: true,
    artifacts: true,
    notify: true,
    observeQueued: true
  };
  const runOnceBound = () => runOnce({ execution, flow, project }, descriptor);
  const enqueuePromise = executionQueue.enqueue({
    projectId,
    executionId: execution.id,
    run: runOnceBound
  });

  insertExecutionRow({
    id: execution.id,
    projectId: execution.projectId,
    flowId: execution.flowId,
    trigger: execution.trigger,
    status: execution.status,
    startedAt: execution.startedAt,
    endedAt: execution.endedAt,
    duration: execution.duration,
    nodesRun: execution.nodesRun,
    variables: execution.variables,
    output: execution.output,
    branchPath: execution.branchPath,
    iterations: execution.iterations,
    logs: execution.logs,
    artifacts: execution.artifacts,
    parentExecutionId: null,
    parentNodeId: null,
    depth: 0
  });

  // Don't await the queue run here; return immediately with position.
  enqueuePromise.catch((err) => {
    console.error(`[executionRunner] queue run rejected for ${execution.id}:`, err.message);
  });

  const queuePosition = executionQueue.getPosition(execution.id);
  // Keep `id` for backward compatibility with older tests/clients that expect
  // the full execution object shape; `executionId` is the canonical field per
  // tech-design「taskService.createTask」契约。
  return { id: execution.id, executionId: execution.id, queuePosition };
}

// 接口契约（REQ-FLOW-048）：runOnce(executionCtx, descriptor)。
// executionCtx = {execution, flow, project}（入队路径；debug 路径无 execution，
// persist=false → 纯内存运行，返回引擎结果）。
// 行为 = 现状 executeTask 逐点等价：generation 快照 → 观察窗（仅 observeQueued
// =true，250ms 常量）→ 检查点①（失配 → abortExecutionIfQueued 结算 queued 行 →
// return）→ 迁移 queued→running → 拼装（executors：testAgentExecutor 注入；
// _channelManager shim 经 resolveChannelAdapter；services.invokeSubflow =
// makeInvokeSubflow 绑定自身 persist）→ 引擎 run → 检查点②（成功）/③（catch）→
// 写入（insertExecutionNodes/completeExecution/collectArtifacts（仅 artifacts=
// true）/addExecutionLog）→ finally 检查点④ 门控 deliverTerminalNotification/
// writeExecutionNotification（仅 notify=true）。trigger=schedule 出队二次 published
// 校验（执行时非 published → completeExecutionError + 日志 E-SCHED-FLOW-INVALID）。
export async function runOnce(executionCtx, descriptor = {}) {
  const { execution, project } = executionCtx;
  const flow = executionCtx.flow ?? null;
  const trigger = descriptor.trigger ?? execution?.trigger ?? "manual";
  const persist = descriptor.persist !== false;
  const wantArtifacts = descriptor.artifacts !== false;
  const wantNotify = descriptor.notify !== false;

  const myGeneration = executionGeneration;
  // 持久化路径判定：有 execution 行且 persist 开启才触碰 DB。
  const persisted = Boolean(execution) && persist;
  // startedAt 只读一次，三个检查点（①/②/③）共用同一基准，结算时长一致。
  const startedAtMs = persisted ? Date.parse(execution.startedAt) : 0;
  // generation 失配判定（reset 竞态守卫）：队列/DB 已重置，本 run 不再写库。
  const generationStale = () => persisted && executionGeneration !== myGeneration;

  // 观察窗（tech-design 决议）：出队启动时睡眠而非 submit 返回前——250ms 必须在
  // 响应之后，调用方才能观察到 queued；深队列下与排队等待重叠，总墙钟不变。
  // 时长保持常量 250ms（不配置化）。仅入队触发（observeQueued=true）走观察窗。
  if (descriptor.observeQueued === true) {
    await sleep(QUEUED_STATE_OBSERVATION_MS);
  }

  // 检查点①：观察窗后 generation 失配 → queued 行结算（abortExecutionIfQueued，
  // 写 QUEUE_DRAINED_REASON）后返回，不触碰已重置 DB。
  if (generationStale()) {
    abortExecutionIfQueued(execution, startedAtMs, QUEUE_DRAINED_REASON);
    return undefined;
  }

  // 迁移 queued → running（仅持久化路径）。
  if (persisted) {
    markExecutionRunning(execution);
  }

  // trigger=schedule 出队二次 published 校验（REQ-FLOW-048 AC5）：执行时 flow
  // 必须仍 published——读取当前 flow 状态（入队时快照可能在排队期间失效）。
  let effectiveFlow = flow;
  if (trigger === "schedule" && persisted) {
    const currentFlow = flowService.getFlow(execution.flowId);
    if (!currentFlow || currentFlow.status !== "published") {
      const endedAt = timestamp();
      const duration = Date.parse(endedAt) - startedAtMs;
      completeExecutionError(execution.id, duration);
      addExecutionLog(execution.id, { node: "engine", status: "error", message: "E-SCHED-FLOW-INVALID: Scheduled execution skipped: flow is not published" });
      return undefined;
    }
    effectiveFlow = { ...currentFlow, nodeList: currentFlow.publishedNodeList || [], edges: currentFlow.publishedEdges || [] };
  }

  try {
    const executors = {};
    if (testAgentExecutor) {
      // REQ-FLOW-051 AC2（测试 seam 装配归一）：注入的 agent executor 按本 story
      // 测试先例经 context.prompt 读节点 prompt（executionRunner.test.js「executor
      // 经 context.prompt 读变量」）。engine 只把变量替换后的 prompt 放在
      // node.config.prompt（context 为扁平变量注册表，无 prompt 键）——runner 的
      // executor 装配 seam 把替换后的 prompt 并入 context，使字面 prompt 节点
      // （无 {{var}} 引用，如本 story parent/child 撞名 fixture）同样可经
      // context.prompt 区分调用来源。仅作用于注入 seam；生产 agentExecutor 走
      // node.config.prompt 路径，不受影响。
      executors.agent = async (args) => {
        const prompt = args.node?.config?.prompt;
        return typeof prompt === "string"
          ? testAgentExecutor({ ...args, context: { ...args.context, prompt } })
          : testAgentExecutor(args);
      };
    }

    // REQ-FLOW-032: inject a channel-manager shim into execution variables so
    // feishuSend nodes can send replies via the currently resolved adapter
    // (live channelManager adapter or test adapter).
    // debug 直跑路径（execution 为空）经 executionCtx.variables 带入调用方变量
    //（taskService.debugFlow 转发；slice 2）。
    const variablesForRun = {
      ...(execution?.variables ?? executionCtx.variables ?? {}),
      _channelManager: buildChannelManagerShim()
    };

    // REQ-FLOW-035 AC7 / D1: 注入 invokeSubflow 服务，绑定当前 execution.id 作为
    // 父 executionId；persist 绑定自身描述符（debug 子树零落库传播）；generation
    // 绑定本次 runOnce 捕获的 myGeneration 快照（REQ-FLOW-051 AC1：子执行写点
    // 纳入父 runOnce 的 generation 守卫——reset 中途子写被拦截）。
    const parentExecutionId = execution?.id ?? null;
    const services = {
      invokeSubflow: makeInvokeSubflow({ project, executors, parentExecutionId, persist, generation: myGeneration })
    };

    const result = await run(
      { flow: effectiveFlow, project },
      { maxDepth: 100, maxIterations: 1000, executors, services, currentDepth: 0 },
      variablesForRun
    );

    // 检查点②：引擎运行期间 generation 可能已变（server stop / 测试生命周期）。
    // 失配 → 结算后返回，不写已重置 DB。
    if (generationStale()) {
      abortExecutionIfQueued(execution, startedAtMs, QUEUE_DRAINED_REASON);
      return undefined;
    }

    if (!persisted) {
      // persist=false（debug）：纯内存运行，返回引擎结果，一切落库由调用方决定。
      return result;
    }

    // REQ-FLOW-028 AC1/AC3：节点级执行记录随每次执行持久化。
    insertExecutionNodes(execution.id, result.nodeRecords);

    const endedAt = timestamp();
    const duration = Date.parse(endedAt) - startedAtMs;
    const status = result.status === "success" ? "success" : "error";
    const artifacts = status === "success" && wantArtifacts ? await collectArtifacts(project, execution) : [];

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

    return result;
  } catch (err) {
    // 检查点③：catch 路径 generation 失配 → 结算后返回。
    if (generationStale()) {
      abortExecutionIfQueued(execution, startedAtMs, QUEUE_DRAINED_REASON);
      return undefined;
    }
    if (persisted) {
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
    }
    throw err;
  } finally {
    // 检查点④：终态通知仅在同一 generation 内且 notify 开启时投递（REQ-SCHEDULE-009
    // v1.1 / REQ-FLOW-032：不再自动回复 IM 消息——最终回复由 flow 中显式 feishuReply
    // 节点控制；仅保留通知中心写入（产物/失败通知），delivery 代码保留用于 schedule 场景）。
    if (persisted && executionGeneration === myGeneration && wantNotify) {
      try {
        await deliverTerminalNotification(execution.id);
      } catch (deliveryErr) {
        console.error("[executionRunner] terminal delivery failed:", deliveryErr.message);
      }
      try {
        writeExecutionNotification(execution.id);
      } catch (notifyErr) {
        console.error("[executionRunner] execution notification failed:", notifyErr.message);
      }
    }
  }
}

// 接口契约（REQ-FLOW-052）：reset() = generation+1 + 队列 destroy + 有界等待
// （20ms 轮询 pendingCount + 5s 上限，超时放弃）→ resolve。队列实例换成新的
// （clearExecutionQueue 语义）——保证在飞项 settle 后返回，不写已重置 DB。
export async function reset() {
  // Replace the queue instance entirely so tests/server restarts don't inherit
  // pending or running executions from a previous lifecycle.
  executionGeneration += 1;
  const oldQueue = executionQueue;
  executionQueue = createExecutionQueue();
  if (oldQueue) {
    // Drain: reject pending items and wait for the currently running item to
    // finish so it cannot write to a DB that has already been reset.
    //
    // 注：pendingCount == 0 时跳过 destroy——executionQueue.destroy() 对已被
    // 清空的 project 数组执行 q.length = 1 会在数组中留下 length 洞，pendingCount()
    // 会把它永久计为 1，使有界等待空转满 5s（既有缺陷，见 destroy 实现）。空队列
    // destroy 本身无副作用（无 pending 可拒绝、无在飞可等待），跳过语义等价。
    if (oldQueue.pendingCount() > 0) {
      oldQueue.destroy();
      const deadline = Date.now() + 5000;
      while (oldQueue.pendingCount() > 0 && Date.now() < deadline) {
        await sleep(20);
      }
    }
  }
}

export { recoverInterruptedExecutions } from "./executionQueue.js";

function parseVariables(variables) {
  if (variables === undefined || variables === null) return {};
  if (typeof variables === "object") return variables;
  try {
    return JSON.parse(variables);
  } catch {
    throw new Error("Invalid variables JSON");
  }
}

// ---- 写入原语（从 taskService 逐点等价迁入，runner 全收） ----

// executions 行插入（submit 的 queued 行与 subflow 子行共用同一列序/序列化规则）。
function insertExecutionRow({ id, projectId, flowId, trigger, status, startedAt, endedAt, duration, nodesRun, variables, output, branchPath, iterations, logs, artifacts, parentExecutionId, parentNodeId, depth }) {
  const db = getDb();
  db.prepare(`
    INSERT INTO executions (id, projectId, flowId, trigger, status, startedAt, endedAt, duration, nodesRun, variables, output, branchPath, iterations, logs, artifacts, parentExecutionId, parentNodeId, depth)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    projectId,
    flowId,
    trigger,
    status,
    startedAt,
    endedAt,
    duration,
    nodesRun,
    JSON.stringify(variables),
    output !== null ? JSON.stringify(output) : null,
    JSON.stringify(branchPath),
    JSON.stringify(iterations),
    JSON.stringify(logs),
    JSON.stringify(artifacts),
    parentExecutionId,
    parentNodeId,
    depth
  );
}

// queued → running 迁移 + 启动事件（仅持久化路径）。
function markExecutionRunning(execution) {
  getDb().prepare(`UPDATE executions SET status = ? WHERE id = ?`).run("running", execution.id);
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
}

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

// queued 行结算（检查点失配收尾）：仅当行仍为 queued 时标 error + 日志 reason。
// running 行弃置不写（由 recoverInterruptedExecutions 兜底，REQ-FLOW-052 AC3）。
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

// REQ-FLOW-032: shim 注入 execution variables——feishuSend 节点经它拿到当前
// live adapter（channelManager 重启后实例替换，运行时动态解析）或测试注入
// adapter（resolveChannelAdapter 兜底）。
function buildChannelManagerShim() {
  return {
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
  };
}

async function resolveChannelAdapter() {
  // Prefer the live adapter currently held by channelManager. After
  // channelManager.restart() the adapter instance is replaced, so any
  // startup-injected adapter becomes a stale offline reference.
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

  // Fallback to the adapter injected at server startup (REQ-CHANNEL-001)——
  // 仅在 online 时使用（与 taskService 原三级回退一致）。
  if (channelAdapter && typeof channelAdapter.getStatus === "function" && channelAdapter.getStatus() === "online") {
    return channelAdapter;
  }

  // Fallback to the adapter injected for tests.
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
    console.error(`[executionRunner] E-CHANNEL-SEND: failed to deliver terminal notification for ${executionId}:`, err.message);
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
    console.error("[executionRunner] artifact collection failed:", err.message);
  }
  return artifacts;
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

function getExecution(id) {
  const db = getDb();
  const row = db.prepare("SELECT * FROM executions WHERE id = ?").get(id);
  return row ? rowToExecution(row) : undefined;
}

function completeExecution(id, { status = "success", duration, nodesRun, output, branchPath, iterations, artifacts }) {
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
  // 卡片失败不阻断执行——渲染器告警后仍返回终态）。REQ-FLOW-051 AC3：payload
  // 追加父子字段 parentExecutionId/depth（additive，从本行读取——父执行如实带
  // null/0，既有字段 executionId/status/output/duration/nodesRun/artifacts 不变，
  // cardRenderer 只读既有字段不受影响）。
  eventBus.publish("execution:completed", {
    executionId: id,
    status,
    output,
    duration,
    nodesRun,
    artifacts,
    parentExecutionId: row.parentExecutionId ?? null,
    depth: row.depth ?? 0,
  });
  return getExecution(id);
}

function addExecutionLog(id, { node, status, message }) {
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

// ---- invokeSubflow（REQ-FLOW-040 / D2 / D4）：同步内联递归执行子流程 ----
// 由 makeInvokeSubflow 闭包绑定 { project, executors, parentExecutionId, persist }，
// 在每次递归时重新绑定新的 parentExecutionId（子 execution id），形成链式可观测记录。
// persist 传播：子描述符继承父 persist（debug 子树零落库，slice 3）。

// REQ-FLOW-035 AC6 / D5: 扫 nodeRecords 找最后一个 flowOutput 作为出口（见 FLOW-033 AC4）。
function findSubflowExit(nodeRecords, nodeList) {
  const nodesById = new Map(nodeList.map((n) => [n.id, n]));
  const exitRecord = nodeRecords
    .filter((r) => nodesById.get(r.nodeId)?.type?.toLowerCase() === "flowoutput")
    .pop();
  return { nodesById, exitRecord: exitRecord ?? null };
}

// 按 flowOutput 节点 config.outputVariables 从 record.outputVariables 取出子出参。
function extractSubflowOutputs(exitRecord, exitNode) {
  const childOutputs = {};
  for (const varDef of exitNode.config?.outputVariables ?? []) {
    if (!varDef || typeof varDef.name !== "string") continue;
    const fqKey = `${exitRecord.nodeId}.${varDef.name}`;
    childOutputs[varDef.name] = exitRecord.outputVariables?.[fqKey];
  }
  return childOutputs;
}

async function invokeSubflowImpl({
  targetFlowId,
  entryNodeId,
  inputVars,
  parentNodeId,
  parentDepth,
  parentExecutionId,
  project,
  executors,
  persist,
  generation
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
  const persistChild = persist !== false;

  // REQ-FLOW-051 AC1: 子执行写点纳入父 runOnce 的 generation 快照守卫——reset
  // 中途（generation 失配）子引擎继续跑完（内存），写全跳过，子行保持 running
  // （由 recoverInterruptedExecutions 兜底）；父 runOnce 检查点②照常结算。
  // writeAllowed 为 live 检查（写点逐个求值）：reset 在子引擎运行期间发生 →
  // 后续写点全部拦截；行 INSERT 发生在引擎前（守卫通过时已落行）不受影响。
  const writeAllowed = () => persistChild && executionGeneration === generation;

  // REQ-FLOW-040 AC2: 子 execution 入库（status=running, trigger=subflow）。
  // persist=false（debug 子树）时零落库。
  if (writeAllowed()) {
    insertExecutionRow({
      id: childExecutionId,
      projectId: project.id,
      flowId: targetFlowId,
      trigger: "subflow",
      status: "running",
      startedAt,
      endedAt: null,
      duration: null,
      nodesRun: 0,
      variables: inputVars || {},
      output: null,
      branchPath: [],
      iterations: [],
      logs: [],
      artifacts: [],
      parentExecutionId,
      parentNodeId,
      depth: childDepth
    });
  }

  // 构建子 run() 的 services：递归绑定 childExecutionId 作为下一层 parentExecutionId，
  // generation 继续传播（深层子写点同受父 runOnce 守卫）。
  const childServices = {
    invokeSubflow: makeInvokeSubflow({
      project,
      executors,
      parentExecutionId: childExecutionId,
      persist,
      generation
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

    const { nodesById, exitRecord } = findSubflowExit(childResult.nodeRecords, childNodeList);

    if (!exitRecord) {
      // REQ-FLOW-037 AC2: 未达出口 → 子 execution 标记 error，抛错冒泡。
      if (writeAllowed()) {
        insertExecutionNodes(childExecutionId, childResult.nodeRecords);
        completeExecutionError(childExecutionId, Date.now() - Date.parse(startedAt));
        addExecutionLog(childExecutionId, { node: "engine", status: "error", message: "E-SUBFLOW-NO-OUTPUT: child flow finished without reaching flowOutput" });
      }
      const err = new Error("E-SUBFLOW-NO-OUTPUT: child flow finished without reaching flowOutput");
      err.nodeRecords = childResult.nodeRecords;
      throw err;
    }

    const exitNode = nodesById.get(exitRecord.nodeId);
    const childOutputs = extractSubflowOutputs(exitRecord, exitNode);

    if (writeAllowed()) {
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
      // REQ-FLOW-051 AC2: 子日志写子 execution 行（逐条 addExecutionLog），不再
      // 冒泡父行；reset 中途（writeAllowed=false）日志同样不写。
      for (const log of childResult.logs ?? []) {
        addExecutionLog(childExecutionId, {
          node: log.node ?? "unknown",
          status: "success",
          message: log.message || JSON.stringify(log)
        });
      }
    }

    return {
      status: "success",
      output: childOutputs,
      childExecutionId,
      logs: []
    };
  } catch (err) {
    // REQ-FLOW-044 AC4: propagate childExecutionId on the failure path so the
    // parent callFlow node can still expose an expand affordance in the UI.
    if (err && typeof err === "object" && !err.childExecutionId) {
      err.childExecutionId = childExecutionId;
    }
    // REQ-FLOW-037 AC1: 子流程节点失败冒泡 → 子 execution 标 error，持久化已累积节点记录。
    if (writeAllowed()) {
      completeExecutionError(childExecutionId, Date.now() - Date.parse(startedAt));
      try {
        insertExecutionNodes(childExecutionId, err.nodeRecords ?? []);
      } catch {
        // 写失败不掩盖主错误。
      }
      // REQ-FLOW-051 AC2: 子失败日志写子行（错误路径同理）。
      addExecutionLog(childExecutionId, { node: "engine", status: "error", message: err.message });
    }
    throw err;
  }
}

// 闭包工厂：绑定 project / executors / parentExecutionId / persist / generation，
// 返回供 engine/callFlowExecutor 调用的 invokeSubflow。generation 为父 runOnce
// 捕获的 myGeneration 快照（REQ-FLOW-051 AC1），随递归链逐层传播。
function makeInvokeSubflow({ project, executors, parentExecutionId, persist, generation }) {
  return async function invokeSubflow(args) {
    return invokeSubflowImpl({ ...args, parentExecutionId, project, executors, persist, generation });
  };
}
