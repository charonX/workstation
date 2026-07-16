// REQ-TRACE: codex-harness-desktop/REQ-FLOW-001, codex-harness-desktop/REQ-FLOW-002, codex-harness-desktop/REQ-FLOW-006, codex-harness-desktop/REQ-FLOW-011, codex-harness-desktop/REQ-FLOW-012, codex-harness-desktop/REQ-FLOW-016, codex-harness-desktop/REQ-FLOW-017
// REQ-VERSION: v1-hash:4b1313dc9c3b59ccfee20bf82bc8fb49d36a5b86a2006abff3f9c33d56cc3035
// CAPABILITY-TRACE: flow-orchestration
// ENTITY-TRACE: flow
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: false

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { startServer, stopServer } from "../../../../../../src/http/server.js";

const CLI = "node src/cli/opc-workstation.js";

describe("Flows", () => {
  let serverCtx;
  let project;

  beforeEach(async () => {
    serverCtx = await startServer();
    project = await (await fetch(`${serverCtx.baseUrl}/api/projects`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Hot News", localPath: "~/opc-workspace/hot-news" })
    })).json();
  });

  afterEach(async () => {
    await stopServer(serverCtx);
  });

  it("REQ-FLOW-001: lists flows with project, node count and schedule status", async () => {
    await fetch(`${serverCtx.baseUrl}/api/flows`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Fetch", projectId: project.id })
    });
    const res = await fetch(`${serverCtx.baseUrl}/api/flows`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(data.length >= 1);
    const flow = data.find(f => f.name === "Fetch");
    assert.equal(flow.projectId, project.id);
    assert.ok(typeof flow.nodeCount === "number");
    assert.ok(typeof flow.scheduleEnabled === "boolean");
  });

  it("REQ-FLOW-002: creates a new flow", async () => {
    const res = await fetch(`${serverCtx.baseUrl}/api/flows`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Fetch", projectId: project.id })
    });
    assert.equal(res.status, 201);
    const data = await res.json();
    assert.equal(data.name, "Fetch");
    assert.deepEqual(data.nodes, []);
    assert.equal(data.scheduleEnabled, false);
  });

  it("REQ-FLOW-002: rejects flow without name or project", async () => {
    const res = await fetch(`${serverCtx.baseUrl}/api/flows`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Fetch" })
    });
    assert.equal(res.status, 400);
  });

  it("REQ-FLOW-006: exports flow as JSON", async () => {
    const flow = await (await fetch(`${serverCtx.baseUrl}/api/flows`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Fetch", projectId: project.id })
    })).json();
    const res = await fetch(`${serverCtx.baseUrl}/api/flows/${flow.id}/export`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.id, flow.id);
    assert.ok(Array.isArray(data.nodes));
    assert.ok(Array.isArray(data.edges));
  });

  it("REQ-FLOW-006: imports flow from JSON", async () => {
    const flowJson = JSON.stringify({
      name: "Imported",
      projectId: project.id,
      nodes: [{ id: "n1", type: "Agent" }],
      edges: []
    });
    const res = await fetch(`${serverCtx.baseUrl}/api/flows/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: flowJson
    });
    assert.equal(res.status, 201);
    const data = await res.json();
    assert.equal(data.name, "Imported");
    assert.equal(data.nodes.length, 1);
  });

  it("REQ-FLOW-011: logically deletes a flow", async () => {
    const flow = await (await fetch(`${serverCtx.baseUrl}/api/flows`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "To Delete", projectId: project.id })
    })).json();

    const delRes = await fetch(`${serverCtx.baseUrl}/api/flows/${flow.id}`, { method: "DELETE" });
    assert.equal(delRes.status, 204);

    const getRes = await fetch(`${serverCtx.baseUrl}/api/flows/${flow.id}`);
    assert.equal(getRes.status, 404);

    const listRes = await fetch(`${serverCtx.baseUrl}/api/flows`);
    const list = await listRes.json();
    assert.ok(!list.some(f => f.id === flow.id));
  });

  it("REQ-FLOW-011: keeps deleted flow records in database", async () => {
    const flow = await (await fetch(`${serverCtx.baseUrl}/api/flows`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Soft Deleted", projectId: project.id })
    })).json();

    await fetch(`${serverCtx.baseUrl}/api/flows/${flow.id}`, { method: "DELETE" });

    const { getDb } = await import("../../../../../../src/db.js");
    const db = getDb();
    const row = db.prepare("SELECT * FROM flows WHERE id = ?").get(flow.id);
    assert.ok(row, "flow row should still exist in database");
    assert.ok(row.deletedAt, "deletedAt should be set");
  });

  it("REQ-FLOW-011: returns 404 when deleting non-existent flow", async () => {
    const res = await fetch(`${serverCtx.baseUrl}/api/flows/non-existent`, { method: "DELETE" });
    assert.equal(res.status, 404);
  });

  it("REQ-FLOW-012: updates flow nodes and edges", async () => {
    const flow = await (await fetch(`${serverCtx.baseUrl}/api/flows`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Connectable", projectId: project.id })
    })).json();

    const patchRes = await fetch(`${serverCtx.baseUrl}/api/flows/${flow.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nodeList: [
          { id: "n1", type: "agent", name: "A", position: { x: 0, y: 0 } },
          { id: "n2", type: "agent", name: "B", position: { x: 200, y: 0 } }
        ],
        edges: [{ id: "e1", sourceNodeId: "n1", targetNodeId: "n2" }]
      })
    });
    assert.equal(patchRes.status, 200);
    const updated = await patchRes.json();
    assert.equal(updated.nodeList.length, 2);
    assert.equal(updated.edges.length, 1);
    assert.equal(updated.edges[0].sourceNodeId, "n1");
    assert.equal(updated.edges[0].targetNodeId, "n2");

    const getRes = await fetch(`${serverCtx.baseUrl}/api/flows/${flow.id}`);
    assert.equal(getRes.status, 200);
    const data = await getRes.json();
    assert.equal(data.edges.length, 1);
  });

  it("REQ-FLOW-001: CLI lists flows", () => {
    execSync(`${CLI} flow create --name Fetch --project-id ${project.id}`, { encoding: "utf-8" });
    const out = execSync(`${CLI} flow list`, { encoding: "utf-8" });
    const data = JSON.parse(out);
    assert.ok(data.some(f => f.name === "Fetch"));
  });

  it("REQ-FLOW-002: CLI creates a flow", () => {
    const out = execSync(`${CLI} flow create --name Fetch --project-id ${project.id}`, { encoding: "utf-8" });
    const data = JSON.parse(out);
    assert.equal(data.name, "Fetch");
    assert.equal(data.scheduleEnabled, false);
  });

  it("REQ-FLOW-011: CLI deletes a flow", () => {
    const out = execSync(`${CLI} flow create --name CLI-Delete --project-id ${project.id}`, { encoding: "utf-8" });
    const flow = JSON.parse(out);
    execSync(`${CLI} flow delete --id ${flow.id}`, { encoding: "utf-8" });
    const listOut = execSync(`${CLI} flow list`, { encoding: "utf-8" });
    const list = JSON.parse(listOut);
    assert.ok(!list.some(f => f.id === flow.id));
  });

  it("REQ-FLOW-016: new flow defaults to draft status", async () => {
    const res = await fetch(`${serverCtx.baseUrl}/api/flows`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Draft Flow", projectId: project.id })
    });
    assert.equal(res.status, 201);
    const data = await res.json();
    assert.equal(data.status, "draft");
  });

  it("REQ-FLOW-016: publishing a flow saves a snapshot and updates status", async () => {
    const flow = await (await fetch(`${serverCtx.baseUrl}/api/flows`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Publish Flow", projectId: project.id })
    })).json();

    const patchRes = await fetch(`${serverCtx.baseUrl}/api/flows/${flow.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nodeList: [{ id: "n1", type: "agent", name: "A", position: { x: 0, y: 0 } }],
        edges: [],
        status: "published"
      })
    });
    assert.equal(patchRes.status, 200);
    const published = await patchRes.json();
    assert.equal(published.status, "published");
    assert.ok(published.publishedAt);
    assert.equal(published.publishedNodeList.length, 1);
    assert.equal(published.publishedNodeList[0].id, "n1");
    assert.deepEqual(published.publishedEdges, []);
  });

  it("REQ-FLOW-016: editing draft does not affect published snapshot", async () => {
    const flow = await (await fetch(`${serverCtx.baseUrl}/api/flows`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Snapshot Flow", projectId: project.id })
    })).json();

    await fetch(`${serverCtx.baseUrl}/api/flows/${flow.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nodeList: [{ id: "n1", type: "agent", name: "A", position: { x: 0, y: 0 } }],
        edges: [],
        status: "published"
      })
    });

    const editRes = await fetch(`${serverCtx.baseUrl}/api/flows/${flow.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nodeList: [
          { id: "n1", type: "agent", name: "A", position: { x: 0, y: 0 } },
          { id: "n2", type: "agent", name: "B", position: { x: 200, y: 0 } }
        ],
        edges: [{ id: "e1", sourceNodeId: "n1", targetNodeId: "n2" }]
      })
    });
    assert.equal(editRes.status, 200);
    const edited = await editRes.json();
    assert.equal(edited.status, "draft");
    assert.equal(edited.nodeList.length, 2);
    assert.equal(edited.publishedNodeList.length, 1);
    assert.equal(edited.publishedEdges.length, 0);
  });

  it("REQ-FLOW-017: debug endpoint runs flow without creating an execution", async () => {
    const flow = await (await fetch(`${serverCtx.baseUrl}/api/flows`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Debug Flow",
        projectId: project.id,
        nodes: [{ id: "n1", type: "agent", name: "Echo", config: { model: "mock", systemPrompt: "hi" }, position: { x: 0, y: 0 } }],
        edges: []
      })
    })).json();

    const before = await (await fetch(`${serverCtx.baseUrl}/api/executions`)).json();

    const debugRes = await fetch(`${serverCtx.baseUrl}/api/flows/${flow.id}/debug`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ variables: { name: "world" } })
    });
    assert.equal(debugRes.status, 200);
    const result = await debugRes.json();
    assert.equal(result.status, "success");
    assert.ok(result.output !== undefined && result.output !== null);
    assert.ok(result.nodesRun > 0);
    assert.ok(Array.isArray(result.logs));

    const after = await (await fetch(`${serverCtx.baseUrl}/api/executions`)).json();
    assert.equal(after.length, before.length);
  });
});
