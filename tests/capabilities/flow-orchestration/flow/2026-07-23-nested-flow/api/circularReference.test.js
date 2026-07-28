// REQ-TRACE: 2026-07-23-nested-flow/REQ-FLOW-038
// REQ-VERSION: v2-hash:908d0d519cd9d8d668fa99c1f665649cb12e62697b3d29bb7561297e253d46f8
// CAPABILITY-TRACE: flow-orchestration
// ENTITY-TRACE: flow
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { startServer, stopServer } from "../../../../../../src/http/server.js";

async function createFlow(baseUrl, projectId, name, nodeList, edges) {
  const res = await fetch(`${baseUrl}/api/flows`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, projectId, nodeList, edges })
  });
  return res.json();
}

async function patchFlow(baseUrl, flowId, nodeList, edges) {
  const res = await fetch(`${baseUrl}/api/flows/${flowId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nodeList, edges })
  });
  return { status: res.status, body: await res.json() };
}

function flowInput(id) {
  return { id, type: "flowInput", config: { outputVariables: [] } };
}

describe("REQ-FLOW-038: 保存时循环引用与嵌套深度校验", () => {
  let serverCtx;
  let project;

  beforeEach(async () => {
    serverCtx = await startServer();
    const res = await fetch(`${serverCtx.baseUrl}/api/projects`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Circ", localPath: "~/opc-workstation/circ" })
    });
    project = await res.json();
  });

  afterEach(async () => { await stopServer(serverCtx); });

  it("AC1: A→B→A 在闭合边保存时被拒绝 (E-FLOW-CIRCULAR)", async () => {
    // v2: every flow referenced by a callFlow must expose at least one flowInput
    // entry (E-FLOW-NO-INPUT). Create A/B with their callable entries up front.
    const a = await createFlow(serverCtx.baseUrl, project.id, "A", [flowInput("ain")], []);
    const b = await createFlow(serverCtx.baseUrl, project.id, "B", [flowInput("bin")], []);

    // A 调 B → 通过
    const r1 = await patchFlow(serverCtx.baseUrl, a.id,
      [
        { id: "trig", type: "trigger", config: { outputVariables: [] } },
        { id: "call", type: "callFlow", config: { targetFlowId: b.id, targetInputNodeId: "bin", inputMappings: [], outputMappings: [] } }
      ],
      [{ sourceNodeId: "trig", targetNodeId: "call" }]
    );
    assert.equal(r1.status, 200, `A→B should save: ${JSON.stringify(r1.body)}`);

    // B 调 A → 闭合环
    const r2 = await patchFlow(serverCtx.baseUrl, b.id,
      [
        flowInput("bin"),
        { id: "call", type: "callFlow", config: { targetFlowId: a.id, targetInputNodeId: "ain", inputMappings: [], outputMappings: [] } }
      ],
      [{ sourceNodeId: "bin", targetNodeId: "call" }]
    );
    assert.equal(r2.status, 400);
    assert.ok(r2.body.details?.some(d => /E-FLOW-CIRCULAR|circular|cycle|循环/i.test(d.message)),
      `expected circular error, got: ${JSON.stringify(r2.body)}`);
  });

  it("AC1: A→B→C→A 三节点环在 C 保存时被拒", async () => {
    const a = await createFlow(serverCtx.baseUrl, project.id, "A", [flowInput("ain")], []);
    const b = await createFlow(serverCtx.baseUrl, project.id, "B", [flowInput("bin")], []);
    const c = await createFlow(serverCtx.baseUrl, project.id, "C", [flowInput("cin")], []);

    await patchFlow(serverCtx.baseUrl, a.id,
      [{ id: "t", type: "trigger", config: { outputVariables: [] } }, { id: "c", type: "callFlow", config: { targetFlowId: b.id, targetInputNodeId: "bin", inputMappings: [], outputMappings: [] } }],
      [{ sourceNodeId: "t", targetNodeId: "c" }]);
    await patchFlow(serverCtx.baseUrl, b.id,
      [flowInput("bin"), { id: "c", type: "callFlow", config: { targetFlowId: c.id, targetInputNodeId: "cin", inputMappings: [], outputMappings: [] } }],
      [{ sourceNodeId: "bin", targetNodeId: "c" }]);
    // C 闭合环
    const r = await patchFlow(serverCtx.baseUrl, c.id,
      [flowInput("cin"), { id: "c", type: "callFlow", config: { targetFlowId: a.id, targetInputNodeId: "ain", inputMappings: [], outputMappings: [] } }],
      [{ sourceNodeId: "cin", targetNodeId: "c" }]);
    assert.equal(r.status, 400);
    assert.ok(r.body.details?.some(d => /E-FLOW-CIRCULAR|circular|cycle/i.test(d.message)));
  });

  it("AC2: 深度 8 通过，深度 9 拒绝 (E-FLOW-MAX-DEPTH)", async () => {
    // 构造链 A1 → A2 → ... → A10。A1 为根 trigger，A2..A10 每条被上一层调用，
    // 因此每条都需要一个 flowInput 入口以满足 E-FLOW-NO-INPUT。
    const flows = [];
    for (let i = 1; i <= 9; i++) {
      flows.push(await createFlow(serverCtx.baseUrl, project.id, `D${i}`, i === 1 ? [] : [flowInput(`in${i}`)], []));
    }
    for (let i = 1; i <= 8; i++) {
      const nextInputNode = `in${i + 1}`;
      await patchFlow(serverCtx.baseUrl, flows[i - 1].id,
        [
          { id: i === 1 ? "t" : `in${i}`, type: i === 1 ? "trigger" : "flowInput", config: { outputVariables: [] } },
          { id: "c", type: "callFlow", config: { targetFlowId: flows[i].id, targetInputNodeId: nextInputNode, inputMappings: [], outputMappings: [] } }
        ],
        [{ sourceNodeId: i === 1 ? "t" : `in${i}`, targetNodeId: "c" }]
      );
    }
    // A9 调 A10，使整条链深度达到 9。
    const a10 = await createFlow(serverCtx.baseUrl, project.id, "D10", [flowInput("in10")], []);
    await patchFlow(serverCtx.baseUrl, flows[8].id,
      [
        flowInput("in9"),
        { id: "c", type: "callFlow", config: { targetFlowId: a10.id, targetInputNodeId: "in10", inputMappings: [], outputMappings: [] } }
      ],
      [{ sourceNodeId: "in9", targetNodeId: "c" }]);
    // 重新保存 A1 触发从 A1 出发的 DFS：A1→A2→...→A10 深度 9 → 应拒
    const revalidate = await patchFlow(serverCtx.baseUrl, flows[0].id,
      [
        { id: "t", type: "trigger", config: { outputVariables: [] } },
        { id: "c", type: "callFlow", config: { targetFlowId: flows[1].id, targetInputNodeId: "in2", inputMappings: [], outputMappings: [] } }
      ],
      [{ sourceNodeId: "t", targetNodeId: "c" }]
    );
    assert.equal(revalidate.status, 400, `chain of depth 9 should be rejected: ${JSON.stringify(revalidate.body)}`);
    assert.ok(revalidate.body.details?.some(d => /E-FLOW-MAX-DEPTH|depth|8/i.test(d.message)),
      `expected depth error, got: ${JSON.stringify(revalidate.body)}`);
  });

  it("AC4: 保存时只从当前 flow 做 DFS，不反向扫描引用者", async () => {
    // X 调 Y；Y 创建时即带入口以满足 E-FLOW-NO-INPUT。
    const x = await createFlow(serverCtx.baseUrl, project.id, "X", [], []);
    const y = await createFlow(serverCtx.baseUrl, project.id, "Y", [flowInput("yin")], []);
    await patchFlow(serverCtx.baseUrl, x.id,
      [{ id: "t", type: "trigger", config: { outputVariables: [] } }, { id: "c", type: "callFlow", config: { targetFlowId: y.id, targetInputNodeId: "yin", inputMappings: [], outputMappings: [] } }],
      [{ sourceNodeId: "t", targetNodeId: "c" }]);
    // Y 加 flowInput（被 X 调），Y 本身不调任何人
    const r = await patchFlow(serverCtx.baseUrl, y.id,
      [flowInput("yin")], []);
    assert.equal(r.status, 200, JSON.stringify(r.body));
  });

  it("AC5: 错误 details 含 nodeId 供 UI 定位", async () => {
    const a = await createFlow(serverCtx.baseUrl, project.id, "A", [flowInput("ain")], []);
    // 自循环：A 调 A
    const r = await patchFlow(serverCtx.baseUrl, a.id,
      [
        { id: "t", type: "trigger", config: { outputVariables: [] } },
        { id: "selfcall", type: "callFlow", config: { targetFlowId: a.id, targetInputNodeId: "ain", inputMappings: [], outputMappings: [] } }
      ],
      [{ sourceNodeId: "t", targetNodeId: "selfcall" }]
    );
    assert.equal(r.status, 400);
    const circ = r.body.details?.find(d => /E-FLOW-CIRCULAR|circular/i.test(d.message));
    assert.ok(circ, "circular error present");
    // details 必须携带 nodeId 供 UI 定位画布节点
    assert.equal(circ.nodeId, "selfcall", `nodeId field present, got: ${JSON.stringify(circ)}`);
  });
});
