import { execute as mockAgentExecute } from "../agentAdapter.js";
import { execute as claudeAgentExecute } from "../claudeAgentAdapter.js";

// adapter 结果 → 节点执行结果：统一四字段形状（无值字段为 undefined，两条分派路径一致）。
function toNodeResult(result) {
  return {
    status: result.status,
    output: result.output,
    logs: result.logs,
    error: result.error
  };
}

export async function agentExecutor({ node, context, projectPath }) {
  const provider = node.config?.provider;

  // provider 分派（tech-design §5.5）：
  // 无 provider（旧 flow）→ 内置 mock 路径，保持 REQ-FLOW-017 等旧签核契约离线可过；
  // "anthropic" → claudeAgentAdapter 真实调用。
  if (provider === "anthropic") {
    const result = await claudeAgentExecute({
      prompt: node.config?.prompt,
      model: node.config?.model,
      projectPath,
      options: node.config?.options
    });
    return toNodeResult(result);
  }

  if (provider !== undefined && provider !== null && provider !== "") {
    const message = `Unknown agent provider: ${provider}`;
    return {
      status: "error",
      error: message,
      logs: [{ at: new Date().toISOString(), message }]
    };
  }

  const result = await mockAgentExecute({
    agentType: node.config?.agentType || "mock",
    systemPrompt: node.config?.systemPrompt,
    model: node.config?.model,
    inputVariables: context
  });
  return toNodeResult(result);
}
