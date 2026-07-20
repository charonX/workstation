// REQ-TRACE: 2026-07-19-media-production-line/REQ-FLOW-029
// REQ-VERSION: v1-hash:de43bc8607a89efe5512712a188a5f24f259d8109cb31a7a476827dd0883fab9
// CAPABILITY-TRACE: flow-orchestration
// ENTITY-TRACE: flow-engine
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { run } from "../../../../../../src/flowEngine/flowEngine.js";

// mock agent executor：捕获替换后的 prompt，不触达真实 agent。
function capturePromptExecutor(store) {
  return async ({ node }) => {
    store.prompts.push({ nodeId: node.id, prompt: node.config.prompt });
    return { status: "success", output: "mocked" };
  };
}

describe("REQ-FLOW-029: trigger 注入变量覆盖默认值", () => {
  it("AC1: createTask 注入的 variables 覆盖 trigger outputVariables 的 defaultValue，未注入的仍用默认值", async () => {
    const flow = {
      nodeList: [
        {
          id: "n1",
          type: "trigger",
          config: {
            outputVariables: [
              { name: "topic", type: "string", defaultValue: "default-topic" },
              { name: "limit", type: "number", defaultValue: 10 }
            ]
          }
        },
        {
          id: "n2",
          type: "agent",
          config: { provider: "anthropic", model: "claude", outputVariable: "out", prompt: "topic={{n1.topic}} limit={{n1.limit}}" }
        }
      ],
      edges: [{ sourceNodeId: "n1", targetNodeId: "n2" }]
    };

    const store = { prompts: [] };
    // 模拟 createTask 注入 variables（schedule/channel 场景经此入口传入 run 的 inputVariables）。
    const result = await run(flow, { executors: { agent: capturePromptExecutor(store) } }, { topic: "AI 科技动态" });
    assert.equal(result.status, "success");
    assert.equal(store.prompts[0].prompt, "topic=AI 科技动态 limit=10", "注入变量覆盖默认值，未注入变量保留默认值");
  });

  it("AC2: 注入变量对下游节点按 节点ID.变量名 可见", async () => {
    const flow = {
      nodeList: [
        {
          id: "n1",
          type: "trigger",
          config: { outputVariables: [{ name: "topic", type: "string", defaultValue: "unset" }] }
        },
        {
          id: "n2",
          type: "condition",
          config: { expression: "n1.topic === 'injected-value'" }
        }
      ],
      edges: [{ sourceNodeId: "n1", targetNodeId: "n2" }]
    };

    const result = await run(flow, {}, { topic: "injected-value" });
    assert.equal(result.status, "success");
    assert.equal(result.branch, "true", "注入变量应以 节点ID.变量名 进入变量注册表");
  });

  it("AC1 边界：注入值与默认值类型不同（注入 false/0 等 falsy 值）也应覆盖", async () => {
    const flow = {
      nodeList: [
        {
          id: "n1",
          type: "trigger",
          config: { outputVariables: [{ name: "enabled", type: "boolean", defaultValue: true }] }
        },
        {
          id: "n2",
          type: "condition",
          config: { expression: "n1.enabled === false" }
        }
      ],
      edges: [{ sourceNodeId: "n1", targetNodeId: "n2" }]
    };

    const result = await run(flow, {}, { enabled: false });
    assert.equal(result.branch, "true", "注入 falsy 值（false）应覆盖默认 true，不得被默认值兜底");
  });
});
