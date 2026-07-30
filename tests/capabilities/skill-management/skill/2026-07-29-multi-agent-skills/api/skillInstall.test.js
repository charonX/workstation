// REQ-TRACE: 2026-07-29-multi-agent-skills/REQ-SKILL-007, 2026-07-29-multi-agent-skills/REQ-SKILL-008, 2026-07-29-multi-agent-skills/REQ-SKILL-009
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

const JSON_HEADERS = { "Content-Type": "application/json" };

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeSkillMd(dir, { name, description }) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n`);
}

function git(cwd, args) {
  execFileSync("git", args, { cwd, stdio: "pipe" });
}

/** 造一个 git 来源仓库（含 skills/* 布局的两个 skill），返回仓库路径。 */
function createGitOrigin(dir) {
  fs.mkdirSync(dir, { recursive: true });
  git(dir, ["init", "-b", "main"]);
  git(dir, ["config", "user.email", "test@example.com"]);
  git(dir, ["config", "user.name", "Test User"]);
  writeSkillMd(path.join(dir, "skills", "review"), { name: "review", description: "Reviews code" });
  writeSkillMd(path.join(dir, "skills", "deploy"), { name: "deploy", description: "Deploys stuff" });
  git(dir, ["add", "."]);
  git(dir, ["commit", "-m", "initial"]);
  return dir;
}

async function startInstall(baseUrl, body) {
  return fetch(`${baseUrl}/api/skills/install`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(body)
  });
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

describe("Skill Install (git / local / legacy sources removed)", () => {
  let serverCtx;
  let repoRoot;

  beforeEach(async () => {
    serverCtx = await startServer();
    repoRoot = makeTempDir("opc-install-root-");
    const res = await fetch(`${serverCtx.baseUrl}/api/settings`, {
      method: "PATCH",
      headers: JSON_HEADERS,
      body: JSON.stringify({ skillRepoPath: repoRoot })
    });
    assert.equal(res.status, 200);
  });

  afterEach(async () => {
    await stopServer(serverCtx);
    fs.rmSync(repoRoot, { recursive: true, force: true });
  });

  // ---------- REQ-SKILL-007 git 来源安装 ----------

  it("REQ-SKILL-007: installs a git source into the library as an async job", async () => {
    const origin = createGitOrigin(makeTempDir("opc-install-origin-"));
    try {
      const res = await startInstall(serverCtx.baseUrl, { sourceType: "git", identifier: `file://${origin}` });
      assert.equal(res.status, 202);
      const { jobId } = await res.json();
      assert.ok(jobId, "install must return a jobId");

      const job = await waitForJob(serverCtx.baseUrl, jobId);
      assert.equal(job.status, "success");

      const groups = await (await fetch(`${serverCtx.baseUrl}/api/skills`)).json();
      assert.equal(groups.length, 1);
      const group = groups[0];
      assert.equal(group.sourceType, "git");
      assert.equal(group.sourceUrl, `file://${origin}`);
      assert.deepEqual(group.skills.map((s) => s.skillName).sort(), ["deploy", "review"]);
      assert.ok(fs.existsSync(path.join(repoRoot, group.slug, "skills", "review", "SKILL.md")), "cloned source must exist under <repoRoot>/<slug>");
    } finally {
      fs.rmSync(origin, { recursive: true, force: true });
    }
  });

  it("REQ-SKILL-007: rejects a git source without any SKILL.md and leaves no residue", async () => {
    const origin = makeTempDir("opc-install-origin-");
    git(origin, ["init", "-b", "main"]);
    git(origin, ["config", "user.email", "test@example.com"]);
    git(origin, ["config", "user.name", "Test User"]);
    fs.writeFileSync(path.join(origin, "README.md"), "no skills here\n");
    git(origin, ["add", "."]);
    git(origin, ["commit", "-m", "initial"]);
    try {
      const res = await startInstall(serverCtx.baseUrl, { sourceType: "git", identifier: `file://${origin}` });
      assert.equal(res.status, 202);
      const job = await waitForJob(serverCtx.baseUrl, (await res.json()).jobId);
      assert.equal(job.status, "error");
      assert.equal(job.error?.code, "SKILL_SOURCE_INVALID");
      assert.equal(fs.readdirSync(repoRoot).length, 0, "failed install must leave no residue in the library");
    } finally {
      fs.rmSync(origin, { recursive: true, force: true });
    }
  });

  it("REQ-SKILL-007: fetch failure surfaces SKILL_FETCH_FAILED and leaves no residue (E1)", async () => {
    const bogus = path.join(os.tmpdir(), `opc-install-bogus-${Date.now()}`);
    const res = await startInstall(serverCtx.baseUrl, { sourceType: "git", identifier: `file://${bogus}` });
    assert.equal(res.status, 202);
    const job = await waitForJob(serverCtx.baseUrl, (await res.json()).jobId);
    assert.equal(job.status, "error");
    assert.equal(job.error?.code, "SKILL_FETCH_FAILED");
    assert.equal(fs.readdirSync(repoRoot).length, 0, "failed fetch must leave no residue");
  });

  it("REQ-SKILL-007: missing git binary is rejected with GIT_UNAVAILABLE 503 (E3)", async () => {
    const origin = createGitOrigin(makeTempDir("opc-install-origin-"));
    const emptyBin = makeTempDir("opc-install-empty-bin-");
    const savedPath = process.env.PATH;
    process.env.PATH = emptyBin;
    try {
      const res = await startInstall(serverCtx.baseUrl, { sourceType: "git", identifier: `file://${origin}` });
      assert.equal(res.status, 503);
      assert.equal((await res.json()).error, "GIT_UNAVAILABLE");
    } finally {
      process.env.PATH = savedPath;
      fs.rmSync(emptyBin, { recursive: true, force: true });
      fs.rmSync(origin, { recursive: true, force: true });
    }
  });

  // ---------- REQ-SKILL-008 local 来源安装 ----------

  it("REQ-SKILL-008: installs a local source by copying (excluding .git) into the library", async () => {
    const source = makeTempDir("opc-install-local-src-");
    writeSkillMd(path.join(source, "skills", "notes"), { name: "notes", description: "Note taking" });
    // 源目录带 .git：拷贝必须排除
    fs.mkdirSync(path.join(source, ".git"), { recursive: true });
    fs.writeFileSync(path.join(source, ".git", "MARKER"), "should not be copied");
    try {
      const res = await startInstall(serverCtx.baseUrl, { sourceType: "local", identifier: source });
      assert.equal(res.status, 202);
      const job = await waitForJob(serverCtx.baseUrl, (await res.json()).jobId);
      assert.equal(job.status, "success");

      const groups = await (await fetch(`${serverCtx.baseUrl}/api/skills`)).json();
      assert.equal(groups.length, 1);
      const group = groups[0];
      assert.equal(group.sourceType, "local");
      assert.equal(group.slug, path.basename(source));
      assert.ok(fs.existsSync(path.join(repoRoot, group.slug, "skills", "notes", "SKILL.md")));
      assert.ok(!fs.existsSync(path.join(repoRoot, group.slug, ".git")), ".git must be excluded from the copy");
    } finally {
      fs.rmSync(source, { recursive: true, force: true });
    }
  });

  it("REQ-SKILL-008: rejects invalid local sources with SKILL_SOURCE_INVALID (E2)", async () => {
    const cases = [];
    // 路径不存在
    cases.push(path.join(os.tmpdir(), `opc-install-missing-${Date.now()}`));
    // 是文件不是目录
    const filePath = path.join(makeTempDir("opc-install-file-"), "a-file");
    fs.writeFileSync(filePath, "x");
    cases.push(filePath);
    // 目录无 SKILL.md
    cases.push(makeTempDir("opc-install-empty-"));
    // 技能库自身（自引用）
    cases.push(repoRoot);

    for (const identifier of cases) {
      const res = await startInstall(serverCtx.baseUrl, { sourceType: "local", identifier });
      assert.equal(res.status, 400, `expected 400 for ${identifier}`);
      assert.equal((await res.json()).error, "SKILL_SOURCE_INVALID");
    }
    assert.equal(fs.readdirSync(repoRoot).length, 0, "rejected installs must leave no residue");
  });

  it("REQ-SKILL-008: rejects skill dirs with illegal directory names (E2)", async () => {
    const source = makeTempDir("opc-install-badname-");
    writeSkillMd(path.join(source, "skills", "bad name"), { name: "bad", description: "space in dir name" });
    try {
      const res = await startInstall(serverCtx.baseUrl, { sourceType: "local", identifier: source });
      assert.equal(res.status, 400);
      assert.equal((await res.json()).error, "SKILL_SOURCE_INVALID");
      assert.equal(fs.readdirSync(repoRoot).length, 0);
    } finally {
      fs.rmSync(source, { recursive: true, force: true });
    }
  });

  it("REQ-SKILL-008: slug conflict without force returns 409 SKILL_SLUG_CONFLICT and writes nothing (E12)", async () => {
    const parentA = makeTempDir("opc-install-a-");
    const parentB = makeTempDir("opc-install-b-");
    const srcA = path.join(parentA, "same-name");
    const srcB = path.join(parentB, "same-name");
    writeSkillMd(path.join(srcA, "skills", "one"), { name: "one", description: "from A" });
    writeSkillMd(path.join(srcB, "skills", "two"), { name: "two", description: "from B" });
    try {
      const first = await startInstall(serverCtx.baseUrl, { sourceType: "local", identifier: srcA });
      const job = await waitForJob(serverCtx.baseUrl, (await first.json()).jobId);
      assert.equal(job.status, "success");

      const conflict = await startInstall(serverCtx.baseUrl, { sourceType: "local", identifier: srcB });
      assert.equal(conflict.status, 409);
      const data = await conflict.json();
      assert.equal(data.error, "SKILL_SLUG_CONFLICT");

      // 原目录内容未被触碰
      assert.ok(fs.existsSync(path.join(repoRoot, "same-name", "skills", "one", "SKILL.md")));
      assert.ok(!fs.existsSync(path.join(repoRoot, "same-name", "skills", "two")), "conflicting install must not write");
    } finally {
      fs.rmSync(parentA, { recursive: true, force: true });
      fs.rmSync(parentB, { recursive: true, force: true });
    }
  });

  it("REQ-SKILL-008: slug conflict with force=true overwrites the existing source", async () => {
    const parentA = makeTempDir("opc-install-a-");
    const parentB = makeTempDir("opc-install-b-");
    const srcA = path.join(parentA, "same-name");
    const srcB = path.join(parentB, "same-name");
    writeSkillMd(path.join(srcA, "skills", "one"), { name: "one", description: "from A" });
    writeSkillMd(path.join(srcB, "skills", "two"), { name: "two", description: "from B" });
    try {
      const first = await startInstall(serverCtx.baseUrl, { sourceType: "local", identifier: srcA });
      const job = await waitForJob(serverCtx.baseUrl, (await first.json()).jobId);
      assert.equal(job.status, "success");

      const forced = await startInstall(serverCtx.baseUrl, { sourceType: "local", identifier: srcB, force: true });
      assert.equal(forced.status, 202);
      const forcedJob = await waitForJob(serverCtx.baseUrl, (await forced.json()).jobId);
      assert.equal(forcedJob.status, "success");

      assert.ok(!fs.existsSync(path.join(repoRoot, "same-name", "skills", "one")), "old content must be replaced");
      assert.ok(fs.existsSync(path.join(repoRoot, "same-name", "skills", "two", "SKILL.md")), "new content must be present");
    } finally {
      fs.rmSync(parentA, { recursive: true, force: true });
      fs.rmSync(parentB, { recursive: true, force: true });
    }
  });

  // ---------- REQ-SKILL-009 npm / Claude Plugin 来源移除 ----------

  it("REQ-SKILL-009: install endpoint rejects npm and plugin sources", async () => {
    for (const sourceType of ["npm", "plugin"]) {
      const res = await startInstall(serverCtx.baseUrl, { sourceType, identifier: "whatever" });
      assert.equal(res.status, 400, `sourceType ${sourceType} must be rejected`);
      assert.equal((await res.json()).error, "SKILL_SOURCE_INVALID");
    }
  });

  it("REQ-SKILL-009: npm/plugin install logic is gone from the service (structural guard)", () => {
    const skillServiceSrc = fs.readFileSync(path.resolve("src/services/skillService.js"), "utf-8");
    assert.ok(!/sourceType?\s*[=!:]==?\s*["']npm["']/.test(skillServiceSrc), "npm install branch must not exist");
    assert.ok(!/sourceType?\s*[=!:]==?\s*["']plugin["']/.test(skillServiceSrc), "plugin install branch must not exist");
  });
});
