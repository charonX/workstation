// REQ-TRACE: 2026-07-23-nested-flow/REQ-FLOW-047
// REQ-VERSION: v1-hash:12fcb37250dd27d709796ef80459b1e5fca506df2f2ae756b1537eeb3501c8e4
// CAPABILITY-TRACE: flow-orchestration
// ENTITY-TRACE: flow
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getUpstreamVariableGroups } from "../../../../../../src/renderer/components/flow/upstreamVariables.js";

function makeNode(id, type, config) {
  return { id, data: { type, label: id, config } };
}

describe("REQ-FLOW-047 AC3/AC5/AC8: setVariables 节点输出应对下游变量选择器可见", () => {
  it("setVariables 的 assignments 对直连下游 agent 可见", () => {
    const nodes = [
      makeNode("sv", "setVariables", {
        assignments: [
          { variableName: "text", expression: "{{fm.text}}" },
          { variableName: "messageId", expression: "{{fm.messageId}}" }
        ]
      }),
      makeNode("agt", "agent", { outputVariable: "out" })
    ];
    const edges = [{ source: "sv", target: "agt" }];

    const groups = getUpstreamVariableGroups(nodes, edges, "agt");
    const svGroup = groups.find((g) => g.nodeId === "sv");
    assert.ok(svGroup, "下游 agent 应能看到 setVariables 节点变量组");

    const names = svGroup.variables.map((v) => v.fullName).sort();
    assert.deepEqual(
      names,
      ["sv.messageId", "sv.text"],
      "应暴露 assignments 中声明的每个 variableName"
    );
  });

  it("setVariables 非 trigger-like，无边连接时不应出现在选择器", () => {
    const nodes = [
      makeNode("sv", "setVariables", {
        assignments: [{ variableName: "x", expression: "1" }]
      }),
      makeNode("agt", "agent", { outputVariable: "out" })
    ];
    const edges = [];

    const groups = getUpstreamVariableGroups(nodes, edges, "agt");
    assert.equal(groups.length, 0, "无边连接时不应暴露 setVariables 变量");
  });

  it("多入口归一化场景：两个入口后的 setVariables 分别暴露统一变量名", () => {
    const nodes = [
      makeNode("fm", "feishuMessage", {
        outputVariables: [
          { name: "text", type: "string" },
          { name: "sender", type: "string" },
          { name: "messageId", type: "string" }
        ]
      }),
      makeNode("svA", "setVariables", {
        assignments: [
          { variableName: "text", expression: "{{fm.text}}" },
          { variableName: "messageId", expression: "{{fm.messageId}}" }
        ]
      }),
      makeNode("fin", "flowInput", {
        outputVariables: [
          { name: "messageText", type: "string" },
          { name: "messageId", type: "string" }
        ]
      }),
      makeNode("svB", "setVariables", {
        assignments: [
          { variableName: "text", expression: "{{fin.messageText}}" },
          { variableName: "messageId", expression: "{{fin.messageId}}" }
        ]
      }),
      makeNode("agt", "agent", { outputVariable: "out" })
    ];
    const edges = [
      { source: "svA", target: "agt" },
      { source: "svB", target: "agt" }
    ];

    const groups = getUpstreamVariableGroups(nodes, edges, "agt");
    const aGroup = groups.find((g) => g.nodeId === "svA");
    const bGroup = groups.find((g) => g.nodeId === "svB");
    assert.ok(aGroup, "svA 变量组应可见");
    assert.ok(bGroup, "svB 变量组应可见");

    const aNames = aGroup.variables.map((v) => v.name).sort();
    const bNames = bGroup.variables.map((v) => v.name).sort();
    assert.deepEqual(aNames, ["messageId", "text"], "svA 暴露统一变量名");
    assert.deepEqual(bNames, ["messageId", "text"], "svB 暴露统一变量名");
  });
});
