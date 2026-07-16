export async function execute({ agentType, systemPrompt, model, inputVariables }) {
  return {
    status: "success",
    output: `mock agent response (${agentType})`,
    logs: [{ at: new Date().toISOString(), message: "mock agent executed" }]
  };
}
