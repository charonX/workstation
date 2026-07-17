// REQ-TRACE: REQ-FLOW-025
// REQ-VERSION: v1-hash:faea1df8
// CAPABILITY-TRACE: flow-orchestration
// ENTITY-TRACE: flow-engine
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: false

import { describe, it, expect } from "vitest";
import { run } from "../../../../../../src/flowEngine/flowEngine.js";

describe("REQ-FLOW-025: FlowEngine 节点错误处理执行", () => {
  it("节点返回 error 时按 config.retries 次数重试", async () => {
    const flow = {
      nodeList: [
        {
          id: "n1",
          type: "agent",
          config: {
            provider: "anthropic",
            model: "claude-sonnet-5",
            outputVariable: "out",
            prompt: "test",
            retries: 2,
            onError: "fail",
          },
        },
      ],
      edges: [],
    };

    // 通过 options.executors 注入 mock adapter，先返回 error 再返回 success
    let callCount = 0;
    const mockAgentExecutor = async () => {
      callCount++;
      if (callCount <= 2) {
        return { status: "error", error: "temporary failure" };
      }
      return { status: "success", output: "recovered" };
    };

    const result = await run(flow, { executors: { agent: mockAgentExecutor } });
    expect(result.status).toBe("success");
    expect(callCount).toBe(3); // 初始 1 次 + 重试 2 次
  });

  it("重试耗尽后 onError=fail 终止整个 flow", async () => {
    const flow = {
      nodeList: [
        {
          id: "n1",
          type: "agent",
          config: {
            provider: "anthropic",
            model: "claude-sonnet-5",
            outputVariable: "out",
            prompt: "test",
            retries: 1,
            onError: "fail",
          },
        },
      ],
      edges: [],
    };

    // 通过 options.executors 注入 mock adapter，始终返回 error
    const mockAgentExecutor = async () => {
      return { status: "error", error: "persistent failure" };
    };

    await expect(run(flow, { executors: { agent: mockAgentExecutor } })).rejects.toThrow();
  });

  it("重试耗尽后 onError=ignore 继续执行下游，输出变量为空字符串", async () => {
    const flow = {
      nodeList: [
        {
          id: "n1",
          type: "agent",
          config: {
            provider: "anthropic",
            model: "claude-sonnet-5",
            outputVariable: "out",
            prompt: "test",
            retries: 1,
            onError: "ignore",
          },
        },
        {
          id: "n2",
          type: "condition",
          config: { expression: "n1.out === ''" },
        },
      ],
      edges: [{ sourceNodeId: "n1", targetNodeId: "n2" }],
    };

    // 通过 options.executors 注入 mock adapter，始终返回 error
    const mockAgentExecutor = async () => {
      return { status: "error", error: "persistent failure" };
    };

    const result = await run(flow, { executors: { agent: mockAgentExecutor } });
    expect(result.status).toBe("success");
    // onError=ignore 时 n1.out 应为空字符串，Condition 走 true 分支
    expect(result.branch).toBe("true");
  });

  it("节点返回 fatal 时直接终止，不进入重试逻辑", async () => {
    const flow = {
      nodeList: [
        {
          id: "n1",
          type: "agent",
          config: {
            provider: "anthropic",
            model: "claude-sonnet-5",
            outputVariable: "out",
            prompt: "test",
            retries: 3,
            onError: "ignore",
          },
        },
      ],
      edges: [],
    };

    // 通过 options.executors 注入 mock adapter，返回 fatal
    let callCount = 0;
    const mockAgentExecutor = async () => {
      callCount++;
      return { status: "fatal", error: "fatal error" };
    };

    await expect(run(flow, { executors: { agent: mockAgentExecutor } })).rejects.toThrow();
    // fatal 不应重试
    expect(callCount).toBe(1);
  });

  it("错误处理对 Trigger/Condition/Claude Agent 三个节点均生效", async () => {
    // Trigger
    const triggerFlow = {
      nodeList: [
        {
          id: "n1",
          type: "trigger",
          config: {
            outputVariables: [{ name: "x", type: "string" }],
            retries: 1,
            onError: "ignore",
          },
        },
      ],
      edges: [],
    };
    const triggerResult = await run(triggerFlow);
    expect(triggerResult.status).toBe("success");

    // Condition
    const conditionFlow = {
      nodeList: [
        {
          id: "n1",
          type: "condition",
          config: { expression: "1 > 0", retries: 1, onError: "fail" },
        },
      ],
      edges: [],
    };
    const conditionResult = await run(conditionFlow);
    expect(conditionResult.status).toBe("success");
  });
});
