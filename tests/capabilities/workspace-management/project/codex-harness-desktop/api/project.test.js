// REQ-TRACE: codex-harness-desktop/REQ-WORKSPACE-003, codex-harness-desktop/REQ-WORKSPACE-004, codex-harness-desktop/REQ-WORKSPACE-005, codex-harness-desktop/REQ-WORKSPACE-006
// REQ-VERSION: v1-hash:71624856165d7ccd8e88041a8f92ec3a2c552457e9e514f29ef3eb747ccf1685
// CAPABILITY-TRACE: workspace-management
// ENTITY-TRACE: project
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: false

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { startServer, stopServer } from "../../../../../../src/http/server.js";

const CLI = "node src/cli/opc-workstation.js";

describe("Projects", () => {
  let serverCtx;

  beforeEach(async () => {
    serverCtx = await startServer();
  });

  afterEach(async () => {
    await stopServer(serverCtx);
  });

  it("REQ-WORKSPACE-003: creates a local project", async () => {
    const res = await fetch(`${serverCtx.baseUrl}/api/projects`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Hot News", localPath: "~/opc-workspace/hot-news" })
    });
    assert.equal(res.status, 201);
    const data = await res.json();
    assert.equal(data.name, "Hot News");
    assert.equal(data.sourceType, "local");
  });

  it("REQ-WORKSPACE-003: rejects local project without name", async () => {
    const res = await fetch(`${serverCtx.baseUrl}/api/projects`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ localPath: "~/opc-workspace/hot-news" })
    });
    assert.equal(res.status, 400);
  });

  it("REQ-WORKSPACE-004: creates a project from git checkout", async () => {
    const res = await fetch(`${serverCtx.baseUrl}/api/projects`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Hot News", repoUrl: "https://github.com/example/hot-news.git" })
    });
    assert.equal(res.status, 201);
    const data = await res.json();
    assert.equal(data.sourceType, "git");
    assert.equal(data.branch, "main");
  });

  it("REQ-WORKSPACE-004: rejects git project without repository URL", async () => {
    const res = await fetch(`${serverCtx.baseUrl}/api/projects`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Hot News", sourceType: "git" })
    });
    assert.equal(res.status, 400);
  });

  it("REQ-WORKSPACE-005: filters projects by name case-insensitively", async () => {
    await fetch(`${serverCtx.baseUrl}/api/projects`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Hot News", localPath: "~/opc-workspace/hot-news" })
    });
    const res = await fetch(`${serverCtx.baseUrl}/api/projects?q=hot`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.length, 1);
    assert.equal(data[0].name, "Hot News");
  });

  it("REQ-WORKSPACE-005: returns all projects when filter is empty", async () => {
    await fetch(`${serverCtx.baseUrl}/api/projects`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Hot News", localPath: "~/opc-workspace/hot-news" })
    });
    const res = await fetch(`${serverCtx.baseUrl}/api/projects`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(data.length >= 1);
  });

  it("REQ-WORKSPACE-006: project detail exposes overview metadata", async () => {
    const created = await (await fetch(`${serverCtx.baseUrl}/api/projects`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Hot News", localPath: "~/opc-workspace/hot-news" })
    })).json();
    const res = await fetch(`${serverCtx.baseUrl}/api/projects/${created.id}`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.overview.name, "Hot News");
    assert.ok(typeof data.overview.flowsCount === "number");
    assert.ok(typeof data.overview.runsCount === "number");
  });

  it("REQ-WORKSPACE-006: toggling skill association is idempotent", async () => {
    const project = await (await fetch(`${serverCtx.baseUrl}/api/projects`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Hot News", localPath: "~/opc-workspace/hot-news" })
    })).json();
    await fetch(`${serverCtx.baseUrl}/api/projects/${project.id}/skills`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ skillId: "s1", linked: true })
    });
    await fetch(`${serverCtx.baseUrl}/api/projects/${project.id}/skills`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ skillId: "s1", linked: true })
    });
    const detail = await (await fetch(`${serverCtx.baseUrl}/api/projects/${project.id}`)).json();
    assert.equal(detail.skills.filter(s => s.id === "s1" && s.linked).length, 1);
  });

  it("REQ-WORKSPACE-003: CLI creates a local project", () => {
    const out = execSync(`${CLI} project create --name "Hot News" --local-path ~/opc-workspace/hot-news`, { encoding: "utf-8" });
    const data = JSON.parse(out);
    assert.equal(data.name, "Hot News");
    assert.equal(data.sourceType, "local");
  });

  it("REQ-WORKSPACE-005: CLI lists and filters projects", () => {
    execSync(`${CLI} project create --name "Hot News" --local-path ~/opc-workspace/hot-news`, { encoding: "utf-8" });
    const out = execSync(`${CLI} project list --q hot`, { encoding: "utf-8" });
    const data = JSON.parse(out);
    assert.ok(data.some(p => p.name === "Hot News"));
  });
});
