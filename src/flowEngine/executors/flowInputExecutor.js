/**
 * flowInputExecutor — pass-through executor for flowInput (subflow entry) nodes.
 *
 * Identical behavior to triggerExecutor: the engine handles variable seeding and
 * parent-input override via the TRIGGER_LIKE path (seedTriggerVariables /
 * applyTriggerVariableOverrides), so this executor only returns success.
 */
export async function flowInputExecutor({ node }) {
  return {
    status: "success",
    logs: [{ level: "info", message: `flowInput "${node.data?.label || node.name || node.id}" started` }]
  };
}
