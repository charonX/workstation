// REQ-TRACE: 2026-08-12-pi-mcp-plugin/REQ-AGENT-084
// REQ-VERSION: v1-hash:742cddf72b44df8cb71bb4b0cf6a8dae7a21d22df2b4c3788bdf3065208b848d
// CAPABILITY-TRACE: plugin-management
// ENTITY-TRACE: mcp-server
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: false (BUG-013 req-gap 补全新增 AC7：工具探测契约——直连拉 tools/list
//   返回名称+描述；连接失败 → 业务错误含「连接失败」；响应不回显 token 明文)

// BUG-013 回归（req-gap 就地补全，人确认 2026-08-16）：MCP 页「配置后直连 server
// 拉取工具清单」能力的服务端 seam——GET /api/mcp/:name/tools。
//
// 锁定契约（REQ-AGENT-084 AC7）：
//   1. stdio fixture server 落库 → 200 + tools 含 fixture_ping（名称+描述）
//   2. http fixture（bearer）→ 200 + fixture_ping；整个响应体不回显 token 明文
//   3. stdio command 不存在 → 业务错误（非 200），message 含「连接失败」
//   4. http 端口不通 → 业务错误，message 含「连接失败」
//
// seam：src/http/routes/mcp.js handleMcp（mock req/res 直调；DB 经
//   OPC_WORKSTATION_CONFIG_DIR 指向临时库——对齐 mcpHttpProjectList.test.js 先例）。
// fixture：tests/fixtures/mcp-stdio-server/server.mjs（tools/list 回 fixture_ping）、
//   tests/fixtures/mcp-http-server/server.mjs（MCP_FIXTURE_TOKEN 校验 bearer，stdout 报 PORT=）。

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../..");
const STDIO_SERVER = path.join(ROOT, "tests/fixtures/mcp-stdio-server/server.mjs");
const HTTP_SERVER = path.join(ROOT, "tests/fixtures/mcp-http-server/server.mjs");

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

async function getTools(handleMcp, name) {
  const res = mockRes();
  await handleMcp(
    { method: "GET", url: `/api/mcp/${encodeURIComponent(name)}/tools`, headers: { host: "localhost" } },
    res,
    undefined,
    [name, "tools"]
  );
  return res;
}

/** spawn http fixture，stdout 报 PORT= 后 resolve {proc, port}（对齐 mcpBridge.test.js 先例）。 */
async function startHttpFixture(env = {}) {
  const proc = spawn(process.execPath, [HTTP_SERVER], {
    env: { ...process.env, ...env },
  });
  const port = await new Promise((resolve, reject) => {
    let buf = "";
    const timer = setTimeout(() => reject(new Error("http fixture 未报 PORT=")), 10000);
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
      reject(new Error(`http fixture 提前退出 code=${code}`));
    });
  });
  return { proc, port };
}

describe("REQ-AGENT-084 AC7 工具探测 GET /api/mcp/:name/tools（BUG-013）", () => {
  let workdir;
  let handleMcp;
  const cleanups = [];

  beforeEach(async () => {
    workdir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-probe-"));
    process.env.OPC_WORKSTATION_CONFIG_DIR = workdir;
    ({ handleMcp } = await loadRoute());
  });

  afterEach(async () => {
    for (const fn of cleanups.splice(0)) await fn();
    delete process.env.OPC_WORKSTATION_CONFIG_DIR;
    fs.rmSync(workdir, { recursive: true, force: true });
  });

  async function seedServer(body) {
    const res = mockRes();
    await handleMcp({ method: "POST" }, res, body, []);
    assert.equal(res.statusCode, 200, `seed 失败: ${JSON.stringify(res.body)}`);
  }

  it("stdio fixture → 200 + tools 含 fixture_ping（名称+描述）", async () => {
    assert.ok(fs.existsSync(STDIO_SERVER), "stdio fixture 存在");
    await seedServer({ name: "probe-stdio", type: "stdio", command: process.execPath, args: [STDIO_SERVER] });

    const res = await getTools(handleMcp, "probe-stdio");
    assert.equal(res.statusCode, 200, `探测失败: ${JSON.stringify(res.body)}`);
    const tools = res.body?.tools ?? res.body;
    const ping = (tools ?? []).find((t) => t.name === "fixture_ping");
    assert.ok(ping, `tools 应含 fixture_ping: ${JSON.stringify(res.body)}`);
    assert.ok(typeof ping.description === "string" && ping.description.length > 0, "描述非空");
  });

  it("http fixture（bearer）→ 200 + fixture_ping；响应不回显 token 明文", async () => {
    const { proc, port } = await startHttpFixture({ MCP_FIXTURE_TOKEN: "probe-secret-t1" });
    cleanups.push(() => proc.kill());
    await seedServer({
      name: "probe-http",
      type: "http",
      url: `http://127.0.0.1:${port}`,
      auth: "bearer",
      token: "probe-secret-t1",
    });

    const res = await getTools(handleMcp, "probe-http");
    assert.equal(res.statusCode, 200, `探测失败: ${JSON.stringify(res.body)}`);
    const tools = res.body?.tools ?? res.body;
    assert.ok((tools ?? []).some((t) => t.name === "fixture_ping"), `tools 应含 fixture_ping: ${JSON.stringify(res.body)}`);
    assert.ok(!res.raw.includes("probe-secret-t1"), "响应不得回显 token 明文");
  });

  it("stdio command 不存在 → 业务错误，message 含「连接失败」", async () => {
    await seedServer({ name: "probe-missing", type: "stdio", command: "run-missing-command-xyz" });

    const res = await getTools(handleMcp, "probe-missing");
    assert.notEqual(res.statusCode, 200, `不应成功: ${JSON.stringify(res.body)}`);
    assert.ok(res.body?.message?.includes("连接失败"), `错误应含「连接失败」: ${JSON.stringify(res.body)}`);
  });

  it("http 端口不通 → 业务错误，message 含「连接失败」", async () => {
    // 127.0.0.1:1 为保留不可达端口，连接必拒
    await seedServer({ name: "probe-down", type: "http", url: "http://127.0.0.1:1/mcp" });

    const res = await getTools(handleMcp, "probe-down");
    assert.notEqual(res.statusCode, 200, `不应成功: ${JSON.stringify(res.body)}`);
    assert.ok(res.body?.message?.includes("连接失败"), `错误应含「连接失败」: ${JSON.stringify(res.body)}`);
  });
});
