// REQ-TRACE: 2026-08-12-pi-mcp-plugin/REQ-AGENT-085
// REQ-VERSION: v1-hash:080af1f439bec8660eeadc84b57fbef5650081f47d8918a7da585b9c172a49a1
// CAPABILITY-TRACE: plugin-management
// ENTITY-TRACE: mcp-server
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true (2026-08-13 assertion signoff)
// BUG-TRACE: BUG-004 (G2：mcpBridge 空断言接线——4 用例接入 REQ-085 真实全链路)

// MCP 桥装配与工具链路（REQ-085，B5）。
//
// seam 1：fixture server 调用日志 = 「server 是否收到调用」权威断言点
//   （stdio：tests/fixtures/mcp-stdio-server/server.mjs，子进程 spawn；
//     http：tests/fixtures/mcp-http-server/server.mjs，stdout 报 PORT=）。
// seam 2：全链路驱动——startServer（测试 configDir/DB）→ mcpService.create fixture
//   stdio server → setProjectEnabled → HTTP API 建项目空间会话（ui:project:<pid>:<sid>）
//   → agentService.prompt（FAUX provider + OPC_FAUX_TOOL_SEQUENCE 脚本化 tool_use）→
//   断言调用日志与 prompt 回执文本（= text_end.content）。
//
// 已签断言（门 1，2026-08-13）：
//   全链路成功标志 = 调用日志含 name="fixture_ping" 且对话事件文本含 "pong:"；
//   快照隔离标志 = 工具面不含 ghost server 工具（mcp({server:"ghost"}) → not found）；
//   新会话生效标志 = 进行中会话工具面不变（not found）、新会话工具面含新 server 工具
//   （fixture 收到调用）。
//
// 权限链（BUG-004 接线说明）：MCP 调用经 worker broker（REQ-086）——gotgenes
// `checkPermission("mcp", "<server>:<tool>")` 默认 ask 会弹确认卡阻塞。本套件写入
// 项目 `.pi/extensions/pi-permission-system/config.json` 的 `mcp: { "*": "allow" }`
// 使调用直放（对齐 Slice 2 自证场景 A）；并以 OPC_FAUX_JUDGE_RESULT=allow 作 auto
// 档兜底（项目策略未生效时 auto-judge 放行，不弹卡）。

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

import { startServer, stopServer } from "../../../../../../src/http/server.js";

const ROOT = path.resolve(import.meta.dirname, "../../../../../../");
const STDIO_SERVER = path.join(ROOT, "tests/fixtures/mcp-stdio-server/server.mjs");
const HTTP_SERVER = path.join(ROOT, "tests/fixtures/mcp-http-server/server.mjs");

const ENV_KEYS = [
  "OPC_WORKSTATION_CONFIG_DIR",
  "OPC_FAUX_TOOL_SEQUENCE",
  "OPC_FAUX_JUDGE_RESULT",
  "HOME",
];

// auto 档兜底：允许数组（takeFauxJudgeResult 每次 ask 取一个，耗尽回落 defer 弹卡）。
const ALLOW_BACKSTOP = Array.from({ length: 16 }, () => ({ kind: "allow" }));

function fixtureCallLog(workdir, name = "calls.log") {
  const p = path.join(workdir, name);
  return {
    path: p,
    read() {
      if (!fs.existsSync(p)) return [];
      return fs.readFileSync(p, "utf-8").trim().split("\n").filter(Boolean).map(JSON.parse);
    },
  };
}

async function waitUntil(predicate, { timeout = 30000, interval = 100, label = "条件" } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
  assert.fail(`等待超时：${label}`);
}

async function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} 超时（${ms}ms）`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

// gotgenes 项目策略：mcp 面 allow → broker checkPermission("mcp", "server:tool") 直放。
function writeProjectMcpPolicy(projectDir) {
  const p = path.join(projectDir, ".pi", "extensions", "pi-permission-system", "config.json");
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify({ permission: { mcp: { "*": "allow" } } }, null, 2));
}

async function createProject(baseUrl, { name = "McpProj", localPath } = {}) {
  const res = await fetch(`${baseUrl}/api/projects`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, localPath, agentTypes: [] }),
  });
  assert.equal(res.status, 201, `createProject 应 201: ${res.status}`);
  return res.json(); // projects POST 直接返回项目对象 { id, name, localPath, ... }
}

async function createSession(baseUrl, projectId) {
  const res = await fetch(`${baseUrl}/api/agent/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ spaceKind: "project", projectId }),
  });
  const body = await res.json().catch(() => ({}));
  assert.equal(res.status, 200, `POST /api/agent/sessions 应 200（REQ-085 seam），实际 ${res.status}: ${JSON.stringify(body)}`);
  return body.spaceKey;
}

describe("REQ-AGENT-085 MCP 桥装配与工具链路（B5）", () => {
  let workdir;
  let callLog;
  let serverCtx;
  let projectDir;
  let project;
  let mcpSvc;
  let savedEnv;

  beforeEach(async () => {
    workdir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-bridge-"));
    callLog = fixtureCallLog(workdir);
    // RED 门：桥全链路依赖 mcpService + worker 装配（BUILD 前不允许变绿）
    const svc = await import("../../../../../../src/services/mcpService.js").catch(() => null);
    const asm = await import("../../../../../../src/agent/sessionAssembly.js").catch(() => null);
    assert.ok(svc && asm, "seam 未就绪：mcpService/sessionAssembly 尚未实现（REQ-AGENT-085）");

    savedEnv = {};
    for (const k of ENV_KEYS) savedEnv[k] = process.env[k];

    // startServer：测试 configDir/DB 隔离（DB_PATH + OPC_WORKSTATION_CONFIG_DIR 指向临时目录）。
    process.env.OPC_WORKSTATION_CONFIG_DIR = path.join(workdir, "config");
    serverCtx = await startServer({ port: 0 });

    // agent 配置（FAUX 模式零网络；provider/key 供会话装配）。
    const settingsMod = await import("../../../../../../src/services/settingsService.js");
    settingsMod.saveAgentConfig({ provider: "deepseek", apiKey: "sk-test-faux" });

    // 项目（worker 会话 cwd = localPath 真实目录；gotgenes 项目策略 allow 就位）。
    projectDir = path.join(workdir, "proj");
    fs.mkdirSync(projectDir, { recursive: true });
    writeProjectMcpPolicy(projectDir);
    project = await createProject(serverCtx.baseUrl, { localPath: projectDir });

    // mcpService（与主进程同库：startServer 已设 DB_PATH）。
    const mcpMod = await import("../../../../../../src/services/mcpService.js");
    mcpSvc = mcpMod.createMcpService();
  });

  afterEach(async () => {
    if (serverCtx) {
      try {
        await stopServer(serverCtx);
      } catch {
        // 尽力关闭
      }
    }
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
    fs.rmSync(workdir, { recursive: true, force: true });
  });

  // FAUX 驱动一轮 prompt：返回 text_end.content（对话事件文本，含工具结果回流）。
  async function promptReply(spaceKey, text) {
    const svc = await serverCtx.server._opcAgentServiceFactory();
    const res = await withTimeout(svc.prompt(spaceKey, text), 60000, "prompt 完成");
    assert.equal(res.ok, true, `prompt 应成功：${JSON.stringify(res)}`);
    assert.equal(typeof res.reply, "string", "prompt 应带回 text_end 文本");
    return res.reply;
  }

  async function createStdioServer(name, logPath) {
    await mcpSvc.create({
      name,
      type: "stdio",
      command: "node",
      args: [STDIO_SERVER],
      env: { MCP_FIXTURE_CALL_LOG: logPath },
    });
  }

  it("标准 1：全链路——stdio fixture 配置入库+项目启用 → 会话工具面含桥工具 → FAUX 驱动调用 → server 收到、结果回流", async () => {
    assert.ok(fs.existsSync(STDIO_SERVER), "fixture server 存在");

    await createStdioServer("fx", callLog.path);
    await mcpSvc.setProjectEnabled(project.id, "fx", true);
    const spaceKey = await createSession(serverCtx.baseUrl, project.id);

    // FAUX 注入缝：让 agent 调用 MCP 网关工具 mcp，参数 { server, tool, args }。
    process.env.OPC_FAUX_TOOL_SEQUENCE = JSON.stringify([
      { tool: "mcp", args: { server: "fx", tool: "fx_fixture_ping", args: { text: "hello-bridge" } } },
    ]);
    process.env.OPC_FAUX_JUDGE_RESULT = JSON.stringify(ALLOW_BACKSTOP);

    const reply = await promptReply(spaceKey, "调用 MCP 工具 fixture_ping");
    await waitUntil(() => callLog.read().some((c) => c.name === "fixture_ping"), { label: "fixture server 收到调用" });

    // 已签断言：调用日志含 name="fixture_ping" 且对话事件文本含 "pong:"
    const calls = callLog.read();
    assert.ok(
      calls.some((c) => c.name === "fixture_ping"),
      `调用日志应含 fixture_ping（server 收到调用）: ${JSON.stringify(calls)}`
    );
    assert.equal(
      calls.find((c) => c.name === "fixture_ping").arguments.text,
      "hello-bridge",
      "调用参数经桥原样透传"
    );
    assert.ok(reply.includes("pong:"), `结果应回流对话事件文本（reply 含 pong:）: ${reply}`);
  });

  it("标准 2：快照隔离——HOME 散落配置不进会话", async () => {
    // 假 HOME 放 ~/.config/mcp/mcp.json（ghost server）——桥以程序化 config 注入
    // （programmaticConfig=true 时不 loadMcpConfig 文件），ghost 不进会话工具面。
    const fakeHome = path.join(workdir, "fake-home");
    fs.mkdirSync(path.join(fakeHome, ".config", "mcp"), { recursive: true });
    fs.writeFileSync(
      path.join(fakeHome, ".config", "mcp", "mcp.json"),
      JSON.stringify({ mcpServers: { ghost: { command: "node", args: [STDIO_SERVER] } } })
    );
    process.env.HOME = fakeHome;

    // 真实项目配置的 server 在（对照：快照含 fx）。
    await createStdioServer("fx", callLog.path);
    await mcpSvc.setProjectEnabled(project.id, "fx", true);
    const spaceKey = await createSession(serverCtx.baseUrl, project.id);

    process.env.OPC_FAUX_TOOL_SEQUENCE = JSON.stringify([
      { tool: "mcp", args: { server: "ghost", tool: "ghost_ping", args: {} } },
      { tool: "mcp", args: { server: "fx", tool: "fx_fixture_ping", args: { text: "iso" } } },
    ]);
    process.env.OPC_FAUX_JUDGE_RESULT = JSON.stringify(ALLOW_BACKSTOP);

    // 已签断言：会话工具面不含 ghost server 工具（mcp({server:"ghost"}) → not found）。
    const ghostReply = await promptReply(spaceKey, "调用 ghost 工具");
    assert.ok(
      ghostReply.includes('Server "ghost" not found'),
      `散落配置的 ghost 不应出现在会话工具面（快照隔离）: ${ghostReply}`
    );

    // 对照：真实项目配置的 server 工具在（调用成功、fixture 收到）。
    await promptReply(spaceKey, "调用 fx 工具");
    await waitUntil(() => callLog.read().some((c) => c.name === "fixture_ping"), { label: "fx server 收到调用" });
    assert.ok(callLog.read().some((c) => c.name === "fixture_ping"), "真实项目配置的 server 工具在工具面（调用成功）");
  });

  it("标准 3：配置变更后新会话生效、进行中会话不变", async () => {
    await createStdioServer("fx", callLog.path);
    await mcpSvc.setProjectEnabled(project.id, "fx", true);
    const lateLog = fixtureCallLog(workdir, "calls-late.log");

    const s1 = await createSession(serverCtx.baseUrl, project.id);
    process.env.OPC_FAUX_TOOL_SEQUENCE = JSON.stringify([
      { tool: "mcp", args: { server: "late", tool: "late_fixture_ping", args: { text: "s1-before" } } },
      { tool: "mcp", args: { server: "late", tool: "late_fixture_ping", args: { text: "s1-after" } } },
      { tool: "mcp", args: { server: "late", tool: "late_fixture_ping", args: { text: "s2" } } },
    ]);
    process.env.OPC_FAUX_JUDGE_RESULT = JSON.stringify(ALLOW_BACKSTOP);

    // S1 会话建立时 late 尚未创建 → 工具面不含 late。
    const s1Before = await promptReply(s1, "调用 late 工具");
    assert.ok(s1Before.includes('Server "late" not found'), `S1 初始工具面不应含 late: ${s1Before}`);

    // 配置变更：新增 late server 并启用。
    await createStdioServer("late", lateLog.path);
    await mcpSvc.setProjectEnabled(project.id, "late", true);

    // 已签断言：进行中会话（S1）工具面不变（仍不含 late）。
    const s1After = await promptReply(s1, "再次调用 late 工具");
    assert.ok(
      s1After.includes('Server "late" not found'),
      `进行中会话 S1 工具面不应变化（仍不含 late）: ${s1After}`
    );

    // 已签断言：新会话 S2 工具面含 late（late fixture 收到调用）。
    const s2 = await createSession(serverCtx.baseUrl, project.id);
    await promptReply(s2, "新会话调用 late 工具");
    await waitUntil(() => lateLog.read().some((c) => c.name === "fixture_ping"), { label: "late server 收到调用" });
    assert.ok(
      lateLog.read().some((c) => c.name === "fixture_ping"),
      `新会话 S2 工具面应含 late（late server 收到调用）: ${JSON.stringify(lateLog.read())}`
    );
  });

  it("标准 4：远程 server（http/bearer）全链路调用成功", async () => {
    assert.ok(fs.existsSync(HTTP_SERVER), "http fixture 存在");
    const httpLog = fixtureCallLog(workdir, "calls-http.log");

    // spawn 本地 HTTP fixture（MCP_FIXTURE_TOKEN=t1 校验 bearer；stdout 报 PORT=）。
    const fixture = spawn(process.execPath, [HTTP_SERVER], {
      env: { ...process.env, MCP_FIXTURE_TOKEN: "t1", MCP_FIXTURE_CALL_LOG: httpLog.path },
    });
    const port = await withTimeout(
      new Promise((resolve, reject) => {
        let buf = "";
        const timer = setTimeout(() => reject(new Error("http fixture 未报 PORT=")), 10000);
        fixture.stdout.setEncoding("utf8");
        fixture.stdout.on("data", (chunk) => {
          buf += chunk;
          const m = /PORT=(\d+)/.exec(buf);
          if (m) {
            clearTimeout(timer);
            resolve(Number(m[1]));
          }
        });
        fixture.on("exit", (code) => {
          clearTimeout(timer);
          reject(new Error(`http fixture 提前退出 code=${code}`));
        });
      }),
      15000,
      "http fixture 启动"
    );

    try {
      // 带 token（经 headers 注入 bearer；桥 schema：http entry = url/headers/auth）。
      await mcpSvc.create({
        name: "remote",
        type: "http",
        url: `http://127.0.0.1:${port}`,
        auth: "bearer",
        headers: { Authorization: "Bearer t1" },
      });
      await mcpSvc.setProjectEnabled(project.id, "remote", true);
      // 无 token 配置 → 401（连接失败态）。
      await mcpSvc.create({ name: "remote-401", type: "http", url: `http://127.0.0.1:${port}`, auth: "bearer" });
      await mcpSvc.setProjectEnabled(project.id, "remote-401", true);

      const spaceKey = await createSession(serverCtx.baseUrl, project.id);
      process.env.OPC_FAUX_TOOL_SEQUENCE = JSON.stringify([
        { tool: "mcp", args: { server: "remote", tool: "remote_fixture_ping", args: { text: "http-bearer" } } },
        { tool: "mcp", args: { server: "remote-401", tool: "remote_401_fixture_ping", args: { text: "no-token" } } },
      ]);
      process.env.OPC_FAUX_JUDGE_RESULT = JSON.stringify(ALLOW_BACKSTOP);

      // 已签断言：http fixture 收到调用（远程 server 全链路调用成功）。
      const okReply = await promptReply(spaceKey, "调用远程 MCP 工具");
      await waitUntil(() => httpLog.read().some((c) => c.name === "fixture_ping"), { label: "http server 收到调用" });
      const calls = httpLog.read();
      assert.ok(
        calls.some((c) => c.name === "fixture_ping"),
        `http fixture 应收到调用: ${JSON.stringify(calls)}`
      );
      assert.equal(calls.find((c) => c.name === "fixture_ping").arguments.text, "http-bearer", "远程调用参数回流");

      // 无 token 配置时 401（连接失败态）：调用不达 fixture（日志无新增）。
      const failReply = await promptReply(spaceKey, "调用无 token 远程工具");
      assert.equal(
        httpLog.read().filter((c) => c.name === "fixture_ping").length,
        1,
        "401 连接失败：无 token 调用不应到达 fixture（日志仍为首次调用一条）"
      );
      assert.match(
        failReply,
        /401|unauthorized|Failed to connect|failed/i,
        `无 token 应呈连接失败态: ${failReply}`
      );
    } finally {
      fixture.kill("SIGKILL");
    }
  });
});
