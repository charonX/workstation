// REQ-TRACE: 2026-07-23-nested-flow/REQ-FLOW-047
// REQ-VERSION: v1-hash:12fcb37250dd27d709796ef80459b1e5fca506df2f2ae756b1537eeb3501c8e4
// CAPABILITY-TRACE: flow-orchestration
// ENTITY-TRACE: flow
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { validateNodeList } from "../../../../../../src/services/flowService.js";

describe("REQ-FLOW-047 AC1: setVariables 节点注册为合法节点类型", () => {
  it("含 setVariables 节点的 nodeList 通过 validateNodeList", () => {
    const nodeList = [
      { id: "trig", type: "trigger", config: { outputVariables: [] } },
      { id: "sv", type: "setVariables", config: {
        assignments: [{ variableName: "x", expression: "hello" }]
      }}
    ];
    // 签核：setVariables 加入 VALIDATED_NODE_TYPES 白名单后不抛错
    assert.doesNotThrow(() => validateNodeList(nodeList));
  });
});

describe("REQ-FLOW-047 AC2: assignments 字段校验", () => {
  it("assignments 不是数组时报错", () => {
    const badNodes = [
      { id: "sv", type: "setVariables", config: { assignments: "not-array" } }
    ];
    // 签核：assignments 必须是数组
    assert.throws(() => validateNodeList(badNodes));
  });

  it("variableName 为空字符串报错 (E-VAR-NAME)", () => {
    const badNodes = [
      { id: "sv", type: "setVariables", config: {
        assignments: [{ variableName: "", expression: "x" }]
      }}
    ];
    assert.throws(() => validateNodeList(badNodes), /Variable name|name|变量名/);
  });

  it("variableName 同节点内重复报错 (E-VAR-NAME)", () => {
    const badNodes = [
      { id: "sv", type: "setVariables", config: {
        assignments: [
          { variableName: "x", expression: "a" },
          { variableName: "x", expression: "b" }
        ]
      }}
    ];
    assert.throws(() => validateNodeList(badNodes), /duplicate|already|重复/);
  });

  it("variableName 含非法字符（数字开头/含横线）报错 (E-VAR-NAME)", () => {
    const badNodes1 = [
      { id: "sv", type: "setVariables", config: {
        assignments: [{ variableName: "1bad", expression: "x" }]
      }}
    ];
    const badNodes2 = [
      { id: "sv", type: "setVariables", config: {
        assignments: [{ variableName: "has-dash", expression: "x" }]
      }}
    ];
    assert.throws(() => validateNodeList(badNodes1));
    assert.throws(() => validateNodeList(badNodes2));
  });

  it("expression 为空字符串报错 (E-EXPR)", () => {
    const badNodes = [
      { id: "sv", type: "setVariables", config: {
        assignments: [{ variableName: "x", expression: "" }]
      }}
    ];
    // 签核：expression 不能为空字符串，错误码 E-EXPR
    assert.throws(() => validateNodeList(badNodes));
  });

  it("合法 assignments 通过校验", () => {
    const nodeList = [
      { id: "trig", type: "trigger", config: { outputVariables: [] } },
      { id: "sv", type: "setVariables", config: {
        assignments: [
          { variableName: "greeting", expression: "hello" },
          { variableName: "msg", expression: "{{trig.text}}" },
          { variableName: "combined", expression: "{{trig.a}} {{trig.b}}" },
          { variableName: "url", expression: "{{trig.response.data.url}}" }
        ]
      }}
    ];
    assert.doesNotThrow(() => validateNodeList(nodeList));
  });
});
