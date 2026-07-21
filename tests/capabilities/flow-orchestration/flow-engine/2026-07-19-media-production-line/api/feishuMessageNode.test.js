// REQ-TRACE: 2026-07-19-media-production-line/REQ-FLOW-031
// REQ-VERSION: v1-hash:aeebbee331c0863144ca7b891e8faf8da12fde2bfbceb0ad525049febf3f1d48
// CAPABILITY-TRACE: flow-orchestration
// ENTITY-TRACE: flow-engine
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { run } from "../../../../../../src/flowEngine/flowEngine.js";
import { validateNodeList } from "../../../../../../src/services/flowService.js";
import { validateFlowNodes } from "../../../../../../src/renderer/components/flow/validateFlowNodes.js";

// mock agent executor：捕获替换后的 prompt，不触达真实 agent。
function capturePromptExecutor(store) {
  return async ({ node }) => {
    store.prompts.push({ nodeId: node.id, prompt: node.config.prompt });
    return { status: "success", output: "mocked" };
  };
}

function makeFeishuMessageNode(id, overrides = {}) {
  const extraVariables = Array.isArray(overrides.extraVariables) ? overrides.extraVariables : [];
  return {
    id,
    type: "feishuMessage",
    config: {
      outputVariables: [
        { name: "text", type: "string", defaultValue: "" },
        { name: "sender", type: "string", defaultValue: "" },
        { name: "messageId", type: "string", defaultValue: "" },
        ...extraVariables
      ]
    }
  };
}

describe("REQ-FLOW-031: 飞书消息触发节点", () => {
  it("AC3: createTask 注入的 text/sender/messageId 覆盖 feishuMessage 节点的 defaultValue", async () => {
    const flow = {
      nodeList: [
        makeFeishuMessageNode("n1"),
        {
          id: "n2",
          type: "agent",
          config: {
            provider: "anthropic",
            model: "claude",
            outputVariable: "out",
            prompt: "text={{n1.text}} sender={{n1.sender}} messageId={{n1.messageId}}"
          }
        }
      ],
      edges: [{ sourceNodeId: "n1", targetNodeId: "n2" }]
    };

    const store = { prompts: [] };
    const result = await run(
      flow,
      { executors: { agent: capturePromptExecutor(store) } },
      { text: "https://example.com/x", sender: "ou_123", messageId: "om_456" }
    );

    assert.equal(result.status, "success");
    assert.equal(
      store.prompts[0].prompt,
      "text=https://example.com/x sender=ou_123 messageId=om_456",
      "注入变量应覆盖 feishuMessage 节点的默认值"
    );
  });

  it("AC3: 未注入的变量使用 defaultValue，注入 falsy 值（空字符串）也应覆盖非空默认值", async () => {
    const flow = {
      nodeList: [
        {
          id: "n1",
          type: "feishuMessage",
          config: {
            outputVariables: [
              { name: "text", type: "string", defaultValue: "default text" },
              { name: "sender", type: "string", defaultValue: "default-sender" }
            ]
          }
        },
        {
          id: "n2",
          type: "condition",
          config: { expression: "n1.text === ''" }
        }
      ],
      edges: [{ sourceNodeId: "n1", targetNodeId: "n2" }]
    };

    const result = await run(flow, {}, { text: "", sender: "ou_789" });
    assert.equal(result.branch, "true", "注入空字符串应覆盖非空 defaultValue");
  });

  it("AC4: validateNodeList 接受固定结构的 feishuMessage 节点", () => {
    const nodeList = [makeFeishuMessageNode("n1")];
    assert.doesNotThrow(() => validateNodeList(nodeList), "固定结构应通过校验");
  });

  it("AC4: validateNodeList 拒绝缺少固定输出变量的 feishuMessage 节点", () => {
    const nodeList = [
      {
        id: "n1",
        type: "feishuMessage",
        config: {
          outputVariables: [
            { name: "text", type: "string", defaultValue: "" },
            { name: "sender", type: "string", defaultValue: "" }
            // 缺少 messageId
          ]
        }
      }
    ];
    assert.throws(() => validateNodeList(nodeList), /messageId|固定输出|required/i, "缺少 messageId 应被拒绝");
  });

  it("AC4: validateNodeList 拒绝非 string 类型的 feishuMessage 固定输出变量", () => {
    const nodeList = [
      {
        id: "n1",
        type: "feishuMessage",
        config: {
          outputVariables: [
            { name: "text", type: "string", defaultValue: "" },
            { name: "sender", type: "string", defaultValue: "" },
            { name: "messageId", type: "number", defaultValue: 0 }
          ]
        }
      }
    ];
    assert.throws(() => validateNodeList(nodeList), /messageId|type|Invalid type/i, "messageId 类型应为 string");
  });

  describe("AC5: validateFlowNodes 前端校验拒绝非法 feishuMessage 配置", () => {
    const t = (key, opts) => (opts ? `${key}:${JSON.stringify(opts)}` : key);

    it("拒绝缺少固定输出变量", () => {
      const nodeList = [
        {
          id: "n1",
          type: "feishuMessage",
          config: {
            outputVariables: [
              { name: "text", type: "string", defaultValue: "" },
              { name: "sender", type: "string", defaultValue: "" }
            ]
          }
        }
      ];
      const errors = validateFlowNodes(nodeList, t);
      assert.ok(errors.some((e) => /feishuMessageVariableRequired.*"name":"messageId"/i.test(e)), "应提示缺少 messageId");
    });

    it("拒绝非 string 类型的固定输出变量", () => {
      const nodeList = [
        {
          id: "n1",
          type: "feishuMessage",
          config: {
            outputVariables: [
              { name: "text", type: "string", defaultValue: "" },
              { name: "sender", type: "string", defaultValue: "" },
              { name: "messageId", type: "number", defaultValue: 0 }
            ]
          }
        }
      ];
      const errors = validateFlowNodes(nodeList, t);
      assert.ok(errors.some((e) => /feishuMessageVariableType.*"name":"messageId"/i.test(e)), "应提示 messageId 类型错误");
    });

    it("拒绝额外输出变量", () => {
      const nodeList = [
        {
          id: "n1",
          type: "feishuMessage",
          config: {
            outputVariables: [
              { name: "text", type: "string", defaultValue: "" },
              { name: "sender", type: "string", defaultValue: "" },
              { name: "messageId", type: "string", defaultValue: "" },
              { name: "extra", type: "string", defaultValue: "" }
            ]
          }
        }
      ];
      const errors = validateFlowNodes(nodeList, t);
      assert.ok(errors.some((e) => /feishuMessageUnexpectedVariable.*"name":"extra"/i.test(e)), "应提示 unexpected 变量 extra");
    });
  });
});
