// REQ-TRACE: 2026-07-29-multi-agent-skills/REQ-SKILL-019
// REQ-VERSION: v1-hash:8e41121222f9276d64083118cdb9070c5346ec47a4e66a6d10622c1f4c2fcab8
// CAPABILITY-TRACE: skill-management
// ENTITY-TRACE: agent-registry
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true (2026-07-29 assertion signoff)

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const SNAPSHOT_PATH = path.resolve("src/services/agentRegistry.json");
const SYNC_SCRIPT_PATH = path.resolve("scripts/sync-agent-registry.mjs");

function readSnapshot() {
  return JSON.parse(fs.readFileSync(SNAPSHOT_PATH, "utf-8"));
}

describe("Agent Registry Snapshot (schema / baseline entries / sync script)", () => {
  it("REQ-SKILL-019: snapshot has version, syncedAt and a well-formed agents[]", () => {
    const snapshot = readSnapshot();
    assert.ok(snapshot.version, "snapshot must carry the upstream version");
    assert.ok(snapshot.syncedAt, "snapshot must carry syncedAt");
    assert.ok(Array.isArray(snapshot.agents), "snapshot must carry agents[]");
    assert.equal(snapshot.agents.length, 75, `registry snapshot must contain exactly 75 agents, got ${snapshot.agents.length}`);

    for (const agent of snapshot.agents) {
      assert.match(agent.name, /^[a-z0-9-]+$/, `agent name must be kebab-case: ${agent.name}`);
      assert.ok(agent.displayName, `${agent.name} must have displayName`);
      assert.ok(agent.skillsDir, `${agent.name} must have skillsDir`);
      assert.ok(!path.isAbsolute(agent.skillsDir), `${agent.name}.skillsDir must be project-relative: ${agent.skillsDir}`);
      assert.ok(!agent.skillsDir.includes("~"), `${agent.name}.skillsDir must not contain ~: ${agent.skillsDir}`);
      assert.ok(agent.globalSkillsDir === null || typeof agent.globalSkillsDir === "string", `${agent.name}.globalSkillsDir must be a template string or null`);
      assert.ok(Array.isArray(agent.globalEnvDeps), `${agent.name}.globalEnvDeps must be an array`);
      assert.equal(typeof agent.universal, "boolean", `${agent.name}.universal must be boolean`);
    }
  });

  it("REQ-SKILL-019: globalSkillsDir templates are expandable (~ only leading, $VAR declared in globalEnvDeps)", () => {
    const snapshot = readSnapshot();
    for (const agent of snapshot.agents) {
      if (agent.globalSkillsDir === null) continue;
      const template = agent.globalSkillsDir;
      if (template.includes("~")) {
        assert.ok(template.startsWith("~"), `${agent.name}: ~ must only appear at the start: ${template}`);
      }
      const vars = template.match(/\$[A-Z_]+/g) ?? [];
      for (const v of vars) {
        assert.ok(
          agent.globalEnvDeps.includes(v.slice(1)),
          `${agent.name}: template var ${v} must be declared in globalEnvDeps`
        );
      }
    }
  });

  it("REQ-SKILL-019: claude-code and codex baseline entries are correct", () => {
    const snapshot = readSnapshot();
    const claude = snapshot.agents.find((a) => a.name === "claude-code");
    assert.ok(claude, "claude-code must exist in the snapshot");
    assert.equal(claude.skillsDir, ".claude/skills");
    assert.equal(claude.universal, false);

    const codex = snapshot.agents.find((a) => a.name === "codex");
    assert.ok(codex, "codex must exist in the snapshot");
    assert.equal(codex.skillsDir, ".agents/skills");

    for (const pinned of ["opencode", "cursor", "kimi-code-cli"]) {
      assert.ok(snapshot.agents.some((a) => a.name === pinned), `${pinned} must exist in the snapshot`);
    }
  });

  it("REQ-SKILL-019: sync script exists and its failure path preserves the current snapshot", () => {
    assert.ok(fs.existsSync(SYNC_SCRIPT_PATH), "scripts/sync-agent-registry.mjs must exist");

    const before = fs.readFileSync(SNAPSHOT_PATH, "utf-8");
    // 失败注入缝：--source <file> 指向畸形上游内容时必须非零退出且不写快照
    const bogusSource = path.join(path.dirname(SNAPSHOT_PATH), `.bogus-agents-${process.pid}.ts`);
    fs.writeFileSync(bogusSource, "this is not a valid agents table\n");
    try {
      let exitCode = 0;
      try {
        execFileSync("node", [SYNC_SCRIPT_PATH, "--source", bogusSource], { stdio: "pipe" });
      } catch (error) {
        exitCode = error.status ?? 1;
      }
      assert.notEqual(exitCode, 0, "malformed upstream content must fail the sync");
      assert.equal(fs.readFileSync(SNAPSHOT_PATH, "utf-8"), before, "failed sync must not overwrite the snapshot");
    } finally {
      fs.rmSync(bogusSource, { force: true });
    }
  });
});
