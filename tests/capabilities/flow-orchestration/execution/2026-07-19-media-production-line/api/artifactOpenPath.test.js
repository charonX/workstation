// REQ-TRACE: 2026-07-19-media-production-line/REQ-FLOW-030
// REQ-VERSION: v1-hash:de43bc8607a89efe5512712a188a5f24f259d8109cb31a7a476827dd0883fab9
// CAPABILITY-TRACE: flow-orchestration
// ENTITY-TRACE: execution
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { makeTmpProjectDir } from "../../../../../fixtures/media-production-line/tmpProjectDir.js";

// seam：preload 白名单校验（tech-design「preload（改造）」：暴露 shell.openPath/showItemInFolder，
// 白名单限项目目录内路径）。校验逻辑应为可独立 import 的纯函数模块（不依赖 electron），
// 建议落点 src/preload/artifactPathGuard.js，导出 isArtifactPathAllowed(projectRoot, artifactPath)。
async function loadGuard() {
  const mod = await import("../../../../../../src/preload/artifactPathGuard.js").catch(() => null);
  assert.ok(mod, "seam 未就绪：src/preload/artifactPathGuard.js 尚未实现（REQ-FLOW-030 白名单校验）");
  const guard = mod.isArtifactPathAllowed || mod.assertArtifactPathAllowed;
  assert.ok(guard, "artifactPathGuard 应导出 isArtifactPathAllowed(projectRoot, artifactPath)");
  return mod;
}

describe("REQ-FLOW-030: 产物打开动作的项目目录白名单校验", () => {
  let tmp;

  beforeEach(() => {
    tmp = makeTmpProjectDir();
  });

  afterEach(() => {
    tmp.cleanup();
  });

  it("项目目录内的相对路径放行", async () => {
    const mod = await loadGuard();
    assert.equal(mod.isArtifactPathAllowed(tmp.dir, "outputs/daily/2026-07-19-ai-daily.md"), true);
    assert.equal(mod.isArtifactPathAllowed(tmp.dir, "materials/LIBRARY.md"), true);
  });

  it("项目目录内的绝对路径放行", async () => {
    const mod = await loadGuard();
    assert.equal(mod.isArtifactPathAllowed(tmp.dir, path.join(tmp.dir, "outputs", "x.md")), true);
  });

  it("项目目录之外的绝对路径拒绝", async () => {
    const mod = await loadGuard();
    assert.equal(mod.isArtifactPathAllowed(tmp.dir, "/etc/passwd"), false);
    assert.equal(mod.isArtifactPathAllowed(tmp.dir, path.join(tmp.dir, "..", "outside.md")), false,
      "经 .. 解析后落在项目目录外的路径应拒绝");
  });

  it("越界相对路径（../ 前缀）拒绝", async () => {
    const mod = await loadGuard();
    assert.equal(mod.isArtifactPathAllowed(tmp.dir, "../outside.md"), false);
    assert.equal(mod.isArtifactPathAllowed(tmp.dir, "outputs/../../outside.md"), false);
  });

  it("符号链接逃逸拒绝", async () => {
    const mod = await loadGuard();
    const outside = makeTmpProjectDir("opc-outside-");
    try {
      const secret = path.join(outside.dir, "secret.md");
      fs.writeFileSync(secret, "secret", "utf8");
      fs.symlinkSync(secret, path.join(tmp.dir, "outputs", "link-escape.md"));
      assert.equal(mod.isArtifactPathAllowed(tmp.dir, "outputs/link-escape.md"), false,
        "指向项目目录外真实路径的 symlink 应拒绝（realpath 校验）");
    } finally {
      outside.cleanup();
    }
  });
});
