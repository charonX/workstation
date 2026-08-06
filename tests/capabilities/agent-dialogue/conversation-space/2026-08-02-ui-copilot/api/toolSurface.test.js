// REQ-TRACE: 2026-08-02-ui-copilot/REQ-AGENT-032
// REQ-VERSION: v1-hash:8432c0cff25d5ef4a71d5c8fd95b3045977d65430eb968d7063be5fc81d67012
// CAPABILITY-TRACE: agent-dialogue
// ENTITY-TRACE: conversation-space
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true

// REQ-AGENT-032 工具清单契约（显式数组比较）+ 标准 4：cwd 外写/执行的权限层拦截
// 在工具面的行为表现（拒绝后 agent 收到工具错误）。
//
// 前置 spike 依赖：H5（多 AgentSession 各持独立 DefaultResourceLoader 共存不串扰）。
//
// seam：src/agent/toolAdapter.js 扩展导出
//   createSessionToolSurface({ profile, cwd, commandsDir, baseUrl })
// （default = 现状 CLI 面；project = CLI + read/write/bash；拦截语义与
// REQ-AGENT-033 附录 A 联动——未授权状态下 cwd 外写/执行 fail-closed 为工具错误）。
// seam 形态以 implementer 等价 public seam 为准。
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { startServer, stopServer } from "../../../../../../src/http/server.js";

const COMMANDS_DIR = path.resolve(import.meta.dirname, "../../../../../../src/cli/commands");

async function loadToolSurfaces() {
  const mod = await import("../../../../../../src/agent/toolAdapter.js").catch(() => null);
  assert.ok(mod, "seam 未就绪：src/agent/toolAdapter.js 尚未实现（REQ-AGENT-032）");
  assert.equal(typeof mod.createToolSurface, "function", "toolAdapter 应导出 createToolSurface()（既有 CLI 面基线）");
  assert.equal(
    typeof mod.createSessionToolSurface,
    "function",
    "seam 未就绪：toolAdapter 应导出 createSessionToolSurface({ profile, cwd, ... })（REQ-AGENT-032，形态以 implementer 等价 seam 为准）"
  );
  return mod;
}

describe("REQ-AGENT-032 各空间工具清单契约（显式数组比较，不用快照文件）", () => {
  let workdir;
  let server;
  let baseUrl;

  beforeEach(async () => {
    workdir = fs.mkdtempSync(path.join(os.tmpdir(), "ui-tool-surface-"));
    process.env.OPC_WORKSTATION_CONFIG_DIR = workdir;
    ({ server, baseUrl } = await startServer({ port: 0 }));
  });

  afterEach(async () => {
    await stopServer({ server });
    delete process.env.OPC_WORKSTATION_CONFIG_DIR;
    fs.rmSync(workdir, { recursive: true, force: true });
  });

  it("通用/飞书空间（default）工具清单 = CLI 工具面，一件不多一件不少", async () => {
    // Arrange：CLI 基线 = 既有 createToolSurface 全量清单（REQ-AGENT-012/013 已签核）。
    const { createToolSurface, createSessionToolSurface } = await loadToolSurfaces();
    const cliBaseline = createToolSurface({ commandsDir: COMMANDS_DIR, baseUrl })
      .listTools()
      .map((t) => t.name)
      .sort();
    // Act
    const names = createSessionToolSurface({ profile: "default", commandsDir: COMMANDS_DIR, baseUrl })
      .listTools()
      .map((t) => t.name)
      .sort();
    // Assert：显式数组比较——default 空间工具清单与 CLI 面完全相等（无 FS/bash 注入）。
    // signoff 2026-08-06: assertion signed（裁决见 signoff.md）
    assert.deepEqual(names, cliBaseline, `default 空间工具清单应 = CLI 工具面。差异: ${JSON.stringify({ names, cliBaseline })}`);
  });

  it("项目空间（project）工具清单 = CLI 工具面 + read + write + bash", async () => {
    // Arrange
    const { createToolSurface, createSessionToolSurface } = await loadToolSurfaces();
    const cliBaseline = createToolSurface({ commandsDir: COMMANDS_DIR, baseUrl })
      .listTools()
      .map((t) => t.name);
    const projectDir = path.join(workdir, "project-a");
    fs.mkdirSync(projectDir, { recursive: true });
    // Act
    const names = createSessionToolSurface({ profile: "project", cwd: projectDir, commandsDir: COMMANDS_DIR, baseUrl })
      .listTools()
      .map((t) => t.name)
      .sort();
    // Assert：显式数组比较——project = CLI + FS/脚本三工具。
    // signoff 2026-08-06: assertion signed（裁决见 signoff.md）
    const expected = [...cliBaseline, "read", "write", "bash"].sort();
    assert.deepEqual(names, expected, `project 空间工具清单应 = CLI + read/write/bash。差异: ${JSON.stringify({ names, expected })}`);
  });
});

describe("REQ-AGENT-032 cwd 外写/执行 → 权限层拦截（标准 4，工具面行为层）", () => {
  let workdir;
  let projectDir;
  let outsideDir;
  let server;
  let baseUrl;

  beforeEach(async () => {
    workdir = fs.mkdtempSync(path.join(os.tmpdir(), "cwd-boundary-"));
    projectDir = path.join(workdir, "project-a");
    outsideDir = path.join(workdir, "outside");
    fs.mkdirSync(projectDir, { recursive: true });
    fs.mkdirSync(outsideDir, { recursive: true });
    process.env.OPC_WORKSTATION_CONFIG_DIR = workdir;
    ({ server, baseUrl } = await startServer({ port: 0 }));
  });

  afterEach(async () => {
    await stopServer({ server });
    delete process.env.OPC_WORKSTATION_CONFIG_DIR;
    fs.rmSync(workdir, { recursive: true, force: true });
  });

  // 与 REQ-AGENT-033 附录 A「cwd 外写/执行 → ask」联动：工具面层断言的是
  // 拦截后的行为表现——未经人工授权（无 authorizer 裁决）时 fail-closed，
  // agent 收到工具错误（reason 可转述），且副作用不发生。
  // ask → approve → 放行的全链在 authorizerBridge.test.js 断言；策略评估在
  // permissionPolicy.test.js 断言。

  it("cwd 外路径写入 → 拦截：agent 收到工具错误且文件未落盘", async () => {
    // Arrange
    const { createSessionToolSurface } = await loadToolSurfaces();
    const surface = createSessionToolSurface({ profile: "project", cwd: projectDir, commandsDir: COMMANDS_DIR, baseUrl });
    const outsideFile = path.join(outsideDir, "escape.txt");
    // Act
    const result = await surface.execute("write", { path: outsideFile, content: "escape" }).catch((e) => ({ thrown: e }));
    // Assert：工具错误（结构化 errorCode 或抛出）+ 无副作用。
    const failed =
      (result && (result.errorCode || result.errorMessage || result.isError)) ||
      (result && result.thrown);
    assert.ok(failed, `cwd 外写入应被权限层拦截并返回工具错误。实际: ${JSON.stringify(result)}`);
    assert.ok(!fs.existsSync(outsideFile), "被拦截的写入不得产生副作用（文件未落盘）");
  });

  it("cwd 外路径 bash 执行 → 拦截：agent 收到工具错误且命令未执行", async () => {
    // Arrange
    const { createSessionToolSurface } = await loadToolSurfaces();
    const surface = createSessionToolSurface({ profile: "project", cwd: projectDir, commandsDir: COMMANDS_DIR, baseUrl });
    const marker = path.join(outsideDir, "bash-marker.txt");
    // Act：目标路径在 cwd 外的执行请求（附录 A：cwd 外写/执行 → ask；无授权 → 拦截）。
    const result = await surface
      .execute("bash", { command: `touch ${JSON.stringify(marker)}` })
      .catch((e) => ({ thrown: e }));
    // Assert
    const failed =
      (result && (result.errorCode || result.errorMessage || result.isError)) ||
      (result && result.thrown);
    assert.ok(failed, `cwd 外 bash 执行应被权限层拦截并返回工具错误。实际: ${JSON.stringify(result)}`);
    assert.ok(!fs.existsSync(marker), "被拦截的执行不得产生副作用（marker 未创建）");
  });
});
