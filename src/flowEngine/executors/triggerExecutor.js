/**
 * triggerExecutor — pass-through executor for the start/trigger node.
 * It returns the input variables as output so downstream nodes can use them,
 * but does not modify context unless an outputVariable is configured.
 */
export async function triggerExecutor({ node, context }) {
  return {
    status: "success",
    output: { ...context },
    logs: [{ level: "info", message: `Trigger "${node.data?.label || node.name || node.id}" started` }]
  };
}
