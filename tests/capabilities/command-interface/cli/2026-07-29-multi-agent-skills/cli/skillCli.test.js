// REQ-TRACE: 2026-07-29-multi-agent-skills/REQ-CLI-002
// REQ-VERSION: v1-hash:48b5bb090689d0ae76858eee7132e228805e6eb09ff701686d30cc1e6863ee4f
// CAPABILITY-TRACE: command-interface
// ENTITY-TRACE: cli
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true (2026-07-29 assertion signoff)

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startServer, stopServer } from "../../../../../../src/http/server.js";

const CLI = ["node", ["src/cli/opc-workstation.js"]];

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeSkillMd(dir, { name, description }) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n`);
}

/** 造一个 local 来源目录（skills/* 布局），返回路径。slug = basename(dir)。 */
function makeLocalSource(skills) {
  const dir = makeTempDir("opc-cli-src-");
  for (const name of skills) {
    writeSkillMd(path.join(dir, "skills", name), { name, description: `${name} desc` });
  }
  return dir;
}

function cli(args, options = {}) {
  const out = execFileSync(CLI[0], [...CLI[1], ...args], { encoding: "utf-8", ...options });
  return out;
}

function cliJson(args) {
  return JSON.parse(cli(args));
}

function cliExpectFail(args) {
  try {
    cli(args);
    assert.fail(`expected command to fail: ${args.join(" ")}`);
  } catch (error) {
    assert.ok(error.status !== 0, "exit code must be non-zero");
    return { status: error.status, stderr: error.stderr ?? "" };
  }
}

describe("CLI skill / project skill commands", () => {
  let serverCtx;
  let repoRoot;

  beforeEach(async () => {
    serverCtx = await startServer();
    repoRoot = makeTempDir("opc-cli-root-");
    cli(["settings", "set", "--skill-repo-path", repoRoot]);
  });

  afterEach(async () => {
    await stopServer(serverCtx);
    fs.rmSync(repoRoot, { recursive: true, force: true });
  });

  async function createProjectViaApi(agentTypes = ["claude-code"]) {
    const localPath = makeTempDir("opc-cli-proj-");
    const res = await fetch(`${serverCtx.baseUrl}/api/projects`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "CLI Project", localPath, agentTypes })
    });
    assert.equal(res.status, 201);
    const project = await res.json();
    return { project, localPath };
  }

  it("REQ-CLI-002: skill agents prints the registry including pinned agents", () => {
    const agents = cliJson(["skill", "agents"]);
    assert.ok(Array.isArray(agents));
    assert.equal(agents.length, 75, `registry must contain exactly 75 agents, got ${agents.length}`);
    assert.deepEqual(agents.slice(0, 5).map((a) => a.name), ["claude-code", "codex", "opencode", "cursor", "kimi-code-cli"]);
  });

  it("REQ-CLI-002: skill install --source local + skill list round-trip", () => {
    const source = makeLocalSource(["alpha-skill"]);
    try {
      const installOut = cliJson(["skill", "install", "--source", "local", "--identifier", source]);
      assert.equal(installOut.slug, path.basename(source));
      assert.equal(installOut.sourceType, "local");
      assert.deepEqual(installOut.skills.map((s) => s.skillName), ["alpha-skill"]);

      const groups = cliJson(["skill", "list"]);
      const group = groups.find((g) => g.slug === path.basename(source));
      assert.ok(group, "installed source must appear in skill list");
      assert.equal(group.sourceType, "local");
      assert.deepEqual(group.skills.map((s) => s.skillName), ["alpha-skill"]);
    } finally {
      fs.rmSync(source, { recursive: true, force: true });
    }
  });

  it("REQ-CLI-002: duplicate local install fails with SKILL_SLUG_CONFLICT, --force overwrites", () => {
    const parentA = makeTempDir("opc-cli-a-");
    const parentB = makeTempDir("opc-cli-b-");
    const srcA = path.join(parentA, "same-name");
    const srcB = path.join(parentB, "same-name");
    writeSkillMd(path.join(srcA, "skills", "one"), { name: "one", description: "A" });
    writeSkillMd(path.join(srcB, "skills", "two"), { name: "two", description: "B" });
    try {
      cli(["skill", "install", "--source", "local", "--identifier", srcA]);

      const conflict = cliExpectFail(["skill", "install", "--source", "local", "--identifier", srcB]);
      assert.ok(conflict.stderr.includes("SKILL_SLUG_CONFLICT"), `stderr should carry the error code: ${conflict.stderr}`);

      cli(["skill", "install", "--source", "local", "--identifier", srcB, "--force"]);
      assert.ok(fs.existsSync(path.join(repoRoot, "same-name", "skills", "two", "SKILL.md")), "--force must overwrite");
    } finally {
      fs.rmSync(parentA, { recursive: true, force: true });
      fs.rmSync(parentB, { recursive: true, force: true });
    }
  });

  it("REQ-CLI-002: skill install --source npm is rejected", () => {
    for (const legacy of ["npm", "plugin"]) {
      const { stderr } = cliExpectFail(["skill", "install", "--source", legacy, "--identifier", "whatever"]);
      assert.ok(stderr.includes("SKILL_SOURCE_INVALID"), `legacy source ${legacy} must be rejected: ${stderr}`);
    }
  });

  it("REQ-CLI-002: skill update on a local source fails with SKILL_UPDATE_UNSUPPORTED", () => {
    const source = makeLocalSource(["alpha-skill"]);
    try {
      cli(["skill", "install", "--source", "local", "--identifier", source]);
      const { stderr } = cliExpectFail(["skill", "update", path.basename(source)]);
      assert.ok(stderr.includes("SKILL_UPDATE_UNSUPPORTED"), stderr);
    } finally {
      fs.rmSync(source, { recursive: true, force: true });
    }
  });

  it("REQ-CLI-002: project update --agents + project skill link/list/unlink/resync flow", async () => {
    const source = makeLocalSource(["alpha-skill"]);
    try {
      cli(["skill", "install", "--source", "local", "--identifier", source]);
      const { project, localPath } = await createProjectViaApi([]);
      const slug = path.basename(source);

      // --agents 设置声明
      const updated = cliJson(["project", "update", project.id, "--agents", "claude-code"]);
      assert.deepEqual(updated.agentTypes, ["claude-code"]);

      // link
      cli(["project", "skill", "link", project.id, slug, "alpha-skill"]);
      const linkPath = path.join(localPath, ".claude", "skills", "alpha-skill");
      assert.equal(fs.realpathSync(linkPath), fs.realpathSync(path.join(repoRoot, slug, "skills", "alpha-skill")));

      // list
      const listed = cli(["project", "skill", "list", project.id]);
      assert.ok(listed.includes("alpha-skill"), "project skill list must include the linked skill");

      // 手工删链 → resync 重建
      fs.rmSync(linkPath);
      cli(["project", "skill", "resync", project.id]);
      assert.equal(fs.realpathSync(linkPath), fs.realpathSync(path.join(repoRoot, slug, "skills", "alpha-skill")));

      // unlink
      cli(["project", "skill", "unlink", project.id, slug, "alpha-skill"]);
      assert.ok(!fs.existsSync(linkPath), "unlink must remove the symlink");
    } finally {
      fs.rmSync(source, { recursive: true, force: true });
    }
  });

  it("REQ-CLI-002: project update --agents with an unknown key fails", async () => {
    const { project } = await createProjectViaApi([]);
    const { stderr } = cliExpectFail(["project", "update", project.id, "--agents", "bogus-agent"]);
    assert.ok(stderr.includes("bogus-agent"), "error must name the invalid key");
  });

  it("REQ-CLI-002: project skill link with missing arguments is a usage error", async () => {
    const { project } = await createProjectViaApi();
    const { status } = cliExpectFail(["project", "skill", "link", project.id, "only-slug"]);
    assert.notEqual(status, 0);
  });

  it("REQ-CLI-002: skill remove deletes the source and it disappears from skill list", () => {
    const source = makeLocalSource(["alpha-skill"]);
    try {
      cli(["skill", "install", "--source", "local", "--identifier", source]);
      const slug = path.basename(source);

      cli(["skill", "remove", slug]);
      assert.ok(!fs.existsSync(path.join(repoRoot, slug)), "source dir must be deleted");
      const groups = cliJson(["skill", "list"]);
      assert.ok(!groups.some((g) => g.slug === slug), "removed source must disappear from skill list");
    } finally {
      fs.rmSync(source, { recursive: true, force: true });
    }
  });

  it("REQ-CLI-002: --json flag yields machine-readable output for list commands", () => {
    const source = makeLocalSource(["alpha-skill"]);
    try {
      cli(["skill", "install", "--source", "local", "--identifier", source]);
      const out = cli(["skill", "list", "--json"]);
      const groups = JSON.parse(out);
      assert.ok(Array.isArray(groups));
      assert.ok(groups.some((g) => g.slug === path.basename(source)));

      const agentsOut = cli(["skill", "agents", "--json"]);
      assert.ok(Array.isArray(JSON.parse(agentsOut)));
    } finally {
      fs.rmSync(source, { recursive: true, force: true });
    }
  });
});
