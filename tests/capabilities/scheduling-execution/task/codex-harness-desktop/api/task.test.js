// REQ-TRACE: codex-harness-desktop/REQ-SCHEDULE-001, codex-harness-desktop/REQ-SCHEDULE-003
// REQ-VERSION: v1-hash:71624856165d7ccd8e88041a8f92ec3a2c552457e9e514f29ef3eb747ccf1685
// CAPABILITY-TRACE: scheduling-execution
// ENTITY-TRACE: task
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: false

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { startServer, stopServer } from "../../../../../../src/http/server.js";

const CLI = "node src/cli/opc-workstation.js";

describe("Tasks and Executions", () => {
  let serverCtx;
  let project;
  let flow;

  beforeEach(async () => {
    serverCtx = await startServer();
    project = await (await fetch(`${serverCtx.baseUrl}/api/projects`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Hot News", localPath: "~/opc-workspace/hot-news" })
    })).json();
    flow = await (await fetch(`${serverCtx.baseUrl}/api/flows`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Fetch", projectId: project.id })
    })).json();
  });

  afterEach(async () => {
    await stopServer(serverCtx);
  });

  it("REQ-SCHEDULE-001: creates a manual task and starts running", async () => {
    const res = await fetch(`${serverCtx.baseUrl}/api/executions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: project.id, flowId: flow.id, trigger: "manual" })
    });
    assert.equal(res.status, 201);
    const data = await res.json();
    assert.equal(data.status, "running");
  });

  it("REQ-SCHEDULE-001: rejects task without project", async () => {
    const res = await fetch(`${serverCtx.baseUrl}/api/executions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ flowId: flow.id })
    });
    assert.equal(res.status, 400);
  });

  it("REQ-SCHEDULE-003: execution history is ordered newest first", async () => {
    await fetch(`${serverCtx.baseUrl}/api/executions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: project.id, flowId: flow.id })
    });
    const res = await fetch(`${serverCtx.baseUrl}/api/executions`);
    assert.equal(res.status, 200);
    const data = await res.json();
    for (let i = 1; i < data.length; i++) {
      assert.ok(new Date(data[i - 1].startedAt) >= new Date(data[i].startedAt));
    }
  });

  it("REQ-SCHEDULE-003: execution detail exposes logs, variables and output tabs", async () => {
    const execution = await (await fetch(`${serverCtx.baseUrl}/api/executions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: project.id, flowId: flow.id })
    })).json();
    const res = await fetch(`${serverCtx.baseUrl}/api/executions/${execution.id}`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(Array.isArray(data.logs));
    assert.ok(typeof data.variables === "object");
    assert.ok(data.output !== undefined);
  });

  it("REQ-SCHEDULE-003: execution records branch path and iteration info", async () => {
    const execution = await (await fetch(`${serverCtx.baseUrl}/api/executions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: project.id, flowId: flow.id })
    })).json();
    const res = await fetch(`${serverCtx.baseUrl}/api/executions/${execution.id}`);
    const data = await res.json();
    assert.ok(Array.isArray(data.branchPath));
    assert.ok(Array.isArray(data.iterations));
  });

  it("REQ-SCHEDULE-001: CLI runs a task", () => {
    const out = execSync(`${CLI} task run --project-id ${project.id} --flow-id ${flow.id}`, { encoding: "utf-8" });
    const data = JSON.parse(out);
    assert.equal(data.status, "running");
  });
});
