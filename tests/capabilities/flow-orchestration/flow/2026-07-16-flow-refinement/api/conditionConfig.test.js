// REQ-TRACE: REQ-FLOW-019
// REQ-VERSION: v1-hash:faea1df8
// CAPABILITY-TRACE: flow-orchestration
// ENTITY-TRACE: flow
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: false

import { describe, it, expect, beforeEach } from "vitest";
import { createFlow, updateFlow, getFlow, resetFlows } from "../../../../../../src/services/flowService.js";

describe("REQ-FLOW-019: Condition 节点 JS 表达式与 true/false 分支标识", () => {
  beforeEach(() => {
    resetFlows([]);
  });

  it("保存 Condition 节点时持久化 expression 到 config", () => {
    const flow = createFlow({ name: "demo", projectId: "p1" });
    const nodeList = [
      {
        id: "n1",
        type: "trigger",
        config: { outputVariables: [{ name: "count", type: "number" }] },
      },
      {
        id: "n2",
        type: "condition",
        name: "Check count",
        config: { expression: "n1.count > 3" },
      },
    ];

    const updated = updateFlow(flow.id, { nodeList });
    expect(updated.nodeList[1].config.expression).toBe("n1.count > 3");

    const fetched = getFlow(flow.id);
    expect(fetched.nodeList[1].config.expression).toBe("n1.count > 3");
  });

  it("拒绝空表达式并返回 400", () => {
    const flow = createFlow({ name: "demo", projectId: "p1" });
    const nodeList = [
      {
        id: "n1",
        type: "condition",
        config: { expression: "" },
      },
    ];

    expect(() => updateFlow(flow.id, { nodeList })).toThrow("Validation failed");
    // 预期错误详情包含 path 和 message，例如：
    // { path: "nodeList[0].config.expression", message: "Expression is required" }
  });

  it("表达式支持变量选择器插入 fullName 格式", () => {
    const flow = createFlow({ name: "demo", projectId: "p1" });
    const nodeList = [
      {
        id: "n1",
        type: "trigger",
        config: { outputVariables: [{ name: "result", type: "string" }] },
      },
      {
        id: "n2",
        type: "condition",
        config: { expression: "n1.result === 'ok'" },
      },
    ];

    const updated = updateFlow(flow.id, { nodeList });
    // Condition 表达式中的变量引用直接使用 fullName（如 n1.result）
    expect(updated.nodeList[1].config.expression).toContain("n1.result");
  });

  it("本 story 不承诺运行时前的表达式语法校验", () => {
    const flow = createFlow({ name: "demo", projectId: "p1" });
    const nodeList = [
      {
        id: "n1",
        type: "condition",
        config: { expression: "invalid syntax here" },
      },
    ];

    // 保存时不做语法校验，只校验非空
    const updated = updateFlow(flow.id, { nodeList });
    expect(updated.nodeList[0].config.expression).toBe("invalid syntax here");
  });
});
