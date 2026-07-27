import { getDb, resetDb } from "../db.js";
import crypto from "node:crypto";

function timestamp() {
  return new Date().toISOString();
}

// --- Node config validation (tech-design §5.4 final schema) ---
// Only fields that are present are validated: nodes without config, or configs
// missing a field, pass through untouched (legacy flow compatibility).
// Sole exception (v1.1): condition.expression is required — a condition node
// whose expression is missing, empty, or whitespace-only is rejected.
const VARIABLE_TYPES = ["string", "number", "array", "object"];
const AGENT_PROVIDERS = ["anthropic"];
const AGENT_OPTION_KEYS = ["systemPrompt", "maxTurns"];
const ON_ERROR_VALUES = ["fail", "ignore"];
const CALLFLOW_ON_ERROR_VALUES = ["fail"];
const VALIDATED_NODE_TYPES = ["trigger", "condition", "agent", "feishumessage", "feishusend", "flowinput", "flowoutput", "callflow", "setvariables"];
const VARIABLE_NAME_PATTERN = /^[a-zA-Z][a-zA-Z0-9_]*$/;
const FEISHU_MESSAGE_REQUIRED_OUTPUTS = ["text", "sender", "messageId"];
// REQ-FLOW-034 AC3: parentExpr must be a single {{var}} reference.
const PARENT_EXPR_PATTERN = /^\{\{\s*([a-zA-Z_][\w.]*)\s*\}\}$/;

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateCommonConfig(config, base, details) {
  if ("retries" in config && config.retries !== undefined) {
    const retries = config.retries;
    if (typeof retries !== "number" || !Number.isInteger(retries) || retries < 0) {
      details.push({ path: `${base}.retries`, message: "Retries must be a non-negative integer" });
    }
  }
  if ("onError" in config && config.onError !== undefined) {
    if (!ON_ERROR_VALUES.includes(config.onError)) {
      details.push({ path: `${base}.onError`, message: `Invalid onError: ${config.onError}. Must be one of: fail, ignore` });
    }
  }
}

function validateTriggerConfig(config, base, details) {
  if (!("outputVariables" in config) || config.outputVariables === undefined) return;
  const variables = config.outputVariables;
  const path = `${base}.outputVariables`;
  if (!Array.isArray(variables)) {
    details.push({ path, message: "Output variables must be an array" });
    return;
  }
  const seen = new Set();
  variables.forEach((variable, index) => {
    const item = isPlainObject(variable) ? variable : {};
    if (typeof item.name !== "string" || item.name.trim().length === 0) {
      details.push({ path: `${path}[${index}].name`, message: "Variable name is required" });
    } else if (seen.has(item.name)) {
      details.push({ path: `${path}[${index}].name`, message: `Duplicate variable name: ${item.name}` });
    } else {
      seen.add(item.name);
    }
    // type is optional (reserved field, not validated in v1); only reject explicit invalid values.
    if (item.type !== undefined && !VARIABLE_TYPES.includes(item.type)) {
      details.push({ path: `${path}[${index}].type`, message: `Invalid type: ${item.type}. Must be one of: string, number, array, object` });
    }
  });
}

function validateFeishuMessageConfig(config, base, details) {
  const path = `${base}.outputVariables`;
  if (!("outputVariables" in config) || config.outputVariables === undefined) {
    details.push({ path, message: "Output variables are required" });
    return;
  }
  const variables = config.outputVariables;
  if (!Array.isArray(variables)) {
    details.push({ path, message: "Output variables must be an array" });
    return;
  }

  const byName = new Map();
  variables.forEach((variable, index) => {
    const item = isPlainObject(variable) ? variable : {};
    byName.set(item.name, { item, index });
  });

  for (const required of FEISHU_MESSAGE_REQUIRED_OUTPUTS) {
    if (!byName.has(required)) {
      details.push({ path, message: `Missing required feishuMessage output variable: ${required}` });
      continue;
    }
    const { item, index } = byName.get(required);
    if (item.type !== "string") {
      details.push({ path: `${path}[${index}].type`, message: `Invalid type: ${item.type}. feishuMessage variable "${required}" must be string` });
    }
  }

  for (const { item, index } of byName.values()) {
    if (!FEISHU_MESSAGE_REQUIRED_OUTPUTS.includes(item.name)) {
      details.push({ path: `${path}[${index}].name`, message: `Unexpected feishuMessage output variable: ${item.name}` });
    }
  }
}

function validateFeishuSendConfig(config, base, details) {
  // REQ-FLOW-032: content is optional (skipped when empty) but if present and
  // a non-empty string, it must parse as JSON. msgType defaults to "text".
  if (typeof config.content === "string" && config.content.trim()) {
    try {
      JSON.parse(config.content);
    } catch {
      details.push({ path: `${base}.content`, message: "Content must be valid JSON" });
    }
  }
}

// REQ-FLOW-032 / REQ-FLOW-033: flowInput and flowOutput share the same
// outputVariables schema (array of { name, type?, defaultValue? }). The name
// must be a non-empty identifier matching /^[a-zA-Z][a-zA-Z0-9_]*$/ and unique
// within the node. `type` is a reserved field, allowed but not validated in v1.
// `defaultValue` is optional and not validated.
function validateDeclaredOutputVariables(config, base, details) {
  if (!("outputVariables" in config) || config.outputVariables === undefined) return;
  const variables = config.outputVariables;
  const path = `${base}.outputVariables`;
  if (!Array.isArray(variables)) {
    details.push({ path, message: "Output variables must be an array" });
    return;
  }
  const seen = new Set();
  variables.forEach((variable, index) => {
    const item = isPlainObject(variable) ? variable : {};
    if (typeof item.name !== "string" || item.name.trim().length === 0) {
      details.push({ path: `${path}[${index}].name`, message: "Variable name is required" });
      return;
    }
    if (!VARIABLE_NAME_PATTERN.test(item.name)) {
      details.push({ path: `${path}[${index}].name`, message: `Variable name "${item.name}" must match pattern /^[a-zA-Z][a-zA-Z0-9_]*$/` });
      return;
    }
    if (seen.has(item.name)) {
      details.push({ path: `${path}[${index}].name`, message: `duplicate variable name: ${item.name}` });
      return;
    }
    seen.add(item.name);
  });
}

function validateConditionConfig(config, base, details) {
  // Expression is required (v1.1 exception to the "only present fields" rule):
  // missing, empty, or whitespace-only (after trim) are all rejected.
  // Non-empty check only; no syntax validation (REQ-FLOW-019).
  if (typeof config.expression !== "string" || config.expression.trim().length === 0) {
    details.push({ path: `${base}.expression`, message: "Expression is required" });
  }
}

// REQ-FLOW-034: callFlow 节点字段校验
// - targetFlowId / targetInputNodeId 必填非空字符串
// - inputMappings: 数组；每项 childVar（合法标识符）+ parentExpr（单 {{var}} 引用）
// - onError: 仅允许 "fail"（REQ-FLOW-037 AC6：callFlow 不支持 ignore）
// - outputMappings: 可选；若存在需为数组且每项含 childVar/parentKey（非空字符串）
function validateCallFlowConfig(config, base, details, nodeId) {
  const pushField = (path, message, code) => {
    details.push({ path: `${base}.${path}`, message, code, nodeId });
  };

  // targetFlowId
  if (typeof config.targetFlowId !== "string" || config.targetFlowId.trim() === "") {
    pushField("targetFlowId", "targetFlowId is required", "E-CALLFLOW-TARGET");
  }
  // targetInputNodeId
  if (typeof config.targetInputNodeId !== "string" || config.targetInputNodeId.trim() === "") {
    pushField("targetInputNodeId", "targetInputNodeId is required", "E-CALLFLOW-INPUT");
  }
  // inputMappings
  if ("inputMappings" in config && config.inputMappings !== undefined) {
    if (!Array.isArray(config.inputMappings)) {
      pushField("inputMappings", "inputMappings must be an array", "E-CALLFLOW-MAP");
    } else {
      config.inputMappings.forEach((mapping, index) => {
        const item = isPlainObject(mapping) ? mapping : {};
        const p = `${base}.inputMappings[${index}]`;
        if (typeof item.childVar !== "string" || item.childVar.trim() === "") {
          details.push({ path: `${p}.childVar`, message: "childVar is required and must be a non-empty string", code: "E-CALLFLOW-MAP", nodeId });
        } else if (!VARIABLE_NAME_PATTERN.test(item.childVar)) {
          details.push({ path: `${p}.childVar`, message: `childVar "${item.childVar}" is not a valid identifier`, code: "E-CALLFLOW-MAP", nodeId });
        }
        if (typeof item.parentExpr !== "string") {
          details.push({ path: `${p}.parentExpr`, message: "parentExpr must be a string", code: "E-CALLFLOW-MAP", nodeId });
        } else if (!PARENT_EXPR_PATTERN.test(item.parentExpr)) {
          details.push({ path: `${p}.parentExpr`, message: `parentExpr "${item.parentExpr}" must be a single {{var}} reference`, code: "E-CALLFLOW-MAP", nodeId });
        }
      });
    }
  }
  // onError override: callFlow only supports "fail"
  if ("onError" in config && config.onError !== undefined) {
    if (!CALLFLOW_ON_ERROR_VALUES.includes(config.onError)) {
      pushField("onError", `Invalid onError: ${config.onError}. callFlow only supports "fail"`, "E-CALLFLOW-ON-ERROR");
    }
  }
  // outputMappings (optional)
  if ("outputMappings" in config && config.outputMappings !== undefined) {
    if (!Array.isArray(config.outputMappings)) {
      pushField("outputMappings", "outputMappings must be an array", "E-CALLFLOW-OUT");
    } else {
      config.outputMappings.forEach((mapping, index) => {
        const item = isPlainObject(mapping) ? mapping : {};
        const p = `${base}.outputMappings[${index}]`;
        if (typeof item.childVar !== "string" || item.childVar.trim() === "") {
          details.push({ path: `${p}.childVar`, message: "childVar is required", code: "E-CALLFLOW-OUT", nodeId });
        }
        if (typeof item.parentKey !== "string" || item.parentKey.trim() === "") {
          details.push({ path: `${p}.parentKey`, message: "parentKey is required", code: "E-CALLFLOW-OUT", nodeId });
        }
      });
    }
  }
}

// REQ-FLOW-047 AC2: setVariables outputVariables / expressions 校验
// - outputVariables  naming rules are validated by validateDeclaredOutputVariables (ADR-010).
// - expressions 必须是数组
// - 每项 name 必须在同节点 outputVariables 中声明
// - 每项 expression 非空字符串（trim 后非空）
function validateSetVariablesConfig(config, base, details) {
  if (!("expressions" in config) || config.expressions === undefined) return;
  const expressions = config.expressions;
  const path = `${base}.expressions`;
  if (!Array.isArray(expressions)) {
    details.push({ path, message: "Expressions must be an array" });
    return;
  }
  const declared = new Set();
  if (Array.isArray(config.outputVariables)) {
    for (const v of config.outputVariables) {
      if (v && typeof v.name === "string") declared.add(v.name);
    }
  }
  const seen = new Set();
  expressions.forEach((expression, index) => {
    const item = isPlainObject(expression) ? expression : {};
    const name = typeof item.name === "string" ? item.name.trim() : "";
    if (name.length === 0) {
      details.push({ path: `${path}[${index}].name`, message: "Expression name is required" });
    } else if (!declared.has(name)) {
      details.push({ path: `${path}[${index}].name`, message: `Expression name "${name}" is not declared in outputVariables` });
    } else if (seen.has(name)) {
      details.push({ path: `${path}[${index}].name`, message: `Duplicate expression name: ${name}` });
    } else {
      seen.add(name);
    }
    const expr = typeof item.expression === "string" ? item.expression.trim() : "";
    if (expr.length === 0) {
      details.push({ path: `${path}[${index}].expression`, message: "Expression is required" });
    }
  });
}

function validateAgentConfig(config, base, details) {
  if ("provider" in config && config.provider !== undefined) {
    if (!AGENT_PROVIDERS.includes(config.provider)) {
      details.push({ path: `${base}.provider`, message: `Invalid provider: ${config.provider}. Must be one of: anthropic` });
    }
  }
  if ("options" in config && config.options !== undefined) {
    const options = config.options;
    if (!isPlainObject(options)) {
      details.push({ path: `${base}.options`, message: "Options must be an object" });
    } else {
      for (const key of Object.keys(options)) {
        if (!AGENT_OPTION_KEYS.includes(key)) {
          details.push({ path: `${base}.options.${key}`, message: `Unknown option: ${key}. Must be one of: systemPrompt, maxTurns` });
        }
      }
    }
  }
}

export function validateNodeList(nodeList) {
  if (!Array.isArray(nodeList)) return;
  const details = [];
  nodeList.forEach((node, index) => {
    if (!isPlainObject(node)) return;
    const type = typeof node.type === "string" ? node.type.toLowerCase() : "";
    if (!VALIDATED_NODE_TYPES.includes(type)) return;
    const base = `nodeList[${index}].config`;
    if (!isPlainObject(node.config)) {
      // v1.1 exception: condition.expression is required, so a condition node
      // without a config object is missing its expression and must be rejected.
      if (type === "condition") {
        details.push({ path: `${base}.expression`, message: "Expression is required" });
      }
      return;
    }
    validateCommonConfig(node.config, base, details);
    // ADR-010: all node types share the same outputVariables naming rules.
    validateDeclaredOutputVariables(node.config, base, details);
    if (type === "trigger") validateTriggerConfig(node.config, base, details);
    else if (type === "feishumessage") validateFeishuMessageConfig(node.config, base, details);
    else if (type === "feishusend") validateFeishuSendConfig(node.config, base, details);
    else if (type === "condition") validateConditionConfig(node.config, base, details);
    else if (type === "agent") validateAgentConfig(node.config, base, details);
    else if (type === "callflow") validateCallFlowConfig(node.config, base, details, node.id);
    else if (type === "setvariables") validateSetVariablesConfig(node.config, base, details);
  });
  if (details.length > 0) {
    const err = new Error(
      "Validation failed: " + details.map((d) => `${d.path}: ${d.message}`).join("; ")
    );
    err.details = details;
    throw err;
  }
}

// REQ-FLOW-034 AC4: auto-fill callFlow.config.outputVariables with the union of
// all flowOutput node outputVariables in the target child flow.
function collectFlowOutputVariables(nodeList) {
  const byName = new Map();
  for (const node of Array.isArray(nodeList) ? nodeList : []) {
    if (String(node?.type || "").toLowerCase() !== "flowoutput") continue;
    for (const v of Array.isArray(node.config?.outputVariables) ? node.config.outputVariables : []) {
      if (v && typeof v.name === "string" && v.name) {
        if (!byName.has(v.name)) {
          byName.set(v.name, v.type || "string");
        }
      }
    }
  }
  return Array.from(byName.entries()).map(([name, type]) => ({ name, type }));
}

export function fillCallFlowOutputVariables(rootFlowId, nodeList, projectId) {
  for (const node of Array.isArray(nodeList) ? nodeList : []) {
    if (!isPlainObject(node)) continue;
    if (String(node.type || "").toLowerCase() !== "callflow") continue;
    const cfg = node.config || {};
    const targetFlowId = cfg.targetFlowId;
    if (typeof targetFlowId !== "string" || targetFlowId.trim() === "") continue;

    let childNodeList;
    if (targetFlowId === rootFlowId) {
      childNodeList = nodeList;
    } else {
      const childFlow = getFlow(targetFlowId);
      if (!childFlow || childFlow.projectId !== projectId) continue;
      childNodeList = childFlow.nodeList || [];
    }
    cfg.outputVariables = collectFlowOutputVariables(childNodeList);
  }
}

// REQ-FLOW-038 / REQ-FLOW-034 AC5: save-time cross-flow validation.
// For each callFlow node in the flow being saved:
//   1. Target flow exists, not soft-deleted, same project
//   2. Target flow has at least one flowInput node
//   3. targetInputNodeId exists and is a flowInput in the target flow
//   4. Every outputVariable declared by the entry flowInput node must be covered by
//      inputMappings OR have a defaultValue; each mapping's childVar must be declared
//   5. DFS from the current flow along callFlow.targetFlowId:
//      - cycle => E-FLOW-CIRCULAR (with readable chain)
//      - depth > 8 => E-FLOW-MAX-DEPTH
//
// `rootNodeList` is the incoming (to-be-saved) nodeList of the current flow; child
// flows are loaded from DB via getFlow.
export function validateSubflowCalls(rootFlowId, rootNodeList, projectId) {
  const details = [];

  const loadNodes = (flowId) => {
    if (flowId === rootFlowId) return Array.isArray(rootNodeList) ? rootNodeList : [];
    const f = getFlow(flowId);
    if (!f) return null;
    return f.nodeList || [];
  };

  const callFlowNodes = (Array.isArray(rootNodeList) ? rootNodeList : [])
    .filter((n) => isPlainObject(n) && n.type?.toLowerCase() === "callflow");

  for (const node of callFlowNodes) {
    const cfg = node.config || {};
    const targetFlowId = cfg.targetFlowId;
    const targetInputNodeId = cfg.targetInputNodeId;

    // 1. Target existence / project match / not deleted
    let childNodes;
    if (typeof targetFlowId !== "string" || targetFlowId.trim() === "") {
      // Missing targetFlowId already reported by validateCallFlowConfig; skip cross-check.
      continue;
    }
    const childFlow = getFlow(targetFlowId);
    if (!childFlow) {
      details.push({ code: "E-FLOW-REF-MISSING", message: `Target flow "${targetFlowId}" not found`, nodeId: node.id });
      continue;
    }
    if (childFlow.projectId !== projectId) {
      details.push({ code: "E-FLOW-REF-MISSING", message: `Target flow "${targetFlowId}" belongs to a different project`, nodeId: node.id });
      continue;
    }
    childNodes = childFlow.nodeList || [];

    // 2. Child must expose at least one flowInput entry (REQ-FLOW-034 / PRD #6).
    //    Saving a callFlow that references a flow with no callable entry fails with
    //    E-FLOW-NO-INPUT instead of being accepted as incremental building.
    const childFlowInputs = childNodes.filter((n) => n.type?.toLowerCase() === "flowinput");
    if (childFlowInputs.length === 0) {
      details.push({
        code: "E-FLOW-NO-INPUT",
        message: `flow "${childFlow.name || targetFlowId}" 未声明可被调用的入口（缺少 flowInput 节点）`,
        nodeId: node.id
      });
      continue;
    }

    // 3. targetInputNodeId must exist and be a flowInput (only enforced once the
    //    child has at least one flowInput; if targetInputNodeId is empty the field
    //    validator already reports it).
    if (typeof targetInputNodeId !== "string" || targetInputNodeId.trim() === "") {
      continue;
    }
    const entryNode = childNodes.find((n) => n.id === targetInputNodeId);
    if (!entryNode || entryNode.type?.toLowerCase() !== "flowinput") {
      details.push({ code: "E-CALLFLOW-INPUT", message: `targetInputNodeId "${targetInputNodeId}" is not a flowInput node in flow "${targetFlowId}"`, nodeId: node.id });
      continue;
    }

    // 4. Mapping completeness: declared entry vars must be mapped OR have defaultValue.
    //    Also every mapping's childVar must be declared by the entry node.
    const declaredVars = entryNode.config?.outputVariables || [];
    const declaredByName = new Map();
    for (const v of declaredVars) {
      if (v && typeof v.name === "string") declaredByName.set(v.name, v);
    }
    const mappedChildVars = new Set();
    for (const mapping of Array.isArray(cfg.inputMappings) ? cfg.inputMappings : []) {
      if (mapping && typeof mapping.childVar === "string") {
        mappedChildVars.add(mapping.childVar);
        if (!declaredByName.has(mapping.childVar)) {
          details.push({ code: "E-CALLFLOW-MAP", message: `Input mapping references '${mapping.childVar}' which is not declared by entry flowInput "${entryNode.id}" of flow "${targetFlowId}"`, nodeId: node.id });
        }
      }
    }
    for (const [name, varDef] of declaredByName.entries()) {
      if (!mappedChildVars.has(name) && !("defaultValue" in varDef && varDef.defaultValue !== undefined)) {
        details.push({ code: "E-CALLFLOW-MAP-MISSING", message: `Input '${name}' of flow "${targetFlowId}" is not mapped and has no defaultValue`, nodeId: node.id });
      }
    }
  }

  // 5. DFS for circular references and depth limit (REQ-FLOW-038 AC1/AC2).
  //    Start from the root flow being saved; traverse all callFlow.targetFlowId edges.
  const MAX_DEPTH = 8;
  const visited = new Set();
  const path = [];

  function dfs(flowId, depth, triggeringNodeId) {
    if (depth > MAX_DEPTH) {
      details.push({
        code: "E-FLOW-MAX-DEPTH",
        message: `Subflow nesting depth exceeds ${MAX_DEPTH} (${depth})`,
        nodeId: triggeringNodeId
      });
      return;
    }
    if (visited.has(flowId)) {
      if (path.includes(flowId)) {
        const cycle = [...path.slice(path.indexOf(flowId)), flowId].join(" -> ");
        details.push({
          code: "E-FLOW-CIRCULAR",
          message: `Circular subflow reference detected: ${cycle}`,
          nodeId: triggeringNodeId
        });
      }
      return;
    }
    visited.add(flowId);
    path.push(flowId);
    const nodes = loadNodes(flowId);
    if (Array.isArray(nodes)) {
      for (const n of nodes) {
        if (!isPlainObject(n)) continue;
        if (n.type?.toLowerCase() !== "callflow") continue;
        const tid = n.config?.targetFlowId;
        if (typeof tid !== "string" || tid.trim() === "") continue;
        dfs(tid, depth + 1, n.id);
      }
    }
    path.pop();
  }

  dfs(rootFlowId, 0, null);

  if (details.length > 0) {
    const err = new Error("Subflow validation failed: " + details.map((d) => `${d.code || ""}: ${d.message}`).join("; "));
    err.details = details;
    throw err;
  }
}

// REQ-FLOW-041: returns flows in the same project (excluding self) that contain
// at least one flowInput node, with each flowInput's declared variables.
export function listCallFlowCandidates(flowId, projectId) {
  const flows = listFlows().filter((f) => f.projectId === projectId && f.id !== flowId);
  const result = [];
  for (const f of flows) {
    const nodes = Array.isArray(f.nodeList) ? f.nodeList : [];
    const inputNodes = nodes.filter((n) => n.type?.toLowerCase() === "flowinput");
    if (inputNodes.length === 0) continue;
    result.push({
      id: f.id,
      name: f.name,
      inputNodes: inputNodes.map((n) => ({
        id: n.id,
        name: n.name ?? n.data?.label ?? null,
        variables: (n.config?.outputVariables || []).map((v) => ({
          name: v.name,
          type: v.type,
          defaultValue: v.defaultValue
        }))
      }))
    });
  }
  return result;
}

export function resetFlows(seed = []) {
  resetDb();
  const db = getDb();
  const insert = db.prepare(`
    INSERT INTO flows (id, projectId, name, description, nodeList, edges, scheduleEnabled, status, publishedNodeList, publishedEdges, publishedAt, updatedAt, deletedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const flow of seed) {
    insert.run(
      flow.id ?? nextFlowId(),
      flow.projectId ?? null,
      flow.name ?? null,
      flow.description ?? null,
      JSON.stringify(flow.nodeList || []),
      JSON.stringify(flow.edges || []),
      flow.scheduleEnabled ? 1 : 0,
      flow.status || "draft",
      JSON.stringify(flow.publishedNodeList || flow.nodeList || []),
      JSON.stringify(flow.publishedEdges || flow.edges || []),
      flow.publishedAt ?? null,
      flow.updatedAt ?? timestamp(),
      flow.deletedAt ?? null
    );
  }
}

function nextFlowId() {
  return crypto.randomUUID();
}

function safeJson(value, fallback) {
  if (Array.isArray(value)) return value;
  if (typeof value === "object" && value !== null) return value;
  try {
    return JSON.parse(value || JSON.stringify(fallback));
  } catch {
    return fallback;
  }
}

function toFlowView(row) {
  const nodeList = safeJson(row.nodeList, []);
  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    description: row.description,
    nodes: nodeList.length,
    nodeList,
    edges: safeJson(row.edges, []),
    scheduleEnabled: Boolean(row.scheduleEnabled),
    status: row.status || "draft",
    publishedAt: row.publishedAt || null,
    publishedNodeList: safeJson(row.publishedNodeList, []),
    publishedEdges: safeJson(row.publishedEdges, []),
    updatedAt: row.updatedAt
  };
}

export function createFlow({ name, projectId, description, nodes, nodeList, edges }) {
  if (!name) throw new Error("Flow name is required");
  if (!projectId) throw new Error("Project is required");
  const effectiveNodeList = nodeList || nodes || [];
  validateNodeList(effectiveNodeList);
  const flowId = nextFlowId();
  // Cross-flow validation: DFS needs the root id, but the flow row is not in DB yet.
  // validateSubflowCalls loads the root's nodeList from the in-memory argument.
  fillCallFlowOutputVariables(flowId, effectiveNodeList, projectId);
  validateSubflowCalls(flowId, effectiveNodeList, projectId);
  const flow = {
    id: flowId,
    projectId,
    name,
    description,
    nodeList: effectiveNodeList,
    edges: edges || [],
    scheduleEnabled: false,
    status: "draft",
    publishedNodeList: [],
    publishedEdges: [],
    publishedAt: null,
    updatedAt: timestamp(),
    deletedAt: null
  };
  const db = getDb();
  db.prepare(`
    INSERT INTO flows (id, projectId, name, description, nodeList, edges, scheduleEnabled, status, publishedNodeList, publishedEdges, publishedAt, updatedAt, deletedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    flow.id,
    flow.projectId,
    flow.name,
    flow.description ?? null,
    JSON.stringify(flow.nodeList),
    JSON.stringify(flow.edges),
    flow.scheduleEnabled ? 1 : 0,
    flow.status,
    JSON.stringify(flow.publishedNodeList),
    JSON.stringify(flow.publishedEdges),
    flow.publishedAt,
    flow.updatedAt,
    flow.deletedAt
  );
  return toFlowView(flow);
}

export function importFlow(data) {
  if (!data.name) throw new Error("Flow name is required");
  if (!data.projectId) throw new Error("Project is required");
  const nodeList = data.nodes || data.nodeList || [];
  validateNodeList(nodeList);
  const edges = data.edges || [];
  const status = data.status || "draft";
  const publishedNodeList = data.publishedNodeList || (status === "published" ? nodeList : []);
  const publishedEdges = data.publishedEdges || (status === "published" ? edges : []);
  const publishedAt = data.publishedAt || (status === "published" ? timestamp() : null);
  const flowId = data.id || nextFlowId();
  fillCallFlowOutputVariables(flowId, nodeList, data.projectId);
  validateSubflowCalls(flowId, nodeList, data.projectId);
  const flow = {
    id: flowId,
    projectId: data.projectId,
    name: data.name,
    description: data.description ?? null,
    nodeList,
    edges,
    scheduleEnabled: data.scheduleEnabled ?? false,
    status,
    publishedNodeList,
    publishedEdges,
    publishedAt,
    updatedAt: data.updatedAt || timestamp(),
    deletedAt: data.deletedAt ?? null
  };
  const db = getDb();
  db.prepare(`
    INSERT INTO flows (id, projectId, name, description, nodeList, edges, scheduleEnabled, status, publishedNodeList, publishedEdges, publishedAt, updatedAt, deletedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      projectId=excluded.projectId,
      name=excluded.name,
      description=excluded.description,
      nodeList=excluded.nodeList,
      edges=excluded.edges,
      scheduleEnabled=excluded.scheduleEnabled,
      status=excluded.status,
      publishedNodeList=excluded.publishedNodeList,
      publishedEdges=excluded.publishedEdges,
      publishedAt=excluded.publishedAt,
      updatedAt=excluded.updatedAt,
      deletedAt=excluded.deletedAt
  `).run(
    flow.id,
    flow.projectId,
    flow.name,
    flow.description,
    JSON.stringify(flow.nodeList),
    JSON.stringify(flow.edges),
    flow.scheduleEnabled ? 1 : 0,
    flow.status,
    JSON.stringify(flow.publishedNodeList),
    JSON.stringify(flow.publishedEdges),
    flow.publishedAt,
    flow.updatedAt,
    flow.deletedAt
  );
  return toFlowView(flow);
}

export function exportFlow(id) {
  const db = getDb();
  const row = db.prepare("SELECT * FROM flows WHERE id = ? AND deletedAt IS NULL").get(id);
  if (!row) return undefined;
  const nodeList = safeJson(row.nodeList, []);
  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    description: row.description,
    nodes: nodeList,
    edges: safeJson(row.edges, []),
    scheduleEnabled: Boolean(row.scheduleEnabled),
    updatedAt: row.updatedAt
  };
}

export function listFlows() {
  const db = getDb();
  return db.prepare("SELECT * FROM flows WHERE deletedAt IS NULL").all().map(toFlowView);
}

export function getFlow(id) {
  const db = getDb();
  const row = db.prepare("SELECT * FROM flows WHERE id = ? AND deletedAt IS NULL").get(id);
  return row ? toFlowView(row) : undefined;
}

export function deleteFlow(id) {
  const db = getDb();
  const row = db.prepare("SELECT * FROM flows WHERE id = ? AND deletedAt IS NULL").get(id);
  if (!row) return false;
  db.prepare("UPDATE flows SET deletedAt = ? WHERE id = ?").run(timestamp(), id);
  return true;
}

export function addNode(flowId, node) {
  const db = getDb();
  const row = db.prepare("SELECT * FROM flows WHERE id = ? AND deletedAt IS NULL").get(flowId);
  if (!row) return undefined;
  const nodeList = safeJson(row.nodeList, []);
  const newNode = { id: `n${nodeList.length + 1}`, ...node };
  nodeList.push(newNode);
  db.prepare(`
    UPDATE flows SET nodeList = ?, updatedAt = ? WHERE id = ?
  `).run(JSON.stringify(nodeList), timestamp(), flowId);
  return { ...newNode };
}

export function connectNodes(flowId, sourceNodeId, targetNodeId) {
  const db = getDb();
  const row = db.prepare("SELECT * FROM flows WHERE id = ? AND deletedAt IS NULL").get(flowId);
  if (!row) return undefined;
  const edges = safeJson(row.edges, []);
  const edge = { id: `e${edges.length + 1}`, sourceNodeId, targetNodeId };
  edges.push(edge);
  db.prepare(`
    UPDATE flows SET edges = ?, updatedAt = ? WHERE id = ?
  `).run(JSON.stringify(edges), timestamp(), flowId);
  return { ...edge };
}

export function updateFlow(flowId, patch) {
  const db = getDb();
  const row = db.prepare("SELECT * FROM flows WHERE id = ? AND deletedAt IS NULL").get(flowId);
  if (!row) return undefined;

  const currentNodeList = safeJson(row.nodeList, []);
  const currentEdges = safeJson(row.edges, []);
  const nodeList = patch.nodeList !== undefined ? patch.nodeList : currentNodeList;
  const edges = patch.edges !== undefined ? patch.edges : currentEdges;
  if (patch.nodeList !== undefined) {
    validateNodeList(nodeList);
    // Cross-flow validation runs against the to-be-saved nodeList.
    fillCallFlowOutputVariables(flowId, nodeList, row.projectId);
    validateSubflowCalls(flowId, nodeList, row.projectId);
  }
  const name = patch.name !== undefined ? patch.name : row.name;
  const description = patch.description !== undefined ? patch.description : row.description;

  let status = row.status || "draft";
  let publishedNodeList = safeJson(row.publishedNodeList, []);
  let publishedEdges = safeJson(row.publishedEdges, []);
  let publishedAt = row.publishedAt || null;

  const nodeListChanged = JSON.stringify(nodeList) !== JSON.stringify(currentNodeList);
  const edgesChanged = JSON.stringify(edges) !== JSON.stringify(currentEdges);

  if (patch.status === "published") {
    status = "published";
    publishedNodeList = nodeList;
    publishedEdges = edges;
    publishedAt = timestamp();
  } else if (patch.status === "draft") {
    status = "draft";
  } else if (status === "published" && (nodeListChanged || edgesChanged)) {
    // Editing a published flow without re-publishing reverts to draft but keeps the snapshot.
    status = "draft";
  }

  const updatedAt = timestamp();
  db.prepare(`
    UPDATE flows SET
      name = ?, description = ?, nodeList = ?, edges = ?,
      status = ?, publishedNodeList = ?, publishedEdges = ?, publishedAt = ?, updatedAt = ?
    WHERE id = ?
  `).run(
    name,
    description,
    JSON.stringify(nodeList),
    JSON.stringify(edges),
    status,
    JSON.stringify(publishedNodeList),
    JSON.stringify(publishedEdges),
    publishedAt,
    updatedAt,
    flowId
  );

  return toFlowView({
    ...row,
    name,
    description,
    nodeList,
    edges,
    status,
    publishedNodeList,
    publishedEdges,
    publishedAt,
    updatedAt
  });
}

export function getPublishedSnapshot(id) {
  const flow = getFlow(id);
  if (!flow) return undefined;
  return {
    nodeList: flow.publishedNodeList || [],
    edges: flow.publishedEdges || []
  };
}

export function getNodeCategories() {
  return ["Trigger", "Agent", "Data", "Logic", "Output"];
}

export function getEditableFields({ type }) {
  const common = ["name", "outputVariable"];
  if (type === "agent") return [...common, "model", "systemPrompt"];
  return common;
}

export function toggleRun(running) {
  return running
    ? { running: false, label: "Run" }
    : { running: true, label: "Running..." };
}

export function zoomIn(current) {
  return Math.min(1.5, Math.round((current + 0.1) * 10) / 10);
}

export function zoomOut(current) {
  return Math.max(0.5, Math.round((current - 0.1) * 10) / 10);
}

export function resetZoom() {
  return 1.0;
}
