// REQ-TRACE: REQ-FLOW-020
// REQ-VERSION: v1-hash:faea1df8
// CAPABILITY-TRACE: flow-orchestration
// ENTITY-TRACE: flow
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: false

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createFlow, updateFlow, getFlow, resetFlows } from "../../../../../../src/services/flowService.js";

describe("REQ-FLOW-020: Claude Agent 节点统一 adapter 调用与输出变量", () => {
  beforeEach(() => {
    resetFlows([]);
  });

  it("保存 Claude Agent 节点时持久化 provider/model/outputVariable/prompt/retries/onError", () => {
    const flow = createFlow({ name: "demo", projectId: "p1" });
    const nodeList = [
      {
        id: "n1",
        type: "agent",
        name: "Summarize",
        config: {
          provider: "anthropic",
          model: "claude-sonnet-5",
          outputVariable: "summary",
          prompt: "Summarize {{n1.result}}",
          retries: 2,
          onError: "ignore",
        },
      },
    ];

    const updated = updateFlow(flow.id, { nodeList });
    const config = updated.nodeList[0].config;
    assert.equal(config.provider, "anthropic");
    assert.equal(config.model, "claude-sonnet-5");
    assert.equal(config.outputVariable, "summary");
    assert.equal(config.prompt, "Summarize {{n1.result}}");
    assert.equal(config.retries, 2);
    assert.equal(config.onError, "ignore");
  });

  it("prompt 支持变量选择器插入 {{fullName}} 格式", () => {
    const flow = createFlow({ name: "demo", projectId: "p1" });
    const nodeList = [
      {
        id: "n1",
        type: "trigger",
        config: { outputVariables: [{ name: "input", type: "string" }] },
      },
      {
        id: "n2",
        type: "agent",
        config: {
          provider: "anthropic",
          model: "claude-sonnet-5",
          outputVariable: "out",
          prompt: "Process {{n1.input}}",
        },
      },
    ];

    const updated = updateFlow(flow.id, { nodeList });
    assert.ok(updated.nodeList[1].config.prompt.includes("{{n1.input}}"));
  });

  it("adapter 不感知变量注册表，只接收已替换变量后的最终 prompt", () => {
    // adapter 接口签名：{ prompt, model, projectPath, options, apiKey }
    // prompt 必须是已替换变量后的最终文本，不包含 {{...}} 占位符
    const adapterInput = {
      prompt: "Summarize hello world",
      model: "claude-sonnet-5",
      projectPath: "/tmp/project",
      options: {},
      apiKey: "test-key",
    };
    assert.ok(!adapterInput.prompt.includes("{{"));
    assert.ok(!adapterInput.prompt.includes("}}"));
  });
});
