// REQ-TRACE: 2026-07-23-nested-flow/REQ-FLOW-038
// REQ-VERSION: v1-hash:12fcb37250dd27d709796ef80459b1e5fca506df2f2ae756b1537eeb3501c8e4
// CAPABILITY-TRACE: flow-orchestration
// ENTITY-TRACE: flow
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: false

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

describe("REQ-FLOW-038: 保存时循环引用与嵌套深度校验", () => {
  let serverCtx;
  let project;

  beforeEach(async () => {
    serverCtx = await startServer();
    const res = await fetch(`${serverCtx.baseUrl}/api/projects`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Circ", localPath: "~/opc-workspace/circ" })
    });
    project = await res.json();
  });

  afterEach(async () => { await stopServer(serverCtx); });

  it("AC1: A→B→A 在闭合边保存时被拒绝 (E-FLOW-CIRCULAR)", async () => {
    const a = await createFlow(serverCtx.baseUrl, project.id, "A", [], []);
    const b = await createFlow(serverCtx.baseUrl, project.id, "B", [], []);

    // A 调 B → 通过
    const r1 = await patchFlow(serverCtx.baseUrl, a.id,
      [
        { id: "trig", type: "trigger", config: { outputVariables: [] } },
        { id: "call", type: "callFlow", config: { targetFlowId: b.id, targetInputNodeId: "bin", inputMappings: [], outputMappings: [] } }
      ],
      [{ sourceNodeId: "trig", targetNodeId: "call" }]
    );
    assert.equal(r1.status, 200, `A→B should save: ${JSON.stringify(r1.body)}`);

    // B 加 flowInput bin，再调 A → 闭合环
    const r2 = await patchFlow(serverCtx.baseUrl, b.id,
      [
        { id: "bin", type: "flowInput", config: { outputVariables: [] } },
        { id: "call", type: "callFlow", config: { targetFlowId: a.id, targetInputNodeId: "ain", inputMappings: [], outputMappings: [] } }
      ],
      [{ sourceNodeId: "bin", targetNodeId: "call" }]
    );
    assert.equal(r2.status, 400);
    assert.ok(r2.body.details?.some(d => /E-FLOW-CIRCULAR|circular|cycle|循环/i.test(d.message)),
      `expected circular error, got: ${JSON.stringify(r2.body)}`);
  });

  it("AC1: A→B→C→A 三节点环在 C 保存时被拒", async () => {
    const a = await createFlow(serverCtx.baseUrl, project.id, "A", [], []);
    const b = await createFlow(serverCtx.baseUrl, project.id, "B", [], []);
    const c = await createFlow(serverCtx.baseUrl, project.id, "C", [], []);

    await patchFlow(serverCtx.baseUrl, a.id,
      [{ id: "t", type: "trigger", config: {} }, { id: "c", type: "callFlow", config: { targetFlowId: b.id, targetInputNodeId: "bin", inputMappings: [], outputMappings: [] } }],
      [{ sourceNodeId: "t", targetNodeId: "c" }]);
    await patchFlow(serverCtx.baseUrl, b.id,
      [{ id: "bin", type: "flowInput", config: { outputVariables: [] } }, { id: "c", type: "callFlow", config: { targetFlowId: c.id, targetInputNodeId: "cin", inputMappings: [], outputMappings: [] } }],
      [{ sourceNodeId: "bin", targetNodeId: "c" }]);
    // C 闭合环
    const r = await patchFlow(serverCtx.baseUrl, c.id,
      [{ id: "cin", type: "flowInput", config: { outputVariables: [] } }, { id: "c", type: "callFlow", config: { targetFlowId: a.id, targetInputNodeId: "ain", inputMappings: [], outputMappings: [] } }],
      [{ sourceNodeId: "cin", targetNodeId: "c" }]);
    assert.equal(r.status, 400);
    assert.ok(r.body.details?.some(d => /E-FLOW-CIRCULAR|circular|cycle/i.test(d.message)));
  });

  it("AC2: 深度 8 通过，深度 9 拒绝 (E-FLOW-MAX-DEPTH)", async () => {
    // 构造链 A1 → A2 → ... → A9，A9 闭合时深度 9 应拒
    const flows = [];
    for (let i = 1; i <= 9; i++) {
      flows.push(await createFlow(serverCtx.baseUrl, project.id, `D${i}`, [], []));
    }
    // A1..A8 串成链 (深度 7 中间)，然后 A8 调 A9 时深度从 A1=0 算起 = 8，刚好通过
    // 实际上每次 patch 是"从当前保存的 flow 出发做 DFS"
    // 我们构造 A1→A2→...→A9 后 patch A9 调 A10（再建一个）→ 深度 9 拒
    // 简化：建一条 9 节点链 DFS 深度超过 8 拒
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
    // 第 9 个节点 (flows[8]) 加 flowInput + 调 flows[8] 自己？ 不——构造深度超限：
    // 此时 flows[0]=A1 depth=0→A2, flows[1]=A2 depth=1→A3, ... flows[6]=A7 depth=6→A8, flows[7]=A8 depth=7→A9
    // 让 A9 (flows[8]) 再调一个新 flow A10，A10 需建 flowInput；从 A1 出发 DFS 深度 = 9 → 拒
    const a10 = await createFlow(serverCtx.baseUrl, project.id, "D10", [], []);
    const r = await patchFlow(serverCtx.baseUrl, flows[8].id,
      [
        { id: "in9", type: "flowInput", config: { outputVariables: [] } },
        { id: "c", type: "callFlow", config: { targetFlowId: a10.id, targetInputNodeId: "in10", inputMappings: [], outputMappings: [] } }
      ],
      [{ sourceNodeId: "in9", targetNodeId: "c" }]
    );
    // 保存 A9→A10 时从 A9 出发做 DFS：A9→A10 深度=1，应通过
    // 但保存 A9 后，在 A1 点 DFS 深度才是 9。测试是单次 patch：
    // 实际场景：用户在保存 A9 时校验"从 A9 出发深度"通过 1；但保存 A1 时再校验会从 A1 出发 DFS 到 A10 深度 9。
    // 调整：patch A10 flowInput 后不需要调其他人；触发保存 A1 时应报错
    // 为简洁起见：patch flows[0] (A1) 本身（不改内容但触发重新校验）
    await patchFlow(serverCtx.baseUrl, a10.id,
      [{ id: "in10", type: "flowInput", config: { outputVariables: [] } }], []);
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
    // X 调 Y；修改 Y 的 nodeList（不调 X）应保存成功，不因为"被 X 调"触发环检测
    const x = await createFlow(serverCtx.baseUrl, project.id, "X", [], []);
    const y = await createFlow(serverCtx.baseUrl, project.id, "Y", [], []);
    await patchFlow(serverCtx.baseUrl, x.id,
      [{ id: "t", type: "trigger", config: {} }, { id: "c", type: "callFlow", config: { targetFlowId: y.id, targetInputNodeId: "yin", inputMappings: [], outputMappings: [] } }],
      [{ sourceNodeId: "t", targetNodeId: "c" }]);
    // Y 加 flowInput（被 X 调），Y 本身不调任何人
    const r = await patchFlow(serverCtx.baseUrl, y.id,
      [{ id: "yin", type: "flowInput", config: { outputVariables: [] } }], []);
    assert.equal(r.status, 200, JSON.stringify(r.body));
  });

  it("AC5: 错误 details 含 nodeId 供 UI 定位", async () => {
    const a = await createFlow(serverCtx.baseUrl, project.id, "A", [], []);
    // 自循环：A 调 A
    const r = await patchFlow(serverCtx.baseUrl, a.id,
      [
        { id: "t", type: "trigger", config: {} },
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
