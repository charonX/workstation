// REQ-TRACE: 2026-07-23-nested-flow/REQ-FLOW-032, REQ-FLOW-033, REQ-FLOW-043, REQ-FLOW-047, ADR-010
// REQ-VERSION: v2-hash:908d0d519cd9d8d668fa99c1f665649cb12e62697b3d29bb7561297e253d46f8
// CAPABILITY-TRACE: flow-orchestration
// ENTITY-TRACE: flow-engine
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: false

import { describe, it } from "node:test";
import assert from "node:assert/strict";

// TODO: HUMAN ASSERTION — 确认 nodeRegistry 导出名称和路径
import { NODE_REGISTRY } from "../../../../../../src/renderer/components/flow/nodeRegistry.js";

const KNOWN_NODE_TYPES = [
  "trigger",
  "feishuMessage",
  "flowInput",
  "flowOutput",
  "agent",
  "feishuSend",
  "condition",
  "forEach",
  "while",
  "callFlow",
  "setVariables"
];

describe("ADR-010 / REQ-FLOW-043: 节点类型注册表契约", () => {
  it("所有已知节点类型已在 nodeRegistry 注册", () => {
    for (const type of KNOWN_NODE_TYPES) {
      assert.ok(NODE_REGISTRY[type], `节点类型 ${type} 必须在 nodeRegistry 中注册`);
      assert.equal(NODE_REGISTRY[type].type, type, `注册项 type 必须等于 ${type}`);
    }
  });

  it("每个注册项包含必需的元数据字段", () => {
    for (const type of KNOWN_NODE_TYPES) {
      const entry = NODE_REGISTRY[type];
      assert.ok(typeof entry.category === "string", `${type}: category 必须是字符串`);
      assert.ok(typeof entry.icon === "string", `${type}: icon 必须是字符串`);
      assert.ok(entry.defaultConfig && typeof entry.defaultConfig === "object", `${type}: defaultConfig 必须是对象`);
      assert.ok(typeof entry.deriveOutputVariables === "function", `${type}: deriveOutputVariables 必须是函数`);
      // configPanel 是 React 组件，可选检查其为函数
      assert.ok(typeof entry.configPanel === "function" || typeof entry.configPanel === "object", `${type}: configPanel 必须存在`);
    }
  });

  it("每个节点类型的 defaultConfig 必须包含 outputVariables 数组", () => {
    for (const type of KNOWN_NODE_TYPES) {
      const entry = NODE_REGISTRY[type];
      assert.ok(Array.isArray(entry.defaultConfig.outputVariables), `${type}: defaultConfig.outputVariables 必须是数组`);
    }
  });

  it("trigger / feishuMessage / flowInput / flowOutput deriveOutputVariables 返回 config.outputVariables", () => {
    const vars = [
      { name: "x", type: "string" },
      { name: "y", type: "number" }
    ];
    for (const type of ["trigger", "feishuMessage", "flowInput", "flowOutput"]) {
      const result = NODE_REGISTRY[type].deriveOutputVariables({ outputVariables: vars });
      assert.deepEqual(result, vars, `${type}: 应原样返回 outputVariables`);
    }
  });

  it("agent deriveOutputVariables 返回 config.outputVariables（默认 [output]）", () => {
    const result = NODE_REGISTRY.agent.deriveOutputVariables({ outputVariables: [{ name: "out", type: "string" }] });
    assert.deepEqual(result, [{ name: "out", type: "string" }]);
  });

  it("setVariables deriveOutputVariables 返回 config.outputVariables", () => {
    const vars = [{ name: "text", type: "string" }, { name: "messageId", type: "string" }];
    const result = NODE_REGISTRY.setVariables.deriveOutputVariables({
      outputVariables: vars,
      expressions: [{ name: "text", expression: "{{fm.text}}" }]
    });
    assert.deepEqual(result, vars, "setVariables 应返回 outputVariables，不依赖 expressions");
  });

  it("callFlow deriveOutputVariables 返回 config.outputVariables（由保存时补全）", () => {
    const vars = [{ name: "savedUrl", type: "string" }];
    const result = NODE_REGISTRY.callFlow.deriveOutputVariables({
      outputVariables: vars,
      targetFlowId: "child-id",
      inputMappings: []
    });
    assert.deepEqual(result, vars, "callFlow 应返回已补全的 outputVariables");
  });

  it("deriveOutputVariables 对缺失/异常 config 不抛异常", () => {
    for (const type of KNOWN_NODE_TYPES) {
      assert.doesNotThrow(() => {
        const result = NODE_REGISTRY[type].deriveOutputVariables({});
        assert.ok(Array.isArray(result), `${type}: 异常输入也应返回数组`);
      });
    }
  });
});
