// REQ-TRACE: codex-harness-desktop/REQ-SKILL-001, codex-harness-desktop/REQ-SKILL-002, codex-harness-desktop/REQ-SKILL-003
// REQ-VERSION: v1-hash:71624856165d7ccd8e88041a8f92ec3a2c552457e9e514f29ef3eb747ccf1685
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

  it("REQ-SKILL-003: CLI installs skill from npm", () => {
    const out = execSync(`${CLI} skill install --source npm --identifier some-skill`, { encoding: "utf-8" });
    const data = JSON.parse(out);
    assert.equal(data.installSource, "npm");
  });
});
