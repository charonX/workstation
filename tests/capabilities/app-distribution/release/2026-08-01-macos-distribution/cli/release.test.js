// REQ-TRACE: 2026-08-01-macos-distribution/REQ-DIST-001
// REQ-VERSION: v1-hash:3167cf207baf471a951b02c4bd09915f1cd79b25cab37ebdb4632c3bb2d63b10
// CAPABILITY-TRACE: app-distribution
// ENTITY-TRACE: release
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: false

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

describe("release command", () => {
  // 备份并隔离 package.json，避免测试改动真实文件。
  let pkgBackup;
  let tmpGitDir;

  beforeEach(() => {
    pkgBackup = fs.readFileSync(PKG, "utf-8");
  });

  afterEach(() => {
    fs.writeFileSync(PKG, pkgBackup);
    if (tmpGitDir) fs.rmSync(tmpGitDir, { recursive: true, force: true });
  });

  it("REQ-DIST-001 AC1: 非法版本被拒绝且 package.json 不被修改", () => {
    const before = fs.readFileSync(PKG, "utf-8");
    const { status } = cliExpectFail(["release", "not.a.version"]);
    // TODO: HUMAN ASSERTION — 确认 stderr 含错误码 E_RELEASE_INVALID_VERSION
    assert.notEqual(status, 0);
    assert.equal(fs.readFileSync(PKG, "utf-8"), before, "package.json must be untouched");
  });

  it("REQ-DIST-001 AC2: 版本低于/等于当前版本被拒绝；v 前缀被接受", () => {
    // TODO: HUMAN ASSERTION — 确认当前版本从 package.json 读取；v1.0.0 前缀用例
    cliExpectFail(["release", "0.0.0"]);
    // TODO: HUMAN ASSERTION — 确认 stderr 含 E_RELEASE_VERSION_BELOW
  });

  it("REQ-DIST-001 AC3: 非 main 分支被拒绝，无副作用", () => {
    tmpGitDir = makeTempDir("opc-release-git-");
    // 临时 git 仓库，切到 dev 分支
    // TODO: HUMAN ASSERTION — 确认 E_RELEASE_NOT_MAIN
    cliExpectFail(["release", "9.9.9"], { cwd: tmpGitDir });
  });

  it("REQ-DIST-001 AC5: gh CLI 未安装/未认证 → E_RELEASE_GH_AUTH", () => {
    // 依赖环境：若发布者机器已认证 gh，此用例走注入 runner 版本（见下）。
    // TODO: HUMAN ASSERTION — 确认 stderr 含 E_RELEASE_GH_AUTH 或环境跳过说明
  });

  it("REQ-DIST-001 AC4/AC9: dry-run 输出步骤序列且不产生副作用", async () => {
    const out = cli(["release", "9.9.9", "--dry-run"]);
    // TODO: HUMAN ASSERTION — 确认 stdout 含步骤序列（校验版本/分支/gh 认证/tag 检查/打包/推送/创建 Release）
    assert.equal(fs.readFileSync(PKG, "utf-8"), pkgBackup, "dry-run must not modify package.json");
  });

  // ---------- 注入 runner：有副作用路径（AC6-AC8） ----------

  it("REQ-DIST-001 AC6: 打包后产物校验失败 → E_RELEASE_BUILD_FAILED", async () => {
    // 注入 fake run：npm make 成功但 out/ 无目标版本产物
    // TODO: HUMAN ASSERTION — 确认错误码与产物命名约定（Workstation-<version>.dmg / .zip）
    const release = (await import("../../../../../../src/cli/commands/release.js")).release;
    const calls = [];
    const fakeRun = async () => {
      calls.push("run");
      return { stdout: "" };
    };
    // TODO: HUMAN ASSERTION — 断言 release 抛 E_RELEASE_BUILD_FAILED 且未调用 push/gh
  });

  it("REQ-DIST-001 AC7: git commit/push 失败 → E_RELEASE_GIT_FAILED 且本地版本回滚", async () => {
    // TODO: HUMAN ASSERTION — 确认失败时 package.json 恢复原版本
  });

  it("REQ-DIST-001 AC4/AC8: tag 已存在拒绝；成功后调用 gh release create 并上传 dmg/zip", async () => {
    // 注入 fake run：gh release view 成功 → 断言 E_RELEASE_TAG_EXISTS；
    // gh release view 失败（不存在）→ 断言后续调用 create/upload 与 Release URL 输出
    // TODO: HUMAN ASSERTION — 确认 gh 命令序列与资产文件名
  });
});
