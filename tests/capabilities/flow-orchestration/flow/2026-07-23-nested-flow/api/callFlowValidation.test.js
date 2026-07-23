// REQ-TRACE: 2026-07-23-nested-flow/REQ-FLOW-034
// REQ-VERSION: v1-hash:12fcb37250dd27d709796ef80459b1e5fca506df2f2ae756b1537eeb3501c8e4
// CAPABILITY-TRACE: flow-orchestration
// ENTITY-TRACE: flow
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: false

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { startServer, stopServer } from "../../../../../../src/http/server.js";

// Helper: 子 flow 含 flowInput 声明若干变量
function childFlow(nodeList, edges) {
  return { name: "child", nodeList, edges };
}

describe("REQ-FLOW-034: callFlow 节点配置与字段校验", () => {
  let serverCtx;
  let project;

  beforeEach(async () => {
    serverCtx = await startServer();
    const res = await fetch(`${serverCtx.baseUrl}/api/projects`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Val", localPath: "~/opc-workstation/val" })
    });
    project = await res.json();
  });

  afterEach(async () => { await stopServer(serverCtx); });

  async function createFlow(payload) {
    const res = await fetch(`${serverCtx.baseUrl}/api/flows`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: project.id, ...payload })
    });
    return { status: res.status, body: await res.json() };
  }

  async function patchFlow(flowId, nodeList, edges) {
    const res = await fetch(`${serverCtx.baseUrl}/api/flows/${flowId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nodeList, edges })
    });
    return { status: res.status, body: await res.json() };
  }

  it("AC1: 合法 callFlow 配置保存成功", async () => {
    const child = await createFlow(childFlow(
      [{ id: "cin", type: "flowInput", name: "entry", config: { outputVariables: [{ name: "x" }] } }],
      []
    ));
    const parent = await createFlow({ name: "parent" });
    const r = await patchFlow(parent.body.id,
      [
        { id: "trig", type: "trigger", config: { outputVariables: [] } },
        { id: "call", type: "callFlow", config: {
          targetFlowId: child.body.id, targetInputNodeId: "cin",
          inputMappings: [{ childVar: "x", parentExpr: "{{trig.x}}" }],
          outputMappings: []
        }}
      ],
      [{ sourceNodeId: "trig", targetNodeId: "call" }]
    );
    assert.equal(r.status, 200, JSON.stringify(r.body));
  });

  it("AC2: targetFlowId 缺失返回 400 (E-CALLFLOW-TARGET)", async () => {
    const parent = await createFlow({ name: "parent" });
    const r = await patchFlow(parent.body.id,
      [
        { id: "trig", type: "trigger", config: {} },
        { id: "call", type: "callFlow", config: { targetInputNodeId: "cin", inputMappings: [], outputMappings: [] } }
      ],
      []
    );
    assert.equal(r.status, 400);
    assert.ok(r.body.details?.some(d => /targetFlowId|E-CALLFLOW-TARGET|required/i.test(d.message)),
      `expected targetFlowId error, got: ${JSON.stringify(r.body)}`);
  });

  it("AC2: targetInputNodeId 缺失返回 400 (E-CALLFLOW-INPUT)", async () => {
    const child = await createFlow(childFlow(
      [{ id: "cin", type: "flowInput", config: { outputVariables: [] } }], []
    ));
    const parent = await createFlow({ name: "parent" });
    const r = await patchFlow(parent.body.id,
      [
        { id: "trig", type: "trigger", config: {} },
        { id: "call", type: "callFlow", config: { targetFlowId: child.body.id, inputMappings: [], outputMappings: [] } }
      ],
      []
    );
    assert.equal(r.status, 400);
    assert.ok(r.body.details?.some(d => /targetInputNodeId|E-CALLFLOW-INPUT/i.test(d.message)));
  });

  it("AC3: parentExpr 不是单 {{var}} 引用返回 400 (E-CALLFLOW-MAP)", async () => {
    const child = await createFlow(childFlow(
      [{ id: "cin", type: "flowInput", config: { outputVariables: [{ name: "x" }] } }], []
    ));
    const parent = await createFlow({ name: "parent" });
    const r = await patchFlow(parent.body.id,
      [
        { id: "trig", type: "trigger", config: { outputVariables: [] } },
        { id: "call", type: "callFlow", config: {
          targetFlowId: child.body.id, targetInputNodeId: "cin",
          inputMappings: [{ childVar: "x", parentExpr: "hello {{trig.x}}" }],
          outputMappings: []
        }}
      ],
      []
    );
    assert.equal(r.status, 400);
    assert.ok(r.body.details?.some(d => /parentExpr|E-CALLFLOW-MAP|single/i.test(d.message)),
      `expected parentExpr error, got: ${JSON.stringify(r.body)}`);
  });

  it("AC5: 子入口声明的入参未映射且无 defaultValue 返回 400 (E-CALLFLOW-MAP-MISSING)", async () => {
    const child = await createFlow(childFlow(
      [{ id: "cin", type: "flowInput", config: { outputVariables: [{ name: "required1" }, { name: "required2" }] } }], []
    ));
    const parent = await createFlow({ name: "parent" });
    const r = await patchFlow(parent.body.id,
      [
        { id: "trig", type: "trigger", config: { outputVariables: [] } },
        { id: "call", type: "callFlow", config: {
          targetFlowId: child.body.id, targetInputNodeId: "cin",
          inputMappings: [{ childVar: "required1", parentExpr: "{{trig.a}}" }],
          outputMappings: []
        }}
      ],
      []
    );
    assert.equal(r.status, 400);
    assert.ok(r.body.details?.some(d => /required2|E-CALLFLOW-MAP-MISSING|missing/i.test(d.message)),
      `expected missing mapping error for required2, got: ${JSON.stringify(r.body)}`);
  });

  it("AC5: 未映射的入参有 defaultValue 时通过", async () => {
    const child = await createFlow(childFlow(
      [{ id: "cin", type: "flowInput", config: { outputVariables: [{ name: "withDefault", defaultValue: "d" }] } }], []
    ));
    const parent = await createFlow({ name: "parent" });
    const r = await patchFlow(parent.body.id,
      [
        { id: "trig", type: "trigger", config: { outputVariables: [] } },
        { id: "call", type: "callFlow", config: {
          targetFlowId: child.body.id, targetInputNodeId: "cin",
          inputMappings: [],  // withDefault 有 defaultValue，不映射也通过
          outputMappings: []
        }}
      ],
      [{ sourceNodeId: "trig", targetNodeId: "call" }]
    );
    assert.equal(r.status, 200, JSON.stringify(r.body));
  });
});
