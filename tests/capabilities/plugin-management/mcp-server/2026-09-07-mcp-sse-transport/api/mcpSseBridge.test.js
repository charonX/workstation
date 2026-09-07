// REQ-TRACE: 2026-09-07-mcp-sse-transport/REQ-MCP-SSE-002
// REQ-VERSION: v1-hash:9f20ee0db8e336cc1980dc6d6570aef6dcfb5e8fc0c592387ce1c6f12723465f
// CAPABILITY-TRACE: plugin-management
// ENTITY-TRACE: mcp-server
// EXPECTED-TRACE: prd.md §6.3 块 2（row 1-3）、§10.4 effectiveConfig 契约、全局约束
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true (2026-09-07 assertion signoff, 见 signoff.md)

// REQ-MCP-SSE-002：桥接快照输出显式 httpTransport（跨模块契约：mcpService → pi-mcp-adapter）。
//
// seam：src/services/mcpService.js effectiveConfig（临时库预置三类条目 +
//   两层启用——对齐 mcpService.test.js / mcpBridge.test.js 先例）。
//
// 锁定契约：
//   1. sse+bearer 条目 → {url, auth:"bearer", bearerToken:<明文>, httpTransport:"sse"}（深等于）
//   2. http 条目 → 含 httpTransport:"streamable-http"（行为变更：http 不再回落）
//   3. stdio 条目 → 不含 httpTransport 键
//   4. sse+headers → headers 原样 + httpTransport:"sse"
//   5. 仅全局开未项目启用 → 不出现在 effectiveConfig
//   6. 快照是唯一解密点：bearerToken=注册明文；DB token_enc 列 ≠ 明文

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";

async function loadMcpService() {
  const mod = await import("../../../../../../src/services/mcpService.js").catch(() => null);
  assert.ok(mod, "seam 未就绪：src/services/mcpService.js");
  assert.equal(typeof mod.createMcpService, "function", "导出 createMcpService");
  return mod;
}

describe("REQ-MCP-SSE-002 桥接快照输出显式 httpTransport", () => {
  let workdir;
  let svc;

  beforeEach(async () => {
    workdir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-sse-bridge-"));
    process.env.OPC_WORKSTATION_CONFIG_DIR = workdir;
    const mod = await loadMcpService();
    svc = await mod.createMcpService();
  });

  afterEach(() => {
    delete process.env.OPC_WORKSTATION_CONFIG_DIR;
    fs.rmSync(workdir, { recursive: true, force: true });
  });

  async function seedEnabled(row, projectId = "p1") {
    await svc.create(row);
    await svc.setGlobalEnabled(row.name, true);
    await svc.setProjectEnabled(projectId, row.name, true);
  }

  it("标准 1：sse+bearer 条目快照深等于 {url, auth, bearerToken, httpTransport:sse}", async () => {
    // EXPECTED-TRACE: prd.md §6.3 块 2 row 1
    await seedEnabled({
      name: "crawl4ai",
      type: "sse",
      url: "http://10.0.0.5:11235/mcp/sse",
      auth: "bearer",
      token: "ck-test",
    });
    const cfg = svc.effectiveConfig("p1");
    assert.deepEqual(cfg.servers.crawl4ai, {
      url: "http://10.0.0.5:11235/mcp/sse",
      auth: "bearer",
      bearerToken: "ck-test",
      httpTransport: "sse",
    });
  });

  it("标准 2：http 条目快照含 httpTransport:streamable-http（不再回落）", async () => {
    // EXPECTED-TRACE: prd.md §6.3 块 2 row 2（稳定块 5 行为变更）
    await seedEnabled({ name: "plain-http", type: "http", url: "https://m.example.com/mcp" });
    const cfg = svc.effectiveConfig("p1");
    assert.equal(cfg.servers["plain-http"].httpTransport, "streamable-http");
  });

  it("标准 3：stdio 条目快照不含 httpTransport 键", async () => {
    // EXPECTED-TRACE: prd.md §6.3 块 2 row 3
    await seedEnabled({ name: "local-stdio", type: "stdio", command: "npx", args: ["-y", "demo"] });
    const cfg = svc.effectiveConfig("p1");
    assert.ok(!("httpTransport" in cfg.servers["local-stdio"]), "stdio 无 httpTransport 键");
  });

  it("标准 4：sse+headers 快照 headers 原样 + httpTransport:sse", async () => {
    // EXPECTED-TRACE: prd.md §6.3 块 2 row 1 扩展
    await seedEnabled({
      name: "sse-headers",
      type: "sse",
      url: "http://h/mcp/sse",
      headers: { "X-Team": "infra" },
    });
    const cfg = svc.effectiveConfig("p1");
    assert.deepEqual(cfg.servers["sse-headers"].headers, { "X-Team": "infra" });
    assert.equal(cfg.servers["sse-headers"].httpTransport, "sse");
  });

  it("标准 5：仅全局开未项目启用的 sse 条目不出现在快照", async () => {
    // EXPECTED-TRACE: 全局约束「两层启用模型不变」
    await svc.create({ name: "global-only", type: "sse", url: "http://h/mcp/sse" });
    await svc.setGlobalEnabled("global-only", true);
    const cfg = svc.effectiveConfig("p1");
    assert.ok(!("global-only" in cfg.servers), "未项目启用不进快照");
  });

  it("标准 6：快照是唯一解密点——bearerToken=明文，DB token_enc ≠ 明文", async () => {
    // EXPECTED-TRACE: 全局约束「凭据安全不变」
    await seedEnabled({
      name: "crawl4ai",
      type: "sse",
      url: "http://10.0.0.5:11235/mcp/sse",
      auth: "bearer",
      token: "ck-test",
    });
    const cfg = svc.effectiveConfig("p1");
    assert.equal(cfg.servers.crawl4ai.bearerToken, "ck-test");

    const db = new Database(path.join(workdir, "data.db"), { readonly: true });
    const row = db.prepare("SELECT token_enc FROM mcp_servers WHERE name = ?").get("crawl4ai");
    db.close();
    assert.ok(row?.token_enc, "token_enc 列存在");
    assert.notEqual(row.token_enc, "ck-test", "DB 不存明文");
    assert.ok(!String(row.token_enc).includes("ck-test"), "密文不含明文子串");
  });
});
