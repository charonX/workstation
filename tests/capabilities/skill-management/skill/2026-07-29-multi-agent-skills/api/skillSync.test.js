// REQ-TRACE: 2026-07-29-multi-agent-skills/REQ-SKILL-013, 2026-07-29-multi-agent-skills/REQ-SKILL-014
// REQ-VERSION: v1-hash:8e41121222f9276d64083118cdb9070c5346ec47a4e66a6d10622c1f4c2fcab8
// CAPABILITY-TRACE: skill-management
// ENTITY-TRACE: skill
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true (2026-07-29 assertion signoff)

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startServer, stopServer } from "../../../../../../src/http/server.js";

const JSON_HEADERS = { "Content-Type": "application/json" };

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeSkillMd(dir, { name, description }) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n`);
}

function makeSourceDir(repoRoot, slug, skillDirNames) {
  for (const dirName of skillDirNames) {
    writeSkillMd(path.join(repoRoot, slug, "skills", dirName), { name: dirName, description: `${dirName} desc` });
  }
}

function assertLinkTo(linkPath, targetDir) {
  const lst = fs.lstatSync(linkPath);
  assert.ok(lst.isSymbolicLink(), `${linkPath} should be a symlink (or junction on Windows)`);
  assert.equal(fs.realpathSync(linkPath), fs.realpathSync(targetDir));
}

async function createProject(baseUrl, { name = "Proj" } = {}) {
  const localPath = makeTempDir("opc-sync-proj-");
  const res = await fetch(`${baseUrl}/api/projects`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ name, localPath })
  });
  assert.equal(res.status, 201);
  const project = await res.json();
  return { project, localPath };
}

async function putAgentTypes(baseUrl, projectId, agentTypes) {
  const res = await fetch(`${baseUrl}/api/projects/${projectId}`, {
    method: "PUT",
    headers: JSON_HEADERS,
    body: JSON.stringify({ agentTypes })
  });
  return res;
}

async function linkSkill(baseUrl, projectId, slug, skillName) {
  const res = await fetch(`${baseUrl}/api/projects/${projectId}/skills`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ slug, skillName })
  });
  assert.equal(res.status, 200);
  return res.json();
}

describe("Skill Sync (auto-converge on agentTypes change / manual resync)", () => {
  let serverCtx;
  let repoRoot;
  let agents;

  beforeEach(async () => {
    serverCtx = await startServer();
    repoRoot = makeTempDir("opc-sync-root-");
    const res = await fetch(`${serverCtx.baseUrl}/api/settings`, {
      method: "PATCH",
      headers: JSON_HEADERS,
      body: JSON.stringify({ skillRepoPath: repoRoot })
    });
    assert.equal(res.status, 200);
    makeSourceDir(repoRoot, "acme-tools", ["review", "deploy"]);

    const agentsRes = await fetch(`${serverCtx.baseUrl}/api/agents`);
    assert.equal(agentsRes.status, 200);
    agents = await agentsRes.json();
  });

  afterEach(async () => {
    await stopServer(serverCtx);
    fs.rmSync(repoRoot, { recursive: true, force: true });
  });

  function skillsDirOf(agentName) {
    const agent = agents.find((a) => a.name === agentName);
    assert.ok(agent, `agent ${agentName} must exist in registry`);
    return agent.skillsDir;
  }

  // ---------- REQ-SKILL-013 自动收敛 ----------

  it("REQ-SKILL-013: switching agents rebuilds links in the new dir and removes ours from the old (F1)", async () => {
    const { project, localPath } = await createProject(serverCtx.baseUrl);
    let res = await putAgentTypes(serverCtx.baseUrl, project.id, ["codex"]);
    assert.equal(res.status, 200);
    await linkSkill(serverCtx.baseUrl, project.id, "acme-tools", "review");

    const codexDir = skillsDirOf("codex");
    const claudeDir = skillsDirOf("claude-code");
    assertLinkTo(path.join(localPath, codexDir, "review"), path.join(repoRoot, "acme-tools", "skills", "review"));

    res = await putAgentTypes(serverCtx.baseUrl, project.id, ["claude-code"]);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.convergence, "PUT response must carry convergence results");
    assert.ok(Array.isArray(body.convergence.agents));

    // 已关联集合在变更前后声明目录的并集上扫描 → 换 agent 不丢关联
    assertLinkTo(path.join(localPath, claudeDir, "review"), path.join(repoRoot, "acme-tools", "skills", "review"));
    assert.ok(!fs.existsSync(path.join(localPath, codexDir, "review")), "our link in the removed dir must be deleted");
  });

  it("REQ-SKILL-013: convergence removes only our links from removed dirs and keeps external entries", async () => {
    const { project, localPath } = await createProject(serverCtx.baseUrl);
    await putAgentTypes(serverCtx.baseUrl, project.id, ["codex"]);
    await linkSkill(serverCtx.baseUrl, project.id, "acme-tools", "review");

    const codexDir = skillsDirOf("codex");
    // 外部实体目录（同名不同物）与外部 skill
    writeSkillMd(path.join(localPath, codexDir, "external-tool"), { name: "external-tool", description: "ext" });

    const res = await putAgentTypes(serverCtx.baseUrl, project.id, ["claude-code"]);
    assert.equal(res.status, 200);

    assert.ok(!fs.existsSync(path.join(localPath, codexDir, "review")), "our link must be removed from the old dir");
    const externalDir = path.join(localPath, codexDir, "external-tool");
    assert.ok(fs.lstatSync(externalDir).isDirectory() && !fs.lstatSync(externalDir).isSymbolicLink(), "external entry must be untouched");
  });

  it("REQ-SKILL-013: convergence never links skills outside the already-linked set", async () => {
    const { project, localPath } = await createProject(serverCtx.baseUrl);
    await putAgentTypes(serverCtx.baseUrl, project.id, ["codex"]);
    await linkSkill(serverCtx.baseUrl, project.id, "acme-tools", "review");
    // "deploy" 在技能库中但从未关联

    const res = await putAgentTypes(serverCtx.baseUrl, project.id, ["claude-code"]);
    assert.equal(res.status, 200);

    const claudeDir = skillsDirOf("claude-code");
    assertLinkTo(path.join(localPath, claudeDir, "review"), path.join(repoRoot, "acme-tools", "skills", "review"));
    assert.ok(!fs.existsSync(path.join(localPath, claudeDir, "deploy")), "never-linked skill must NOT be auto-linked by convergence");
  });

  it("REQ-SKILL-013: keeping an agent keeps its links, adding one adds links (overlap case)", async () => {
    const { project, localPath } = await createProject(serverCtx.baseUrl);
    await putAgentTypes(serverCtx.baseUrl, project.id, ["codex"]);
    await linkSkill(serverCtx.baseUrl, project.id, "acme-tools", "review");

    const res = await putAgentTypes(serverCtx.baseUrl, project.id, ["codex", "claude-code"]);
    assert.equal(res.status, 200);

    const codexDir = skillsDirOf("codex");
    const claudeDir = skillsDirOf("claude-code");
    assertLinkTo(path.join(localPath, codexDir, "review"), path.join(repoRoot, "acme-tools", "skills", "review"));
    assertLinkTo(path.join(localPath, claudeDir, "review"), path.join(repoRoot, "acme-tools", "skills", "review"));
  });

  it("REQ-SKILL-013: setting agentTypes to [] removes all our links and keeps externals", async () => {
    const { project, localPath } = await createProject(serverCtx.baseUrl);
    await putAgentTypes(serverCtx.baseUrl, project.id, ["codex", "claude-code"]);
    await linkSkill(serverCtx.baseUrl, project.id, "acme-tools", "review");

    const codexDir = skillsDirOf("codex");
    writeSkillMd(path.join(localPath, codexDir, "external-tool"), { name: "external-tool", description: "ext" });

    const res = await putAgentTypes(serverCtx.baseUrl, project.id, []);
    assert.equal(res.status, 200);

    for (const dir of [codexDir, skillsDirOf("claude-code")]) {
      assert.ok(!fs.existsSync(path.join(localPath, dir, "review")), `our link must be removed from ${dir}`);
    }
    assert.ok(fs.existsSync(path.join(localPath, codexDir, "external-tool")), "external entry must stay");
  });

  it("REQ-SKILL-013: convergence result reports per-agent outcomes including failures (E5)", async (t) => {
    if (process.platform === "win32" || (process.geteuid && process.geteuid() === 0)) {
      t.skip("permission-based failure injection is unreliable on Windows/root");
      return;
    }
    const { project, localPath } = await createProject(serverCtx.baseUrl);
    await putAgentTypes(serverCtx.baseUrl, project.id, ["codex"]);
    await linkSkill(serverCtx.baseUrl, project.id, "acme-tools", "review");

    // 让 claude-code 目标目录不可写 → 该 agent 收敛失败
    const claudeDir = skillsDirOf("claude-code");
    fs.mkdirSync(path.join(localPath, claudeDir), { recursive: true });
    fs.chmodSync(path.join(localPath, claudeDir), 0o555);
    try {
      const res = await putAgentTypes(serverCtx.baseUrl, project.id, ["codex", "claude-code"]);
      assert.equal(res.status, 200, "per-agent failure must not fail the whole PUT");
      const body = await res.json();
      const claude = body.convergence.agents.find((a) => a.agent === "claude-code");
      assert.ok(claude.failed.length > 0, "claude-code failure must be surfaced in convergence result");
    } finally {
      fs.chmodSync(path.join(localPath, claudeDir), 0o755);
    }
  });

  // ---------- REQ-SKILL-014 手动重同步 ----------

  it("REQ-SKILL-014: resync rebuilds links that were manually deleted", async () => {
    const { project, localPath } = await createProject(serverCtx.baseUrl);
    await putAgentTypes(serverCtx.baseUrl, project.id, ["claude-code"]);
    await linkSkill(serverCtx.baseUrl, project.id, "acme-tools", "review");

    const claudeDir = skillsDirOf("claude-code");
    fs.rmSync(path.join(localPath, claudeDir, "review"));
    assert.ok(!fs.existsSync(path.join(localPath, claudeDir, "review")));

    const res = await fetch(`${serverCtx.baseUrl}/api/projects/${project.id}/skills/resync`, { method: "POST" });
    assert.equal(res.status, 200);
    assertLinkTo(path.join(localPath, claudeDir, "review"), path.join(repoRoot, "acme-tools", "skills", "review"));
  });

  it("REQ-SKILL-014: resync removes broken links pointing into the library", async () => {
    const { project, localPath } = await createProject(serverCtx.baseUrl);
    await putAgentTypes(serverCtx.baseUrl, project.id, ["claude-code"]);
    await linkSkill(serverCtx.baseUrl, project.id, "acme-tools", "review");

    // 技能库中删除该 skill → 断链
    fs.rmSync(path.join(repoRoot, "acme-tools", "skills", "review"), { recursive: true, force: true });
    const claudeDir = skillsDirOf("claude-code");
    const linkPath = path.join(localPath, claudeDir, "review");
    assert.ok(fs.lstatSync(linkPath).isSymbolicLink(), "broken link still present before resync");

    const res = await fetch(`${serverCtx.baseUrl}/api/projects/${project.id}/skills/resync`, { method: "POST" });
    assert.equal(res.status, 200);
    assert.ok(!fs.existsSync(linkPath), "broken link must be cleaned by resync");
  });

  it("REQ-SKILL-014: resync repairs a link whose target was repointed", async () => {
    const { project, localPath } = await createProject(serverCtx.baseUrl);
    await putAgentTypes(serverCtx.baseUrl, project.id, ["claude-code"]);
    await linkSkill(serverCtx.baseUrl, project.id, "acme-tools", "review");

    const claudeDir = skillsDirOf("claude-code");
    const linkPath = path.join(localPath, claudeDir, "review");
    // 把链 target 改错（仍指向技能库内的另一个 skill）
    fs.rmSync(linkPath);
    fs.symlinkSync(path.join(repoRoot, "acme-tools", "skills", "deploy"), linkPath, "dir");

    const res = await fetch(`${serverCtx.baseUrl}/api/projects/${project.id}/skills/resync`, { method: "POST" });
    assert.equal(res.status, 200);
    assertLinkTo(linkPath, path.join(repoRoot, "acme-tools", "skills", "review"));
  });

  it("REQ-SKILL-014: resync does not auto-link new skills and keeps external entries", async () => {
    const { project, localPath } = await createProject(serverCtx.baseUrl);
    await putAgentTypes(serverCtx.baseUrl, project.id, ["claude-code"]);
    await linkSkill(serverCtx.baseUrl, project.id, "acme-tools", "review");

    const claudeDir = skillsDirOf("claude-code");
    writeSkillMd(path.join(localPath, claudeDir, "external-tool"), { name: "external-tool", description: "ext" });

    const res = await fetch(`${serverCtx.baseUrl}/api/projects/${project.id}/skills/resync`, { method: "POST" });
    assert.equal(res.status, 200);

    assert.ok(!fs.existsSync(path.join(localPath, claudeDir, "deploy")), "never-linked skill must NOT be linked by resync");
    const externalDir = path.join(localPath, claudeDir, "external-tool");
    assert.ok(fs.lstatSync(externalDir).isDirectory() && !fs.lstatSync(externalDir).isSymbolicLink(), "external entry must be untouched");
  });

  it("REQ-SKILL-014: resync on a project with empty agentTypes succeeds as a no-op", async () => {
    const { project } = await createProject(serverCtx.baseUrl);
    const res = await fetch(`${serverCtx.baseUrl}/api/projects/${project.id}/skills/resync`, { method: "POST" });
    assert.equal(res.status, 200);
  });
});
