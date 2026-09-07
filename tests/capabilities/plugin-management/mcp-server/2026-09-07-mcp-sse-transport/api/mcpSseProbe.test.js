// REQ-TRACE: 2026-09-07-mcp-sse-transport/REQ-MCP-SSE-003
// REQ-VERSION: v1-hash:9f20ee0db8e336cc1980dc6d6570aef6dcfb5e8fc0c592387ce1c6f12723465f
// CAPABILITY-TRACE: plugin-management
// ENTITY-TRACE: mcp-server
// EXPECTED-TRACE: prd.md §6.3 块 3（row 1-2）、§8、§10.3 步骤 5
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true (2026-09-07 assertion signoff, 见 signoff.md)

// REQ-MCP-SSE-003：探测按声明 transport 分派（消除 SSE 假阴性）。
//
// seam：src/services/mcpService.js probeTools（service 直调；DB 经
//   OPC_WORKSTATION_CONFIG_DIR 指向临时库）。
// fixture：
//   tests/fixtures/mcp-sse-server/server.mjs（legacy-only SSE stub；对 streamable
//     POST 一律 405——探测成功即证明走的是 SSEClientTransport；MCP_FIXTURE_TOKEN
//     校验 bearer；MCP_FIXTURE_AUTH_LOG 记录 GET /sse 的 Authorization 头）
//   tests/fixtures/mcp-http-server/server.mjs（既有 streamable fixture，回归用）
//
// 锁定契约：
//   1. sse 条目探测 stub → tools 含 {name:"echo", description:"回显输入文本（sse fixture）"}
//   2. （同 1）stub 为 legacy-only，成功即证明使用 SSEClientTransport
//   3. sse 指向已关闭端口 → 抛错，消息以「连接失败：」开头
//   4. sse+bearer → stub 收到 Authorization: Bearer <token>
//   5. 回归：http 条目探测既有 streamable fixture 仍成功

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../../..");
const SSE_SERVER = path.join(ROOT, "tests/fixtures/mcp-sse-server/server.mjs");
const HTTP_SERVER = path.join(ROOT, "tests/fixtures/mcp-http-server/server.mjs");

async function loadMcpService() {
  const mod = await import("../../../../../../src/services/mcpService.js").catch(() => null);
  assert.ok(mod, "seam 未就绪：src/services/mcpService.js");
  assert.equal(typeof mod.createMcpService, "function", "导出 createMcpService");
  return mod;
}

/** spawn fixture，stdout 报 PORT= 后 resolve {proc, port}（对齐 mcpProbeTools.test.js 先例）。 */
async function startFixture(script, env = {}) {
  const proc = spawn(process.execPath, [script], {
    env: { ...process.env, ...env },
  });
  const port = await new Promise((resolve, reject) => {
    let buf = "";
    const timer = setTimeout(() => reject(new Error("fixture 未报 PORT=")), 10000);
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

describe("REQ-MCP-SSE-003 探测按声明 transport 分派", () => {
  let workdir;
  let svc;
  const cleanups = [];

  beforeEach(async () => {
    workdir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-sse-probe-"));
    process.env.OPC_WORKSTATION_CONFIG_DIR = workdir;
    const mod = await loadMcpService();
    svc = await mod.createMcpService();
  });

  afterEach(async () => {
    for (const fn of cleanups.splice(0)) await fn();
    delete process.env.OPC_WORKSTATION_CONFIG_DIR;
    fs.rmSync(workdir, { recursive: true, force: true });
  });

  it("标准 1+2：sse 条目探测 legacy-only stub → tools 含 echo（证明走 SSEClientTransport）", async () => {
    // EXPECTED-TRACE: prd.md §6.3 块 3 row 1
    const { proc, port } = await startFixture(SSE_SERVER);
    cleanups.push(() => proc.kill());
    await svc.create({
      name: "crawl4ai",
      type: "sse",
      url: `http://127.0.0.1:${port}/sse`,
    });

    const tools = await svc.probeTools("crawl4ai");
    const echo = (tools ?? []).find((t) => t.name === "echo");
    assert.ok(echo, `tools 应含 echo: ${JSON.stringify(tools)}`);
    assert.ok(typeof echo.description === "string" && echo.description.length > 0, "描述非空");
  });

  it("标准 3：sse 指向已关闭端口 → 抛错消息以「连接失败：」开头", async () => {
    // EXPECTED-TRACE: prd.md §6.3 块 3 row 2, §8
    const { proc, port } = await startFixture(SSE_SERVER);
    proc.kill();
    await new Promise((resolve) => proc.on("exit", resolve));

    await svc.create({ name: "down", type: "sse", url: `http://127.0.0.1:${port}/sse` });
    await assert.rejects(
      () => svc.probeTools("down"),
      (err) => {
        assert.ok(
          String(err.message).startsWith("连接失败："),
          `消息以「连接失败：」开头: ${err.message}`
        );
        return true;
      }
    );
  });

  it("标准 4：sse+bearer 探测携带 Authorization: Bearer <token>", async () => {
    // EXPECTED-TRACE: prd.md §10.3 步骤 5；全局约束「凭据安全不变」
    const authLog = path.join(workdir, "auth.log");
    const { proc, port } = await startFixture(SSE_SERVER, {
      MCP_FIXTURE_TOKEN: "probe-sse-token",
      MCP_FIXTURE_AUTH_LOG: authLog,
    });
    cleanups.push(() => proc.kill());
    await svc.create({
      name: "crawl4ai",
      type: "sse",
      url: `http://127.0.0.1:${port}/sse`,
      auth: "bearer",
      token: "probe-sse-token",
    });

    const tools = await svc.probeTools("crawl4ai");
    assert.ok((tools ?? []).some((t) => t.name === "echo"), "bearer 探测成功");

    const lines = fs.readFileSync(authLog, "utf8").trim().split("\n");
    assert.ok(
      lines.includes("Bearer probe-sse-token"),
      `GET /sse 收到 Bearer 头: ${JSON.stringify(lines)}`
    );
  });

  it("标准 5：回归——http 条目探测既有 streamable fixture 仍成功", async () => {
    // EXPECTED-TRACE: prd.md §8 回归面（REQ-AGENT-084 AC7 既有契约不动）
    const { proc, port } = await startFixture(HTTP_SERVER);
    cleanups.push(() => proc.kill());
    await svc.create({ name: "plain-http", type: "http", url: `http://127.0.0.1:${port}` });

    const tools = await svc.probeTools("plain-http");
    assert.ok(
      (tools ?? []).some((t) => t.name === "fixture_ping"),
      `http 探测不回归: ${JSON.stringify(tools)}`
    );
  });

  it("标准 5b：回归——stdio 条目探测既有 stdio fixture 仍成功（review test-F2 补强）", async () => {
    // EXPECTED-TRACE: prd.md §8 回归面（REQ-AGENT-084 AC7：stdio 仍走 StdioClientTransport）
    const STDIO_SERVER = path.join(ROOT, "tests/fixtures/mcp-stdio-server/server.mjs");
    await svc.create({
      name: "local-stdio",
      type: "stdio",
      command: process.execPath,
      args: [STDIO_SERVER],
    });

    const tools = await svc.probeTools("local-stdio");
    assert.ok(
      (tools ?? []).some((t) => t.name === "fixture_ping"),
      `stdio 探测不回归: ${JSON.stringify(tools)}`
    );
  });
});
