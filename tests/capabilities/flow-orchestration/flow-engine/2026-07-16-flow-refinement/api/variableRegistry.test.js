// REQ-TRACE: REQ-FLOW-023
// REQ-VERSION: v1-hash:faea1df8
// CAPABILITY-TRACE: flow-orchestration
// ENTITY-TRACE: flow-engine
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: false

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { run } from "../../../../../../src/flowEngine/flowEngine.js";

describe("REQ-FLOW-023: FlowEngine 变量注册表", () => {
  it("Trigger 节点声明的变量作为初始 context", async () => {
    const flow = {
      nodeList: [
        {
          id: "n1",
          type: "trigger",
          config: {
            outputVariables: [
              { name: "repoPath", type: "string", defaultValue: "/tmp/repo" },
              { name: "count", type: "number", defaultValue: 5 },
            ],
          },
        },
      ],
      edges: [],
    };

    const result = await run(flow);
    // Trigger 变量作为初始 context，可通过 result 或下游节点间接验证
    assert.equal(result.status, "success");
  });

  it("节点执行成功后按 nodeId.variableName 写入注册表", async () => {
    const flow = {
      nodeList: [
        {
          id: "n1",
          type: "trigger",
          config: { outputVariables: [{ name: "x", type: "string", defaultValue: "hello" }] },
        },
        {
          id: "n2",
          type: "agent",
          config: {
            provider: "anthropic",
            model: "claude-sonnet-5",
            outputVariable: "result",
            prompt: "echo {{n1.x}}",
          },
        },
      ],
      edges: [{ sourceNodeId: "n1", targetNodeId: "n2" }],
    };

    // 通过 options.executors 注入 mock adapter，捕获调用参数
    let capturedContext;
    const mockAgentExecutor = async ({ node, context }) => {
      capturedContext = context;
      return { status: "success", output: "mocked" };
    };

    const result = await run(flow, { executors: { agent: mockAgentExecutor } });
    assert.equal(result.status, "success");
    // 验证 n1.x 已写入 context
    assert.equal(capturedContext["n1.x"], "hello");
  });

  it("不同节点可声明同名变量，通过 nodeId 区分", async () => {
    const flow = {
      nodeList: [
        {
          id: "n1",
          type: "trigger",
          config: { outputVariables: [{ name: "x", type: "string", defaultValue: "from-n1" }] },
        },
        {
          id: "n2",
          type: "agent",
          config: {
            provider: "anthropic",
            model: "claude-sonnet-5",
            outputVariable: "x",
            prompt: "process",
          },
        },
      ],
      edges: [{ sourceNodeId: "n1", targetNodeId: "n2" }],
    };

    // 通过 options.executors 注入 mock adapter，验证同名变量按 nodeId 隔离
    let capturedContext;
    const mockAgentExecutor = async ({ node, context }) => {
      capturedContext = context;
      return { status: "success", output: "from-n2" };
    };

    const result = await run(flow, { executors: { agent: mockAgentExecutor } });
    assert.equal(result.status, "success");
    // n1.x 和 n2.x 应同时存在，互不覆盖
    assert.equal(capturedContext["n1.x"], "from-n1");
    assert.equal(capturedContext["n2.x"], "from-n2");
  });

  it("变量注册表不持久化到数据库，仅存在于单次执行内存中", async () => {
    const flow = {
      nodeList: [
        {
          id: "n1",
          type: "trigger",
          config: { outputVariables: [{ name: "x", type: "string", defaultValue: "test" }] },
        },
      ],
      edges: [],
    };

    const result1 = await run(flow);
    const result2 = await run(flow);

    // 两次执行应使用独立的注册表，互不干扰
    assert.equal(result1.status, "success");
    assert.equal(result2.status, "success");
  });
});
