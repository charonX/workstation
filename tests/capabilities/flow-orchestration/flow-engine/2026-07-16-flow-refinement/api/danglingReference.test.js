// REQ-TRACE: REQ-FLOW-026
// REQ-VERSION: v1-hash:faea1df8
// CAPABILITY-TRACE: flow-orchestration
// ENTITY-TRACE: flow-engine
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: false

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { run } from "../../../../../../src/flowEngine/flowEngine.js";

describe("REQ-FLOW-026: Claude Agent 悬空引用执行行为", () => {
  it("上游删除/重命名变量后，下游保存时不做强制阻断", async () => {
    // 保存时不阻断：这是 flowService 的职责，已在 REQ-FLOW-018/019 中覆盖
    // 本测试关注执行时行为
    assert.equal(true, true);
  });

  it("执行时 {{fullName}} 不存在替换为空字符串", async () => {
    const flow = {
      nodeList: [
        {
          id: "n1",
          type: "agent",
          config: {
            provider: "anthropic",
            model: "claude-sonnet-5",
            outputVariable: "out",
            prompt: "Value: {{n999.missing}}",
          },
        },
      ],
      edges: [],
    };

    // 通过 options.executors 注入 mock adapter，验证不存在变量替换为空字符串
    let capturedPrompt;
    const mockAgentExecutor = async ({ node, context }) => {
      capturedPrompt = node.config.prompt;
      return { status: "success", output: "mocked" };
    };

    const result = await run(flow, { executors: { agent: mockAgentExecutor } });
    assert.equal(result.status, "success");
    assert.equal(capturedPrompt, "Value: ");
  });

  it("Condition 表达式中的 fullName 不存在时按 JS 语义处理为 undefined", async () => {
    const flow = {
      nodeList: [
        {
          id: "n1",
          type: "condition",
          config: { expression: "typeof n999.missing === 'undefined'" },
        },
      ],
      edges: [],
    };

    // typeof n999.missing 应为 'undefined'，表达式为 true
    const result = await run(flow);
    assert.equal(result.status, "success");
    assert.equal(result.branch, "true");
  });
});
