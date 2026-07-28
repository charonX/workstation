// REQ-TRACE: 2026-07-23-nested-flow/REQ-FLOW-037
// REQ-VERSION: v2.2-hash:b496ef72731fba3105a49d3185d3ca6f430dae96b9cf22e358cf2a2fd589f104
// CAPABILITY-TRACE: flow-orchestration
// ENTITY-TRACE: flow-engine
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { run } from "../../../../../../src/flowEngine/flowEngine.js";
import { validateNodeList } from "../../../../../../src/services/flowService.js";

describe("REQ-FLOW-037: 子流程失败/未达出口向父传播", () => {
  it("AC1: 子流程节点失败 invokeSubflow throw → 父 callFlow error → 父中止", async () => {
    const parentFlow = {
      nodeList: [
        { id: "trig", type: "trigger", config: { outputVariables: [] } },
        { id: "call", type: "callFlow", config: { targetFlowId: "child", targetInputNodeId: "cin", inputMappings: [], outputMappings: [], retries: 0 } },
        { id: "after", type: "agent", config: { provider: "anthropic", model: "claude", outputVariable: "o", prompt: "x" } }
      ],
      edges: [
        { sourceNodeId: "trig", targetNodeId: "call" },
        { sourceNodeId: "call", targetNodeId: "after" }
      ]
    };
    const services = { async invokeSubflow() { throw new Error("E-SUBFLOW-FAILED: agent exploded"); } };
    let caught;
    try {
      await run({ flow: parentFlow }, { services }, {});
    } catch (e) { caught = e; }
    assert.ok(caught, "父流程应抛出并中止");
    assert.ok(caught.message.includes("agent exploded"));
    assert.ok(Array.isArray(caught.nodeRecords));
    const ranIds = caught.nodeRecords.map(r => r.nodeId);
    assert.ok(ranIds.includes("call"), "call 节点被执行");
    assert.ok(!ranIds.includes("after"), "after 节点不应执行（父已中止）");
    const callRec = caught.nodeRecords.find(r => r.nodeId === "call");
    assert.ok(callRec.error, "call 节点 record.error 非空");
  });

  it("AC2: 子流程未达出口 E-SUBFLOW-NO-OUTPUT → 父中止", async () => {
    const parentFlow = {
      nodeList: [
        { id: "trig", type: "trigger", config: { outputVariables: [] } },
        { id: "call", type: "callFlow", config: { targetFlowId: "child", targetInputNodeId: "cin", inputMappings: [], outputMappings: [] } }
      ],
      edges: [{ sourceNodeId: "trig", targetNodeId: "call" }]
    };
    const services = { async invokeSubflow() { throw new Error("E-SUBFLOW-NO-OUTPUT: child finished without flowOutput"); } };
    let caught;
    try { await run({ flow: parentFlow }, { services }, {}); } catch (e) { caught = e; }
    assert.ok(caught);
    assert.ok(caught.message.includes("E-SUBFLOW-NO-OUTPUT"));
  });

  it("AC3: 运行时子流程被删 E-FLOW-REF-MISSING → 父中止", async () => {
    const parentFlow = {
      nodeList: [
        { id: "trig", type: "trigger", config: { outputVariables: [] } },
        { id: "call", type: "callFlow", config: { targetFlowId: "deleted-flow", targetInputNodeId: "cin", inputMappings: [], outputMappings: [] } }
      ],
      edges: [{ sourceNodeId: "trig", targetNodeId: "call" }]
    };
    const services = {
      async invokeSubflow({ targetFlowId }) {
        throw new Error(`E-FLOW-REF-MISSING: subflow ${targetFlowId} not found`);
      }
    };
    let caught;
    try { await run({ flow: parentFlow }, { services }, {}); } catch (e) { caught = e; }
    assert.ok(caught);
    assert.ok(caught.message.includes("E-FLOW-REF-MISSING"));
    assert.ok(caught.message.includes("deleted-flow"));
  });

  it("AC4: 运行时深度超 8 层 E-FLOW-MAX-DEPTH", async () => {
    // 用 stub 模拟 invokeSubflow 检测 depth > 8 抛错
    let depthSeen = 0;
    const parentFlow = {
      nodeList: [
        { id: "trig", type: "trigger", config: { outputVariables: [] } },
        { id: "call", type: "callFlow", config: { targetFlowId: "deep", targetInputNodeId: "cin", inputMappings: [], outputMappings: [] } }
      ],
      edges: [{ sourceNodeId: "trig", targetNodeId: "call" }]
    };
    const services = {
      async invokeSubflow({ parentDepth }) {
        depthSeen = parentDepth + 1;
        if (depthSeen > 8) throw new Error("E-FLOW-MAX-DEPTH: nested call depth > 8");
        return { status: "success", output: {}, childExecutionId: "c", logs: [] };
      }
    };
    // parentDepth 0 → depthSeen=1 OK
    await assert.doesNotReject(() => run({ flow: parentFlow }, { services, currentDepth: 0 }, {}));
    assert.equal(depthSeen, 1);
    // parentDepth 8 → depthSeen=9 抛错
    let caught;
    try { await run({ flow: parentFlow }, { services, currentDepth: 8 }, {}); } catch (e) { caught = e; }
    assert.ok(caught);
    assert.ok(caught.message.includes("E-FLOW-MAX-DEPTH"));
  });

  it("AC6: callFlow onError=ignore 被 validateNodeList 拒绝（固定 fail）", () => {
    // callFlow 节点配 onError='ignore' 时 validateNodeList 抛错（一期固定 fail，不支持 ignore）
    const badNodes = [
      { id: "call", type: "callFlow", config: {
        targetFlowId: "x", targetInputNodeId: "y", inputMappings: [], outputMappings: [], onError: "ignore"
      }}
    ];
    assert.throws(() => validateNodeList(badNodes), /onError/);
  });
});
