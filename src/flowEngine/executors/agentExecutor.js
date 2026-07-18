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
    const { prompt, model, options, systemPrompt } = node.config ?? {};
    // BUG-002 修复：面板顶层 config.systemPrompt（REQ-FLOW-014 持久化契约）在
    // anthropic 路径作为 options.systemPrompt 的回落；options.systemPrompt 存在时优先。
    // 两者皆 undefined 时原样透传 options（不设置该键），adapter 的 undefined 判断不变。
    const adapterOptions =
      options?.systemPrompt === undefined && systemPrompt !== undefined
        ? { ...options, systemPrompt }
        : options;
    const result = await claudeAgentExecute({
      prompt,
      model,
      projectPath,
      options: adapterOptions
    });
    return {
      ...toNodeResult(result),
      // agent 调用详情（tech-design §5.6）：引擎抄入 nodeRecord。
      // prompt 为引擎完成变量替换后的文本；内置 mock 分支不带此字段。
      // REQ-FLOW-028 v1.2：output 总是携带 adapter 返回的文本（success 时有值；
      // error 时按 adapter 返回原样，可为 undefined），供 output 列不经 outputVariable 声明捕获。
      agent: {
        prompt,
        model,
        provider,
        output: result.output,
        durationMs: result.durationMs
      }
    };
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
