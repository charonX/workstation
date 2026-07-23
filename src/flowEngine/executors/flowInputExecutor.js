/**
 * flowInputExecutor — pass-through executor for flowInput (subflow entry) nodes.
 *
 * Identical behavior to triggerExecutor: returns context as output so downstream
 * nodes can reference seeded/overridden variables. The actual variable seeding
 * and parent-input override is handled by the engine's TRIGGER_LIKE seeding path
 * (seedTriggerVariables / applyTriggerVariableOverrides), not by this executor.
 */
export async function flowInputExecutor({ node, context }) {
  return {
    status: "success",
    output: { ...context },
    logs: [{ level: "info", message: `flowInput "${node.data?.label || node.name || node.id}" started` }]
  };
}
