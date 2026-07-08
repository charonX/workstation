// REQ-TRACE: codex-harness-desktop/REQ-SCHEDULE-002
// REQ-VERSION: v1-hash:71624856165d7ccd8e88041a8f92ec3a2c552457e9e514f29ef3eb747ccf1685
// CAPABILITY-TRACE: scheduling-execution
// ENTITY-TRACE: schedule
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: false

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { startServer, stopServer } from "../../../../../../src/http/server.js";

const CLI = "node src/cli/opc-workstation.js";

describe("Schedules", () => {
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

  it("REQ-SCHEDULE-002: creates a schedule", async () => {
    const res = await fetch(`${serverCtx.baseUrl}/api/schedules`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: project.id, flowId: flow.id, cron: "0 8 * * *" })
    });
    assert.equal(res.status, 201);
    const data = await res.json();
    assert.equal(data.cron, "0 8 * * *");
    assert.equal(data.enabled, true);
  });

  it("REQ-SCHEDULE-002: rejects schedule without cron", async () => {
    const res = await fetch(`${serverCtx.baseUrl}/api/schedules`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: project.id, flowId: flow.id })
    });
    assert.equal(res.status, 400);
  });

  it("REQ-SCHEDULE-002: toggles schedule enabled state", async () => {
    const schedule = await (await fetch(`${serverCtx.baseUrl}/api/schedules`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: project.id, flowId: flow.id, cron: "0 8 * * *" })
    })).json();
    const res = await fetch(`${serverCtx.baseUrl}/api/schedules/${schedule.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: false })
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.enabled, false);
  });

  it("REQ-SCHEDULE-002: schedule list shows project, cron and enabled state", async () => {
    await fetch(`${serverCtx.baseUrl}/api/schedules`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: project.id, flowId: flow.id, cron: "0 8 * * *" })
    });
    const res = await fetch(`${serverCtx.baseUrl}/api/schedules`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.length, 1);
    assert.equal(data[0].projectId, project.id);
    assert.equal(data[0].cron, "0 8 * * *");
    assert.equal(data[0].enabled, true);
  });

  it("REQ-SCHEDULE-002: CLI creates and toggles schedule", () => {
    const out = execSync(`${CLI} schedule create --project-id ${project.id} --flow-id ${flow.id} --cron "0 8 * * *"`, { encoding: "utf-8" });
    const data = JSON.parse(out);
    assert.equal(data.enabled, true);
    const toggled = JSON.parse(execSync(`${CLI} schedule toggle --id ${data.id}`, { encoding: "utf-8" }));
    assert.equal(toggled.enabled, false);
  });
});
