import { evaluate } from "./setVariablesExecutor.js";

/**
 * flowOutputExecutor — collects declared output variables from the current context
 * and returns them as result.outputVariables so the engine's D10 multi-output path
 * writes them (fullName + bare key) into context and nodeRecord.outputVariables.
 *
 * It reads bare keys (varDef.name) from context because upstream nodes write their
 * outputs as bare keys via the unified output model (ADR-010).
 *
 * REQ-FLOW-033 AC7: if config.expressions is provided, each output variable can be
 * mapped from an upstream variable via the same expression syntax as setVariables
 * ({{nodeId.var}}, dot paths, templates, JS expressions like {{a || b}}).
 */
export async function flowOutputExecutor({ node, context }) {
  const outputVariables = {};
  const logs = [{ level: "info", message: `flowOutput "${node.data?.label || node.name || node.id}" collecting outputs` }];

  const varDefs = node.config?.outputVariables ?? [];
  const expressions = Array.isArray(node.config?.expressions)
    ? new Map(node.config.expressions
        .filter((e) => e && typeof e.name === "string" && e.name !== "")
        .map((e) => [e.name, e.expression]))
    : new Map();

  if (Array.isArray(varDefs)) {
    for (const varDef of varDefs) {
      if (!varDef || typeof varDef.name !== "string" || varDef.name === "") continue;
      const expression = expressions.get(varDef.name);
      outputVariables[varDef.name] = expression !== undefined
        ? evaluate(expression, context)
        : context[varDef.name];
    }
  }

  return {
    status: "success",
    outputVariables,
    logs
  };
}
