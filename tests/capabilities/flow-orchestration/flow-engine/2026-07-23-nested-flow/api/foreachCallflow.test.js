// REQ-TRACE: 2026-07-23-nested-flow/REQ-FLOW-046
// REQ-VERSION: v2.2-hash:b496ef72731fba3105a49d3185d3ca6f430dae96b9cf22e358cf2a2fd589f104
// CAPABILITY-TRACE: flow-orchestration
// ENTITY-TRACE: flow-engine
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { run } from "../../../../../../src/flowEngine/flowEngine.js";

describe("REQ-FLOW-046: foreach 内 callFlow 批量调用", () => {
  it("AC1: forEach body 含 callFlow，每轮迭代独立调用 invokeSubflow", async () => {
    const calls = [];
    const flow = {
      nodeList: [
        { id: "trig", type: "trigger", config: { outputVariables: [{ name: "items", defaultValue: ["a", "b", "c"] }] } },
        { id: "fe", type: "foreach", config: { "items-expr": "trig.items" } },
        { id: "call", type: "callFlow", config: {
          targetFlowId: "child", targetInputNodeId: "cin",
          inputMappings: [{ childVar: "item", parentExpr: "{{fe.item}}" }],
          outputMappings: [{ childVar: "result", parentKey: "call.result" }]
        }}
      ],
      edges: [
        { sourceNodeId: "trig", targetNodeId: "fe" },
        { sourceNodeId: "fe", targetNodeId: "call", sourcePort: "body" }
      ]
    };
    const services = {
      async invokeSubflow({ inputVars }) {
        calls.push(inputVars.item);
        return { status: "success", output: { result: `got-${inputVars.item}` }, childExecutionId: `c-${inputVars.item}`, logs: [] };
      }
    };
    const result = await run({ flow }, { services }, {});
    assert.deepEqual(calls, ["a", "b", "c"]);
    assert.equal(result.status, "success");
    assert.equal(result.iterations, 3);
  });

  it("AC2: 每次迭代独立 childExecutionId；父 record 保留最后一次", async () => {
    const childIds = [];
    const flow = {
      nodeList: [
        { id: "trig", type: "trigger", config: { outputVariables: [{ name: "items", defaultValue: [1, 2] }] } },
        { id: "fe", type: "foreach", config: { "items-expr": "trig.items" } },
        { id: "call", type: "callFlow", config: {
          targetFlowId: "child", targetInputNodeId: "cin",
          inputMappings: [], outputMappings: []
        }}
      ],
      edges: [
        { sourceNodeId: "trig", targetNodeId: "fe" },
        { sourceNodeId: "fe", targetNodeId: "call", sourcePort: "body" }
      ]
    };
    const services = {
      async invokeSubflow() {
        const id = `c-${childIds.length}`;
        childIds.push(id);
        return { status: "success", output: {}, childExecutionId: id, logs: [] };
      }
    };
    const result = await run({
      flow,
      executors: {
        callflow: async ({ services }) => {
          const r = await services.invokeSubflow({});
          return { status: "success", outputVariables: { __childExecutionId: r.childExecutionId }, logs: [] };
        }
      }
    }, { services });
    assert.deepEqual(childIds, ["c-0", "c-1"]);
    const callRec = result.nodeRecords.filter(r => r.nodeId === "call").pop();
    assert.equal(callRec.outputVariables["call.__childExecutionId"], "c-1");
  });

  it("AC3: 任意一次迭代子失败 → forEach 失败 → 父流程中止", async () => {
    const calls = [];
    const flow = {
      nodeList: [
        { id: "trig", type: "trigger", config: { outputVariables: [{ name: "items", defaultValue: [1, 2, 3] }] } },
        { id: "fe", type: "foreach", config: { "items-expr": "trig.items" } },
        { id: "call", type: "callFlow", config: { targetFlowId: "child", targetInputNodeId: "cin", inputMappings: [], outputMappings: [], retries: 0 } }
      ],
      edges: [
        { sourceNodeId: "trig", targetNodeId: "fe" },
        { sourceNodeId: "fe", targetNodeId: "call", sourcePort: "body" }
      ]
    };
    const services = {
      async invokeSubflow() {
        calls.push(1);
        if (calls.length === 2) throw new Error("E-SUBFLOW-FAILED: boom");
        return { status: "success", output: {}, childExecutionId: `c${calls.length}`, logs: [] };
      }
    };
    let caught;
    try { await run({ flow }, { services }, {}); } catch (e) { caught = e; }
    assert.ok(caught);
    assert.equal(calls.length, 2);
  });
});
