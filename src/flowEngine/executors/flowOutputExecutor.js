/**
 * flowOutputExecutor — collects declared output variables from the current context
 * and returns them as result.outputVariables so the engine's D10 multi-output path
 * writes them (fullName + bare key) into context and nodeRecord.outputVariables.
 *
 * It reads bare keys (varDef.name) from context because upstream nodes write their
 * result to bare keys via the single-output path (config.outputVariable).
 */
export async function flowOutputExecutor({ node, context }) {
  const outputVariables = {};
  const logs = [{ level: "info", message: `flowOutput "${node.data?.label || node.name || node.id}" collecting outputs` }];

  const varDefs = node.config?.outputVariables ?? [];
  if (Array.isArray(varDefs)) {
    for (const varDef of varDefs) {
      if (!varDef || typeof varDef.name !== "string" || varDef.name === "") continue;
      outputVariables[varDef.name] = context[varDef.name];
    }
  }

  return {
    status: "success",
    outputVariables,
    logs
  };
}
