// REQ-TRACE: 2026-08-02-ui-copilot/REQ-AGENT-032
// REQ-VERSION: v1-hash:8432c0cff25d5ef4a71d5c8fd95b3045977d65430eb968d7063be5fc81d67012
// CAPABILITY-TRACE: agent-dialogue
// ENTITY-TRACE: conversation-space
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true

// REQ-AGENT-032 项目空间 FS/脚本工具面（S7，M2）——按空间装配（标准 1/2/3）。
//
// 前置 spike 依赖：H5（多 AgentSession 各持独立 DefaultResourceLoader 共存不串扰）。
// H5 未过 → 本文件整体应以「seam 未就绪」失败信息注明，不得静默绿。
//
// seam 1（按空间装配，标准 1/2）：createAgentService + 自建 fake worker 捕获
// session-config 扩展字段 cwd / permissionProfile（BUG-004/005 同型，
// tech-design IPC 契约节）。
//
// seam 2（会话工具面，标准 2/3）：src/agent/toolAdapter.js 扩展导出
//   createSessionToolSurface({ profile, cwd, commandsDir, baseUrl }) →
//   { listTools() → [{name, ...}], execute(name, args) → {output, errorCode?, errorMessage?} }
// profile="default" = 现状 CLI 面（createToolSurface 等价）；profile="project" =
// CLI + read/write/bash FS/脚本工具（cwd 限定项目目录）。seam 形态以 implementer
// 等价 public seam 为准。
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { resetDb, closeDb } from "../../../../../../src/db.js";
import { startServer, stopServer } from "../../../../../../src/http/server.js";

const COMMANDS_DIR = path.resolve(import.meta.dirname, "../../../../../../src/cli/commands");

// fake worker：捕获 session-config 扩展字段（未实现的字段记录为 null → 清晰失败）。
const FAKE_WORKER_SRC = `import fs from "node:fs";
import readline from "node:readline";
const captureFile = process.env.OPC_FAKE_CAPTURE;
const rl = readline.createInterface({ input: process.stdin });
process.stdout.write(JSON.stringify({ type: "ready", pid: process.pid }) + "\\n");
rl.on("line", (line) => {
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  if (msg.type === "session-config") {
    if (captureFile) {
      fs.appendFileSync(captureFile, JSON.stringify({
        type: "session-config",
        sessionKey: msg.sessionKey,
        skillPaths: Array.isArray(msg.skillPaths) ? msg.skillPaths : null,
        cwd: typeof msg.cwd === "string" ? msg.cwd : null,
        permissionProfile: typeof msg.permissionProfile === "string" ? msg.permissionProfile : null,
      }) + "\\n");
    }
    process.stdout.write(JSON.stringify({ type: "config-ack", sessionKey: msg.sessionKey }) + "\\n");
  } else if (msg.type === "ping") {
    process.stdout.write(JSON.stringify({ type: "pong" }) + "\\n");
  } else if (msg.type === "shutdown") {
    process.exit(0);
  }
});
`;

async function loadAgentService() {
  const mod = await import("../../../../../../src/services/agentService.js").catch(() => null);
  assert.ok(mod, "seam 未就绪：src/services/agentService.js 尚未实现（REQ-AGENT-032）");
  assert.equal(typeof mod.createAgentService, "function", "agentService 应导出 createAgentService()");
  return mod.createAgentService;
}

async function loadSessionToolSurface() {
  const mod = await import("../../../../../../src/agent/toolAdapter.js").catch(() => null);
  assert.ok(mod, "seam 未就绪：src/agent/toolAdapter.js 尚未实现（REQ-AGENT-032）");
  assert.equal(
    typeof mod.createSessionToolSurface,
    "function",
    "seam 未就绪：toolAdapter 应导出 createSessionToolSurface({ profile, cwd, ... })（REQ-AGENT-032 标准 2/3，形态以 implementer 等价 seam 为准）"
  );
  return mod.createSessionToolSurface;
}

async function waitUntil(predicate, { timeout = 10000, interval = 100, label = "条件" } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
  assert.fail(`等待超时：${label}`);
}

describe("REQ-AGENT-032 按空间装配：cwd 与 permissionProfile（标准 1/2）", () => {
  let workdir;
  let sessionDir;
  let configDir;
  let projectDir;
  let entry;
  let captureFile;
  let agentService;
  let project;

  beforeEach(async () => {
    workdir = fs.mkdtempSync(path.join(os.tmpdir(), "worker-assembly-"));
    sessionDir = path.join(workdir, "sessions");
    configDir = path.join(workdir, "config");
    projectDir = path.join(workdir, "project-a");
    fs.mkdirSync(configDir, { recursive: true });
    fs.mkdirSync(projectDir, { recursive: true });
    entry = path.join(workdir, "fake-worker.mjs");
    captureFile = path.join(workdir, "capture.jsonl");
    fs.writeFileSync(entry, FAKE_WORKER_SRC);
    process.env.OPC_WORKSTATION_CONFIG_DIR = configDir;
    process.env.OPC_FAKE_CAPTURE = captureFile;
    process.env.DB_PATH = path.join(workdir, "data.db");
    resetDb(process.env.DB_PATH);
    const settingsService = await import("../../../../../../src/services/settingsService.js");
    settingsService.resetSettings();
    const projectService = await import("../../../../../../src/services/projectService.js");
    project = projectService.createLocalProject({
      name: "项目A",
      localPath: projectDir,
      agentTypes: ["claude-code"],
    });
    agentService = null;
  });

  afterEach(async () => {
    delete process.env.OPC_FAKE_CAPTURE;
    delete process.env.OPC_WORKSTATION_CONFIG_DIR;
    await agentService?.stop();
    closeDb();
    delete process.env.DB_PATH;
    fs.rmSync(workdir, { recursive: true, force: true });
  });

  function readConfigs() {
    if (!fs.existsSync(captureFile)) return [];
    return fs
      .readFileSync(captureFile, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l))
      .filter((m) => m.type === "session-config");
  }

  async function startAndCapture(spaceKey) {
    const createAgentService = await loadAgentService();
    if (!agentService) {
      agentService = createAgentService({ cwd: workdir, sessionDir, entry });
      const ready = [];
      agentService.on("ready", () => ready.push(1));
      await agentService.start();
      await waitUntil(() => ready.length === 1, { label: "worker ready" });
    }
    const before = readConfigs().length;
    agentService.createSession({ spaceKey, provider: "deepseek", apiKey: "sk-test" });
    await waitUntil(() => readConfigs().length > before, { label: `session-config 下发（${spaceKey}）` });
    const configs = readConfigs();
    return configs[configs.length - 1];
  }

  it("项目空间会话：permissionProfile='project' 且 cwd = 项目目录绝对路径（标准 1）", async () => {
    const config = await startAndCapture(`ui:project:${project.id}:s1`);
    assert.equal(
      config.permissionProfile,
      "project",
      `seam 未就绪或装配错误：项目空间 session-config.permissionProfile 应为 "project"（REQ-AGENT-032 标准 1）。实际: ${JSON.stringify(config)}`
    );
    assert.notEqual(config.cwd, null, "seam 未就绪：session-config 未携带 cwd（REQ-AGENT-032 标准 1）");
    // 契约 = 项目目录绝对路径；macOS /var→/private/var 符号链接前缀按 realpath 归一化比较。
    // signoff 2026-08-06: assertion signed（裁决见 signoff.md）
    assert.equal(
      fs.realpathSync(config.cwd),
      fs.realpathSync(projectDir),
      `项目空间 cwd 应 = 项目目录绝对路径。实际: ${config.cwd}`
    );
    assert.ok(path.isAbsolute(config.cwd), `cwd 应为绝对路径。实际: ${config.cwd}`);
  });

  it("通用空间会话：permissionProfile='default'（标准 2，分级硬边界的装配输入）", async () => {
    const config = await startAndCapture("ui:copilot:s1");
    assert.equal(
      config.permissionProfile,
      "default",
      `通用空间 permissionProfile 应为 "default"（不装配 gotgenes/FS 工具）。实际: ${JSON.stringify(config)}`
    );
  });

  it("飞书会话：permissionProfile='default'（标准 2，分级硬边界的装配输入）", async () => {
    const config = await startAndCapture("feishu:oc_1");
    assert.equal(
      config.permissionProfile,
      "default",
      `飞书空间 permissionProfile 应为 "default"（不装配 gotgenes/FS 工具）。实际: ${JSON.stringify(config)}`
    );
  });
});

describe("REQ-AGENT-032 会话工具面：分级与 cwd 内读文件（标准 2/3）", () => {
  let workdir;
  let projectDir;
  let server;
  let baseUrl;

  // server 在 beforeEach 起（与既有 toolSurface.test.js REQ-AGENT-012 同型）：
  // 保证 afterEach 的 stopServer 永远拿到真实 server——若把 startServer 放测试体内
  // 的 seam 加载之后，seam 未就绪抛错时 server 保持 undefined，
  // stopServer({ server: undefined }) 会异步抛 TypeError 且 promise 永不 settle，
  // 导致测试整体挂满 timeout。
  beforeEach(async () => {
    workdir = fs.mkdtempSync(path.join(os.tmpdir(), "session-surface-"));
    projectDir = path.join(workdir, "project-a");
    fs.mkdirSync(projectDir, { recursive: true });
    process.env.OPC_WORKSTATION_CONFIG_DIR = workdir;
    ({ server, baseUrl } = await startServer({ port: 0 }));
  });

  afterEach(async () => {
    await stopServer({ server });
    server = null;
    delete process.env.OPC_WORKSTATION_CONFIG_DIR;
    fs.rmSync(workdir, { recursive: true, force: true });
  });

  it("default 空间工具清单无 read/write/bash（标准 2，工具面分级硬边界）", async () => {
    const createSessionToolSurface = await loadSessionToolSurface();
    // Act
    const surface = createSessionToolSurface({ profile: "default", commandsDir: COMMANDS_DIR, baseUrl });
    const names = surface.listTools().map((t) => t.name);
    // Assert：FS/脚本工具不得出现在 CLI-only 空间。
    for (const fsTool of ["read", "write", "bash"]) {
      assert.ok(
        !names.some((n) => n === fsTool || n.startsWith(`${fsTool} `)),
        `default 空间工具清单不得含 ${fsTool}（分级硬边界）。实际清单: ${JSON.stringify(names)}`
      );
    }
  });

  it("项目空间 agent 可在 cwd 内读文件：read 工具返回项目文件内容（标准 3，集成）", async () => {
    // Arrange：临时项目目录落一个项目文件。
    fs.writeFileSync(path.join(projectDir, "hello.txt"), "hello project\n");
    const createSessionToolSurface = await loadSessionToolSurface();
    const surface = createSessionToolSurface({ profile: "project", cwd: projectDir, commandsDir: COMMANDS_DIR, baseUrl });
    // Act：read 工具读 cwd 内文件。
    const result = await surface.execute("read", { path: path.join(projectDir, "hello.txt") });
    // Assert：返回项目文件内容。
    assert.ok(result, "read 应返回结构化结果");
    assert.ok(!result.errorCode, `read cwd 内文件不应报错，实际: ${JSON.stringify(result)}`);
    assert.ok(
      String(result.output ?? "").includes("hello project"),
      `read 应返回项目文件内容。实际: ${JSON.stringify(result)}`
    );
    // 注：本断言在会话工具面集成层（C2 同型 seam）；FAUX 全链（真 worker + PI 驱动
    // read 工具）由 E2E/worker 集成层可选覆盖。
  });
});
