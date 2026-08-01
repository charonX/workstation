// REQ-TRACE: 2026-07-29-multi-agent-skills/REQ-SKILL-010, 2026-07-29-multi-agent-skills/REQ-SKILL-011, 2026-07-29-multi-agent-skills/REQ-SKILL-012
// REQ-VERSION: v1-hash:fa23e65798c9caf788c5697ef1524e2fd084f0b582ae37ecb42bc032b2108551
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
  assert.equal(fs.realpathSync(linkPath), fs.realpathSync(targetDir), `${linkPath} must resolve into the skill library`);
}

async function createProjectWithAgents(baseUrl, { name = "Proj", agentTypes = [] } = {}) {
  const localPath = makeTempDir("opc-projskills-proj-");
  const res = await fetch(`${baseUrl}/api/projects`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ name, localPath })
  });
  assert.equal(res.status, 201);
  const project = await res.json();
  if (agentTypes.length > 0) {
    const put = await fetch(`${baseUrl}/api/projects/${project.id}`, {
      method: "PUT",
      headers: JSON_HEADERS,
      body: JSON.stringify({ agentTypes })
    });
    assert.equal(put.status, 200);
  }
  return { project, localPath };
}

async function linkSkill(baseUrl, projectId, body) {
  return fetch(`${baseUrl}/api/projects/${projectId}/skills`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(body)
  });
}

describe("Project Skills (link / unlink / project skill view)", () => {
  let serverCtx;
  let repoRoot;

  beforeEach(async () => {
    serverCtx = await startServer();
    repoRoot = makeTempDir("opc-projskills-root-");
    const res = await fetch(`${serverCtx.baseUrl}/api/settings`, {
      method: "PATCH",
      headers: JSON_HEADERS,
      body: JSON.stringify({ skillRepoPath: repoRoot })
    });
    assert.equal(res.status, 200);
    makeSourceDir(repoRoot, "acme-tools", ["review", "deploy"]);
  });

  afterEach(async () => {
    await stopServer(serverCtx);
    fs.rmSync(repoRoot, { recursive: true, force: true });
  });

  // ---------- REQ-SKILL-010 项目关联 ----------

  it("REQ-SKILL-010: linking creates a symlink in each declared agent dir resolving into the library", async () => {
    const { project, localPath } = await createProjectWithAgents(serverCtx.baseUrl, {
      agentTypes: ["claude-code"]
    });

    const res = await linkSkill(serverCtx.baseUrl, project.id, { slug: "acme-tools", skillName: "review" });
    assert.equal(res.status, 200);
    const result = await res.json();
    assert.ok(Array.isArray(result.agents), "link result must carry per-agent outcomes");
    const claude = result.agents.find((a) => a.agent === "claude-code");
    assert.ok(claude.linked.includes("review"), "claude-code should report review as linked");

    const linkPath = path.join(localPath, ".claude", "skills", "review");
    assertLinkTo(linkPath, path.join(repoRoot, "acme-tools", "skills", "review"));

    const throughLink = fs.readFileSync(path.join(linkPath, "SKILL.md"), "utf-8");
    assert.ok(throughLink.includes("name: review"), "SKILL.md must be readable through the link");
  });

  it("REQ-SKILL-010: agents sharing one skillsDir produce a single link counted for both", async () => {
    // 从 registry 找出共享同一 skillsDir 的两个 agent（数据驱动，不硬编码具体 agent）
    const agentsRes = await fetch(`${serverCtx.baseUrl}/api/agents`);
    assert.equal(agentsRes.status, 200);
    const agents = await agentsRes.json();
    const byDir = new Map();
    for (const a of agents) {
      if (!byDir.has(a.skillsDir)) byDir.set(a.skillsDir, []);
      byDir.get(a.skillsDir).push(a.name);
    }
    const shared = [...byDir.entries()].find(([, names]) => names.length >= 2);
    assert.ok(shared, "registry must contain at least two agents sharing a skillsDir");
    const [skillsDir, names] = shared;
    const [agentA, agentB] = names;

    const { project, localPath } = await createProjectWithAgents(serverCtx.baseUrl, {
      agentTypes: [agentA, agentB]
    });
    const res = await linkSkill(serverCtx.baseUrl, project.id, { slug: "acme-tools", skillName: "review" });
    assert.equal(res.status, 200);
    const result = await res.json();
    assert.ok(result.agents.find((a) => a.agent === agentA).linked.includes("review"));
    assert.ok(result.agents.find((a) => a.agent === agentB).linked.includes("review"));

    const entries = fs.readdirSync(path.join(localPath, skillsDir));
    assert.deepEqual(entries.filter((e) => e === "review"), ["review"], "exactly one link must exist in the shared dir");
    assertLinkTo(path.join(localPath, skillsDir, "review"), path.join(repoRoot, "acme-tools", "skills", "review"));
  });

  it("REQ-SKILL-010: linking the same skill twice is idempotent", async () => {
    const { project, localPath } = await createProjectWithAgents(serverCtx.baseUrl, {
      agentTypes: ["claude-code"]
    });
    const first = await linkSkill(serverCtx.baseUrl, project.id, { slug: "acme-tools", skillName: "review" });
    assert.equal(first.status, 200);
    const second = await linkSkill(serverCtx.baseUrl, project.id, { slug: "acme-tools", skillName: "review" });
    assert.equal(second.status, 200, "repeat link must succeed");

    const entries = fs.readdirSync(path.join(localPath, ".claude", "skills"));
    assert.deepEqual(entries.filter((e) => e === "review"), ["review"], "still exactly one link");
    assertLinkTo(path.join(localPath, ".claude", "skills", "review"), path.join(repoRoot, "acme-tools", "skills", "review"));
  });

  it("REQ-SKILL-010: linking with empty agentTypes is rejected with PROJECT_AGENTS_EMPTY (E7)", async () => {
    const { project } = await createProjectWithAgents(serverCtx.baseUrl, { agentTypes: [] });
    const res = await linkSkill(serverCtx.baseUrl, project.id, { slug: "acme-tools", skillName: "review" });
    assert.equal(res.status, 409);
    assert.equal((await res.json()).error, "PROJECT_AGENTS_EMPTY");
  });

  it("REQ-SKILL-010: external occupation at the link target is skipped and surfaced as conflict (D4)", async () => {
    const { project, localPath } = await createProjectWithAgents(serverCtx.baseUrl, {
      agentTypes: ["claude-code", "codex"]
    });
    // claude-code 目标位置被外部实体目录占用
    const externalDir = path.join(localPath, ".claude", "skills", "review");
    writeSkillMd(externalDir, { name: "review", description: "external, not ours" });

    const res = await linkSkill(serverCtx.baseUrl, project.id, { slug: "acme-tools", skillName: "review" });
    assert.equal(res.status, 200, "conflict in one agent must not fail the whole link");
    const result = await res.json();
    const claude = result.agents.find((a) => a.agent === "claude-code");
    assert.ok(claude.conflicts.includes("review"), "claude-code should report review as conflicted");
    assert.ok(!claude.linked.includes("review"));

    // 外部实体原样保留（仍是实体目录、内容不变）
    const lst = fs.lstatSync(externalDir);
    assert.ok(lst.isDirectory() && !lst.isSymbolicLink(), "external entity must remain a real directory");
    assert.ok(fs.readFileSync(path.join(externalDir, "SKILL.md"), "utf-8").includes("external, not ours"));

    // codex 照常建链
    const agentsRes = await (await fetch(`${serverCtx.baseUrl}/api/agents`)).json();
    const codexDir = agentsRes.find((a) => a.name === "codex").skillsDir;
    assertLinkTo(path.join(localPath, codexDir, "review"), path.join(repoRoot, "acme-tools", "skills", "review"));
  });

  it("REQ-SKILL-010: per-agent link failure is surfaced in failed[] without aborting others (E5)", async (t) => {
    if (process.platform === "win32" || (process.geteuid && process.geteuid() === 0)) {
      t.skip("permission-based failure injection is unreliable on Windows/root");
      return;
    }
    const { project, localPath } = await createProjectWithAgents(serverCtx.baseUrl, {
      agentTypes: ["claude-code", "codex"]
    });
    // 让 claude-code 的 skillsDir 不可写
    const claudeSkillsDir = path.join(localPath, ".claude", "skills");
    fs.mkdirSync(claudeSkillsDir, { recursive: true });
    fs.chmodSync(claudeSkillsDir, 0o555);
    try {
      const res = await linkSkill(serverCtx.baseUrl, project.id, { slug: "acme-tools", skillName: "review" });
      assert.equal(res.status, 200);
      const result = await res.json();
      const claude = result.agents.find((a) => a.agent === "claude-code");
      assert.ok(claude.failed.includes("review"), "claude-code failure must be surfaced as skillName in failed[]");
      const codex = result.agents.find((a) => a.agent === "codex");
      assert.ok(codex.linked.includes("review"), "other agents must still be linked");
    } finally {
      fs.chmodSync(claudeSkillsDir, 0o755);
    }
  });

  it("REQ-SKILL-010: link requires the {slug, skillName} identity", async () => {
    const { project } = await createProjectWithAgents(serverCtx.baseUrl, { agentTypes: ["claude-code"] });

    const missingSlug = await linkSkill(serverCtx.baseUrl, project.id, { skillName: "review" });
    assert.equal(missingSlug.status, 400, "bare skillName without slug must be rejected");

    const missingName = await linkSkill(serverCtx.baseUrl, project.id, { slug: "acme-tools" });
    assert.equal(missingName.status, 400);

    const badSlug = await linkSkill(serverCtx.baseUrl, project.id, { slug: "no-such-source", skillName: "review" });
    assert.equal(badSlug.status, 404);

    const badSkill = await linkSkill(serverCtx.baseUrl, project.id, { slug: "acme-tools", skillName: "no-such-skill" });
    assert.equal(badSkill.status, 404);
  });

  // ---------- REQ-SKILL-011 取消关联 ----------

  it("REQ-SKILL-011: unlinking removes only our symlink", async () => {
    const { project, localPath } = await createProjectWithAgents(serverCtx.baseUrl, {
      agentTypes: ["claude-code"]
    });
    await linkSkill(serverCtx.baseUrl, project.id, { slug: "acme-tools", skillName: "review" });
    const linkPath = path.join(localPath, ".claude", "skills", "review");
    assertLinkTo(linkPath, path.join(repoRoot, "acme-tools", "skills", "review"));

    const res = await fetch(`${serverCtx.baseUrl}/api/projects/${project.id}/skills/acme-tools/review`, { method: "DELETE" });
    assert.equal(res.status, 200);
    assert.ok(!fs.existsSync(linkPath), "our link must be removed");
    assert.ok(fs.existsSync(path.join(repoRoot, "acme-tools", "skills", "review", "SKILL.md")), "library content must be untouched");
  });

  it("REQ-SKILL-011: unlinking leaves external entries and foreign symlinks untouched", async () => {
    const { project, localPath } = await createProjectWithAgents(serverCtx.baseUrl, {
      agentTypes: ["claude-code"]
    });
    // 外部实体目录
    const externalDir = path.join(localPath, ".claude", "skills", "review");
    writeSkillMd(externalDir, { name: "review", description: "external" });
    // 外部软链（指向技能库之外）
    const foreignTarget = makeTempDir("opc-projskills-foreign-");
    writeSkillMd(path.join(foreignTarget, "skills", "deploy"), { name: "deploy", description: "foreign" });
    const foreignLink = path.join(localPath, ".claude", "skills", "deploy");
    fs.symlinkSync(path.join(foreignTarget, "skills", "deploy"), foreignLink, "dir");

    const res = await fetch(`${serverCtx.baseUrl}/api/projects/${project.id}/skills/acme-tools/review`, { method: "DELETE" });
    assert.equal(res.status, 200, "unlink with nothing of ours should still succeed");

    assert.ok(fs.lstatSync(externalDir).isDirectory() && !fs.lstatSync(externalDir).isSymbolicLink(), "external entity must stay");
    assert.ok(fs.lstatSync(foreignLink).isSymbolicLink(), "foreign symlink must stay");
    fs.rmSync(foreignTarget, { recursive: true, force: true });
  });

  it("REQ-SKILL-011: unlinking a non-linked skill is idempotent success", async () => {
    const { project } = await createProjectWithAgents(serverCtx.baseUrl, { agentTypes: ["claude-code"] });
    const res = await fetch(`${serverCtx.baseUrl}/api/projects/${project.id}/skills/acme-tools/review`, { method: "DELETE" });
    assert.equal(res.status, 200);
  });

  // ---------- REQ-SKILL-010 AC8 / REQ-SKILL-011 AC5 批量 (v1.2) ----------

  it("REQ-SKILL-010 AC8: bulk link links every valid identity, surfaces a bad identity per-item, and does not abort", async () => {
    makeSourceDir(repoRoot, "acme-extras", ["migrate"]);
    const { project, localPath } = await createProjectWithAgents(serverCtx.baseUrl, {
      agentTypes: ["claude-code"]
    });

    const res = await fetch(`${serverCtx.baseUrl}/api/projects/${project.id}/skills`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({
        skills: [
          { slug: "acme-tools", skillName: "review" },
          { slug: "acme-tools", skillName: "deploy" },
          { slug: "acme-extras", skillName: "migrate" },
          { slug: "acme-tools", skillName: "does-not-exist" }
        ]
      })
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body.results), "bulk link must return results[]");
    assert.equal(body.results.length, 4);
    assert.ok(body.count, "bulk link must return count summary");
    assert.equal(body.count.linked, 3);

    const byName = Object.fromEntries(body.results.map((r) => [r.skillName, r]));
    assert.equal(byName.review.status, "linked");
    assert.equal(byName.deploy.status, "linked");
    assert.equal(byName.migrate.status, "linked");
    assert.notEqual(byName["does-not-exist"].status, "linked");
    assert.ok(byName["does-not-exist"].code, "failed item must carry an error code");

    for (const skillName of ["review", "deploy", "migrate"]) {
      const slug = skillName === "migrate" ? "acme-extras" : "acme-tools";
      assertLinkTo(
        path.join(localPath, ".claude", "skills", skillName),
        path.join(repoRoot, slug, "skills", skillName)
      );
    }
  });

  it("REQ-SKILL-010 AC8: bulk link rejects empty / non-array skills with 400", async () => {
    const { project } = await createProjectWithAgents(serverCtx.baseUrl, {
      agentTypes: ["claude-code"]
    });
    for (const badBody of [{ skills: [] }, { skills: "review" }, {}]) {
      const res = await fetch(`${serverCtx.baseUrl}/api/projects/${project.id}/skills`, {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify(badBody)
      });
      assert.equal(res.status, 400, `body ${JSON.stringify(badBody)} must be rejected`);
    }
  });

  it("REQ-SKILL-010 AC8: bulk link with empty agentTypes is rejected with 409 (E7)", async () => {
    const { project } = await createProjectWithAgents(serverCtx.baseUrl); // no agents
    const res = await fetch(`${serverCtx.baseUrl}/api/projects/${project.id}/skills`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ skills: [{ slug: "acme-tools", skillName: "review" }] })
    });
    assert.equal(res.status, 409);
  });

  it("REQ-SKILL-011 AC5: bulk unlink removes only our links, surfaces unknown identities per-item, leaves external entries", async () => {
    const { project, localPath } = await createProjectWithAgents(serverCtx.baseUrl, {
      agentTypes: ["claude-code"]
    });
    await linkSkill(serverCtx.baseUrl, project.id, { slug: "acme-tools", skillName: "review" });
    await linkSkill(serverCtx.baseUrl, project.id, { slug: "acme-tools", skillName: "deploy" });
    const externalDir = path.join(localPath, ".claude", "skills", "external-thing");
    writeSkillMd(externalDir, { name: "external-thing", description: "external" });

    const res = await fetch(`${serverCtx.baseUrl}/api/projects/${project.id}/skills`, {
      method: "DELETE",
      headers: JSON_HEADERS,
      body: JSON.stringify({
        skills: [
          { slug: "acme-tools", skillName: "review" },
          { slug: "acme-tools", skillName: "deploy" },
          { slug: "acme-tools", skillName: "vanished" }
        ]
      })
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body.results));
    assert.equal(body.results.length, 3);
    assert.equal(body.count.unlinked, 2);

    const byName = Object.fromEntries(body.results.map((r) => [r.skillName, r]));
    assert.equal(byName.review.status, "unlinked");
    assert.equal(byName.deploy.status, "unlinked");
    assert.notEqual(byName.vanished.status, "unlinked");
    assert.ok(byName.vanished.code, "skipped item must carry a code");

    assert.ok(!fs.existsSync(path.join(localPath, ".claude", "skills", "review")), "our link removed");
    assert.ok(!fs.existsSync(path.join(localPath, ".claude", "skills", "deploy")), "our link removed");
    assert.ok(fs.existsSync(externalDir), "external entry must be untouched");
  });

  it("REQ-SKILL-011 AC5: bulk unlink rejects empty / non-array skills with 400", async () => {
    const { project } = await createProjectWithAgents(serverCtx.baseUrl, {
      agentTypes: ["claude-code"]
    });
    for (const badBody of [{ skills: [] }, { skills: "review" }, {}]) {
      const res = await fetch(`${serverCtx.baseUrl}/api/projects/${project.id}/skills`, {
        method: "DELETE",
        headers: JSON_HEADERS,
        body: JSON.stringify(badBody)
      });
      assert.equal(res.status, 400, `body ${JSON.stringify(badBody)} must be rejected`);
    }
  });

  // ---------- REQ-SKILL-012 项目技能视图与外部条目 ----------

  it("REQ-SKILL-012: project skill view attributes origin repo/external correctly", async () => {
    const { project, localPath } = await createProjectWithAgents(serverCtx.baseUrl, {
      agentTypes: ["claude-code"]
    });
    await linkSkill(serverCtx.baseUrl, project.id, { slug: "acme-tools", skillName: "review" });
    // 外部实体目录
    writeSkillMd(path.join(localPath, ".claude", "skills", "external-tool"), { name: "external-tool", description: "ext" });
    // 外部软链（指向技能库之外）
    const foreignTarget = makeTempDir("opc-projskills-foreign-");
    writeSkillMd(path.join(foreignTarget, "skills", "foreign-skill"), { name: "foreign-skill", description: "f" });
    fs.symlinkSync(path.join(foreignTarget, "skills", "foreign-skill"), path.join(localPath, ".claude", "skills", "foreign-skill"), "dir");

    const res = await fetch(`${serverCtx.baseUrl}/api/projects/${project.id}/skills`);
    assert.equal(res.status, 200);
    const entries = await res.json();
    const own = entries.find((e) => e.origin === "repo" && e.skillName === "review");
    assert.ok(own, "our linked skill must appear with origin=repo");
    assert.equal(own.slug, "acme-tools");
    assert.ok(own.agents.includes("claude-code"));

    const externalDirEntry = entries.find((e) => e.origin === "external" && (e.name ?? e.skillName) === "external-tool");
    assert.ok(externalDirEntry, "external real dir must be listed with origin=external");
    const foreignLinkEntry = entries.find((e) => e.origin === "external" && (e.name ?? e.skillName) === "foreign-skill");
    assert.ok(foreignLinkEntry, "foreign symlink must be listed with origin=external");

    fs.rmSync(foreignTarget, { recursive: true, force: true });
  });

  it("REQ-SKILL-010/012: nested-layout skills link by leaf dir name and attribute to the source (v1.1)", async () => {
    const { project, localPath } = await createProjectWithAgents(serverCtx.baseUrl, {
      agentTypes: ["claude-code"]
    });
    // 嵌套布局来源：acme-tools 已有 1 层布局的 review/deploy，补一个 engineering/code-review
    writeSkillMd(path.join(repoRoot, "acme-tools", "skills", "engineering", "code-review"), {
      name: "Code Review",
      description: "Review code"
    });

    const res = await linkSkill(serverCtx.baseUrl, project.id, { slug: "acme-tools", skillName: "code-review" });
    assert.equal(res.status, 200);
    const result = await res.json();
    const claude = result.agents.find((a) => a.agent === "claude-code");
    assert.ok(claude.linked.includes("code-review"), "nested-layout skill must link under its leaf dir name");
    assertLinkTo(path.join(localPath, ".claude", "skills", "code-review"), path.join(repoRoot, "acme-tools", "skills", "engineering", "code-review"));

    const view = await (await fetch(`${serverCtx.baseUrl}/api/projects/${project.id}/skills`)).json();
    const own = view.find((e) => e.origin === "repo" && e.skillName === "code-review");
    assert.ok(own, "nested-layout skill must appear in the project view with origin=repo");
    assert.equal(own.slug, "acme-tools");
    assert.ok(own.agents.includes("claude-code"));
  });

  it("REQ-SKILL-012: a broken nested-layout link is attributed by its leaf dir name (v1.1)", async () => {
    const { project } = await createProjectWithAgents(serverCtx.baseUrl, { agentTypes: ["claude-code"] });
    writeSkillMd(path.join(repoRoot, "acme-tools", "skills", "engineering", "code-review"), {
      name: "Code Review",
      description: "Review code"
    });
    await linkSkill(serverCtx.baseUrl, project.id, { slug: "acme-tools", skillName: "code-review" });
    // 目标从库中消失 -> 断链，靠路径形状兜底归因到叶子目录名
    fs.rmSync(path.join(repoRoot, "acme-tools", "skills", "engineering"), { recursive: true, force: true });

    const view = await (await fetch(`${serverCtx.baseUrl}/api/projects/${project.id}/skills`)).json();
    const broken = view.find((e) => (e.skillName ?? e.name) === "code-review");
    assert.ok(broken, "broken nested link must be listed by its leaf dir name");
    assert.equal(broken.broken, true);
  });

  it("REQ-SKILL-012: a link whose library target vanished is marked broken", async () => {
    const { project } = await createProjectWithAgents(serverCtx.baseUrl, { agentTypes: ["claude-code"] });
    await linkSkill(serverCtx.baseUrl, project.id, { slug: "acme-tools", skillName: "review" });
    // 技能库中删除该 skill（链变断链）
    fs.rmSync(path.join(repoRoot, "acme-tools", "skills", "review"), { recursive: true, force: true });

    const res = await fetch(`${serverCtx.baseUrl}/api/projects/${project.id}/skills`);
    const entries = await res.json();
    const broken = entries.find((e) => (e.skillName ?? e.name) === "review");
    assert.ok(broken, "broken link entry must still be listed");
    assert.equal(broken.broken, true);
  });

  it("REQ-SKILL-012: a skill blocked by external occupation is marked conflict", async () => {
    const { project, localPath } = await createProjectWithAgents(serverCtx.baseUrl, { agentTypes: ["claude-code"] });
    writeSkillMd(path.join(localPath, ".claude", "skills", "review"), { name: "review", description: "external" });
    const linkRes = await linkSkill(serverCtx.baseUrl, project.id, { slug: "acme-tools", skillName: "review" });
    assert.equal(linkRes.status, 200);

    const res = await fetch(`${serverCtx.baseUrl}/api/projects/${project.id}/skills`);
    const entries = await res.json();
    const conflicted = entries.find((e) => e.conflict === true);
    assert.ok(conflicted, "view must surface the conflict state on the repo entry");
    assert.equal(conflicted.skillName, "review");
    assert.equal(conflicted.origin, "repo");
  });

  it("REQ-SKILL-012: scan tolerates an unreadable agent dir and still returns the view (E10)", async (t) => {
    if (process.platform === "win32" || (process.geteuid && process.geteuid() === 0)) {
      t.skip("permission-based failure injection is unreliable on Windows/root");
      return;
    }
    const { project, localPath } = await createProjectWithAgents(serverCtx.baseUrl, {
      agentTypes: ["claude-code", "codex"]
    });
    await linkSkill(serverCtx.baseUrl, project.id, { slug: "acme-tools", skillName: "review" });
    const claudeSkillsDir = path.join(localPath, ".claude", "skills");
    fs.chmodSync(claudeSkillsDir, 0o000);
    try {
      const res = await fetch(`${serverCtx.baseUrl}/api/projects/${project.id}/skills`);
      assert.equal(res.status, 200, "view must not fail when one dir is unreadable");
      const entries = await res.json();
      assert.ok(entries.some((e) => e.skillName === "review" || e.name === "review"), "other agents' entries must still be listed");
    } finally {
      fs.chmodSync(claudeSkillsDir, 0o755);
    }
  });
});
