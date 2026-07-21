// REQ-TRACE: 2026-07-19-media-production-line/REQ-FLOW-031
// REQ-VERSION: v1-hash:835c36c5544138cce6439e02f7ba146691088bcb08b1de2b6224f939ddbc7485
// CAPABILITY-TRACE: flow-orchestration
// ENTITY-TRACE: flow-engine
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getUpstreamVariableGroups } from "../../../../../../src/renderer/components/flow/upstreamVariables.js";

function makeNode(id, type, config) {
  return { id, data: { type, label: id, config } };
}

describe("REQ-FLOW-031: 变量选择器应包含 feishuMessage 节点输出", () => {
  it("feishuMessage 作为首节点时，其 outputVariables 对下游 agent 可见", () => {
    const nodes = [
      makeNode("n1", "feishuMessage", {
        outputVariables: [
          { name: "url", type: "string", defaultValue: "" },
          { name: "sender", type: "string", defaultValue: "" },
          { name: "messageId", type: "string", defaultValue: "" }
        ]
      }),
      makeNode("n2", "agent", { outputVariable: "out" })
    ];
    const edges = [{ source: "n1", target: "n2" }];

    const groups = getUpstreamVariableGroups(nodes, edges, "n2");
    const feishuGroup = groups.find((g) => g.nodeId === "n1");
    assert.ok(feishuGroup, "下游 agent 应能看到 feishuMessage 节点变量组");

    const names = feishuGroup.variables.map((v) => v.fullName);
    assert.deepEqual(
      names.sort(),
      ["n1.messageId", "n1.sender", "n1.url"],
      "应暴露 url/sender/messageId 三个变量"
    );
  });

  it("feishuMessage 作为 trigger-like 节点，即使无边也对下游可见", () => {
    const nodes = [
      makeNode("n1", "feishuMessage", {
        outputVariables: [{ name: "url", type: "string", defaultValue: "" }]
      }),
      makeNode("n2", "agent", { outputVariable: "out" })
    ];
    const edges = [];

    const groups = getUpstreamVariableGroups(nodes, edges, "n2");
    assert.equal(groups.length, 1, "trigger-like 节点无需边连接即可见");
    assert.equal(groups[0].nodeId, "n1");
  });

  it("非 trigger-like 节点无边连接时不应出现在选择器", () => {
    const nodes = [
      makeNode("n1", "agent", { outputVariable: "agentOut" }),
      makeNode("n2", "agent", { outputVariable: "out" })
    ];
    const edges = [];

    const groups = getUpstreamVariableGroups(nodes, edges, "n2");
    assert.equal(groups.length, 0, "无边连接时不应出现非 trigger-like 上游变量组");
  });

  it("trigger 节点的 outputVariables 仍对下游可见", () => {
    const nodes = [
      makeNode("n1", "trigger", {
        outputVariables: [{ name: "topic", type: "string", defaultValue: "AI" }]
      }),
      makeNode("n2", "agent", { outputVariable: "out" })
    ];
    const edges = [{ source: "n1", target: "n2" }];

    const groups = getUpstreamVariableGroups(nodes, edges, "n2");
    const triggerGroup = groups.find((g) => g.nodeId === "n1");
    assert.ok(triggerGroup, "trigger 节点变量组应可见");
    assert.ok(
      triggerGroup.variables.some((v) => v.fullName === "n1.topic"),
      "应暴露 trigger 的 topic 变量"
    );
  });

  it("非 trigger-like 节点只有存在上游路径时才暴露其 outputVariable", () => {
    const nodes = [
      makeNode("n1", "agent", { outputVariable: "agentOut" }),
      makeNode("n2", "agent", { outputVariable: "out" })
    ];
    const edges = [{ source: "n1", target: "n2" }];

    const groups = getUpstreamVariableGroups(nodes, edges, "n2");
    const agentGroup = groups.find((g) => g.nodeId === "n1");
    assert.ok(agentGroup, "有边连接的 agent 节点变量应可见");
    assert.ok(
      agentGroup.variables.some((v) => v.fullName === "n1.agentOut"),
      "应暴露 agent 的 outputVariable"
    );
  });
});
