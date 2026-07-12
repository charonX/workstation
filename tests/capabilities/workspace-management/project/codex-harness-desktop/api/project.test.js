// REQ-TRACE: codex-harness-desktop/REQ-WORKSPACE-003, codex-harness-desktop/REQ-WORKSPACE-004, codex-harness-desktop/REQ-WORKSPACE-005, codex-harness-desktop/REQ-WORKSPACE-006
// REQ-VERSION: v1-hash:5f19048eee0e43e5d60e4099f06fa1200a77261163b4bf0a7b64ec44177e0afd
// CAPABILITY-TRACE: workspace-management
// ENTITY-TRACE: project
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: false

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { execSync, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startServer, stopServer } from "../../../../../../src/http/server.js";

const CLI = "node src/cli/opc-workstation.js";

function createLocalGitRepo(baseDir, repoName) {
  const repoPath = path.join(baseDir, repoName);
  fs.mkdirSync(repoPath, { recursive: true });
  execFileSync("git", ["init"], { cwd: repoPath });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: repoPath });
  execFileSync("git", ["config", "user.name", "Test User"], { cwd: repoPath });
  fs.writeFileSync(path.join(repoPath, "README.md"), `# ${repoName}\n`);
  execFileSync("git", ["add", "."], { cwd: repoPath });
  execFileSync("git", ["commit", "-m", "initial"], { cwd: repoPath });
  return { repoPath, repoUrl: `file://${repoPath}/.git` };
}

describe("Projects", () => {
  let serverCtx;
  let tempDir;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opc-project-test-"));
    serverCtx = await startServer();
    // Point workspaceRoot to a temp directory so git clones land there.
    const settingsRes = await fetch(`${serverCtx.baseUrl}/api/settings`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceRoot: tempDir })
    });
    assert.equal(settingsRes.status, 200);
  });

  afterEach(async () => {
    await stopServer(serverCtx);
    fs.rmSync(tempDir, { recursive: true, force: true });
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
    const { repoUrl } = createLocalGitRepo(tempDir, "hot-news");
    const res = await fetch(`${serverCtx.baseUrl}/api/projects`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Hot News", repoUrl })
    });
    assert.equal(res.status, 201);
    const data = await res.json();
    assert.equal(data.sourceType, "git");
    assert.equal(data.branch, "main");
    assert.ok(data.localPath, "localPath should be set");
    assert.ok(fs.existsSync(data.localPath), "cloned directory should exist");
    assert.ok(fs.existsSync(path.join(data.localPath, ".git")), "cloned directory should be a git repo");
    assert.ok(fs.existsSync(path.join(data.localPath, "README.md")), "cloned files should be present");
  });

  it("REQ-WORKSPACE-004: uses repo name when project name is empty", async () => {
    const { repoUrl } = createLocalGitRepo(tempDir, "fallback-repo");
    const res = await fetch(`${serverCtx.baseUrl}/api/projects`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "", repoUrl })
    });
    assert.equal(res.status, 201);
    const data = await res.json();
    assert.equal(data.name, "fallback-repo");
    assert.equal(data.sourceType, "git");
    assert.ok(data.localPath, "localPath should be set");
    assert.ok(fs.existsSync(data.localPath), "cloned directory should exist");
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
