// REQ-TRACE: 2026-07-23-nested-flow/REQ-FLOW-041
// REQ-VERSION: v1-hash:12fcb37250dd27d709796ef80459b1e5fca506df2f2ae756b1537eeb3501c8e4
// CAPABILITY-TRACE: flow-orchestration
// ENTITY-TRACE: flow
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { startServer, stopServer } from "../../../../../../src/http/server.js";

describe("REQ-FLOW-041: callFlow 候选子流程列表 API", () => {
  let serverCtx;
  let project;

  beforeEach(async () => {
    serverCtx = await startServer();
    const res = await fetch(`${serverCtx.baseUrl}/api/projects`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Cand", localPath: "~/opc-workspace/cand" })
    });
    project = await res.json();
  });

  afterEach(async () => { await stopServer(serverCtx); });

  async function createFlow(name, nodeList) {
    const res = await fetch(`${serverCtx.baseUrl}/api/flows`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, projectId: project.id, nodeList, edges: [] })
    });
    return res.json();
  }

  it("AC1: 只返回含 flowInput 节点的 flow，附带 inputNodes 列表", async () => {
    await createFlow("plain", [{ id: "t", type: "trigger", config: {} }]);
    const withInput = await createFlow("sub", [
      { id: "in1", type: "flowInput", name: "fromFeishu", config: { outputVariables: [{ name: "text", type: "string" }] } },
      { id: "in2", type: "flowInput", name: "fromSchedule", config: { outputVariables: [{ name: "topic" }] } }
    ]);

    const parent = await createFlow("parent", [{ id: "t", type: "trigger", config: {} }]);
    const res = await fetch(`${serverCtx.baseUrl}/api/flows/${parent.id}/callflow-candidates`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(Array.isArray(data));

    const sub = data.find(f => f.id === withInput.id);
    assert.ok(sub, "sub (with flowInput) appears in candidates");
    assert.ok(!data.find(f => f.name === "plain"), "plain (no flowInput) filtered out");

    assert.equal(sub.inputNodes.length, 2);
    const ids = sub.inputNodes.map(n => n.id).sort();
    assert.deepEqual(ids, ["in1", "in2"]);
    const in1 = sub.inputNodes.find(n => n.id === "in1");
    assert.deepEqual(in1.variables.map(v => v.name), ["text"]);
    assert.equal(in1.name, "fromFeishu");
  });

  it("AC2: 返回结果不含自身 (parent id)", async () => {
    await createFlow("other", [{ id: "in", type: "flowInput", config: { outputVariables: [] } }]);
    const parent = await createFlow("parent", [{ id: "in", type: "flowInput", config: { outputVariables: [] } }]);

    const res = await fetch(`${serverCtx.baseUrl}/api/flows/${parent.id}/callflow-candidates`);
    const data = await res.json();
    assert.ok(!data.find(f => f.id === parent.id), "parent itself excluded");
    assert.equal(data.length, 1);
    assert.equal(data[0].name, "other");
  });

  it("AC3: 无含 flowInput 的 flow 时返回空数组", async () => {
    await createFlow("plain1", [{ id: "t", type: "trigger", config: {} }]);
    const parent = await createFlow("parent", [{ id: "t", type: "trigger", config: {} }]);

    const res = await fetch(`${serverCtx.baseUrl}/api/flows/${parent.id}/callflow-candidates`);
    const data = await res.json();
    assert.deepEqual(data, []);
  });
});
