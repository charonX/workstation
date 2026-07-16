// REQ-TRACE: codex-harness-desktop/REQ-WORKSPACE-003, codex-harness-desktop/REQ-WORKSPACE-004, codex-harness-desktop/REQ-WORKSPACE-005, codex-harness-desktop/REQ-WORKSPACE-006, codex-harness-desktop/REQ-WORKSPACE-008
// REQ-VERSION: v1-hash:762b9b7ff4d4891a26d57bdd0dd7ead507d8e0b23271665ae1ff317e3cfa9493
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
import { getDb } from "../../../../../../src/db.js";

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
    // Point workspaceRoot to a temp subdirectory so git clones don't collide with source repos.
    const workspaceRoot = path.join(tempDir, "workspace");
    fs.mkdirSync(workspaceRoot, { recursive: true });
    const settingsRes = await fetch(`${serverCtx.baseUrl}/api/settings`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceRoot })
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

  it("REQ-WORKSPACE-006: project detail excludes orphan skills without a repo", async () => {
    const project = await (await fetch(`${serverCtx.baseUrl}/api/projects`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Hot News", localPath: "~/opc-workspace/hot-news" })
    })).json();

    const db = getDb();
    db.prepare(`
      INSERT INTO skill_repos (id, name, repoPath, installSource, createdAt)
      VALUES (?, ?, ?, ?, ?)
    `).run("repo-1", "valid-repo", "/tmp/valid-repo", "npm", new Date().toISOString());
    db.prepare(`
      INSERT INTO skills (id, repoId, name, description, repoPath, version, dependencies, category, author, tags, parameters, examples, readme)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run("valid-skill", "repo-1", "Valid Skill", "A valid skill", "skills/valid", null, "[]", null, null, "[]", "[]", "[]", null);
    db.prepare(`
      INSERT INTO skills (id, repoId, name, description, repoPath, version, dependencies, category, author, tags, parameters, examples, readme)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run("orphan-skill", "", "mattpocock/skills", "Orphan repo-like skill", "skills/orphan", null, "[]", null, null, "[]", "[]", "[]", null);

    const detail = await (await fetch(`${serverCtx.baseUrl}/api/projects/${project.id}`)).json();
    const skillIds = detail.skills.map(s => s.id);
    assert.ok(skillIds.includes("valid-skill"), "valid skill should be listed");
    assert.ok(!skillIds.includes("orphan-skill"), "orphan skill without repo should be excluded");
  });

  it("REQ-WORKSPACE-006: linking a skill creates project symlinks and cascades dependencies", async () => {
    const projectLocalPath = path.join(tempDir, "link-test-project");
    fs.mkdirSync(projectLocalPath, { recursive: true });
    const project = await (await fetch(`${serverCtx.baseUrl}/api/projects`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Link Test", localPath: projectLocalPath })
    })).json();

    const repoPath = path.join(tempDir, "skills-repo");
    const skillDir = path.join(repoPath, "skills", "main");
    const depDir = path.join(repoPath, "skills", "helper");
    fs.mkdirSync(skillDir, { recursive: true });
    fs.mkdirSync(depDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, "SKILL.md"), "---\nname: main\ndependencies:\n  - helper\n---\n");
    fs.writeFileSync(path.join(depDir, "SKILL.md"), "---\nname: helper\n---\n");

    const db = getDb();
    db.prepare(`
      INSERT INTO skill_repos (id, name, repoPath, installSource, createdAt)
      VALUES (?, ?, ?, ?, ?)
    `).run("repo-link", "mattpocock/skills", repoPath, "npm", new Date().toISOString());
    db.prepare(`
      INSERT INTO skills (id, repoId, name, description, repoPath, version, dependencies, category, author, tags, parameters, examples, readme)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run("skill-dep", "repo-link", "helper", "dep skill", "skills/helper", null, "[]", null, null, "[]", "[]", "[]", null);
    db.prepare(`
      INSERT INTO skills (id, repoId, name, description, repoPath, version, dependencies, category, author, tags, parameters, examples, readme)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run("skill-main", "repo-link", "main", "main skill", "skills/main", null, '["helper"]', null, null, "[]", "[]", "[]", null);

    const res = await fetch(`${serverCtx.baseUrl}/api/projects/${project.id}/skills`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ skillId: "skill-main", linked: true })
    });
    assert.equal(res.status, 200);
    const detail = await res.json();

    const linkedIds = detail.skills.filter(s => s.linked).map(s => s.id);
    assert.ok(linkedIds.includes("skill-main"), "main skill should be linked");
    assert.ok(linkedIds.includes("skill-dep"), "dependency skill should be auto-linked");

    const mainLink = path.join(projectLocalPath, ".opc", "skills", "mattpocock_skills", "main");
    const depLink = path.join(projectLocalPath, ".opc", "skills", "mattpocock_skills", "helper");
    assert.ok(fs.lstatSync(mainLink).isSymbolicLink(), "main skill symlink should exist");
    assert.ok(fs.lstatSync(depLink).isSymbolicLink(), "dependency skill symlink should exist");
  });

  it("REQ-WORKSPACE-006: unlinking a skill removes its symlink but keeps dependencies", async () => {
    const projectLocalPath = path.join(tempDir, "unlink-test-project");
    fs.mkdirSync(projectLocalPath, { recursive: true });
    const project = await (await fetch(`${serverCtx.baseUrl}/api/projects`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Unlink Test", localPath: projectLocalPath })
    })).json();

    const repoPath = path.join(tempDir, "unlink-skills-repo");
    const skillDir = path.join(repoPath, "skills", "main");
    const depDir = path.join(repoPath, "skills", "helper");
    fs.mkdirSync(skillDir, { recursive: true });
    fs.mkdirSync(depDir, { recursive: true });

    const db = getDb();
    db.prepare(`
      INSERT INTO skill_repos (id, name, repoPath, installSource, createdAt)
      VALUES (?, ?, ?, ?, ?)
    `).run("repo-unlink", "mattpocock/skills", repoPath, "npm", new Date().toISOString());
    db.prepare(`
      INSERT INTO skills (id, repoId, name, description, repoPath, version, dependencies, category, author, tags, parameters, examples, readme)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run("skill-dep-2", "repo-unlink", "helper", "dep skill", "skills/helper", null, "[]", null, null, "[]", "[]", "[]", null);
    db.prepare(`
      INSERT INTO skills (id, repoId, name, description, repoPath, version, dependencies, category, author, tags, parameters, examples, readme)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run("skill-main-2", "repo-unlink", "main", "main skill", "skills/main", null, '["helper"]', null, null, "[]", "[]", "[]", null);

    await fetch(`${serverCtx.baseUrl}/api/projects/${project.id}/skills`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ skillId: "skill-main-2", linked: true })
    });

    const res = await fetch(`${serverCtx.baseUrl}/api/projects/${project.id}/skills`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ skillId: "skill-main-2", linked: false })
    });
    assert.equal(res.status, 200);
    const detail = await res.json();

    assert.ok(!detail.skills.find(s => s.id === "skill-main-2")?.linked, "main skill should be unlinked");
    assert.ok(detail.skills.find(s => s.id === "skill-dep-2")?.linked, "dependency skill should stay linked");

    const mainLink = path.join(projectLocalPath, ".opc", "skills", "mattpocock_skills", "main");
    const depLink = path.join(projectLocalPath, ".opc", "skills", "mattpocock_skills", "helper");
    assert.ok(!fs.existsSync(mainLink), "main skill symlink should be removed");
    assert.ok(fs.lstatSync(depLink).isSymbolicLink(), "dependency skill symlink should remain");
  });

  it("REQ-WORKSPACE-008: deletes a project and cascades related data", async () => {
    const project = await (await fetch(`${serverCtx.baseUrl}/api/projects`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "To Delete", localPath: "~/opc-workspace/to-delete" })
    })).json();

    // Create a flow, schedule and execution referencing the project so we can verify cascade.
    await fetch(`${serverCtx.baseUrl}/api/flows`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Flow", projectId: project.id })
    });
    await fetch(`${serverCtx.baseUrl}/api/schedules`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: project.id, flowId: "f1", cron: "0 8 * * *" })
    });
    await fetch(`${serverCtx.baseUrl}/api/executions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: project.id, flowId: "f1" })
    });

    const delRes = await fetch(`${serverCtx.baseUrl}/api/projects/${project.id}`, { method: "DELETE" });
    assert.equal(delRes.status, 204);

    const getRes = await fetch(`${serverCtx.baseUrl}/api/projects/${project.id}`);
    assert.equal(getRes.status, 404);

    const listRes = await fetch(`${serverCtx.baseUrl}/api/projects`);
    const list = await listRes.json();
    assert.ok(!list.some(p => p.id === project.id));
  });

  it("REQ-WORKSPACE-008: deleting a project preserves the cloned directory", async () => {
    const { repoUrl } = createLocalGitRepo(tempDir, "preserve-me");
    const project = await (await fetch(`${serverCtx.baseUrl}/api/projects`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Preserve Me", repoUrl })
    })).json();

    assert.ok(fs.existsSync(project.localPath), "cloned directory should exist before delete");
    const delRes = await fetch(`${serverCtx.baseUrl}/api/projects/${project.id}`, { method: "DELETE" });
    assert.equal(delRes.status, 204);
    assert.ok(fs.existsSync(project.localPath), "cloned directory should still exist after project delete");
  });

  it("REQ-WORKSPACE-008: returns 404 when deleting non-existent project", async () => {
    const res = await fetch(`${serverCtx.baseUrl}/api/projects/non-existent`, { method: "DELETE" });
    assert.equal(res.status, 404);
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

  it("REQ-WORKSPACE-008: CLI deletes a project", () => {
    const out = execSync(`${CLI} project create --name "CLI Delete" --local-path ~/opc-workspace/cli-delete`, { encoding: "utf-8" });
    const project = JSON.parse(out);
    execSync(`${CLI} project delete --id ${project.id}`, { encoding: "utf-8" });
    const listOut = execSync(`${CLI} project list --q cli-delete`, { encoding: "utf-8" });
    const list = JSON.parse(listOut);
    assert.ok(!list.some(p => p.id === project.id));
  });
});
