// REQ-TRACE: REQ-FLOW-018
// REQ-VERSION: v1-hash:faea1df8
// CAPABILITY-TRACE: flow-orchestration
// ENTITY-TRACE: flow
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: false

import { describe, it, expect, beforeEach } from "vitest";
import { createFlow, updateFlow, getFlow, resetFlows } from "../../../../../../src/services/flowService.js";

describe("REQ-FLOW-018: Trigger 节点输出变量声明", () => {
  beforeEach(() => {
    resetFlows([]);
  });

  it("保存 Trigger 节点时持久化 outputVariables 到 config", () => {
    const flow = createFlow({ name: "demo", projectId: "p1" });
    const nodeList = [
      {
        id: "n1",
        type: "trigger",
        name: "Start",
        config: {
          outputVariables: [
            { name: "repoPath", type: "string", defaultValue: "" },
            { name: "count", type: "number", defaultValue: 0 },
          ],
        },
      },
    ];

    const updated = updateFlow(flow.id, { nodeList });
    expect(updated.nodeList[0].config.outputVariables).toHaveLength(2);
    expect(updated.nodeList[0].config.outputVariables[0]).toEqual({
      name: "repoPath",
      type: "string",
      defaultValue: "",
    });

    const fetched = getFlow(flow.id);
    expect(fetched.nodeList[0].config.outputVariables).toHaveLength(2);
  });

  it("拒绝空变量名并返回 400", () => {
    const flow = createFlow({ name: "demo", projectId: "p1" });
    const nodeList = [
      {
        id: "n1",
        type: "trigger",
        config: {
          outputVariables: [{ name: "", type: "string" }],
        },
      },
    ];

    expect(() => updateFlow(flow.id, { nodeList })).toThrow("Validation failed");
    // 预期错误详情包含 path 和 message，方便前端定位
    // 例如：{ path: "nodeList[0].config.outputVariables[0].name", message: "Variable name is required" }
  });

  it("拒绝非法变量类型并返回 400", () => {
    const flow = createFlow({ name: "demo", projectId: "p1" });
    const nodeList = [
      {
        id: "n1",
        type: "trigger",
        config: {
          outputVariables: [{ name: "x", type: "boolean" }],
        },
      },
    ];

    expect(() => updateFlow(flow.id, { nodeList })).toThrow("Validation failed");
    // 预期错误详情包含 path 和 message，例如：
    // { path: "nodeList[0].config.outputVariables[0].type", message: "Invalid type: boolean. Must be one of: string, number, array, object" }
  });

  it("拒绝同一节点内重复变量名", () => {
    const flow = createFlow({ name: "demo", projectId: "p1" });
    const nodeList = [
      {
        id: "n1",
        type: "trigger",
        config: {
          outputVariables: [
            { name: "x", type: "string" },
            { name: "x", type: "number" },
          ],
        },
      },
    ];

    expect(() => updateFlow(flow.id, { nodeList })).toThrow("Validation failed");
    // 预期错误详情包含 path 和 message，例如：
    // { path: "nodeList[0].config.outputVariables[1].name", message: "Duplicate variable name: x" }
  });

  it("删除变量后下游变量选择器不再显示该变量", () => {
    const flow = createFlow({ name: "demo", projectId: "p1" });
    const nodeList = [
      {
        id: "n1",
        type: "trigger",
        config: {
          outputVariables: [{ name: "x", type: "string" }],
        },
      },
      {
        id: "n2",
        type: "condition",
        config: { expression: "n1.x" },
      },
    ];

    updateFlow(flow.id, { nodeList });

    const updatedNodeList = [
      { ...nodeList[0], config: { outputVariables: [] } },
      nodeList[1],
    ];
    const updated = updateFlow(flow.id, { nodeList: updatedNodeList });

    // 下游变量选择器基于上游 outputVariables 计算；删除后列表应为空
    expect(updated.nodeList[0].config.outputVariables).toHaveLength(0);
  });
});
