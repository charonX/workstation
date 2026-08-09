// REQ-TRACE: 2026-08-02-ui-copilot/REQ-AGENT-032
// REQ-VERSION: v1-hash:8432c0cff25d5ef4a71d5c8fd95b3045977d65430eb968d7063be5fc81d67012
// CAPABILITY-TRACE: agent-dialogue
// ENTITY-TRACE: conversation-space
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true
// BUG-TRACE: BUG-005

// BUG-005 回归：read/write 相对路径必须按**会话项目目录**（sessionCwd）解析，
// 而非 worker 进程 cwd（生产事故实锤 2026-08-09：knowledge 项目会话中
// `read README.md` 静默读到 workstation 仓库根的同名 README —— agent 被错误
// 内容误导；`read 00_Home.md` 因仓库根无此文件报「文件不存在或不可读」，
// 文件明明存在于项目目录）。
//
// 根因：toolAdapter executeFsTool 的 path.resolve(args.path) 单参形态以
// process.cwd() 为基准；worker 进程 cwd = 应用仓库根 ≠ 会话项目目录。
// boundaryAuthorized=true 分支同时构成边界逃逸（相对路径读出项目外文件）。
//
// 断言（REQ-AGENT-032 标准 3「项目空间 agent 可在 cwd 内读文件」的相对路径面）：
// 1. read 相对路径（未授权边界分支）→ 读到项目目录内文件内容；
// 2. read 相对路径（boundaryAuthorized=true 分支）→ 同上（分支一致性）；
// 3. 同名异内容文件（生产事故复现）→ 必须读到项目目录版本，不得静默错读；
// 4. write 相对路径（未授权分支）→ 文件落在项目目录内（不落 worker 进程 cwd）；
// 5. 绝对路径 read 两分支行为不变（回归保护）；
// 6. 相对路径指向不存在文件 → E-AGENT-FS-ERROR 报错语义保留。
//
// 安全注意：用例 4 只用未授权分支（修复前该分支 fail-closed 拦截，不会在
// process.cwd() 下落副作用文件）；用例 2/3 的 authorized 分支只读不写。

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const COMMANDS_DIR = path.resolve(import.meta.dirname, "../../../../../../src/cli/commands");

async function loadToolAdapter() {
  const mod = await import("../../../../../../src/agent/toolAdapter.js").catch(() => null);
  assert.ok(mod, "seam 未就绪：src/agent/toolAdapter.js 尚未导出 createSessionToolSurface（REQ-AGENT-032）");
  assert.equal(typeof mod.createSessionToolSurface, "function");
  return mod;
}

describe("BUG-005 回归：read/write 相对路径按会话项目目录解析", () => {
  let workdir;
  let projectDir;

  beforeEach(() => {
    workdir = fs.mkdtempSync(path.join(os.tmpdir(), "bug005-rel-path-"));
    projectDir = path.join(workdir, "knowledge-project");
    fs.mkdirSync(projectDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(workdir, { recursive: true, force: true });
  });

  it("用例 1：read 相对路径（未授权边界分支）→ 读到项目目录内文件", async () => {
    // Arrange：项目目录内独特文件名（process.cwd() 下必不存在，防假绿）。
    fs.writeFileSync(path.join(projectDir, "bug005-note.md"), "PROJECT-NOTE-CONTENT");
    const { createSessionToolSurface } = await loadToolAdapter();
    const surface = createSessionToolSurface({ profile: "project", cwd: projectDir, commandsDir: COMMANDS_DIR });
    // Act
    const result = await surface.execute("read", { path: "bug005-note.md" });
    // Assert：相对路径按项目目录解析（修复前：resolve 到进程 cwd → 越界拦截 E-AGENT-BOUNDARY）。
    assert.equal(result.errorCode, undefined, `相对路径 read 不应报错。实际: ${JSON.stringify(result)}`);
    assert.equal(result.output, "PROJECT-NOTE-CONTENT");
  });

  it("用例 2：read 相对路径（boundaryAuthorized=true 分支）→ 读到项目目录内文件", async () => {
    // Arrange
    fs.writeFileSync(path.join(projectDir, "bug005-note.md"), "PROJECT-NOTE-CONTENT");
    const { createSessionToolSurface } = await loadToolAdapter();
    const surface = createSessionToolSurface({
      profile: "project",
      cwd: projectDir,
      commandsDir: COMMANDS_DIR,
      boundaryAuthorized: true,
    });
    // Act
    const result = await surface.execute("read", { path: "bug005-note.md" });
    // Assert：两分支解析基准一致（修复前：resolve 到进程 cwd → E-AGENT-FS-ERROR）。
    assert.equal(result.errorCode, undefined, `authorized 分支相对路径 read 不应报错。实际: ${JSON.stringify(result)}`);
    assert.equal(result.output, "PROJECT-NOTE-CONTENT");
  });

  it("用例 3：同名异内容文件 → 读到项目目录版本（生产事故复现：read README.md 错读仓库根文件）", async () => {
    // Arrange：process.cwd()（仓库根）存在 README.md；项目目录内同名文件内容不同。
    const repoReadme = path.join(process.cwd(), "README.md");
    assert.ok(fs.existsSync(repoReadme), "前置：仓库根 README.md 存在（事故现场形态）");
    fs.writeFileSync(path.join(projectDir, "README.md"), "KNOWLEDGE-PROJECT-README");
    const { createSessionToolSurface } = await loadToolAdapter();
    const surface = createSessionToolSurface({
      profile: "project",
      cwd: projectDir,
      commandsDir: COMMANDS_DIR,
      boundaryAuthorized: true,
    });
    // Act
    const result = await surface.execute("read", { path: "README.md" });
    // Assert：必须读到项目目录版本——静默错读比报错更坏（agent 被错误内容误导）。
    assert.equal(result.errorCode, undefined, `实际: ${JSON.stringify(result)}`);
    assert.equal(
      result.output,
      "KNOWLEDGE-PROJECT-README",
      "相对路径同名文件必须解析到项目目录版本（修复前静默读到 worker 进程 cwd 的同名文件——边界逃逸）"
    );
  });

  it("用例 4：write 相对路径（未授权分支）→ 文件落在项目目录内", async () => {
    // Arrange
    const { createSessionToolSurface } = await loadToolAdapter();
    const surface = createSessionToolSurface({ profile: "project", cwd: projectDir, commandsDir: COMMANDS_DIR });
    // Act
    const result = await surface.execute("write", { path: "bug005-out/a.txt", content: "HELLO" });
    // Assert：写入落项目目录（修复前：resolve 到进程 cwd → 越界拦截，文件不落盘）。
    assert.equal(result.errorCode, undefined, `相对路径 write 不应报错。实际: ${JSON.stringify(result)}`);
    assert.equal(fs.readFileSync(path.join(projectDir, "bug005-out", "a.txt"), "utf8"), "HELLO");
  });

  it("用例 5：绝对路径 read 两分支行为不变（回归保护）", async () => {
    // Arrange
    fs.writeFileSync(path.join(projectDir, "abs.md"), "ABS-CONTENT");
    const { createSessionToolSurface } = await loadToolAdapter();
    const absPath = path.join(projectDir, "abs.md");
    for (const boundaryAuthorized of [false, true]) {
      const surface = createSessionToolSurface({
        profile: "project",
        cwd: projectDir,
        commandsDir: COMMANDS_DIR,
        boundaryAuthorized,
      });
      // Act
      const result = await surface.execute("read", { path: absPath });
      // Assert
      assert.equal(result.errorCode, undefined, `authorized=${boundaryAuthorized} 实际: ${JSON.stringify(result)}`);
      assert.equal(result.output, "ABS-CONTENT");
    }
  });

  it("用例 6：相对路径指向不存在文件 → E-AGENT-FS-ERROR 报错语义保留", async () => {
    // Arrange
    const { createSessionToolSurface } = await loadToolAdapter();
    const surface = createSessionToolSurface({
      profile: "project",
      cwd: projectDir,
      commandsDir: COMMANDS_DIR,
      boundaryAuthorized: true,
    });
    // Act
    const result = await surface.execute("read", { path: "bug005-no-such-file.md" });
    // Assert：解析基准修正后，「不存在」报错语义不变（agent 可转述并继续）。
    assert.equal(result.errorCode, "E-AGENT-FS-ERROR", `实际: ${JSON.stringify(result)}`);
    assert.match(result.errorMessage ?? "", /bug005-no-such-file\.md/);
  });
});
