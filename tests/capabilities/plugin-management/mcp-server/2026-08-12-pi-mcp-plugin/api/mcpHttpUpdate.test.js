// REQ-TRACE: 2026-08-12-pi-mcp-plugin/REQ-AGENT-084
// REQ-VERSION: v1-hash:6c7fd998525a697ef21587c808800edfb15182b428d588f83c9ae835acf09243
// CAPABILITY-TRACE: plugin-management
// ENTITY-TRACE: mcp-server
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true (2026-08-13 assertion signoff)

// BUG-008 回归：REQ-084 契约是 CRUD，但 HTTP 面缺 U——PUT /api/mcp/:name 落 404，
// UI 因此无编辑入口。本文件锁 HTTP 路由层 update 契约。
//
// 断言来源（不新签主观值，直接应用已签契约）：
//   - REQ-084 接口契约「CRUD { name, type, command?, args?, env?, url?, headers?, auth?, token? }」
//   - BUG-006 已签 token 语义（REQ-084 标准 6/token 语义段）：token 明文永不回显；
//     编辑不带 token = 保留原 token；带 token = 轮换。
//   - 已签错误消息：名称重复含「已存在」（update 改名撞名同样适用）。
//
// seam：src/http/routes/mcp.js handleMcp（mock req/res 直调；DB 经
//   OPC_WORKSTATION_CONFIG_DIR 指向临时库——对齐 mcpService.test.js 先例）。

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

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
    writeHead(status) {
      this.statusCode = status;
      return this;
    },
    end(payload) {
      this.body = payload ? JSON.parse(payload) : undefined;
      return this;
    },
  };
}

describe("REQ-AGENT-084 MCP server HTTP update（BUG-008 回归）", () => {
  let workdir;
  let handleMcp;

  beforeEach(async () => {
    workdir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-http-"));
    process.env.OPC_WORKSTATION_CONFIG_DIR = workdir;
    ({ handleMcp } = await loadRoute());
  });

  afterEach(() => {
    delete process.env.OPC_WORKSTATION_CONFIG_DIR;
    fs.rmSync(workdir, { recursive: true, force: true });
  });

  async function seedHttp(overrides = {}) {
    const res = mockRes();
    await handleMcp(
      { method: "POST" },
      res,
      {
        name: "firecrawl",
        type: "http",
        url: "https://old.example.com/mcp",
        auth: "bearer",
        token: "secret-token-1",
        ...overrides,
      },
      []
    );
    assert.equal(res.statusCode, 200, `seed 失败: ${JSON.stringify(res.body)}`);
  }

  it("标准 7a：PUT /api/mcp/:name 更新 url/headers → 200 + list 反映新值", async () => {
    await seedHttp();
    const res = mockRes();
    await handleMcp(
      { method: "PUT" },
      res,
      { url: "https://new.example.com/mcp", headers: { X_Team: "core" } },
      ["firecrawl"]
    );
    assert.equal(res.statusCode, 200, `PUT 应成功: ${JSON.stringify(res.body)}`);

    const listRes = mockRes();
    await handleMcp({ method: "GET" }, listRes, undefined, []);
    const row = listRes.body.find((s) => s.name === "firecrawl");
    assert.equal(row.url, "https://new.example.com/mcp", "list 反映新 url");
    assert.deepEqual(row.headers, { X_Team: "core" }, "list 反映新 headers");
  });

  it("标准 7b：PUT 带 token = 轮换；不带 token = 保留（BUG-006 已签语义）", async () => {
    await seedHttp();
    const svcMod = await import("../../../../../../src/services/mcpService.js");
    const svc = svcMod.createMcpService();
    await svc.setProjectEnabled("p1", "firecrawl", true);

    // 带 token → 轮换
    const rotateRes = mockRes();
    await handleMcp({ method: "PUT" }, rotateRes, { token: "secret-token-2" }, ["firecrawl"]);
    assert.equal(rotateRes.statusCode, 200, `轮换应成功: ${JSON.stringify(rotateRes.body)}`);
    let snap = await svc.effectiveConfig("p1");
    assert.equal(snap.servers.firecrawl.bearerToken, "secret-token-2", "快照为新 token");

    // 不带 token → 保留
    const keepRes = mockRes();
    await handleMcp({ method: "PUT" }, keepRes, { url: "https://v3.example.com/mcp" }, ["firecrawl"]);
    assert.equal(keepRes.statusCode, 200, `保留语义更新应成功: ${JSON.stringify(keepRes.body)}`);
    snap = await svc.effectiveConfig("p1");
    assert.equal(snap.servers.firecrawl.bearerToken, "secret-token-2", "未带 token 时保留原值");
    assert.equal(snap.servers.firecrawl.url, "https://v3.example.com/mcp", "其他字段照常更新");

    // 响应不回显明文
    assert.equal(JSON.stringify(keepRes.body).includes("secret-token"), false, "响应不含明文 token");
  });

  it("标准 7c：PUT 不存在的 name → 404；非法字段值 → 4xx 校验错误", async () => {
    const missingRes = mockRes();
    await handleMcp({ method: "PUT" }, missingRes, { url: "https://x.example.com" }, ["ghost"]);
    assert.equal(missingRes.statusCode, 404, "不存在 → 404");

    await seedHttp();
    const badRes = mockRes();
    await handleMcp({ method: "PUT" }, badRes, { url: "ftp://bad" }, ["firecrawl"]);
    assert.equal(badRes.statusCode, 400, "非法 url → 400");
    assert.match(badRes.body.message, /URL/, "错误文案含 URL（对齐已签消息契约）");
  });
});
