/**
 * triggerExecutor — pass-through executor for the start/trigger node.
 *
 * Trigger-like nodes (trigger / feishuMessage / flowInput) declare their outputs
 * via config.outputVariables. The engine seeds and overrides those variables
 * before the executor runs, so this executor only needs to return success.
 */
export async function triggerExecutor({ node }) {
  return {
    status: "success",
    logs: [{ level: "info", message: `Trigger "${node.data?.label || node.name || node.id}" started` }]
  };
}
