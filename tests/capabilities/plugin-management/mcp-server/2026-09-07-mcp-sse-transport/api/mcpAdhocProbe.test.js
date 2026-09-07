// REQ-TRACE: 2026-09-07-mcp-sse-transport/REQ-MCP-SSE-005
// REQ-VERSION: v2-hash:514369c508988564fe44bcd04f986f44e029c17fd4db91296f6e3e165e4e852d
// CAPABILITY-TRACE: plugin-management
// ENTITY-TRACE: mcp-server
// EXPECTED-TRACE: prd.md §6.3 块 6（row 1-3）、§10.4 probeConfig 契约
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true (2026-09-07 assertion signoff v1.2 增量, 见 signoff.md)

// REQ-MCP-SSE-005：未落库配置的 ad-hoc 测试连接（req-gap 补全，2026-09-07 人裁决）。
//
// seam：src/http/routes/mcp.js handleMcp（mock req/res 直调；DB 经
//   OPC_WORKSTATION_CONFIG_DIR 指向临时库——对齐 mcpProbeTools.test.js 先例）。
// fixture：tests/fixtures/mcp-sse-server/server.mjs（legacy-only SSE stub）、
//   tests/fixtures/mcp-stdio-server/server.mjs（既有 stdio fixture）。
//
// 锁定契约：
//   1. POST /api/mcp/probe {type:"sse", url:stub} → 200 + tools 含 echo；不落库（list 为空）
//   2. url 指向已关闭端口 → 业务错误，message 以「连接失败：」开头
//   3. {type:"ws"} → 业务错误「type 不合法: 仅支持 stdio/http/sse」（校验与注册同构）
//   4. sse+bearer 内联配置 → stub 收到 Authorization: Bearer <token>；token 不落库
//   5. stdio 内联配置 → tools 含 fixture_ping（三类型同构）

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../../..");
const SSE_SERVER = path.join(ROOT, "tests/fixtures/mcp-sse-server/server.mjs");
const STDIO_SERVER = path.join(ROOT, "tests/fixtures/mcp-stdio-server/server.mjs");

async function loadRoute() {
  const mod = await import("../../../../../../src/http/routes/mcp.js").catch(() => null);
  assert.ok(mod, "seam 未就绪：src/http/routes/mcp.js");
  assert.equal(typeof mod.handleMcp, "function", "导出 handleMcp");
  return mod;
}

function mockRes() {
  return {
    statusCode: 0,
    body: undefined,
    raw: undefined,
    writeHead(status) {
      this.statusCode = status;
      return this;
    },
    end(payload) {
      this.raw = payload;
      this.body = payload ? JSON.parse(payload) : undefined;
      return this;
    },
  };
}

async function postProbe(handleMcp, body) {
  const res = mockRes();
  await handleMcp(
    { method: "POST", url: "/api/mcp/probe", headers: { host: "localhost" } },
    res,
    body,
    ["probe"]
  );
  return res;
}

async function startFixture(script, env = {}) {
  const proc = spawn(process.execPath, [script], {
    env: { ...process.env, ...env },
  });
  const port = await new Promise((resolve, reject) => {
    let buf = "";
    const timer = setTimeout(() => {
      proc.kill();
      reject(new Error("fixture 未报 PORT="));
    }, 10000);
    proc.stdout.setEncoding("utf8");
    proc.stdout.on("data", (chunk) => {
      buf += chunk;
      const m = /PORT=(\d+)/.exec(buf);
      if (m) {
        clearTimeout(timer);
        resolve(Number(m[1]));
      }
    });
    proc.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`fixture 提前退出 code=${code}`));
    });
  });
  return { proc, port };
}

describe("REQ-MCP-SSE-005 未落库配置的 ad-hoc 测试连接", () => {
  let workdir;
  let handleMcp;
  const cleanups = [];

  beforeEach(async () => {
    workdir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-adhoc-"));
    process.env.OPC_WORKSTATION_CONFIG_DIR = workdir;
    ({ handleMcp } = await loadRoute());
  });

  afterEach(async () => {
    for (const fn of cleanups.splice(0)) await fn();
    delete process.env.OPC_WORKSTATION_CONFIG_DIR;
    fs.rmSync(workdir, { recursive: true, force: true });
  });

  it("标准 1+2：内联 sse 配置探测成功且不落库", async () => {
    // EXPECTED-TRACE: prd.md §6.3 块 6 row 1
    const { proc, port } = await startFixture(SSE_SERVER);
    cleanups.push(() => proc.kill());

    const res = await postProbe(handleMcp, {
      type: "sse",
      url: `http://127.0.0.1:${port}/sse`,
    });
    assert.equal(res.statusCode, 200, `探测失败: ${JSON.stringify(res.body)}`);
    const tools = res.body?.tools ?? res.body;
    const echo = (tools ?? []).find((t) => t.name === "echo");
    assert.ok(echo, `tools 应含 echo: ${JSON.stringify(res.body)}`);
    assert.ok(typeof echo.description === "string" && echo.description.length > 0, "描述非空");

    // 无持久化副作用：列表仍为空
    const listRes = mockRes();
    await handleMcp({ method: "GET", url: "/api/mcp", headers: { host: "localhost" } }, listRes, undefined, []);
    const rows = Array.isArray(listRes.body) ? listRes.body : listRes.body?.servers ?? [];
    assert.equal(rows.length, 0, `探测不得落库: ${JSON.stringify(listRes.body)}`);
  });

  it("标准 3：url 指向已关闭端口 → 业务错误以「连接失败：」开头", async () => {
    // EXPECTED-TRACE: prd.md §6.3 块 6 row 2
    const { proc, port } = await startFixture(SSE_SERVER);
    proc.kill();
    await new Promise((resolve) => proc.on("exit", resolve));

    const res = await postProbe(handleMcp, {
      type: "sse",
      url: `http://127.0.0.1:${port}/sse`,
    });
    assert.notEqual(res.statusCode, 200, "失败不得返回 200");
    const msg = res.body?.error ?? res.body?.message ?? "";
    assert.ok(String(msg).startsWith("连接失败："), `消息以「连接失败：」开头: ${msg}`);
  });

  it("标准 4：{type:ws} → 业务错误「type 不合法: 仅支持 stdio/http/sse」", async () => {
    // EXPECTED-TRACE: prd.md §6.3 块 6 row 3（校验与注册同构）
    const res = await postProbe(handleMcp, { type: "ws", url: "ws://h/x" });
    assert.notEqual(res.statusCode, 200);
    const msg = res.body?.error ?? res.body?.message ?? "";
    assert.equal(msg, "type 不合法: 仅支持 stdio/http/sse");
  });

  it("标准 5：sse+bearer 内联配置 → stub 收到 Bearer 头；token 不落库", async () => {
    // EXPECTED-TRACE: prd.md §10.4 probeConfig 副作用行
    const authLog = path.join(workdir, "auth.log");
    const { proc, port } = await startFixture(SSE_SERVER, {
      MCP_FIXTURE_TOKEN: "adhoc-token",
      MCP_FIXTURE_AUTH_LOG: authLog,
    });
    cleanups.push(() => proc.kill());

    const res = await postProbe(handleMcp, {
      type: "sse",
      url: `http://127.0.0.1:${port}/sse`,
      auth: "bearer",
      token: "adhoc-token",
    });
    assert.equal(res.statusCode, 200, `bearer 探测失败: ${JSON.stringify(res.body)}`);
    assert.ok(!String(res.raw).includes("adhoc-token"), "响应不回显 token 明文");

    const lines = fs.readFileSync(authLog, "utf8").trim().split("\n");
    assert.ok(lines.includes("Bearer adhoc-token"), `stub 收到 Bearer 头: ${JSON.stringify(lines)}`);

    // token 不落库：DB 文件不存在 mcp_servers 行（list 已证空；此处防 stash 到凭据库）
    const listRes = mockRes();
    await handleMcp({ method: "GET", url: "/api/mcp", headers: { host: "localhost" } }, listRes, undefined, []);
    assert.ok(!String(listRes.raw ?? "").includes("adhoc-token"), "list 不含 token");
  });

  it("标准 6：stdio 内联配置 → tools 含 fixture_ping（三类型同构）", async () => {
    // EXPECTED-TRACE: prd.md §10.4 probeConfig 输入行（stdio→validateStdio 同构）
    const res = await postProbe(handleMcp, {
      type: "stdio",
      command: process.execPath,
      args: [STDIO_SERVER],
    });
    assert.equal(res.statusCode, 200, `stdio 探测失败: ${JSON.stringify(res.body)}`);
    const tools = res.body?.tools ?? res.body;
    assert.ok(
      (tools ?? []).some((t) => t.name === "fixture_ping"),
      `tools 应含 fixture_ping: ${JSON.stringify(res.body)}`
    );
  });
});
