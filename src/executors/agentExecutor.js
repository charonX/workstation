import { execute } from "../agentAdapter.js";

export async function agentExecutor({ node, context }) {
  const result = await execute({
    agentType: node.config?.agentType || "mock",
    systemPrompt: node.config?.systemPrompt,
    model: node.config?.model,
    inputVariables: context
  });
  return {
    status: result.status,
    output: result.output,
    logs: result.logs,
    error: result.error
  };
}
