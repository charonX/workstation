// REQ-TRACE: codex-harness-desktop/REQ-FLOW-001, codex-harness-desktop/REQ-FLOW-002, codex-harness-desktop/REQ-FLOW-006
// REQ-VERSION: v1-hash:71624856165d7ccd8e88041a8f92ec3a2c552457e9e514f29ef3eb747ccf1685
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
});
