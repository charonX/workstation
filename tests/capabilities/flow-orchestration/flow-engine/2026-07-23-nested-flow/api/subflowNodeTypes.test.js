// REQ-TRACE: 2026-07-23-nested-flow/REQ-FLOW-032, 2026-07-23-nested-flow/REQ-FLOW-033
// REQ-VERSION: v2.2-hash:b496ef72731fba3105a49d3185d3ca6f430dae96b9cf22e358cf2a2fd589f104
// CAPABILITY-TRACE: flow-orchestration
// ENTITY-TRACE: flow-engine, flow
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true

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

  it("AC7: flowOutput 可通过 expression 显式映射上游变量作为输出", async () => {
    const flow = {
      nodeList: [
        { id: "in", type: "flowInput", config: { outputVariables: [{ name: "url", defaultValue: "http://default" }] } },
        { id: "agt", type: "agent", config: { provider: "anthropic", model: "claude", outputVariable: "raw", prompt: "go" } },
        { id: "out", type: "flowOutput", config: {
          outputVariables: [{ name: "savedUrl" }],
          expressions: [{ name: "savedUrl", expression: "{{agt.raw}}" }]
        }}
      ],
      edges: [
        { sourceNodeId: "in", targetNodeId: "agt" },
        { sourceNodeId: "agt", targetNodeId: "out" }
      ]
    };
    const result = await run(
      { flow },
      { executors: { agent: async () => ({ status: "success", output: "http://mapped" }) } },
      {}
    );
    assert.equal(result.status, "success");
    const outRecord = result.nodeRecords.find(r => r.nodeId === "out");
    assert.ok(outRecord, "flowOutput node record present");
    assert.equal(outRecord.outputVariables["out.savedUrl"], "http://mapped");
  });

  it("AC7: flowOutput 无 expression 时保持原行为（读同名 bare key）", async () => {
    const flow = {
      nodeList: [
        { id: "in", type: "flowInput", config: { outputVariables: [{ name: "url", defaultValue: "http://x" }] } },
        { id: "out", type: "flowOutput", config: { outputVariables: [{ name: "url" }] } }
      ],
      edges: [{ sourceNodeId: "in", targetNodeId: "out" }]
    };
    const result = await run({ flow }, {}, {});
    assert.equal(result.status, "success");
    const outRecord = result.nodeRecords.find(r => r.nodeId === "out");
    assert.equal(outRecord.outputVariables["out.url"], "http://x");
  });

  it("AC7: flowOutput expression 支持多来源回退 {{a || b}}", async () => {
    const flow = {
      nodeList: [
        { id: "in", type: "flowInput", config: { outputVariables: [{ name: "url", defaultValue: "" }] } },
        { id: "agt", type: "agent", config: { provider: "anthropic", model: "claude", outputVariable: "raw", prompt: "go" } },
        { id: "out", type: "flowOutput", config: {
          outputVariables: [{ name: "savedUrl" }],
          expressions: [{ name: "savedUrl", expression: "{{agt.raw || in.url}}" }]
        }}
      ],
      edges: [
        { sourceNodeId: "in", targetNodeId: "agt" },
        { sourceNodeId: "agt", targetNodeId: "out" }
      ]
    };
    const result = await run(
      { flow },
      { executors: { agent: async () => ({ status: "success", output: "http://from-agent" }) } },
      {}
    );
    assert.equal(result.status, "success");
    const outRecord = result.nodeRecords.find(r => r.nodeId === "out");
    assert.equal(outRecord.outputVariables["out.savedUrl"], "http://from-agent");
  });

  it("AC7: flowOutput expression 引用未声明的输出变量名时保存失败", () => {
    assert.throws(() => validateNodeList([
      { id: "out", type: "flowOutput", config: {
        outputVariables: [{ name: "savedUrl" }],
        expressions: [{ name: "notDeclared", expression: "{{agt.raw}}" }]
      }}
    ]));
  });
});
