// Temporary stub for test compilation.
// Real FlowEngine implementation will be provided by the implementer agent.

export async function run({
  flow,
  project,
  inputVariables,
  executors,
  onEvent,
  options = {}
}) {
  // Placeholder: always return success so tests can be authored.
  // Implementer will replace with topological execution, condition/loop handling,
  // and maxDepth/maxIterations protection.
  onEvent?.({ type: "execution:started", executionId: "placeholder" });
  return { status: "success", output: undefined };
}
