// REQ-TRACE: 2026-08-01-macos-distribution/REQ-DIST-001
// REQ-VERSION: v1-hash:3167cf207baf471a951b02c4bd09915f1cd79b25cab37ebdb4632c3bb2d63b10
// CAPABILITY-TRACE: app-distribution
// ENTITY-TRACE: release
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true (2026-08-02 assertion signoff)

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// REQ-DIST-001：release 发布命令（main-only，自动发版）。
//
// 测试策略（test-plan.md 记录）：
// - 无副作用路径（版本校验/分支校验/gh 认证前置/dry-run）走真实 CLI 命令。
// - 有副作用路径（打包/git push/gh release create）经注入 runner 覆盖——
//   release 的副作用是真实发布到 GitHub（不可逆外部操作），不可在测试中执行；
//   这是对"CLI 测试跑真实命令"纪律的显式例外（tech-design 测试 seam：可注入执行器）。
//
// 实现约定（待 implementer 落地）：
//   release 模块导出 release(version, { dryRun, run, cwd })，
//   run = 异步命令执行器（默认 node:child_process 封装，测试注入 fake）。

const CLI = ["node", ["src/cli/opc-workstation.js"]];
const PKG = path.resolve("package.json");

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function cli(args, options = {}) {
  return execFileSync(CLI[0], [...CLI[1], ...args], { encoding: "utf-8", ...options });
}

function cliExpectFail(args, options = {}) {
  try {
    cli(args, options);
    assert.fail(`expected command to fail: ${args.join(" ")}`);
  } catch (error) {
    assert.ok(error.status !== 0, "exit code must be non-zero");
    return { status: error.status, stderr: error.stderr ?? "" };
  }
}

function currentVersion() {
  return JSON.parse(fs.readFileSync(PKG, "utf-8")).version;
}

function makeGitRepo(branch) {
  const dir = makeTempDir("opc-release-git-");
  const run = (cmd) => execFileSync("git", ["-C", dir, ...cmd.split(" ")], { stdio: "pipe" });
  run("init -q");
  run("config user.email test@example.com");
  run("config user.name test");
  run(`checkout -q -b ${branch}`);
  return dir;
}

describe("release command", () => {
  let pkgBackup;
  let tmpGitDir;

  beforeEach(() => {
    pkgBackup = fs.readFileSync(PKG, "utf-8");
  });

  afterEach(() => {
    fs.writeFileSync(PKG, pkgBackup);
    if (tmpGitDir) fs.rmSync(tmpGitDir, { recursive: true, force: true });
  });

  it("REQ-DIST-001 AC1: 非法版本被拒绝（E_RELEASE_INVALID_VERSION）且 package.json 不被修改", () => {
    const before = fs.readFileSync(PKG, "utf-8");
    const { stderr } = cliExpectFail(["release", "not.a.version"]);
    assert.match(stderr, /E_RELEASE_INVALID_VERSION/);
    assert.equal(fs.readFileSync(PKG, "utf-8"), before, "package.json must be untouched");
  });

  it("REQ-DIST-001 AC2: 版本低于/等于当前被拒绝（E_RELEASE_VERSION_BELOW）；v 前缀被接受", () => {
    const { stderr } = cliExpectFail(["release", "0.0.0"]);
    assert.match(stderr, /E_RELEASE_VERSION_BELOW/);
    const same = cliExpectFail(["release", currentVersion()]);
    assert.match(same.stderr, /E_RELEASE_VERSION_BELOW/);
    // v 前缀接受：dry-run 不报 INVALID_VERSION（规范化由实现保证）
    cli(["release", `v${currentVersion()}`, "--dry-run"]);
  });

  it("REQ-DIST-001 AC3: 非 main 分支被拒绝（E_RELEASE_NOT_MAIN），无副作用", () => {
    tmpGitDir = makeGitRepo("dev");
    const { stderr } = cliExpectFail(["release", "9.9.9"], { cwd: tmpGitDir });
    assert.match(stderr, /E_RELEASE_NOT_MAIN/);
    assert.equal(fs.readFileSync(PKG, "utf-8"), pkgBackup);
  });

  it("REQ-DIST-001 AC9: dry-run 输出步骤序列且不产生副作用", () => {
    const out = cli(["release", "9.9.9", "--dry-run"]);
    for (const keyword of ["版本校验", "分支", "gh 认证", "tag", "打包", "推送", "创建 Release"]) {
      assert.ok(out.includes(keyword), `dry-run output must mention: ${keyword}`);
    }
    assert.equal(fs.readFileSync(PKG, "utf-8"), pkgBackup, "dry-run must not modify package.json");
  });

  it("REQ-DIST-001 AC4/AC8: tag 已存在拒绝（E_RELEASE_TAG_EXISTS）；成功路径 gh 序列 create+upload 且输出 Release URL", async () => {
    const release = (await import("../../../../../../src/cli/commands/release.js")).release;
    const calls = [];
    const fakeRun = async (cmd) => {
      calls.push(cmd);
      if (cmd.includes("release view")) {
        return { ok: true }; // tag 已存在
      }
      return { ok: false };
    };
    await assert.rejects(
      release("9.9.9", { dryRun: false, run: fakeRun, cwd: process.cwd() }),
      (err) => err.code === "E_RELEASE_TAG_EXISTS"
    );
    // 成功路径：view 失败（不存在）→ create + upload
    const calls2 = [];
    const fakeRun2 = async (cmd) => {
      calls2.push(cmd);
      if (cmd.includes("release view")) return { ok: false };
      if (cmd.includes("release create")) return { ok: true, stdout: "https://github.com/charonX/workstation/releases/tag/v9.9.9" };
      return { ok: true };
    };
    const result = await release("9.9.9", { dryRun: false, run: fakeRun2, cwd: process.cwd() });
    assert.ok(calls2.some((c) => c.includes("release create v9.9.9")), "must call gh release create");
    assert.ok(calls2.some((c) => c.includes("release upload")), "must call gh release upload");
    assert.match(result.url, /releases\/tag\/v9\.9\.9/);
  });

  it("REQ-DIST-001 AC6: 产物缺失 → E_RELEASE_BUILD_FAILED 且未调用 push/gh", async () => {
    const release = (await import("../../../../../../src/cli/commands/release.js")).release;
    tmpGitDir = makeGitRepo("main");
    const calls = [];
    const fakeRun = async (cmd) => {
      calls.push(cmd);
      return { ok: true };
    };
    await assert.rejects(
      release("9.9.9", { dryRun: false, run: fakeRun, cwd: tmpGitDir }),
      (err) => err.code === "E_RELEASE_BUILD_FAILED"
    );
    assert.ok(!calls.some((c) => c.includes("push")), "must not push before artifact check");
    assert.ok(!calls.some((c) => c.includes("release create")), "must not create release");
  });

  it("REQ-DIST-001 AC7: git push 失败 → E_RELEASE_GIT_FAILED 且 package.json 回滚", async () => {
    const release = (await import("../../../../../../src/cli/commands/release.js")).release;
    tmpGitDir = makeGitRepo("main");
    const calls = [];
    const fakeRun = async (cmd) => {
      calls.push(cmd);
      if (cmd.includes("make")) return { ok: true };
      if (cmd.includes("push")) return { ok: false, stderr: "rejected" };
      return { ok: true };
    };
    // 产物校验需通过：往 tmpGitDir/out 放符合命名的假产物
    const version = "9.9.9";
    fs.mkdirSync(path.join(tmpGitDir, "out"), { recursive: true });
    fs.writeFileSync(path.join(tmpGitDir, "out", `Workstation-${version}.dmg`), "fake");
    fs.writeFileSync(path.join(tmpGitDir, "out", `Workstation-${version}.zip`), "fake");
    await assert.rejects(
      release(version, { dryRun: false, run: fakeRun, cwd: tmpGitDir }),
      (err) => err.code === "E_RELEASE_GIT_FAILED"
    );
    // package.json 回滚：release 进程内修改的文件在失败后恢复
    assert.equal(fs.readFileSync(PKG, "utf-8"), pkgBackup, "version must roll back on git failure");
  });
});
