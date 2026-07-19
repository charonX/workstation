// REQ-TRACE: REQ-FLOW-024
// REQ-VERSION: v1-hash:faea1df8
// CAPABILITY-TRACE: flow-orchestration
// ENTITY-TRACE: flow-engine
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: false

import { describe, it } from "node:test";
import assert from "node:assert/strict";
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
    assert.equal(result.status, "success");
    assert.equal(capturedPrompt, "Hello world");
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
    assert.equal(result.status, "success");
    assert.equal(capturedPrompt, "Value: ");
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
    assert.equal(result.status, "success");
    assert.equal(result.branch, "true");
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
    assert.equal(result.status, "success");
    assert.equal(result.branch, "false");
  });

  it("BUG-003: 含下划线的节点 ID 作为 fullName 可在 Condition 表达式中求值", async () => {
    const flow = {
      nodeList: [
        {
          id: "node_1234567890",
          type: "trigger",
          config: { outputVariables: [{ name: "name", type: "string", defaultValue: "abc" }] },
        },
        {
          id: "node_9876543210",
          type: "condition",
          config: { expression: "node_1234567890.name == 'abc'" },
        },
      ],
      edges: [{ sourceNodeId: "node_1234567890", targetNodeId: "node_9876543210" }],
    };

    const result = await run(flow);
    assert.equal(result.status, "success");
    assert.equal(result.branch, "true");
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
    assert.equal(result.status, "success");
    assert.equal(capturedPrompt, "Process abc");
  });
});
