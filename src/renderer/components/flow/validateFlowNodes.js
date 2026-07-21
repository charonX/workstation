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
const VALIDATED_NODE_TYPES = ["trigger", "condition", "agent", "feishumessage"];
const FEISHU_MESSAGE_REQUIRED_OUTPUTS = ["url", "sender", "messageId"];

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
      const path = `${base}.outputVariables`;
      if (!Array.isArray(config.outputVariables)) {
        errors.push(`${path}: ${t("flowEditor.outputVariablesRequired")}`);
      } else {
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
    }

    if (type === "trigger" && Array.isArray(config.outputVariables)) {
      const seen = new Set();
      config.outputVariables.forEach((variable, variableIndex) => {
        const name = typeof variable?.name === "string" ? variable.name : "";
        if (name.trim().length === 0) {
          errors.push(
            `${base}.outputVariables[${variableIndex}].name: ${t("flowEditor.variableNameRequired")}`
          );
        } else if (seen.has(name)) {
          errors.push(
            `${base}.outputVariables[${variableIndex}].name: ${t("flowEditor.duplicateVariableName", { name })}`
          );
        } else {
          seen.add(name);
        }
        if (!VARIABLE_TYPES.includes(variable?.type)) {
          errors.push(
            `${base}.outputVariables[${variableIndex}].type: ${t("flowEditor.invalidVariableType", { type: variable?.type })}`
          );
        }
      });
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
