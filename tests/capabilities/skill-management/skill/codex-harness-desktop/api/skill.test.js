// REQ-TRACE: codex-harness-desktop/REQ-SKILL-001, codex-harness-desktop/REQ-SKILL-002, codex-harness-desktop/REQ-SKILL-003, codex-harness-desktop/REQ-SKILL-004
// REQ-VERSION: v1-hash:5d0bdb3d2786189d093861e7afc37e0431ca15d5e7ae871afd42b421bf45f108
// CAPABILITY-TRACE: skill-management
// ENTITY-TRACE: skill-repo, skill
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: false

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startServer, stopServer } from "../../../../../../src/http/server.js";

const CLI = "node src/cli/opc-workstation.js";
const NPM_SKILL_FIXTURE = path.resolve("tests/fixtures/npm-skill");

describe("Skills", () => {
  let serverCtx;

  beforeEach(async () => {
    serverCtx = await startServer();
  });

  afterEach(async () => {
    await stopServer(serverCtx);
  });

  async function setSkillRepoPath(baseUrl, skillRepoPath) {
    const res = await fetch(`${baseUrl}/api/settings`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ skillRepoPath })
    });
    assert.equal(res.status, 200);
  }

  function makeTempSkillRepoPath() {
    return path.join(os.tmpdir(), `opc-skill-repo-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
  }

  async function startInstallJob(baseUrl, body) {
    const res = await fetch(`${baseUrl}/api/skills/install`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    assert.equal(res.status, 202);
    const data = await res.json();
    assert.ok(data.jobId, "install endpoint must return a jobId");
    return data.jobId;
  }

  async function consumeInstallStream(baseUrl, jobId) {
    const res = await fetch(`${baseUrl}/api/skills/install/${jobId}/stream`);
    assert.equal(res.status, 200);
    assert.ok(
      (res.headers.get("content-type") || "").includes("text/event-stream"),
      "stream must have text/event-stream content type"
    );

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    const logs = [];
    let final = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop();
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const event = JSON.parse(line.slice(6));
        if (event.type === "log") {
          logs.push(event.text);
        } else if (event.type === "success") {
          final = { status: "success", repo: event.repo, skills: event.skills };
        } else if (event.type === "error") {
          final = { status: "error", message: event.message };
        }
      }
    }

    return { logs, final };
  }

  async function installAndAssert(baseUrl, body) {
    const jobId = await startInstallJob(baseUrl, body);
    return consumeInstallStream(baseUrl, jobId);
  }

  it("REQ-SKILL-001: lists skill repos grouped with nested skills and no linked projects column", async () => {
    const skillRepoPath = makeTempSkillRepoPath();
    fs.mkdirSync(skillRepoPath, { recursive: true });
    await setSkillRepoPath(serverCtx.baseUrl, skillRepoPath);

    await installAndAssert(serverCtx.baseUrl, { source: "npm", identifier: NPM_SKILL_FIXTURE });

    const res = await fetch(`${serverCtx.baseUrl}/api/skill-repos`);
    assert.equal(res.status, 200);
    const groups = await res.json();
    assert.equal(groups.length, 1);
    const [group] = groups;
    assert.ok(group.repo.id);
    assert.equal(group.repo.installSource, "npm");
    assert.equal(group.skills.length, 2);
    const paths = group.skills.map(s => s.repoPath).sort();
    assert.deepEqual(paths, ["skills/npm-fixture-skill", "skills/utils/helper"]);
    for (const skill of group.skills) {
      assert.equal(skill.linkedProjects, undefined);
    }
  });

  it("REQ-SKILL-002: skill detail exposes overview metadata and repoId", async () => {
    const skillRepoPath = makeTempSkillRepoPath();
    fs.mkdirSync(skillRepoPath, { recursive: true });
    await setSkillRepoPath(serverCtx.baseUrl, skillRepoPath);

    const { final } = await installAndAssert(serverCtx.baseUrl, { source: "npm", identifier: NPM_SKILL_FIXTURE });
    const skill = final.skills.find(s => s.repoPath === "skills/npm-fixture-skill");

    const res = await fetch(`${serverCtx.baseUrl}/api/skills/${skill.id}`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.name, "npm-fixture-skill");
    assert.deepEqual(data.tabs, ["Overview", "Parameters", "Examples", "README"]);
    assert.equal(data.repoId, final.repo.id);
    assert.equal(data.canLinkProjects, undefined);
    assert.equal(data.version, "1.0.0");
    assert.equal(data.author, "Test Author");
    assert.equal(data.category, "Test");
    assert.deepEqual(data.tags, ["test", "fixture"]);
  });

  it("REQ-SKILL-003: npm install runs a real command, streams logs and records repoPath under skillRepoPath", async () => {
    const skillRepoPath = makeTempSkillRepoPath();
    fs.mkdirSync(skillRepoPath, { recursive: true });
    await setSkillRepoPath(serverCtx.baseUrl, skillRepoPath);

    const { logs, final } = await installAndAssert(serverCtx.baseUrl, { source: "npm", identifier: NPM_SKILL_FIXTURE });

    assert.ok(logs.length > 0, "npm install should produce command logs");
    assert.equal(final.status, "success");
    assert.equal(final.repo.installSource, "npm");
    assert.ok(final.repo.repoPath.startsWith(skillRepoPath), `repoPath ${final.repo.repoPath} should be under ${skillRepoPath}`);
    assert.ok(fs.existsSync(path.join(final.repo.repoPath, "skills", "npm-fixture-skill", "SKILL.md")), "installed repo should contain skills/.../SKILL.md");
    assert.equal(final.skills.length, 2);
    for (const skill of final.skills) {
      assert.ok(skill.repoPath.startsWith("skills/"), `skill repoPath ${skill.repoPath} should be relative under skills/`);
    }
  });

  it("REQ-SKILL-003: plugin install records repoPath under skillRepoPath", async () => {
    const skillRepoPath = makeTempSkillRepoPath();
    fs.mkdirSync(skillRepoPath, { recursive: true });
    await setSkillRepoPath(serverCtx.baseUrl, skillRepoPath);

    const { logs, final } = await installAndAssert(serverCtx.baseUrl, { source: "plugin", identifier: "claude-plugin-id" });

    assert.ok(logs.length > 0, "plugin install should produce logs");
    assert.equal(final.status, "success");
    assert.equal(final.repo.installSource, "plugin");
    assert.ok(final.repo.repoPath.startsWith(skillRepoPath), `repoPath ${final.repo.repoPath} should be under ${skillRepoPath}`);
    assert.ok(fs.existsSync(path.join(final.repo.repoPath, "skills", "claude-plugin-id", "SKILL.md")), "plugin directory should contain skills/.../SKILL.md");
    assert.equal(final.skills.length, 1);
  });

  it("REQ-SKILL-003: rejects local install source", async () => {
    const skillRepoPath = makeTempSkillRepoPath();
    fs.mkdirSync(skillRepoPath, { recursive: true });
    await setSkillRepoPath(serverCtx.baseUrl, skillRepoPath);

    const res = await fetch(`${serverCtx.baseUrl}/api/skills/install`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source: "local", identifier: "/tmp/some-skill" })
    });
    assert.equal(res.status, 400);
  });

  it("REQ-SKILL-003: rejects install when skillRepoPath is not configured", async () => {
    await setSkillRepoPath(serverCtx.baseUrl, "");
    const res = await fetch(`${serverCtx.baseUrl}/api/skills/install`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source: "npm", identifier: NPM_SKILL_FIXTURE })
    });
    assert.equal(res.status, 400);
  });

  it("REQ-SKILL-003: failed npm install streams error logs and does not create repo or skill records", async () => {
    const skillRepoPath = makeTempSkillRepoPath();
    fs.mkdirSync(skillRepoPath, { recursive: true });
    await setSkillRepoPath(serverCtx.baseUrl, skillRepoPath);

    const bogusPath = path.join(os.tmpdir(), `opc-bogus-skill-${Date.now()}`);
    const { logs, final } = await installAndAssert(serverCtx.baseUrl, { source: "npm", identifier: bogusPath });

    assert.ok(logs.length > 0, "failed install should still stream command logs");
    assert.equal(final.status, "error");

    const listRes = await fetch(`${serverCtx.baseUrl}/api/skill-repos`);
    const groups = await listRes.json();
    assert.equal(groups.length, 0);
  });

  it("REQ-SKILL-004: deletes a skill repo and cascades skills and project links", async () => {
    const skillRepoPath = makeTempSkillRepoPath();
    fs.mkdirSync(skillRepoPath, { recursive: true });
    await setSkillRepoPath(serverCtx.baseUrl, skillRepoPath);

    const { final } = await installAndAssert(serverCtx.baseUrl, { source: "npm", identifier: NPM_SKILL_FIXTURE });
    const repoId = final.repo.id;
    const skillId = final.skills[0].id;

    const project = await (await fetch(`${serverCtx.baseUrl}/api/projects`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Project", localPath: "~/opc-workspace/project" })
    })).json();

    await fetch(`${serverCtx.baseUrl}/api/projects/${project.id}/skills`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ skillId, linked: true })
    });

    const delRes = await fetch(`${serverCtx.baseUrl}/api/skill-repos/${repoId}`, { method: "DELETE" });
    assert.equal(delRes.status, 204);

    assert.ok(!fs.existsSync(final.repo.repoPath), "repo directory should be removed");

    const getRes = await fetch(`${serverCtx.baseUrl}/api/skills/${skillId}`);
    assert.equal(getRes.status, 404);

    const listRes = await fetch(`${serverCtx.baseUrl}/api/skill-repos`);
    const groups = await listRes.json();
    assert.equal(groups.length, 0);
  });

  it("REQ-SKILL-004: deleting a skill repo removes project symlinks", async () => {
    const skillRepoPath = makeTempSkillRepoPath();
    fs.mkdirSync(skillRepoPath, { recursive: true });
    await setSkillRepoPath(serverCtx.baseUrl, skillRepoPath);

    const { final } = await installAndAssert(serverCtx.baseUrl, { source: "npm", identifier: NPM_SKILL_FIXTURE });
    const repoId = final.repo.id;
    const skill = final.skills.find((s) => s.name === "npm-fixture-skill");

    const projectLocalPath = path.join(os.tmpdir(), `opc-symlink-project-${Date.now()}`);
    fs.mkdirSync(projectLocalPath, { recursive: true });
    const project = await (await fetch(`${serverCtx.baseUrl}/api/projects`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Symlink Project", localPath: projectLocalPath })
    })).json();

    const linkRes = await fetch(`${serverCtx.baseUrl}/api/projects/${project.id}/skills`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ skillId: skill.id, linked: true })
    });
    assert.equal(linkRes.status, 200);

    const repoDirName = final.repo.name.replace(/[^a-zA-Z0-9_-]/g, "_");
    const skillDirName = skill.name.replace(/[^a-zA-Z0-9_-]/g, "_");
    const symlinkPath = path.join(projectLocalPath, ".opc", "skills", repoDirName, skillDirName);
    assert.ok(fs.lstatSync(symlinkPath).isSymbolicLink(), "project skill symlink should exist before repo delete");

    const delRes = await fetch(`${serverCtx.baseUrl}/api/skill-repos/${repoId}`, { method: "DELETE" });
    assert.equal(delRes.status, 204);

    assert.ok(!fs.existsSync(symlinkPath), "project skill symlink should be removed after repo delete");
  });

  it("REQ-SKILL-004: returns 404 when deleting non-existent repo", async () => {
    const res = await fetch(`${serverCtx.baseUrl}/api/skill-repos/non-existent`, { method: "DELETE" });
    assert.equal(res.status, 404);
  });

  it("REQ-SKILL-003: CLI installs skill repo from npm and prints logs", () => {
    const skillRepoPath = makeTempSkillRepoPath();
    fs.mkdirSync(skillRepoPath, { recursive: true });
    execSync(`${CLI} settings set --skill-repo-path ${skillRepoPath}`);

    const out = execSync(`${CLI} skill install --source npm --identifier ${NPM_SKILL_FIXTURE}`, { encoding: "utf-8" });
    const data = JSON.parse(out);
    assert.equal(data.repo.installSource, "npm");
    assert.ok(Array.isArray(data.skills) && data.skills.length === 2, "CLI should return two skills");
    assert.ok(Array.isArray(data.logs) && data.logs.length > 0, "CLI should return command logs");
    assert.ok(data.repo.repoPath.startsWith(skillRepoPath), `repoPath ${data.repo.repoPath} should be under ${skillRepoPath}`);
  });

  it("REQ-SKILL-004: CLI deletes a skill repo", () => {
    const out = execSync(`${CLI} skill install --source npm --identifier ${NPM_SKILL_FIXTURE}`, { encoding: "utf-8" });
    const { repo } = JSON.parse(out);
    execSync(`${CLI} skill repo-delete --id ${repo.id}`, { encoding: "utf-8" });
    const listOut = execSync(`${CLI} skill list`, { encoding: "utf-8" });
    const groups = JSON.parse(listOut);
    assert.ok(!groups.some(g => g.repo.id === repo.id));
  });
});
