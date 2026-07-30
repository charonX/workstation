// REQ-TRACE: 2026-07-29-multi-agent-skills/REQ-SKILL-005, 2026-07-29-multi-agent-skills/REQ-SKILL-006, 2026-07-29-multi-agent-skills/REQ-SKILL-015, 2026-07-29-multi-agent-skills/REQ-SKILL-016, 2026-07-29-multi-agent-skills/REQ-SKILL-017
// REQ-VERSION: v1-hash:48b5bb090689d0ae76858eee7132e228805e6eb09ff701686d30cc1e6863ee4f
// CAPABILITY-TRACE: skill-management
// ENTITY-TRACE: skill
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true (2026-07-29 assertion signoff)

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startServer, stopServer } from "../../../../../../src/http/server.js";
import { getDb } from "../../../../../../src/db.js";
import * as settingsService from "../../../../../../src/services/settingsService.js";

// agentRegistryService 尚不存在（BUILD 产物）：动态 import，让本文件可加载、测试以 RED 失败而非 import 崩溃。
async function registrySvc() {
  return import("../../../../../../src/services/agentRegistryService.js");
}

const JSON_HEADERS = { "Content-Type": "application/json" };

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeSkillMd(dir, { name, description, extraFrontmatter = "", body }) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${description}\n${extraFrontmatter}---\n\n${body ?? `# ${name}\n`}`
  );
}

function git(cwd, args) {
  execFileSync("git", args, { cwd, stdio: "pipe" });
}

/** 在技能库目录下手工造一个来源目录（绕过安装 API，直接测扫描视图）。 */
function makeSourceDir(repoRoot, slug, { withGitRemote, skills = [] } = {}) {
  const sourceDir = path.join(repoRoot, slug);
  fs.mkdirSync(sourceDir, { recursive: true });
  for (const skill of skills) {
    const skillDir = skill.layout === "root" ? sourceDir : path.join(sourceDir, "skills", skill.dirName);
    writeSkillMd(skillDir, { name: skill.frontmatterName ?? skill.dirName, description: skill.description ?? `${skill.dirName} desc` });
  }
  if (withGitRemote) {
    git(sourceDir, ["init", "-b", "main"]);
    git(sourceDir, ["remote", "add", "origin", withGitRemote]);
  }
  return sourceDir;
}

async function setSkillRepoPath(baseUrl, skillRepoPath) {
  const res = await fetch(`${baseUrl}/api/settings`, {
    method: "PATCH",
    headers: JSON_HEADERS,
    body: JSON.stringify({ skillRepoPath })
  });
  return res;
}

async function createProjectWithAgents(baseUrl, { name = "Proj", agentTypes = [] } = {}) {
  const localPath = makeTempDir("opc-skilllib-proj-");
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

async function waitForJob(baseUrl, jobId, { timeoutMs = 15000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await fetch(`${baseUrl}/api/skills/jobs/${jobId}`);
    assert.equal(res.status, 200);
    const job = await res.json();
    if (job.status === "success" || job.status === "error") return job;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.fail(`job ${jobId} did not reach a terminal state`);
}

describe("Skill Library (settings / scan view / remove / update / legacy cleanup)", () => {
  let serverCtx;
  let repoRoot;

  beforeEach(async () => {
    serverCtx = await startServer();
    repoRoot = makeTempDir("opc-skilllib-root-");
    const res = await setSkillRepoPath(serverCtx.baseUrl, repoRoot);
    assert.equal(res.status, 200);
  });

  afterEach(async () => {
    await stopServer(serverCtx);
    fs.rmSync(repoRoot, { recursive: true, force: true });
  });

  // ---------- REQ-SKILL-005 技能库路径设置与冲突校验 ----------

  it("REQ-SKILL-005: default skill library path is ~/.opc-workstation/skills when unconfigured", () => {
    const prevConfigDir = process.env.OPC_WORKSTATION_CONFIG_DIR;
    const freshConfigDir = makeTempDir("opc-settings-default-");
    process.env.OPC_WORKSTATION_CONFIG_DIR = freshConfigDir;
    try {
      settingsService.resetSettings();
      const settings = settingsService.loadSettings();
      assert.equal(settings.skillRepoPath, path.join(os.homedir(), ".opc-workstation", "skills"));
    } finally {
      if (prevConfigDir === undefined) delete process.env.OPC_WORKSTATION_CONFIG_DIR;
      else process.env.OPC_WORKSTATION_CONFIG_DIR = prevConfigDir;
      settingsService.resetSettings();
      fs.rmSync(freshConfigDir, { recursive: true, force: true });
    }
  });

  it("REQ-SKILL-005: rejects library path equal to a universal agent global scan dir", async () => {
    const res = await setSkillRepoPath(serverCtx.baseUrl, path.join(os.homedir(), ".agents", "skills"));
    assert.equal(res.status, 400);
    const data = await res.json();
    assert.equal(data.error, "SKILL_REPO_PATH_CONFLICT");
    assert.ok(Array.isArray(data.conflicts) && data.conflicts.length > 0, "error body must list conflicting agents");
  });

  it("REQ-SKILL-005: rejects library path nested inside a scan dir and a parent dir of a scan dir", async () => {
    const nested = await setSkillRepoPath(serverCtx.baseUrl, path.join(os.homedir(), ".agents", "skills", "nested"));
    assert.equal(nested.status, 400);
    assert.equal((await nested.json()).error, "SKILL_REPO_PATH_CONFLICT");

    const parent = await setSkillRepoPath(serverCtx.baseUrl, path.join(os.homedir(), ".agents"));
    assert.equal(parent.status, 400);
    assert.equal((await parent.json()).error, "SKILL_REPO_PATH_CONFLICT");
  });

  it("REQ-SKILL-005: rejects library path equal to claude-code global scan dir (env-expanded)", async () => {
    const agentRegistryService = await registrySvc();
    const claudeGlobal = agentRegistryService.getGlobalSkillsDir("claude-code");
    assert.ok(claudeGlobal, "claude-code must have a global skills dir in the registry");
    const res = await setSkillRepoPath(serverCtx.baseUrl, claudeGlobal);
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error, "SKILL_REPO_PATH_CONFLICT");
  });

  it("REQ-SKILL-005: accepts a legal path and scans from the new root", async () => {
    const legalRoot = makeTempDir("opc-skilllib-legal-");
    try {
      const res = await setSkillRepoPath(serverCtx.baseUrl, legalRoot);
      assert.equal(res.status, 200);

      makeSourceDir(legalRoot, "acme-tools", { skills: [{ dirName: "review" }] });
      const list = await fetch(`${serverCtx.baseUrl}/api/skills`);
      assert.equal(list.status, 200);
      const groups = await list.json();
      assert.equal(groups.length, 1);
      assert.equal(groups[0].slug, "acme-tools");
    } finally {
      fs.rmSync(legalRoot, { recursive: true, force: true });
    }
  });

  // ---------- REQ-SKILL-006 技能列表 = 分组扫描视图 ----------

  it("REQ-SKILL-006: lists sources grouped with sourceType, sourceUrl and parsed skill metadata", async () => {
    const gitUrl = "https://example.com/acme/acme-tools.git";
    makeSourceDir(repoRoot, "acme-tools", {
      withGitRemote: gitUrl,
      skills: [{ dirName: "review", description: "Reviews code" }, { dirName: "deploy", description: "Deploys stuff" }]
    });
    makeSourceDir(repoRoot, "local-pack", {
      skills: [{ dirName: "notes", description: "Note taking" }]
    });

    const res = await fetch(`${serverCtx.baseUrl}/api/skills`);
    assert.equal(res.status, 200);
    const groups = await res.json();
    assert.equal(groups.length, 2);

    const gitGroup = groups.find((g) => g.slug === "acme-tools");
    assert.equal(gitGroup.sourceType, "git");
    assert.equal(gitGroup.sourceUrl, gitUrl);
    const skillNames = gitGroup.skills.map((s) => s.skillName).sort();
    assert.deepEqual(skillNames, ["deploy", "review"]);
    const review = gitGroup.skills.find((s) => s.skillName === "review");
    assert.equal(review.name, "review");
    assert.equal(review.description, "Reviews code");

    const localGroup = groups.find((g) => g.slug === "local-pack");
    assert.equal(localGroup.sourceType, "local");
    assert.equal(localGroup.sourceUrl, null);
  });

  it("REQ-SKILL-006: supports root-level SKILL.md layout with skillName equal to source dir name", async () => {
    makeSourceDir(repoRoot, "solo-skill", {
      skills: [{ dirName: "solo-skill", layout: "root", frontmatterName: "Solo", description: "Single skill at root" }]
    });

    const res = await fetch(`${serverCtx.baseUrl}/api/skills`);
    const groups = await res.json();
    assert.equal(groups.length, 1);
    assert.equal(groups[0].skills.length, 1);
    assert.equal(groups[0].skills[0].skillName, "solo-skill");
    assert.equal(groups[0].skills[0].description, "Single skill at root");
  });

  it("REQ-SKILL-006: skips directories whose SKILL.md misses name/description (E6) without failing the scan", async () => {
    makeSourceDir(repoRoot, "mixed", { skills: [{ dirName: "good" }] });
    // 非法：缺 description
    const badDir = path.join(repoRoot, "mixed", "skills", "bad");
    fs.mkdirSync(badDir, { recursive: true });
    fs.writeFileSync(path.join(badDir, "SKILL.md"), `---\nname: bad\n---\n\n# bad\n`);

    const res = await fetch(`${serverCtx.baseUrl}/api/skills`);
    assert.equal(res.status, 200, "scan must not fail on invalid skill dirs");
    const groups = await res.json();
    const mixed = groups.find((g) => g.slug === "mixed");
    assert.deepEqual(mixed.skills.map((s) => s.skillName), ["good"]);
  });

  it("REQ-SKILL-006: reflects manual disk changes on the next scan (disk as truth, no cache)", async () => {
    makeSourceDir(repoRoot, "acme-tools", { skills: [{ dirName: "review" }] });
    let res = await fetch(`${serverCtx.baseUrl}/api/skills`);
    assert.equal((await res.json()).length, 1);

    makeSourceDir(repoRoot, "second-pack", { skills: [{ dirName: "extra" }] });
    res = await fetch(`${serverCtx.baseUrl}/api/skills`);
    assert.equal((await res.json()).length, 2);

    fs.rmSync(path.join(repoRoot, "acme-tools"), { recursive: true, force: true });
    res = await fetch(`${serverCtx.baseUrl}/api/skills`);
    const groups = await res.json();
    assert.equal(groups.length, 1);
    assert.equal(groups[0].slug, "second-pack");
  });

  // ---------- REQ-SKILL-015 来源级联移除 ----------

  it("REQ-SKILL-015: deleting a source cascades link removal across projects and deletes the source dir", async () => {
    makeSourceDir(repoRoot, "acme-tools", { skills: [{ dirName: "review" }] });
    makeSourceDir(repoRoot, "other-pack", { skills: [{ dirName: "notes" }] });

    const p1 = await createProjectWithAgents(serverCtx.baseUrl, { name: "P1", agentTypes: ["claude-code"] });
    const p2 = await createProjectWithAgents(serverCtx.baseUrl, { name: "P2", agentTypes: ["claude-code"] });

    for (const { project } of [p1, p2]) {
      const res = await fetch(`${serverCtx.baseUrl}/api/projects/${project.id}/skills`, {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ slug: "acme-tools", skillName: "review" })
      });
      assert.equal(res.status, 200);
    }

    // 外部实体目录：级联删除不得触碰
    const externalDir = path.join(p1.localPath, ".claude", "skills", "external-tool");
    fs.mkdirSync(externalDir, { recursive: true });
    writeSkillMd(externalDir, { name: "external-tool", description: "not ours" });

    const del = await fetch(`${serverCtx.baseUrl}/api/skills/acme-tools`, { method: "DELETE" });
    assert.equal(del.status, 200);
    const delBody = await del.json();
    assert.equal(delBody.deleted, "acme-tools");

    for (const { localPath } of [p1, p2]) {
      const linkPath = path.join(localPath, ".claude", "skills", "review");
      assert.ok(!fs.existsSync(linkPath), `link should be removed in ${localPath}`);
    }
    assert.ok(!fs.existsSync(path.join(repoRoot, "acme-tools")), "source dir must be deleted");
    assert.ok(fs.existsSync(externalDir), "external entry must be untouched");
    assert.ok(fs.existsSync(path.join(repoRoot, "other-pack")), "other sources must be untouched");

    const list = await (await fetch(`${serverCtx.baseUrl}/api/skills`)).json();
    assert.deepEqual(list.map((g) => g.slug), ["other-pack"]);
  });

  it("REQ-SKILL-015: deleting a non-existent source returns 404", async () => {
    const res = await fetch(`${serverCtx.baseUrl}/api/skills/no-such-source`, { method: "DELETE" });
    assert.equal(res.status, 404);
  });

  // ---------- REQ-SKILL-016 来源更新 ----------

  it("REQ-SKILL-016: git update pulls new commits ff-only and project links see new content", async () => {
    const origin = makeTempDir("opc-skilllib-origin-");
    try {
      git(origin, ["init", "-b", "main"]);
      git(origin, ["config", "user.email", "test@example.com"]);
      git(origin, ["config", "user.name", "Test User"]);
      writeSkillMd(path.join(origin, "skills", "review"), { name: "review", description: "v1", body: "# v1\n" });
      git(origin, ["add", "."]);
      git(origin, ["commit", "-m", "v1"]);

      const install = await fetch(`${serverCtx.baseUrl}/api/skills/install`, {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ sourceType: "git", identifier: `file://${origin}` })
      });
      assert.equal(install.status, 202);
      const { jobId } = await install.json();
      const job = await waitForJob(serverCtx.baseUrl, jobId);
      assert.equal(job.status, "success");
      const groups = await (await fetch(`${serverCtx.baseUrl}/api/skills`)).json();
      const slug = groups[0].slug;

      const { project, localPath } = await createProjectWithAgents(serverCtx.baseUrl, { agentTypes: ["claude-code"] });
      const linkRes = await fetch(`${serverCtx.baseUrl}/api/projects/${project.id}/skills`, {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ slug, skillName: "review" })
      });
      assert.equal(linkRes.status, 200);

      // 上游新增提交
      writeSkillMd(path.join(origin, "skills", "review"), { name: "review", description: "v2", body: "# v2\n" });
      git(origin, ["add", "."]);
      git(origin, ["commit", "-m", "v2"]);

      const update = await fetch(`${serverCtx.baseUrl}/api/skills/${slug}/update`, { method: "POST" });
      assert.equal(update.status, 202);
      const updateJob = await waitForJob(serverCtx.baseUrl, (await update.json()).jobId);
      assert.equal(updateJob.status, "success");

      // 项目侧零操作：经软链读到新内容
      const throughLink = fs.readFileSync(path.join(localPath, ".claude", "skills", "review", "SKILL.md"), "utf-8");
      assert.ok(throughLink.includes("# v2"), "project symlink should expose updated content");
    } finally {
      fs.rmSync(origin, { recursive: true, force: true });
    }
  });

  it("REQ-SKILL-016: update fails surfaced when the library clone has local changes (no reset)", async () => {
    const origin = makeTempDir("opc-skilllib-origin-");
    try {
      git(origin, ["init", "-b", "main"]);
      git(origin, ["config", "user.email", "test@example.com"]);
      git(origin, ["config", "user.name", "Test User"]);
      writeSkillMd(path.join(origin, "skills", "review"), { name: "review", description: "v1" });
      git(origin, ["add", "."]);
      git(origin, ["commit", "-m", "v1"]);

      const install = await fetch(`${serverCtx.baseUrl}/api/skills/install`, {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ sourceType: "git", identifier: `file://${origin}` })
      });
      const job = await waitForJob(serverCtx.baseUrl, (await install.json()).jobId);
      assert.equal(job.status, "success");
      const slug = (await (await fetch(`${serverCtx.baseUrl}/api/skills`)).json())[0].slug;

      writeSkillMd(path.join(origin, "skills", "review"), { name: "review", description: "v2" });
      git(origin, ["add", "."]);
      git(origin, ["commit", "-m", "v2"]);

      // 技能库克隆内制造本地改动
      const localFile = path.join(repoRoot, slug, "skills", "review", "SKILL.md");
      fs.writeFileSync(localFile, "local dirty change\n");

      const update = await fetch(`${serverCtx.baseUrl}/api/skills/${slug}/update`, { method: "POST" });
      assert.equal(update.status, 202);
      const updateJob = await waitForJob(serverCtx.baseUrl, (await update.json()).jobId);
      assert.equal(updateJob.status, "error");
      assert.ok(updateJob.error?.message, "ff-only failure must be surfaced with an error message");
      assert.equal(fs.readFileSync(localFile, "utf-8"), "local dirty change\n", "failed update must not reset local changes");
    } finally {
      fs.rmSync(origin, { recursive: true, force: true });
    }
  });

  it("REQ-SKILL-016: update on a local source is rejected with SKILL_UPDATE_UNSUPPORTED", async () => {
    const source = makeTempDir("opc-skilllib-local-src-");
    writeSkillMd(path.join(source, "skills", "notes"), { name: "notes", description: "n" });
    try {
      const install = await fetch(`${serverCtx.baseUrl}/api/skills/install`, {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ sourceType: "local", identifier: source })
      });
      const job = await waitForJob(serverCtx.baseUrl, (await install.json()).jobId);
      assert.equal(job.status, "success");
      const slug = (await (await fetch(`${serverCtx.baseUrl}/api/skills`)).json())[0].slug;

      const res = await fetch(`${serverCtx.baseUrl}/api/skills/${slug}/update`, { method: "POST" });
      assert.equal(res.status, 400);
      assert.equal((await res.json()).error, "SKILL_UPDATE_UNSUPPORTED");
    } finally {
      fs.rmSync(source, { recursive: true, force: true });
    }
  });

  it("REQ-SKILL-016: update with no upstream changes succeeds without modifying content", async () => {
    const origin = makeTempDir("opc-skilllib-origin-");
    try {
      git(origin, ["init", "-b", "main"]);
      git(origin, ["config", "user.email", "test@example.com"]);
      git(origin, ["config", "user.name", "Test User"]);
      writeSkillMd(path.join(origin, "skills", "review"), { name: "review", description: "v1", body: "# v1\n" });
      git(origin, ["add", "."]);
      git(origin, ["commit", "-m", "v1"]);

      const install = await fetch(`${serverCtx.baseUrl}/api/skills/install`, {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ sourceType: "git", identifier: `file://${origin}` })
      });
      const job = await waitForJob(serverCtx.baseUrl, (await install.json()).jobId);
      assert.equal(job.status, "success");
      const slug = (await (await fetch(`${serverCtx.baseUrl}/api/skills`)).json())[0].slug;

      const update = await fetch(`${serverCtx.baseUrl}/api/skills/${slug}/update`, { method: "POST" });
      const updateJob = await waitForJob(serverCtx.baseUrl, (await update.json()).jobId);
      assert.equal(updateJob.status, "success");
      const content = fs.readFileSync(path.join(repoRoot, slug, "skills", "review", "SKILL.md"), "utf-8");
      assert.ok(content.includes("# v1"));
    } finally {
      fs.rmSync(origin, { recursive: true, force: true });
    }
  });

  // ---------- REQ-SKILL-017 旧机制清除 ----------

  it("REQ-SKILL-017: database has no skills/skill_repos/project_skills tables and projects has agentTypes", () => {
    const db = getDb();
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name);
    for (const dropped of ["skills", "skill_repos", "project_skills"]) {
      assert.ok(!tables.includes(dropped), `table ${dropped} must not exist`);
    }
    const projectCols = db.prepare("PRAGMA table_info(projects)").all().map((c) => c.name);
    assert.ok(projectCols.includes("agentTypes"), "projects must have agentTypes column");
  });

  it("REQ-SKILL-017: legacy /api/skill-repos endpoints are gone", async () => {
    const list = await fetch(`${serverCtx.baseUrl}/api/skill-repos`);
    assert.equal(list.status, 404);
    const del = await fetch(`${serverCtx.baseUrl}/api/skill-repos/whatever`, { method: "DELETE" });
    assert.equal(del.status, 404);
  });

  it("REQ-SKILL-017: linking a skill never creates a .opc/skills path in the project", async () => {
    makeSourceDir(repoRoot, "acme-tools", { skills: [{ dirName: "review" }] });
    const { project, localPath } = await createProjectWithAgents(serverCtx.baseUrl, { agentTypes: ["claude-code"] });
    const res = await fetch(`${serverCtx.baseUrl}/api/projects/${project.id}/skills`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ slug: "acme-tools", skillName: "review" })
    });
    assert.equal(res.status, 200);
    assert.ok(!fs.existsSync(path.join(localPath, ".opc")), "project must not gain a .opc directory");
  });

  it("REQ-SKILL-017: linking a skill with dependencies frontmatter links only itself (no cascade)", async () => {
    makeSourceDir(repoRoot, "acme-tools", {
      skills: [{ dirName: "review" }, { dirName: "helper-base" }]
    });
    // 给 review 加上 dependencies 声明（旧级联机制的输入）
    writeSkillMd(path.join(repoRoot, "acme-tools", "skills", "review"), {
      name: "review",
      description: "r",
      extraFrontmatter: "dependencies:\n  - helper-base\n"
    });

    const { project, localPath } = await createProjectWithAgents(serverCtx.baseUrl, { agentTypes: ["claude-code"] });
    const res = await fetch(`${serverCtx.baseUrl}/api/projects/${project.id}/skills`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ slug: "acme-tools", skillName: "review" })
    });
    assert.equal(res.status, 200);
    assert.ok(fs.existsSync(path.join(localPath, ".claude", "skills", "review")), "requested skill must be linked");
    assert.ok(!fs.existsSync(path.join(localPath, ".claude", "skills", "helper-base")), "dependency must NOT be cascaded");
  });

  it("REQ-SKILL-017: reconcileUserSkillRepos is removed from the startup path (structural guard)", () => {
    // 结构性守护：旧启动协调逻辑不得回潮（行为不可观测，静态断言防止复活）
    const skillServiceSrc = fs.readFileSync(path.resolve("src/services/skillService.js"), "utf-8");
    const serverSrc = fs.readFileSync(path.resolve("src/http/server.js"), "utf-8");
    assert.ok(!skillServiceSrc.includes("reconcileUserSkillRepos"), "skillService must not define reconcileUserSkillRepos");
    assert.ok(!serverSrc.includes("reconcileUserSkillRepos"), "server startup must not call reconcileUserSkillRepos");
  });
});
