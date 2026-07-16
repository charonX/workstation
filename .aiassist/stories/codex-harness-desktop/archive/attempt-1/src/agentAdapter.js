// AgentAdapter spike: defines the execution contract and provides a mock mode
// for early integration. Real Claude Code / Codex drivers are TODO.

function timestamp() {
  return new Date().toISOString();
}

/**
 * Execute an agent step.
 *
 * @param {Object} input
 * @param {"claude-code" | "codex" | "mock"} input.agentType
 * @param {string} [input.systemPrompt]
 * @param {string} [input.model]
 * @param {Record<string, unknown>} input.inputVariables
 * @returns {Promise<{ status: "success" | "error" | "fatal", output?: unknown, logs: Array<{at: string, message: string}>, error?: string }>}
 */
export async function execute({ agentType, systemPrompt, model, inputVariables }) {
  const logs = [{ at: timestamp(), message: `agentType=${agentType} model=${model || "default"}` }];

  if (agentType === "mock") {
    return {
      status: "success",
      output: { mocked: true, variables: inputVariables },
      logs
    };
  }

  if (agentType === "claude-code") {
    return {
      status: "fatal",
      error: "Claude Code driver is not implemented in this spike",
      logs
    };
  }

  if (agentType === "codex") {
    return {
      status: "fatal",
      error: "Codex driver is not implemented in this spike",
      logs
    };
  }

  return {
    status: "fatal",
    error: `Unsupported agent type: ${agentType}`,
    logs
  };
}
