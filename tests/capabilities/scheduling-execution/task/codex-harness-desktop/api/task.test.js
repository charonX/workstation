// REQ-TRACE: codex-harness-desktop/REQ-SCHEDULE-001, codex-harness-desktop/REQ-SCHEDULE-003
// REQ-VERSION: v1-hash:53fcb918ad26820e6760c66ac610791ceca2a11a981737c76234a70ea8f36569
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
    const projectOut = execSync(`${CLI} project create --name "CLI Run Project" --local-path "/tmp/cli-run-project"`, { encoding: "utf-8" });
    const cliProject = JSON.parse(projectOut);

    const flowOut = execSync(`${CLI} flow create --name "CLI Run Flow" --project-id ${cliProject.id}`, { encoding: "utf-8" });
    const cliFlow = JSON.parse(flowOut);

    const out = execSync(`${CLI} task run --project-id ${cliProject.id} --flow-id ${cliFlow.id}`, { encoding: "utf-8" });
    const data = JSON.parse(out);
    assert.equal(data.status, "running");
  });

  it("BUG-012: execution runs the flow engine and records real output, logs and nodesRun", async () => {
    // Seed a flow with an agent node so the engine has real work to do.
    const agentFlow = await (await fetch(`${serverCtx.baseUrl}/api/flows`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Agent Echo",
        projectId: project.id,
        nodes: [{ id: "n1", type: "agent", name: "Echo", config: { model: "mock", systemPrompt: "say hi" }, position: { x: 0, y: 0 } }],
        edges: []
      })
    })).json();

    const execution = await (await fetch(`${serverCtx.baseUrl}/api/executions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: project.id, flowId: agentFlow.id, trigger: "manual" })
    })).json();

    assert.equal(execution.status, "running");

    // Poll until the asynchronous engine run completes.
    let detail;
    for (let i = 0; i < 20; i++) {
      detail = await (await fetch(`${serverCtx.baseUrl}/api/executions/${execution.id}`)).json();
      if (detail.status !== "running") break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    assert.equal(detail.status, "success");
    assert.ok(detail.nodesRun > 0, "nodesRun should be greater than 0");
    assert.ok(detail.output !== null && detail.output !== undefined, "output should not be null/undefined");
    assert.ok(Array.isArray(detail.logs) && detail.logs.length > 0, "logs should contain entries");
    assert.ok(detail.duration !== null && detail.duration !== undefined, "duration should be recorded");
  });

  it("BUG-015: execution list and detail include flowName and projectName", async () => {
    await fetch(`${serverCtx.baseUrl}/api/executions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: project.id, flowId: flow.id })
    });

    const listRes = await fetch(`${serverCtx.baseUrl}/api/executions`);
    const list = await listRes.json();
    assert.equal(list[0].flowName, flow.name);
    assert.equal(list[0].projectName, project.name);

    const detailRes = await fetch(`${serverCtx.baseUrl}/api/executions/${list[0].id}`);
    const detail = await detailRes.json();
    assert.equal(detail.flowName, flow.name);
    assert.equal(detail.projectName, project.name);
  });
});
