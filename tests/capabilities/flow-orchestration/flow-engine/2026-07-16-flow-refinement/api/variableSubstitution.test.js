// REQ-TRACE: REQ-FLOW-024
// REQ-VERSION: v1-hash:faea1df8
// CAPABILITY-TRACE: flow-orchestration
// ENTITY-TRACE: flow-engine
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: false

import { describe, it, expect } from "vitest";
import { run } from "../../../../../../src/flowEngine/flowEngine.js";

describe("REQ-FLOW-024: FlowEngine 变量替换机制", () => {
  it("Claude Agent prompt 中的 {{fullName}} 替换为 registry 中的实际值", async () => {
    const flow = {
      nodeList: [
        {
          id: "n1",
          type: "trigger",
          config: { outputVariables: [{ name: "input", type: "string", defaultValue: "world" }] },
        },
        {
          id: "n2",
          type: "agent",
          config: {
            provider: "anthropic",
            model: "claude-sonnet-5",
            outputVariable: "out",
            prompt: "Hello {{n1.input}}",
          },
        },
      ],
      edges: [{ sourceNodeId: "n1", targetNodeId: "n2" }],
    };

    // 通过 options.executors 注入 mock adapter，捕获替换后的 prompt
    let capturedPrompt;
    const mockAgentExecutor = async ({ node, context }) => {
      capturedPrompt = node.config.prompt;
      return { status: "success", output: "mocked" };
    };

    const result = await run(flow, { executors: { agent: mockAgentExecutor } });
    expect(result.status).toBe("success");
    expect(capturedPrompt).toBe("Hello world");
  });

  it("{{fullName}} 在 registry 中不存在时替换为空字符串", async () => {
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
    expect(result.status).toBe("success");
    expect(capturedPrompt).toBe("Value: ");
  });

  it("Condition 表达式中的 fullName 直接作为 JavaScript 标识符求值", async () => {
    const flow = {
      nodeList: [
        {
          id: "n1",
          type: "trigger",
          config: { outputVariables: [{ name: "count", type: "number", defaultValue: 5 }] },
        },
        {
          id: "n2",
          type: "condition",
          config: { expression: "n1.count > 3" },
        },
      ],
      edges: [{ sourceNodeId: "n1", targetNodeId: "n2" }],
    };

    // 表达式 n1.count > 3 中 count=5，应走 true 分支
    const result = await run(flow);
    expect(result.status).toBe("success");
    expect(result.branch).toBe("true");
  });

  it("Condition 表达式中的 fullName 不存在时按 JS 语义处理为 undefined", async () => {
    const flow = {
      nodeList: [
        {
          id: "n1",
          type: "condition",
          config: { expression: "n999.missing > 3" },
        },
      ],
      edges: [],
    };

    // n999.missing 不存在，表达式求值为 undefined > 3，即 false
    const result = await run(flow);
    expect(result.status).toBe("success");
    expect(result.branch).toBe("false");
  });

  it("替换后的 prompt 文本传递给 claudeAgentAdapter", async () => {
    const flow = {
      nodeList: [
        {
          id: "n1",
          type: "trigger",
          config: { outputVariables: [{ name: "x", type: "string", defaultValue: "abc" }] },
        },
        {
          id: "n2",
          type: "agent",
          config: {
            provider: "anthropic",
            model: "claude-sonnet-5",
            outputVariable: "out",
            prompt: "Process {{n1.x}}",
          },
        },
      ],
      edges: [{ sourceNodeId: "n1", targetNodeId: "n2" }],
    };

    // 通过 options.executors 注入 mock adapter，验证传入的 prompt 参数
    let capturedPrompt;
    const mockAgentExecutor = async ({ node, context }) => {
      capturedPrompt = node.config.prompt;
      return { status: "success", output: "mocked" };
    };

    const result = await run(flow, { executors: { agent: mockAgentExecutor } });
    expect(result.status).toBe("success");
    expect(capturedPrompt).toBe("Process abc");
  });
});
