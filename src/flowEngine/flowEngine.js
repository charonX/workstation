import { conditionExecutor, forEachExecutor, whileExecutor, agentExecutor, triggerExecutor } from "./executors/index.js";

const defaultExecutors = {
  condition: conditionExecutor,
  foreach: forEachExecutor,
  while: whileExecutor,
  agent: agentExecutor,
  trigger: triggerExecutor
};

// signoff 决策 3：Claude Agent prompt 使用 {{fullName}} 引用注册表变量。
const VARIABLE_REF_PATTERN = /\{\{\s*([^{}]+?)\s*\}\}/g;

export async function run(flowOrConfig, options = {}, inputVariables = {}) {
  const flow = flowOrConfig.flow || flowOrConfig;
  const project = flowOrConfig.project || {};
  // executor 解析优先级（tech-design §5.1）：options.executors > flowOrConfig.executors > 默认。
  // 按类型合并：注入单类型 mock 时，其余类型回落默认实现。
  const executors = { ...defaultExecutors, ...(flowOrConfig.executors ?? {}), ...(options.executors ?? {}) };
  const projectPath = project.localPath;

  const maxDepth = options.maxDepth ?? 100;
  const maxIterations = options.maxIterations ?? 1000;

  // Support both test-facing `nodes` and service-facing `nodeList`.
  // Service layer uses `nodeList` for the array and `nodes` for the count,
  // so prefer `nodeList` when present.
  const nodeList = flow?.nodeList ?? flow?.nodes ?? [];
  const edges = flow?.edges ?? [];

  if (nodeList.length === 0) {
    return { status: "success", output: undefined, branch: undefined, iterations: 0, nodesRun: 0, logs: [], nodeRecords: [] };
  }

  const nodesById = new Map(nodeList.map((node) => [node.id, node]));

  const outgoing = new Map();
  for (const node of nodeList) {
    outgoing.set(node.id, []);
  }
  for (const edge of edges) {
    const list = outgoing.get(edge.sourceNodeId);
    if (list) {
      list.push(edge);
    }
  }

  const incomingCount = new Map(nodeList.map((node) => [node.id, 0]));
  for (const edge of edges) {
    incomingCount.set(edge.targetNodeId, (incomingCount.get(edge.targetNodeId) ?? 0) + 1);
  }
  const startNodes = nodeList.filter((node) => incomingCount.get(node.id) === 0);
  let currentNodeId = startNodes.length > 0 ? startNodes[0].id : nodeList[0].id;

  // 变量注册表（tech-design §5.2）：单一扁平 context 为唯一事实来源，
  // fullName 键（"n1.x"）与 legacy 平铺键共存。单个可变对象贯穿整次执行——
  // executor 捕获的 context 引用必须能观察到后续节点的写入（REQ-FLOW-023）。
  // 注册表仅存在于单次执行内存中，不持久化（REQ-FLOW-023 AC5）。
  const context = {};
  seedTriggerVariables(nodeList, context);
  // inputVariables 合入：同名覆盖 Trigger defaultValue；未声明 key 原样进入（legacy 兼容）。
  Object.assign(context, inputVariables ?? {});

  let lastOutput = undefined;
  let iterationCount = 0;
  let depth = 0;
  const nodeVisitCount = new Map();
  let loopBodyCount = 0;
  let controlType = null;
  const logs = [];
  const nodeRecords = [];

  while (currentNodeId) {
    iterationCount++;
    if (iterationCount > maxIterations) {
      abortRun(nodeRecords, `maxIterations exceeded (${maxIterations})`);
    }

    const node = nodesById.get(currentNodeId);
    if (!node) {
      abortRun(nodeRecords, `Node ${currentNodeId} not found`);
    }

    const visitIndex = nodeVisitCount.get(currentNodeId) ?? 0;
    nodeVisitCount.set(currentNodeId, visitIndex + 1);

    const nodeType = node.type?.toLowerCase();
    const executor = executors?.[nodeType];
    if (!executor) {
      abortRun(nodeRecords, `No executor registered for node type "${node.type}"`);
    }

    // nodeRecord（tech-design §4.1 2e）：进入节点时的扁平 context 快照。
    const record = {
      nodeId: node.id,
      nodeName: node.name ?? node.data?.label ?? null,
      inputVariables: { ...context },
      outputVariables: {},
      branchTaken: null,
      error: null,
      attemptCount: 0
    };

    // agent 节点：引擎在调用 executor 之前完成 {{fullName}} 替换（tech-design §2.3），
    // 传替换后的 node 副本，不修改 flow 定义。
    const effectiveNode = nodeType === "agent" ? substitutePromptVariables(node, context) : node;

    const retries = normalizeRetries(node.config?.retries);
    const onError = node.config?.onError === "ignore" ? "ignore" : "fail";

    const { result: rawResult, attemptCount } = await executeWithRetry(executor, {
      node: effectiveNode,
      context,
      project,
      projectPath,
      iteration: visitIndex
    }, retries);
    record.attemptCount = attemptCount;

    if (rawResult.status === "fatal") {
      // fatal：立即终止，不进入重试/onError 流程（REQ-FLOW-025 AC4）。
      failRun(nodeRecords, record, rawResult, rawResult.error || `Node "${node.id}" failed fatally`);
    }

    let result = rawResult;
    if (rawResult.status === "error") {
      const message = rawResult.error || `Node "${node.id}" failed`;
      if (onError !== "ignore") {
        // onError=fail（默认）：终止整个 flow（REQ-FLOW-025 AC2）。
        failRun(nodeRecords, record, rawResult, message);
      }
      // onError=ignore：视为成功，输出变量写空字符串，flow 继续（REQ-FLOW-025 AC3）。
      record.error = message;
      result = { status: "success", output: "", logs: rawResult.logs, agent: rawResult.agent };
    }

    if (result.logs && Array.isArray(result.logs)) {
      for (const log of result.logs) {
        logs.push({ node: node.id, ...log });
      }
    }

    if (result.output !== undefined) {
      if (node.config?.outputVariable) {
        const fullName = `${node.id}.${node.config.outputVariable}`;
        // REQ-FLOW-023 AC2：按 nodeId.variableName 写入；fullName 天然隔离同名变量（AC4）。
        context[fullName] = result.output;
        // legacy 平铺键：旧 flow 下游表达式按裸标识符读取，行为不变。
        context[node.config.outputVariable] = result.output;
        record.outputVariables[fullName] = result.output;
      }
      lastOutput = result.output;
    }

    if (nodeType === "condition" && (result.output === "true" || result.output === "false")) {
      record.branchTaken = result.output;
    }
    copyAgentDetail(record, result);
    nodeRecords.push(record);

    controlType = nodeType;
    const next = chooseNextNode(node, result.output, outgoing);

    if (next.loopBack) {
      depth = incrementDepthOrAbort(nodeRecords, depth, maxDepth);
      loopBodyCount++;
      if (nodeType === "while") {
        incrementFirstNumericContext(context);
      }
      currentNodeId = node.id;
      continue;
    }

    if (next.edge) {
      depth = incrementDepthOrAbort(nodeRecords, depth, maxDepth);
      currentNodeId = next.edge.targetNodeId;
    } else {
      currentNodeId = null;
    }
  }

  return {
    status: "success",
    output: lastOutput,
    branch: controlType === "condition" && typeof lastOutput === "string" ? lastOutput : undefined,
    iterations: loopBodyCount,
    nodesRun: iterationCount,
    logs,
    nodeRecords
  };
}

// REQ-FLOW-023 AC1：Trigger 节点声明的 outputVariables defaultValue 播种为初始注册表。
function seedTriggerVariables(nodeList, context) {
  for (const node of nodeList) {
    if (node.type?.toLowerCase() !== "trigger") continue;
    for (const varDef of node.config?.outputVariables ?? []) {
      if (varDef && typeof varDef.name === "string" && varDef.name !== "" && "defaultValue" in varDef) {
        context[`${node.id}.${varDef.name}`] = varDef.defaultValue;
      }
    }
  }
}

// REQ-FLOW-024：prompt 中 {{fullName}} 替换为注册表当前值；缺失 → 空字符串（AC2）。
function substitutePromptVariables(node, context) {
  const prompt = node.config?.prompt;
  if (typeof prompt !== "string" || !prompt.includes("{{")) {
    return node;
  }
  const substituted = prompt.replace(VARIABLE_REF_PATTERN, (_match, fullName) => {
    const value = context[fullName.trim()];
    return value === undefined || value === null ? "" : String(value);
  });
  return { ...node, config: { ...node.config, prompt: substituted } };
}

// REQ-FLOW-025 / tech-design §5.4：retries 默认 1，可配 0 或正整数。
function normalizeRetries(value) {
  if (Number.isInteger(value) && value >= 0) return value;
  return 1;
}

// 终止整个 flow：补齐 nodeRecord（error + agent 详情）后以 fatal: 前缀中止。
// 用于 fatal 直终（AC4）与重试耗尽后 onError=fail（AC2）两条路径。
// 已累积的 nodeRecords 挂到错误对象上，供 taskService 在终止路径持久化（REQ-FLOW-028）。
function failRun(nodeRecords, record, result, message) {
  record.error = message;
  copyAgentDetail(record, result);
  nodeRecords.push(record);
  abortRun(nodeRecords, `fatal: ${message}`);
}

// 引擎安全中止（maxIterations / 节点缺失 / 无 executor / maxDepth）：把已累积的
// nodeRecords 挂到错误对象上抛出，供 taskService 在 catch 路径持久化（REQ-FLOW-028 v1.2）。
function abortRun(nodeRecords, message) {
  const error = new Error(message);
  error.nodeRecords = nodeRecords;
  throw error;
}

// depth 递增并检查上限；超限即安全中止。loopBack 与 edge 两条推进路径共用。
function incrementDepthOrAbort(nodeRecords, depth, maxDepth) {
  const nextDepth = depth + 1;
  if (nextDepth >= maxDepth) {
    abortRun(nodeRecords, `maxDepth exceeded (${maxDepth})`);
  }
  return nextDepth;
}

function copyAgentDetail(record, result) {
  if (result.agent !== undefined) {
    record.agent = result.agent;
  }
}

// error 按 retries 重试（总尝试 = 1 + retries）；success/fatal 立即返回。
async function executeWithRetry(executor, input, retries) {
  let attemptCount = 0;
  let result;
  do {
    result = await executor(input);
    attemptCount++;
  } while (result.status === "error" && attemptCount <= retries);
  return { result, attemptCount };
}

function chooseNextNode(node, output, outgoing) {
  const outEdges = outgoing.get(node.id) ?? [];

  const isControlNode = ["condition", "foreach", "while"].includes(node.type?.toLowerCase());
  if (isControlNode && typeof output === "string") {
    const matched = outEdges.find((edge) => edge.sourcePort === output);
    if (matched) {
      return { edge: matched };
    }

    if (output === "body" && node.type?.toLowerCase() !== "condition") {
      return { loopBack: true };
    }

    return {};
  }

  const unlabeled = outEdges.find((edge) => !edge.sourcePort);
  if (unlabeled) {
    return { edge: unlabeled };
  }
  if (outEdges.length > 0) {
    return { edge: outEdges[0] };
  }
  return {};
}

function incrementFirstNumericContext(context) {
  for (const key of Object.keys(context)) {
    if (typeof context[key] === "number") {
      context[key] = context[key] + 1;
      return;
    }
  }
}
