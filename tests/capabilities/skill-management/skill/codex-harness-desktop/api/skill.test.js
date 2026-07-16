// REQ-TRACE: codex-harness-desktop/REQ-SKILL-001, codex-harness-desktop/REQ-SKILL-002, codex-harness-desktop/REQ-SKILL-003, codex-harness-desktop/REQ-SKILL-004
// REQ-VERSION: v1-hash:4b1313dc9c3b59ccfee20bf82bc8fb49d36a5b86a2006abff3f9c33d56cc3035
// CAPABILITY-TRACE: skill-management
// ENTITY-TRACE: skill
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

  it("REQ-SKILL-001: lists skills without linked projects column", async () => {
    await fetch(`${serverCtx.baseUrl}/api/skills`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source: "local", identifier: "news-fetcher", name: "news-fetcher", repoPath: "~/.skills/news-fetcher", version: "1.0.0", category: "Data" })
    });
    const res = await fetch(`${serverCtx.baseUrl}/api/skills`);
    assert.equal(res.status, 200);
    const data = await res.json();
    const skill = data.find(s => s.name === "news-fetcher");
    assert.ok(skill);
    assert.equal(skill.category, "Data");
    assert.equal(skill.linkedProjects, undefined);
  });

  it("REQ-SKILL-001: skill row exposes a detail entry point", async () => {
    const skill = await (await fetch(`${serverCtx.baseUrl}/api/skills`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source: "local", identifier: "news-fetcher", name: "news-fetcher", repoPath: "~/.skills/news-fetcher", version: "1.0.0", category: "Data" })
    })).json();
    assert.ok(skill.id);
  });

  it("REQ-SKILL-002: skill detail exposes overview metadata", async () => {
    const skill = await (await fetch(`${serverCtx.baseUrl}/api/skills`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source: "local", identifier: "news-fetcher", name: "news-fetcher", description: "Fetch news", repoPath: "~/.skills/news-fetcher", version: "1.0.0", category: "Data", author: "OPC", tags: ["news"] })
    })).json();
    const res = await fetch(`${serverCtx.baseUrl}/api/skills/${skill.id}`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.name, "news-fetcher");
    assert.deepEqual(data.tabs, ["Overview", "Parameters", "Examples", "README"]);
    assert.equal(data.canLinkProjects, undefined);
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
          final = { status: "success", skill: event.skill };
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

  it("REQ-SKILL-003: npm install runs a real command, streams logs and records repoPath under skillRepoPath", async () => {
    const skillRepoPath = makeTempSkillRepoPath();
    fs.mkdirSync(skillRepoPath, { recursive: true });
    await setSkillRepoPath(serverCtx.baseUrl, skillRepoPath);

    const { logs, final } = await installAndAssert(serverCtx.baseUrl, { source: "npm", identifier: NPM_SKILL_FIXTURE });

    assert.ok(logs.length > 0, "npm install should produce command logs");
    assert.equal(final.status, "success");
    assert.equal(final.skill.installSource, "npm");
    assert.equal(final.skill.name, "npm-fixture-skill");
    assert.ok(final.skill.repoPath.startsWith(skillRepoPath), `repoPath ${final.skill.repoPath} should be under ${skillRepoPath}`);
    assert.ok(fs.existsSync(path.join(final.skill.repoPath, "SKILL.md")), "installed directory should contain SKILL.md");

    const detailRes = await fetch(`${serverCtx.baseUrl}/api/skills/${final.skill.id}`);
    assert.equal(detailRes.status, 200);
    const detail = await detailRes.json();
    assert.equal(detail.repoPath, final.skill.repoPath);
  });

  it("REQ-SKILL-003: plugin install records repoPath under skillRepoPath", async () => {
    const skillRepoPath = makeTempSkillRepoPath();
    fs.mkdirSync(skillRepoPath, { recursive: true });
    await setSkillRepoPath(serverCtx.baseUrl, skillRepoPath);

    const { logs, final } = await installAndAssert(serverCtx.baseUrl, { source: "plugin", identifier: "claude-plugin-id" });

    assert.ok(logs.length > 0, "plugin install should produce logs");
    assert.equal(final.status, "success");
    assert.equal(final.skill.installSource, "plugin");
    assert.ok(final.skill.repoPath.startsWith(skillRepoPath), `repoPath ${final.skill.repoPath} should be under ${skillRepoPath}`);
    assert.ok(fs.existsSync(path.join(final.skill.repoPath, "SKILL.md")), "plugin directory should contain SKILL.md");
  });

  it("REQ-SKILL-003: local install copies source directory to skillRepoPath and parses SKILL.md", async () => {
    const skillRepoPath = makeTempSkillRepoPath();
    fs.mkdirSync(skillRepoPath, { recursive: true });
    await setSkillRepoPath(serverCtx.baseUrl, skillRepoPath);

    const sourceDir = path.join(os.tmpdir(), `opc-skill-source-${Date.now()}`);
    fs.mkdirSync(sourceDir, { recursive: true });
    fs.writeFileSync(
      path.join(sourceDir, "SKILL.md"),
      ["---", "name: local-copied-skill", "description: A copied local skill", "---", "", "# Local Copied Skill"].join("\n")
    );

    const { logs, final } = await installAndAssert(serverCtx.baseUrl, { source: "local", identifier: sourceDir });

    assert.ok(logs.length > 0, "local install should produce copy logs");
    assert.equal(final.status, "success");
    assert.equal(final.skill.installSource, "local");
    assert.equal(final.skill.name, "local-copied-skill");
    assert.equal(final.skill.description, "A copied local skill");
    assert.ok(final.skill.repoPath.startsWith(skillRepoPath), `repoPath ${final.skill.repoPath} should be under ${skillRepoPath}`);
    assert.ok(fs.existsSync(path.join(final.skill.repoPath, "SKILL.md")), "installed directory should contain SKILL.md");

    const detailRes = await fetch(`${serverCtx.baseUrl}/api/skills/${final.skill.id}`);
    assert.equal(detailRes.status, 200);
    const detail = await detailRes.json();
    assert.equal(detail.repoPath, final.skill.repoPath);
  });

  it("REQ-SKILL-003: rejects install when skillRepoPath is not configured", async () => {
    await setSkillRepoPath(serverCtx.baseUrl, "");
    const res = await fetch(`${serverCtx.baseUrl}/api/skills/install`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source: "local", identifier: "/tmp/some-skill" })
    });
    assert.equal(res.status, 400);
  });

  it("REQ-SKILL-003: failed npm install streams error logs and does not create a skill record", async () => {
    const skillRepoPath = makeTempSkillRepoPath();
    fs.mkdirSync(skillRepoPath, { recursive: true });
    await setSkillRepoPath(serverCtx.baseUrl, skillRepoPath);

    const bogusPath = path.join(os.tmpdir(), `opc-bogus-skill-${Date.now()}`);
    const { logs, final } = await installAndAssert(serverCtx.baseUrl, { source: "npm", identifier: bogusPath });

    assert.ok(logs.length > 0, "failed install should still stream command logs");
    assert.equal(final.status, "error");

    const listRes = await fetch(`${serverCtx.baseUrl}/api/skills`);
    const list = await listRes.json();
    assert.ok(!list.some(s => s.installSource === "npm" && s.repoPath.includes(path.basename(bogusPath))));
  });

  it("REQ-SKILL-004: deletes a skill that is not linked to any project", async () => {
    const skill = await (await fetch(`${serverCtx.baseUrl}/api/skills`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source: "local", identifier: "deletable", name: "deletable", repoPath: "~/.skills/deletable" })
    })).json();

    const delRes = await fetch(`${serverCtx.baseUrl}/api/skills/${skill.id}`, { method: "DELETE" });
    assert.equal(delRes.status, 204);

    const getRes = await fetch(`${serverCtx.baseUrl}/api/skills/${skill.id}`);
    assert.equal(getRes.status, 404);

    const listRes = await fetch(`${serverCtx.baseUrl}/api/skills`);
    const list = await listRes.json();
    assert.ok(!list.some(s => s.id === skill.id));
  });

  it("REQ-SKILL-004: rejects deleting a skill linked to a project", async () => {
    const project = await (await fetch(`${serverCtx.baseUrl}/api/projects`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Project", localPath: "~/opc-workspace/project" })
    })).json();

    const skill = await (await fetch(`${serverCtx.baseUrl}/api/skills`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source: "local", identifier: "linked", name: "linked", repoPath: "~/.skills/linked" })
    })).json();

    await fetch(`${serverCtx.baseUrl}/api/projects/${project.id}/skills`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ skillId: skill.id, linked: true })
    });

    const delRes = await fetch(`${serverCtx.baseUrl}/api/skills/${skill.id}`, { method: "DELETE" });
    assert.equal(delRes.status, 400);
  });

  it("REQ-SKILL-004: returns 404 when deleting non-existent skill", async () => {
    const res = await fetch(`${serverCtx.baseUrl}/api/skills/non-existent`, { method: "DELETE" });
    assert.equal(res.status, 404);
  });

  it("REQ-SKILL-003: CLI installs skill from npm and prints logs", () => {
    const skillRepoPath = makeTempSkillRepoPath();
    fs.mkdirSync(skillRepoPath, { recursive: true });
    execSync(`${CLI} settings set --skill-repo-path ${skillRepoPath}`);

    const out = execSync(`${CLI} skill install --source npm --identifier ${NPM_SKILL_FIXTURE}`, { encoding: "utf-8" });
    const data = JSON.parse(out);
    assert.equal(data.skill.installSource, "npm");
    assert.ok(Array.isArray(data.logs) && data.logs.length > 0, "CLI should return command logs");
    assert.ok(data.skill.repoPath.startsWith(skillRepoPath), `repoPath ${data.skill.repoPath} should be under ${skillRepoPath}`);
  });

  it("REQ-SKILL-004: CLI deletes a skill", () => {
    const out = execSync(`${CLI} skill install --source npm --identifier ${NPM_SKILL_FIXTURE}`, { encoding: "utf-8" });
    const { skill } = JSON.parse(out);
    execSync(`${CLI} skill delete --id ${skill.id}`, { encoding: "utf-8" });
    const listOut = execSync(`${CLI} skill list`, { encoding: "utf-8" });
    const list = JSON.parse(listOut);
    assert.ok(!list.some(s => s.id === skill.id));
  });
});
