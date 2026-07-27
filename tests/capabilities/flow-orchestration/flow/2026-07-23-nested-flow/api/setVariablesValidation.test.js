// REQ-TRACE: 2026-07-23-nested-flow/REQ-FLOW-047
// REQ-VERSION: v2-hash:908d0d519cd9d8d668fa99c1f665649cb12e62697b3d29bb7561297e253d46f8
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
        outputVariables: [{ name: "x", type: "string" }],
        expressions: [{ name: "x", expression: "hello" }]
      }}
    ];
    // 签核：setVariables 加入 VALIDATED_NODE_TYPES 白名单后不抛错
    assert.doesNotThrow(() => validateNodeList(nodeList));
  });
});

describe("REQ-FLOW-047 AC2: outputVariables / expressions 字段校验", () => {
  it("outputVariables 不是数组时报错", () => {
    const badNodes = [
      { id: "sv", type: "setVariables", config: { outputVariables: "not-array" } }
    ];
    // 签核：outputVariables 必须是数组
    assert.throws(() => validateNodeList(badNodes));
  });

  it("name 为空字符串报错 (E-VAR-NAME)", () => {
    const badNodes = [
      { id: "sv", type: "setVariables", config: {
        outputVariables: [{ name: "", type: "string" }],
        expressions: [{ name: "", expression: "x" }]
      }}
    ];
    assert.throws(() => validateNodeList(badNodes), /Variable name|name|变量名/);
  });

  it("name 同节点内重复报错 (E-VAR-NAME)", () => {
    const badNodes = [
      { id: "sv", type: "setVariables", config: {
        outputVariables: [
          { name: "x", type: "string" },
          { name: "x", type: "string" }
        ],
        expressions: []
      }}
    ];
    assert.throws(() => validateNodeList(badNodes), /duplicate|already|重复/);
  });

  it("name 含非法字符（数字开头/含横线）报错 (E-VAR-NAME)", () => {
    const badNodes1 = [
      { id: "sv", type: "setVariables", config: {
        outputVariables: [{ name: "1bad", type: "string" }]
      }}
    ];
    const badNodes2 = [
      { id: "sv", type: "setVariables", config: {
        outputVariables: [{ name: "has-dash", type: "string" }]
      }}
    ];
    assert.throws(() => validateNodeList(badNodes1));
    assert.throws(() => validateNodeList(badNodes2));
  });

  it("expression 为空字符串报错 (E-EXPR)", () => {
    const badNodes = [
      { id: "sv", type: "setVariables", config: {
        outputVariables: [{ name: "x", type: "string" }],
        expressions: [{ name: "x", expression: "" }]
      }}
    ];
    // 签核：expression 不能为空字符串，错误码 E-EXPR
    assert.throws(() => validateNodeList(badNodes));
  });

  it("expression 引用未在 outputVariables 中声明的 name 报错 (E-EXPR)", () => {
    const badNodes = [
      { id: "sv", type: "setVariables", config: {
        outputVariables: [{ name: "x", type: "string" }],
        expressions: [{ name: "y", expression: "hello" }]
      }}
    ];
    assert.throws(() => validateNodeList(badNodes));
  });

  it("合法 outputVariables + expressions 通过校验", () => {
    const nodeList = [
      { id: "trig", type: "trigger", config: { outputVariables: [] } },
      { id: "sv", type: "setVariables", config: {
        outputVariables: [
          { name: "greeting", type: "string" },
          { name: "msg", type: "string" },
          { name: "combined", type: "string" },
          { name: "url", type: "string" }
        ],
        expressions: [
          { name: "greeting", expression: "hello" },
          { name: "msg", expression: "{{trig.text}}" },
          { name: "combined", expression: "{{trig.a}} {{trig.b}}" },
          { name: "url", expression: "{{trig.response.data.url}}" }
        ]
      }}
    ];
    assert.doesNotThrow(() => validateNodeList(nodeList));
  });
});
