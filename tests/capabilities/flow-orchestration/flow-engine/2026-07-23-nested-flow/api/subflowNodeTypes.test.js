// REQ-TRACE: 2026-07-23-nested-flow/REQ-FLOW-032, 2026-07-23-nested-flow/REQ-FLOW-033
// REQ-VERSION: v1-hash:12fcb37250dd27d709796ef80459b1e5fca506df2f2ae756b1537eeb3501c8e4
// CAPABILITY-TRACE: flow-orchestration
// ENTITY-TRACE: flow-engine, flow
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: false

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { run } from "../../../../../../src/flowEngine/flowEngine.js";
import { validateNodeList } from "../../../../../../src/services/flowService.js";

describe("REQ-FLOW-032: flowInput 节点类型", () => {
  it("AC1: flowInput 节点注册为合法节点类型，保存/执行不被拒绝", () => {
    const nodeList = [
      { id: "n1", type: "flowInput", name: "entry", config: { outputVariables: [{ name: "messageText", type: "string" }] } },
      { id: "n2", type: "agent", name: "process", config: { provider: "anthropic", model: "claude", outputVariable: "out", prompt: "echo" } }
    ];
    assert.doesNotThrow(() => validateNodeList(nodeList));
  });

  it("AC2: outputVariables name 为空字符串返回校验错误", () => {
    const badNodes = [
      { id: "n1", type: "flowInput", config: { outputVariables: [{ name: "", type: "string" }] } }
    ];
    assert.throws(() => validateNodeList(badNodes), /Variable name|name/);
  });

  it("AC2: outputVariables 重复 name 返回校验错误", () => {
    const badNodes = [
      { id: "n1", type: "flowInput", config: { outputVariables: [{ name: "x" }, { name: "x" }] } }
    ];
    assert.throws(() => validateNodeList(badNodes), /duplicate|already|重复/);
  });

  it("AC2: outputVariables name 含非法字符返回校验错误", () => {
    const badNodes = [
      { id: "n1", type: "flowInput", config: { outputVariables: [{ name: "1bad" }, { name: "has-dash" }] } }
    ];
    assert.throws(() => validateNodeList(badNodes));
  });

  it("AC3: flowInput 作为 TRIGGER_LIKE，defaultValue 被播种到 context 并替换 agent prompt", async () => {
    const flow = {
      nodeList: [
        { id: "inp", type: "flowInput", config: { outputVariables: [{ name: "topic", defaultValue: "default-topic" }] } },
        { id: "agt", type: "agent", config: { provider: "anthropic", model: "claude", outputVariable: "out", prompt: "{{inp.topic}}" } }
      ],
      edges: [{ sourceNodeId: "inp", targetNodeId: "agt" }]
    };
    const prompts = [];
    const result = await run(
      { flow },
      { executors: { agent: async ({ node }) => { prompts.push(node.config.prompt); return { status: "success", output: "ok" }; } } },
      {}
    );
    assert.equal(result.status, "success");
    assert.equal(prompts[0], "default-topic");
  });

  it("AC4: 一个 flow 可有多个 flowInput 节点（多入口），互不冲突", () => {
    const nodeList = [
      { id: "in1", type: "flowInput", config: { outputVariables: [{ name: "a" }] } },
      { id: "in2", type: "flowInput", config: { outputVariables: [{ name: "b" }] } },
      { id: "agt", type: "agent", config: { provider: "anthropic", model: "claude", outputVariable: "out", prompt: "x" } }
    ];
    assert.doesNotThrow(() => validateNodeList(nodeList));
  });
});

describe("REQ-FLOW-033: flowOutput 节点类型", () => {
  it("AC1: flowOutput 注册为合法节点类型", () => {
    const nodeList = [
      { id: "n1", type: "flowOutput", name: "out", config: { outputVariables: [{ name: "savedUrl", type: "string" }] } }
    ];
    assert.doesNotThrow(() => validateNodeList(nodeList));
  });

  it("AC2: outputVariables name 规则同 flowInput", () => {
    assert.throws(() => validateNodeList([
      { id: "n1", type: "flowOutput", config: { outputVariables: [{ name: "" }] } }
    ]));
    assert.throws(() => validateNodeList([
      { id: "n1", type: "flowOutput", config: { outputVariables: [{ name: "x" }, { name: "x" }] } }
    ]));
  });

  it("AC3: flowOutput 通过多输出机制返回出口变量", async () => {
    const flow = {
      nodeList: [
        { id: "in", type: "flowInput", config: { outputVariables: [{ name: "url", defaultValue: "http://x" }] } },
        { id: "agt", type: "agent", config: { provider: "anthropic", model: "claude", outputVariable: "savedUrl", prompt: "go" } },
        { id: "out", type: "flowOutput", config: { outputVariables: [{ name: "savedUrl" }] } }
      ],
      edges: [
        { sourceNodeId: "in", targetNodeId: "agt" },
        { sourceNodeId: "agt", targetNodeId: "out" }
      ]
    };
    const result = await run(
      { flow },
      { executors: { agent: async () => ({ status: "success", output: "http://saved" }) } },
      {}
    );
    assert.equal(result.status, "success");
    const outRecord = result.nodeRecords.find(r => r.nodeId === "out");
    assert.ok(outRecord, "flowOutput node record present");
    assert.equal(outRecord.outputVariables["out.savedUrl"], "http://saved");
  });

  it("AC4: flowOutput 作为叶子节点终止流程", async () => {
    const flow = {
      nodeList: [
        { id: "in", type: "flowInput", config: { outputVariables: [] } },
        { id: "out", type: "flowOutput", config: { outputVariables: [{ name: "x" }] } }
      ],
      edges: [{ sourceNodeId: "in", targetNodeId: "out" }]
    };
    const result = await run({ flow }, {}, {});
    assert.equal(result.status, "success");
    assert.equal(result.nodesRun, 2);
  });

  it("AC5: 多个 flowOutput（不同分支），跑到的那个作为出口", async () => {
    const flow = {
      nodeList: [
        { id: "in", type: "flowInput", config: { outputVariables: [{ name: "branch", defaultValue: "a" }] } },
        { id: "cond", type: "condition", config: { expression: "in.branch === 'a'" } },
        { id: "outA", type: "flowOutput", config: { outputVariables: [{ name: "result" }] } },
        { id: "outB", type: "flowOutput", config: { outputVariables: [{ name: "result" }] } },
        { id: "a", type: "agent", config: { provider: "anthropic", model: "claude", outputVariable: "result", prompt: "a" } },
        { id: "b", type: "agent", config: { provider: "anthropic", model: "claude", outputVariable: "result", prompt: "b" } }
      ],
      edges: [
        { sourceNodeId: "in", targetNodeId: "cond" },
        { sourceNodeId: "cond", targetNodeId: "a", sourcePort: "true" },
        { sourceNodeId: "cond", targetNodeId: "b", sourcePort: "false" },
        { sourceNodeId: "a", targetNodeId: "outA" },
        { sourceNodeId: "b", targetNodeId: "outB" }
      ]
    };
    const result = await run({ flow }, {
      executors: { agent: async ({ node }) => ({ status: "success", output: node.id === "a" ? "A-result" : "B-result" }) }
    }, { branch: "a" });
    const exitRecords = result.nodeRecords.filter(r => r.nodeId === "outA" || r.nodeId === "outB");
    assert.equal(exitRecords.length, 1);
    assert.equal(exitRecords[0].nodeId, "outA");
    assert.equal(exitRecords[0].outputVariables["outA.result"], "A-result");
  });
});
