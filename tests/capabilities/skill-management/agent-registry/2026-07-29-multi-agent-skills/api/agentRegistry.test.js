// REQ-TRACE: 2026-07-29-multi-agent-skills/REQ-SKILL-018
// REQ-VERSION: v1-hash:8e41121222f9276d64083118cdb9070c5346ec47a4e66a6d10622c1f4c2fcab8
// CAPABILITY-TRACE: skill-management
// ENTITY-TRACE: agent-registry
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true (2026-07-29 assertion signoff)

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startServer, stopServer } from "../../../../../../src/http/server.js";

// agentRegistryService 尚不存在（BUILD 产物）：动态 import，让本文件可加载、测试以 RED 失败而非 import 崩溃。
async function registrySvc() {
  return import("../../../../../../src/services/agentRegistryService.js");
}

const PINNED = ["claude-code", "codex", "opencode", "cursor", "kimi-code-cli"];

describe("Agent Registry (snapshot service / ordering / template expansion)", () => {
  let serverCtx;

  beforeEach(async () => {
    serverCtx = await startServer();
  });

  afterEach(async () => {
    await stopServer(serverCtx);
  });

  it("REQ-SKILL-018: GET /api/agents returns the full registry with name/displayName/skillsDir", async () => {
    const res = await fetch(`${serverCtx.baseUrl}/api/agents`);
    assert.equal(res.status, 200);
    const agents = await res.json();
    assert.equal(agents.length, 75, `registry snapshot must contain exactly 75 agents, got ${agents.length}`);
    for (const agent of agents) {
      assert.ok(agent.name, "each agent must have a name");
      assert.ok(agent.displayName, `${agent.name} must have a displayName`);
      assert.ok(agent.skillsDir, `${agent.name} must have a project skillsDir`);
    }
  });

  it("REQ-SKILL-018: pinned agents come first in pinned order, the rest sorted by displayName", async () => {
    const res = await fetch(`${serverCtx.baseUrl}/api/agents`);
    const agents = await res.json();
    assert.deepEqual(agents.slice(0, PINNED.length).map((a) => a.name), PINNED);

    const rest = agents.slice(PINNED.length).map((a) => a.displayName);
    const sorted = [...rest].sort((a, b) => a.localeCompare(b));
    assert.deepEqual(rest, sorted, "non-pinned agents must be sorted by displayName");
  });

  it("REQ-SKILL-018: getGlobalSkillsDir expands ~ to the current homedir", async () => {
    const agentRegistryService = await registrySvc();
    const expanded = agentRegistryService.getGlobalSkillsDir("claude-code");
    assert.ok(expanded, "claude-code must have a global skills dir");
    assert.ok(expanded.startsWith(os.homedir() + path.sep), `expected expansion under homedir, got ${expanded}`);
    assert.ok(!expanded.includes("~"), "template must be fully expanded");
  });

  it("REQ-SKILL-018: template expansion reads whitelisted env vars (CLAUDE_CONFIG_DIR drives claude-code)", async () => {
    const agentRegistryService = await registrySvc();
    const sentinel = path.join(os.tmpdir(), `opc-registry-sentinel-${process.pid}`);
    const saved = process.env.CLAUDE_CONFIG_DIR;
    process.env.CLAUDE_CONFIG_DIR = sentinel;
    try {
      const expanded = agentRegistryService.getGlobalSkillsDir("claude-code");
      assert.ok(expanded.startsWith(sentinel), `CLAUDE_CONFIG_DIR is whitelisted and must drive expansion, got ${expanded}`);
    } finally {
      if (saved === undefined) delete process.env.CLAUDE_CONFIG_DIR;
      else process.env.CLAUDE_CONFIG_DIR = saved;
    }
  });

  it("REQ-SKILL-018: non-whitelisted env vars never influence expansion", async () => {
    const agentRegistryService = await registrySvc();
    const marker = `opc-registry-nonwhite-${process.pid}`;
    const saved = process.env.OPC_NONWHITELIST_MARKER;
    process.env.OPC_NONWHITELIST_MARKER = marker;
    try {
      const expanded = agentRegistryService.getGlobalSkillsDir("claude-code");
      assert.ok(!expanded.includes(marker), "non-whitelisted env var must not leak into expansion");
    } finally {
      if (saved === undefined) delete process.env.OPC_NONWHITELIST_MARKER;
      else process.env.OPC_NONWHITELIST_MARKER = saved;
    }
  });

  it("REQ-SKILL-018: agent key validation and displayName mapping", async () => {
    const agentRegistryService = await registrySvc();
    assert.equal(agentRegistryService.isValidAgentKey("claude-code"), true);
    assert.equal(agentRegistryService.isValidAgentKey("bogus-agent"), false);
    assert.equal(agentRegistryService.getAgentKeyByDisplayName("Claude Code"), "claude-code");
    assert.equal(agentRegistryService.getAgentKeyByDisplayName("No Such Agent"), null);
  });

  it("REQ-SKILL-018: unknown keys are reported as invalid, never thrown", async () => {
    const agentRegistryService = await registrySvc();
    assert.doesNotThrow(() => agentRegistryService.getGlobalSkillsDir("bogus-agent"));
    assert.equal(agentRegistryService.getGlobalSkillsDir("bogus-agent"), null);
  });

  it("REQ-SKILL-018: registry service has no module-top side effects (ADR-009 lazy load)", async () => {
    // 惰性加载的行为证据：快照文件被临时替换后，首次访问才读取新内容。
    const agentRegistryService = await registrySvc();
    const snapshotPath = process.env.OPC_AGENT_REGISTRY_SNAPSHOT;
    const fixture = path.join(os.tmpdir(), `opc-registry-fixture-${process.pid}.json`);
    fs.writeFileSync(fixture, JSON.stringify({
      version: "0.0.0-test",
      syncedAt: "2026-07-29",
      agents: [{ name: "fixture-agent", displayName: "Fixture Agent", skillsDir: ".fixture/skills", globalSkillsDir: null, globalEnvDeps: [], universal: false }]
    }));
    process.env.OPC_AGENT_REGISTRY_SNAPSHOT = fixture;
    try {
      agentRegistryService.resetAgentRegistryCache();
      assert.equal(agentRegistryService.isValidAgentKey("fixture-agent"), true);
      assert.equal(agentRegistryService.isValidAgentKey("claude-code"), false);
    } finally {
      if (snapshotPath === undefined) delete process.env.OPC_AGENT_REGISTRY_SNAPSHOT;
      else process.env.OPC_AGENT_REGISTRY_SNAPSHOT = snapshotPath;
      agentRegistryService.resetAgentRegistryCache();
      fs.rmSync(fixture, { force: true });
    }
  });
});
