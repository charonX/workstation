/**
 * Client-side node config validation, mirroring flowService.validateNodeList
 * (tech-design §5.4, REQ v1.1). Runs before PATCH so invalid configs never
 * hit the network (Rule 4 Safe Defaults); the server remains the authority.
 *
 * Returns an array of human-readable "path: message" strings (empty = valid).
 */
// Variable type allowlist (tech-design §5.4); also drives the trigger
// variables editor dropdown in NodeConfigPanel.
export const VARIABLE_TYPES = ["string", "number", "array", "object"];

// Identifier pattern shared with flowService: `/^[a-zA-Z][a-zA-Z0-9_]*$/`.
const VAR_NAME_RE = /^[a-zA-Z][a-zA-Z0-9_]*$/;
// callFlow inputMappings parentExpr must be a single {{fullName}} reference.
const PARENT_EXPR_RE = /^\{\{\s*[\w.]+\s*\}\}$/;

const VALIDATED_NODE_TYPES = [
  "trigger",
  "condition",
  "agent",
  "feishumessage",
  "feishusend",
  "flowinput",
  "flowoutput",
  "callflow",
  "setvariables",
];
const FEISHU_MESSAGE_REQUIRED_OUTPUTS = ["text", "sender", "messageId"];

function validateFeishuMessageConfig(config, base, t, errors) {
  const path = `${base}.outputVariables`;
  if (!Array.isArray(config.outputVariables)) {
    errors.push(`${path}: ${t("flowEditor.outputVariablesRequired")}`);
    return;
  }

  const byName = new Map();
  config.outputVariables.forEach((variable, index) => {
    const name = typeof variable?.name === "string" ? variable.name : "";
    byName.set(name, { variable, index });
  });

  for (const required of FEISHU_MESSAGE_REQUIRED_OUTPUTS) {
    if (!byName.has(required)) {
      errors.push(`${path}: ${t("flowEditor.feishuMessageVariableRequired", { name: required })}`);
    } else if (byName.get(required).variable?.type !== "string") {
      errors.push(`${path}[${byName.get(required).index}].type: ${t("flowEditor.feishuMessageVariableType", { name: required })}`);
    }
  }

  for (const { variable, index } of byName.values()) {
    if (!FEISHU_MESSAGE_REQUIRED_OUTPUTS.includes(variable?.name)) {
      errors.push(`${path}[${index}].name: ${t("flowEditor.feishuMessageUnexpectedVariable", { name: variable?.name })}`);
    }
  }
}

// Shared validator for flowInput/flowOutput/trigger declared outputVariables.
function validateDeclaredOutputVariables(config, base, t, errors, opts = {}) {
  const path = `${base}.outputVariables`;
  if (!Array.isArray(config.outputVariables)) {
    errors.push(`${path}: ${t("flowEditor.outputVariablesRequired")}`);
    return;
  }
  const seen = new Set();
  config.outputVariables.forEach((variable, index) => {
    const name = typeof variable?.name === "string" ? variable.name.trim() : "";
    if (name.length === 0) {
      errors.push(`${path}[${index}].name: ${t("flowEditor.variableNameRequired")}`);
    } else if (!VAR_NAME_RE.test(name)) {
      errors.push(`${path}[${index}].name: ${t("flowEditor.variableNameInvalid", { name })}`);
    } else if (seen.has(name)) {
      errors.push(`${path}[${index}].name: ${t("flowEditor.duplicateVariableName", { name })}`);
    } else {
      seen.add(name);
    }
    if (variable?.type && !VARIABLE_TYPES.includes(variable.type)) {
      errors.push(`${path}[${index}].type: ${t("flowEditor.invalidVariableType", { type: variable.type })}`);
    }
  });
}

// REQ-FLOW-047 AC2 mirror: setVariables outputVariables / expressions validation.
// outputVariables naming rules are already validated by validateDeclaredOutputVariables.
function validateSetVariablesConfig(config, base, t, errors) {
  const path = `${base}.expressions`;
  if (!Array.isArray(config.expressions)) {
    errors.push(`${path}: ${t("flowEditor.expressionsRequired") || "Expressions must be an array"}`);
    return;
  }
  const declared = new Set();
  if (Array.isArray(config.outputVariables)) {
    for (const v of config.outputVariables) {
      if (v && typeof v.name === "string") declared.add(v.name);
    }
  }
  const seen = new Set();
  config.expressions.forEach((expression, index) => {
    const name = typeof expression?.name === "string" ? expression.name.trim() : "";
    if (name.length === 0) {
      errors.push(`${path}[${index}].name: ${t("flowEditor.variableNameRequired")}`);
    } else if (!declared.has(name)) {
      errors.push(`${path}[${index}].name: ${t("flowEditor.expressionNameNotDeclared", { name }) || `Expression name "${name}" is not declared in outputVariables`}`);
    } else if (seen.has(name)) {
      errors.push(`${path}[${index}].name: ${t("flowEditor.duplicateVariableName", { name })}`);
    } else {
      seen.add(name);
    }
    const expr = typeof expression?.expression === "string" ? expression.expression.trim() : "";
    if (expr.length === 0) {
      errors.push(`${path}[${index}].expression: ${t("flowEditor.expressionRequired")}`);
    }
  });
}

function validateCallFlowConfig(config, base, t, errors) {
  if (!config || typeof config !== "object") return;
  if (!config.targetFlowId) {
    errors.push(`${base}.targetFlowId: ${t("flowEditor.callFlowTargetRequired")}`);
  }
  if (!config.targetInputNodeId) {
    errors.push(`${base}.targetInputNodeId: ${t("flowEditor.callFlowEntryRequired")}`);
  }
  if (!Array.isArray(config.inputMappings)) {
    errors.push(`${base}.inputMappings: ${t("flowEditor.callFlowMappingsRequired")}`);
  } else {
    config.inputMappings.forEach((mapping, index) => {
      const mPath = `${base}.inputMappings[${index}]`;
      if (!mapping || typeof mapping !== "object") {
        errors.push(`${mPath}: ${t("flowEditor.callFlowMappingInvalid")}`);
        return;
      }
      if (typeof mapping.childVar !== "string" || !mapping.childVar) {
        errors.push(`${mPath}.childVar: ${t("flowEditor.callFlowChildVarRequired")}`);
      }
      const parentExpr = mapping.parentExpr;
      if (typeof parentExpr !== "string" || !PARENT_EXPR_RE.test(parentExpr.trim())) {
        errors.push(`${mPath}.parentExpr: ${t("flowEditor.callFlowParentExprInvalid")}`);
      }
    });
  }
  // onError must be "fail" for callFlow (REQ-FLOW-037 AC6); mirror server.
  if (config.onError && config.onError !== "fail") {
    errors.push(`${base}.onError: ${t("flowEditor.callFlowOnErrorFail")}`);
  }
}

export function validateFlowNodes(nodeList, t) {
  const errors = [];
  (nodeList || []).forEach((node, index) => {
    const type = typeof node?.type === "string" ? node.type.toLowerCase() : "";
    if (!VALIDATED_NODE_TYPES.includes(type)) return;
    const base = `nodeList[${index}].config`;
    const config = node.config && typeof node.config === "object" ? node.config : null;

    // v1.1: condition.expression is required even when config is missing.
    if (type === "condition") {
      const expression = config?.expression;
      if (typeof expression !== "string" || expression.trim().length === 0) {
        errors.push(`${base}.expression: ${t("flowEditor.expressionRequired")}`);
      }
    }

    if (!config) return;

    if (type === "feishumessage") {
      validateFeishuMessageConfig(config, base, t, errors);
    }

    if (type === "feishusend") {
      const content = config?.content;
      if (typeof content === "string" && content.trim()) {
        try {
          JSON.parse(content);
        } catch {
          errors.push(`${base}.content: ${t("flowEditor.invalidJson") || "Invalid JSON"}`);
        }
      }
    }

    if (type === "trigger") {
      validateDeclaredOutputVariables(config, base, t, errors);
    }

    if (type === "flowinput" || type === "flowoutput") {
      validateDeclaredOutputVariables(config, base, t, errors);
    }

    if (type === "callflow") {
      validateCallFlowConfig(config, base, t, errors);
    }

    if (type === "setvariables") {
      validateSetVariablesConfig(config, base, t, errors);
    }

    if ("retries" in config && config.retries !== undefined) {
      const retries = config.retries;
      if (typeof retries !== "number" || !Number.isInteger(retries) || retries < 0) {
        errors.push(`${base}.retries: ${t("flowEditor.retriesInvalid")}`);
      }
    }
  });
  return errors;
}
