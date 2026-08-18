// REQ-TRACE: 2026-08-18-skill-update-diagnostics/REQ-SKILL-020, 2026-08-18-skill-update-diagnostics/REQ-SKILL-021
// REQ-VERSION: v1-hash:7885a24c88a9e9b8a2c1d4d8e36aaf859f2240bed4dcebdeda1126a728277941
// CAPABILITY-TRACE: skill-management
// ENTITY-TRACE: skill
// EXPECTED-TRACE: prd.md §6.3 锚点——version 四态（0.24.0/1.1.0/7位短哈希/null）+ §10.4 契约（job +log: string|null，成功 null / 失败 git stderr 原文）
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: false

// REQ-SKILL-020（版本号展示）/ REQ-SKILL-021（失败 log）API 契约。
// version 解析顺序：package.json.version → git 源 git rev-parse --short HEAD → null。
// job.log：终态才有值（成功 null / 失败 git 输出原文）；pending/running 为 null。
//
// seam：src/http/server.js startServer 全栈（skillLibrary.test.js 先例）+ 临时技能库
// （setSkillRepoPath）+ 手工来源目录（makeSourceDir）+ 真实 git 源安装（install API）。

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

function git(cwd, args) {
  execFileSync("git", args, { cwd, stdio: "pipe" });
}

function writeSkillMd(dir, { name, description }) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n`);
}

function writePackageJson(dir, content) {
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify(content));
}

function initGitRepo(sourceDir) {
  git(sourceDir, ["init", "-b", "main"]);
  git(sourceDir, ["config", "user.email", "test@example.com"]);
  git(sourceDir, ["config", "user.name", "Test User"]);
  writeSkillMd(path.join(sourceDir, "skills", "alpha"), { name: "alpha", description: "alpha desc" });
  git(sourceDir, ["add", "."]);
  git(sourceDir, ["commit", "-m", "init"]);
}

async function setSkillRepoPath(baseUrl, skillRepoPath) {
  const res = await fetch(`${baseUrl}/api/settings`, {
    method: "PATCH",
    headers: JSON_HEADERS,
    body: JSON.stringify({ skillRepoPath }),
  });
  assert.equal(res.status, 200);
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

describe("REQ-SKILL-020 技能源版本号展示", () => {
  let serverCtx;
  let repoRoot;

  beforeEach(async () => {
    serverCtx = await startServer();
    repoRoot = makeTempDir("opc-skilllib-ver-");
    await setSkillRepoPath(serverCtx.baseUrl, repoRoot);
  });

  afterEach(async () => {
    await stopServer(serverCtx);
    fs.rmSync(repoRoot, { recursive: true, force: true });
  });

  async function listGroups() {
    const res = await fetch(`${serverCtx.baseUrl}/api/skills`);
    assert.equal(res.status, 200);
    return res.json();
  }

  function groupBySlug(groups, slug) {
    return groups.find((g) => g.slug === slug);
  }

  it("AC1: git 源 package.json 有 version → version = 该值（0.24.0）", async () => {
    // EXPECTED-TRACE: prd.md §6.3（实证 charonX-workflow → "0.24.0"）
    const sourceDir = path.join(repoRoot, "charon");
    fs.mkdirSync(sourceDir, { recursive: true });
    initGitRepo(sourceDir);
    writePackageJson(sourceDir, { version: "0.24.0" });

    const groups = await listGroups();
    const group = groupBySlug(groups, "charon");
    assert.ok(group, "charon 源应被扫描到");
    assert.equal(group.version, "0.24.0");
  });

  it("AC2: local 源 package.json 有 version → version = 该值（1.1.0）", async () => {
    // EXPECTED-TRACE: prd.md §6.3（实证 mattpocock-skills → "1.1.0"）
    const sourceDir = path.join(repoRoot, "mattpocock");
    fs.mkdirSync(sourceDir, { recursive: true });
    writeSkillMd(path.join(sourceDir, "skills", "review"), { name: "review", description: "desc" });
    writePackageJson(sourceDir, { version: "1.1.0" });

    const groups = await listGroups();
    assert.equal(groupBySlug(groups, "mattpocock").version, "1.1.0");
  });

  it("AC3: package.json 无 version 字段 → git 源短哈希 / local 源 null", async () => {
    // EXPECTED-TRACE: prd.md §6.3（实证 baoyu-skills → null；git fallback 语义）
    const gitSource = path.join(repoRoot, "git-no-version");
    fs.mkdirSync(gitSource, { recursive: true });
    initGitRepo(gitSource);
    writePackageJson(gitSource, { name: "no-version" }); // 无 version 字段

    const localSource = path.join(repoRoot, "local-no-version");
    fs.mkdirSync(localSource, { recursive: true });
    writeSkillMd(path.join(localSource, "skills", "beta"), { name: "beta", description: "desc" });
    writePackageJson(localSource, { name: "no-version" }); // 无 version 字段

    const groups = await listGroups();
    const expectedHash = execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      cwd: gitSource,
      encoding: "utf8",
    }).trim();
    assert.equal(groupBySlug(groups, "git-no-version").version, expectedHash);
    assert.match(groupBySlug(groups, "git-no-version").version, /^[0-9a-f]{7}$/);
    assert.equal(groupBySlug(groups, "local-no-version").version, null);
  });

  it("AC4: 无 package.json / 解析失败 → 回落 fallback，扫描不失败", async () => {
    // EXPECTED-TRACE: prd.md §6.3 + §7（损坏 JSON 回落，E10 不阻断）
    const gitNoPkg = path.join(repoRoot, "git-no-pkg");
    fs.mkdirSync(gitNoPkg, { recursive: true });
    initGitRepo(gitNoPkg); // 无 package.json → git fallback 短哈希

    const localBroken = path.join(repoRoot, "local-broken-pkg");
    fs.mkdirSync(localBroken, { recursive: true });
    writeSkillMd(path.join(localBroken, "skills", "gamma"), { name: "gamma", description: "desc" });
    fs.writeFileSync(path.join(localBroken, "package.json"), "{ not valid json");

    const groups = await listGroups();
    const gitGroup = groupBySlug(groups, "git-no-pkg");
    assert.ok(gitGroup, "git-no-pkg 应仍被扫描到");
    assert.match(gitGroup.version, /^[0-9a-f]{7}$/, "git 源无 package.json → 短哈希回落");

    const localGroup = groupBySlug(groups, "local-broken-pkg");
    assert.ok(localGroup, "local-broken-pkg 应仍被扫描到（E10：损坏 JSON 不阻断）");
    assert.equal(localGroup.version, null, "local 源损坏 JSON → null 回落");
  });
});

describe("REQ-SKILL-021 更新失败 log（job 捕获 git 输出）", () => {
  let serverCtx;
  let repoRoot;

  beforeEach(async () => {
    serverCtx = await startServer();
    repoRoot = makeTempDir("opc-skilllib-log-");
    await setSkillRepoPath(serverCtx.baseUrl, repoRoot);
  });

  afterEach(async () => {
    await stopServer(serverCtx);
    fs.rmSync(repoRoot, { recursive: true, force: true });
  });

  async function installGitSource(origin) {
    const install = await fetch(`${serverCtx.baseUrl}/api/skills/install`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ sourceType: "git", identifier: `file://${origin}` }),
    });
    assert.equal(install.status, 202);
    const job = await waitForJob(serverCtx.baseUrl, (await install.json()).jobId);
    assert.equal(job.status, "success");
    const groups = await (await fetch(`${serverCtx.baseUrl}/api/skills`)).json();
    return groups[0].slug;
  }

  it("AC1: 更新成功 → job.log = null（'log' 键在，无输出可展示）", async () => {
    const origin = makeTempDir("opc-skilllib-log-origin-");
    try {
      git(origin, ["init", "-b", "main"]);
      git(origin, ["config", "user.email", "test@example.com"]);
      git(origin, ["config", "user.name", "Test User"]);
      writeSkillMd(path.join(origin, "skills", "review"), { name: "review", description: "v1" });
      git(origin, ["add", "."]);
      git(origin, ["commit", "-m", "v1"]);
      const slug = await installGitSource(origin);

      const update = await fetch(`${serverCtx.baseUrl}/api/skills/${slug}/update`, { method: "POST" });
      assert.equal(update.status, 202);
      const updateJob = await waitForJob(serverCtx.baseUrl, (await update.json()).jobId);
      assert.equal(updateJob.status, "success");
      assert.ok("log" in updateJob, "job 响应必须含 log 键");
      assert.equal(updateJob.log, null, "成功 job 无 log（仅失败展示）");
    } finally {
      fs.rmSync(origin, { recursive: true, force: true });
    }
  });

  it("AC2: 更新失败 → job.log = git 输出原文（含本地改动被拒的 stderr）", async () => {
    const origin = makeTempDir("opc-skilllib-log-origin-");
    try {
      git(origin, ["init", "-b", "main"]);
      git(origin, ["config", "user.email", "test@example.com"]);
      git(origin, ["config", "user.name", "Test User"]);
      writeSkillMd(path.join(origin, "skills", "review"), { name: "review", description: "v1" });
      git(origin, ["add", "."]);
      git(origin, ["commit", "-m", "v1"]);
      const slug = await installGitSource(origin);

      // 上游新增提交 + 技能库克隆内制造本地改动 → ff-only 拒绝
      writeSkillMd(path.join(origin, "skills", "review"), { name: "review", description: "v2" });
      git(origin, ["add", "."]);
      git(origin, ["commit", "-m", "v2"]);
      const localFile = path.join(repoRoot, slug, "skills", "review", "SKILL.md");
      fs.writeFileSync(localFile, "local dirty change\n");

      const update = await fetch(`${serverCtx.baseUrl}/api/skills/${slug}/update`, { method: "POST" });
      assert.equal(update.status, 202);
      const updateJob = await waitForJob(serverCtx.baseUrl, (await update.json()).jobId);
      assert.equal(updateJob.status, "error");
      assert.ok(updateJob.error?.message, "失败必须带错误文案");
      // log = git stderr 原文（非翻译文案）；git 对本地改动会报 "Your local changes ... would be overwritten"
      assert.ok(typeof updateJob.log === "string" && updateJob.log.length > 0, "失败 job 必须带 log（git 输出原文）");
      assert.match(updateJob.log, /local changes/i, "log 应含 git 对本地改动的原始报错");
      assert.notEqual(updateJob.log, updateJob.error.message, "log 是原始输出，非翻译文案");
    } finally {
      fs.rmSync(origin, { recursive: true, force: true });
    }
  });
});
