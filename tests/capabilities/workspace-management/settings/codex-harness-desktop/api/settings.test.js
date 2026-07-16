// REQ-TRACE: codex-harness-desktop/REQ-WORKSPACE-001, codex-harness-desktop/REQ-WORKSPACE-002, codex-harness-desktop/REQ-WORKSPACE-007
// REQ-VERSION: v1-hash:5d0bdb3d2786189d093861e7afc37e0431ca15d5e7ae871afd42b421bf45f108
// CAPABILITY-TRACE: workspace-management
// ENTITY-TRACE: settings
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: false

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { startServer, stopServer } from "../../../../../../src/http/server.js";

const CLI = "node src/cli/opc-workstation.js";

describe("Settings", () => {
  let serverCtx;

  beforeEach(async () => {
    serverCtx = await startServer();
  });

  afterEach(async () => {
    await stopServer(serverCtx);
  });

  it("REQ-WORKSPACE-001: persists workspace root directory", async () => {
    const res = await fetch(`${serverCtx.baseUrl}/api/settings`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceRoot: "~/opc-workspace" })
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.workspaceRoot, "~/opc-workspace");
  });

  it("REQ-WORKSPACE-001: rejects empty workspace root", async () => {
    const res = await fetch(`${serverCtx.baseUrl}/api/settings`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceRoot: "" })
    });
    assert.equal(res.status, 400);
  });

  it("REQ-WORKSPACE-002: persists skill repository path", async () => {
    const res = await fetch(`${serverCtx.baseUrl}/api/settings`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ skillRepoPath: "~/.opc-skills" })
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.skillRepoPath, "~/.opc-skills");
  });

  it("REQ-WORKSPACE-007: density has a default value", async () => {
    const res = await fetch(`${serverCtx.baseUrl}/api/settings`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.density, "comfortable");
  });

  it("REQ-WORKSPACE-007: persists density preference", async () => {
    const res = await fetch(`${serverCtx.baseUrl}/api/settings`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ density: "compact" })
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.density, "compact");
  });

  it("REQ-WORKSPACE-001: CLI settings set workspace root", () => {
    const out = execSync(`${CLI} settings set --workspace-root ~/opc-workspace`, { encoding: "utf-8" });
    const data = JSON.parse(out);
    assert.equal(data.workspaceRoot, "~/opc-workspace");
  });

  it("REQ-WORKSPACE-001: CLI rejects empty workspace root", () => {
    assert.throws(() => execSync(`${CLI} settings set --workspace-root ""`, { encoding: "utf-8" }), /error/i);
  });
});
