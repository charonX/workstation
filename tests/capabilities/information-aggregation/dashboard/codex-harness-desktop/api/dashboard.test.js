// REQ-TRACE: codex-harness-desktop/REQ-DASH-001
// REQ-VERSION: v1-hash:762b9b7ff4d4891a26d57bdd0dd7ead507d8e0b23271665ae1ff317e3cfa9493
// CAPABILITY-TRACE: information-aggregation
// ENTITY-TRACE: dashboard
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: false

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { startServer, stopServer } from "../../../../../../src/http/server.js";

const CLI = "node src/cli/opc-workstation.js";

describe("Dashboard", () => {
  let serverCtx;

  beforeEach(async () => {
    serverCtx = await startServer();
  });

  afterEach(async () => {
    await stopServer(serverCtx);
  });

  it("REQ-DASH-001: exposes key metric cards", async () => {
    const res = await fetch(`${serverCtx.baseUrl}/api/dashboard`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(typeof data.projectCount === "number");
    assert.ok(typeof data.activeScheduleCount === "number");
    assert.ok(typeof data.recentRunCount === "number");
    assert.ok(typeof data.successRate === "number");
  });

  it("REQ-DASH-001: lists recent executions with flow, project, status and time", async () => {
    const res = await fetch(`${serverCtx.baseUrl}/api/dashboard`);
    const data = await res.json();
    assert.ok(Array.isArray(data.recentExecutions));
    for (const e of data.recentExecutions) {
      assert.ok("flowName" in e);
      assert.ok("projectName" in e);
      assert.ok("status" in e);
      assert.ok("time" in e);
    }
  });

  it("REQ-DASH-001: provides quick project links", async () => {
    const res = await fetch(`${serverCtx.baseUrl}/api/dashboard`);
    const data = await res.json();
    assert.ok(Array.isArray(data.quickProjectLinks));
  });

  it("REQ-DASH-001: CLI returns dashboard stats", () => {
    const out = execSync(`${CLI} dashboard`, { encoding: "utf-8" });
    const data = JSON.parse(out);
    assert.ok(typeof data.projectCount === "number");
  });
});
