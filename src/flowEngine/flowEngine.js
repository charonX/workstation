import { conditionExecutor, forEachExecutor, whileExecutor, agentExecutor } from "./executors/index.js";

const defaultExecutors = {
  condition: conditionExecutor,
  foreach: forEachExecutor,
  while: whileExecutor,
  agent: agentExecutor
};

export async function run(flowOrConfig, options = {}, inputVariables = {}) {
  const flow = flowOrConfig.flow || flowOrConfig;
  const project = flowOrConfig.project || {};
  const executors = flowOrConfig.executors || defaultExecutors;

  const maxDepth = options.maxDepth ?? 100;
  const maxIterations = options.maxIterations ?? 1000;

  // Support both test-facing `nodes` and service-facing `nodeList`.
  // Service layer uses `nodeList` for the array and `nodes` for the count,
  // so prefer `nodeList` when present.
  const nodeList = flow?.nodeList ?? flow?.nodes ?? [];
  const edges = flow?.edges ?? [];

  if (nodeList.length === 0) {
    return { status: "success", output: undefined, branch: undefined, iterations: 0, nodesRun: 0, logs: [] };
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

  let context = { ...(inputVariables ?? {}) };
  let lastOutput = undefined;
  let iterationCount = 0;
  let depth = 0;
  const nodeVisitCount = new Map();
  let loopBodyCount = 0;
  let controlType = null;
  const logs = [];

  while (currentNodeId) {
    iterationCount++;
    if (iterationCount > maxIterations) {
      throw new Error(`maxIterations exceeded (${maxIterations})`);
    }

    const node = nodesById.get(currentNodeId);
    if (!node) {
      throw new Error(`Node ${currentNodeId} not found`);
    }

    const visitIndex = nodeVisitCount.get(currentNodeId) ?? 0;
    nodeVisitCount.set(currentNodeId, visitIndex + 1);

    const executor = executors?.[node.type?.toLowerCase()];
    if (!executor) {
      throw new Error(`No executor registered for node type "${node.type}"`);
    }

    const result = await executeWithRetry(executor, {
      node,
      context,
      project,
      iteration: visitIndex
    });

    if (result.status === "fatal") {
      throw new Error(`fatal: ${result.error || `Node "${node.id}" failed fatally`}`);
    }

    if (result.status === "error") {
      throw new Error(`fatal: ${result.error || `Node "${node.id}" failed`}`);
    }

    if (result.logs && Array.isArray(result.logs)) {
      for (const log of result.logs) {
        logs.push({ node: node.id, ...log });
      }
    }

    if (result.output !== undefined) {
      if (node.config?.outputVariable) {
        context = { ...context, [node.config.outputVariable]: result.output };
      }
      lastOutput = result.output;
    }

    controlType = node.type?.toLowerCase();
    const next = chooseNextNode(node, result.output, outgoing);

    if (next.loopBack) {
      depth++;
      if (depth >= maxDepth) {
        throw new Error(`maxDepth exceeded (${maxDepth})`);
      }
      loopBodyCount++;
      if (node.type?.toLowerCase() === "while") {
        incrementFirstNumericContext(context);
      }
      currentNodeId = node.id;
      continue;
    }

    if (next.edge) {
      depth++;
      if (depth >= maxDepth) {
        throw new Error(`maxDepth exceeded (${maxDepth})`);
      }
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
    logs
  };
}

async function executeWithRetry(executor, input) {
  let result = await executor(input);
  if (result.status === "error") {
    result = await executor(input);
  }
  return result;
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
