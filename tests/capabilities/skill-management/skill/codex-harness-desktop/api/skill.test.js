// REQ-TRACE: codex-harness-desktop/REQ-SKILL-001, codex-harness-desktop/REQ-SKILL-002, codex-harness-desktop/REQ-SKILL-003, codex-harness-desktop/REQ-SKILL-004
// REQ-VERSION: v1-hash:9ef9310da8e2e2737ea32e521ee7f83fcee2c5d30f8d7d435ae367124e240b22
// CAPABILITY-TRACE: skill-management
// ENTITY-TRACE: skill
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: false

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { startServer, stopServer } from "../../../../../../src/http/server.js";

const CLI = "node src/cli/opc-workstation.js";

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

  it("REQ-SKILL-003: supports npm skill install", async () => {
    const res = await fetch(`${serverCtx.baseUrl}/api/skills/install`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source: "npm", identifier: "some-skill" })
    });
    assert.equal(res.status, 201);
    const data = await res.json();
    assert.equal(data.installSource, "npm");
  });

  it("REQ-SKILL-003: supports Claude Plugin skill install", async () => {
    const res = await fetch(`${serverCtx.baseUrl}/api/skills/install`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source: "plugin", identifier: "claude-plugin-id" })
    });
    assert.equal(res.status, 201);
    const data = await res.json();
    assert.equal(data.installSource, "plugin");
  });

  it("REQ-SKILL-003: supports Local Files skill install", async () => {
    const res = await fetch(`${serverCtx.baseUrl}/api/skills/install`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source: "local", identifier: "~/my-skills/local-skill" })
    });
    assert.equal(res.status, 201);
    const data = await res.json();
    assert.equal(data.installSource, "local");
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

  it("REQ-SKILL-003: CLI installs skill from npm", () => {
    const out = execSync(`${CLI} skill install --source npm --identifier some-skill`, { encoding: "utf-8" });
    const data = JSON.parse(out);
    assert.equal(data.installSource, "npm");
  });

  it("REQ-SKILL-004: CLI deletes a skill", () => {
    const out = execSync(`${CLI} skill install --source npm --identifier cli-deletable`, { encoding: "utf-8" });
    const skill = JSON.parse(out);
    execSync(`${CLI} skill delete --id ${skill.id}`, { encoding: "utf-8" });
    const listOut = execSync(`${CLI} skill list`, { encoding: "utf-8" });
    const list = JSON.parse(listOut);
    assert.ok(!list.some(s => s.id === skill.id));
  });
});
