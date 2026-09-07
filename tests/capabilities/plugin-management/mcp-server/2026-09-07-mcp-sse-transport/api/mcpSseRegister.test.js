// REQ-TRACE: 2026-09-07-mcp-sse-transport/REQ-MCP-SSE-001
// REQ-VERSION: v1-hash:9f20ee0db8e336cc1980dc6d6570aef6dcfb5e8fc0c592387ce1c6f12723465f
// CAPABILITY-TRACE: plugin-management
// ENTITY-TRACE: mcp-server
// EXPECTED-TRACE: prd.md §6.3 块 1（row 1-3）、§7（type/url/auth/token/headers 行）、§7.1 行 2
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true (2026-09-07 assertion signoff, 见 signoff.md)

// REQ-MCP-SSE-001：注册与更新支持 type:"sse"。
//
// seam：src/services/mcpService.js（create/update/list 直调；DB 经
//   OPC_WORKSTATION_CONFIG_DIR 指向临时库——对齐 mcpService.test.js 先例）。
//
// 锁定契约（全部 EXPECTED-TRACE 自 PRD 锚点，不读实现）：
//   1. create sse+bearer 成功：type/url/auth 原样；list 同值
//   2. 任何响应与 list 输出不含 token 明文（脱敏契约 sse 同构）
//   3. url=ftp://… → 抛「URL 不合法: 仅支持 http/https」
//   4. url 缺失/空 → 抛「URL 不合法: url is required」
//   5. type=ws → 抛「type 不合法: 仅支持 stdio/http/sse」
//   6. sse+bearer 无 token → 抛「auth=bearer 必须提供 token（加密存系统凭据库）」
//   7. auth=basic → 抛「auth 不合法: 仅支持 none/bearer/oauth」
//   8. update 仅改 url（未给新 token）→ 保留既有密文，快照仍得旧 token
//   9. sse 支持 headers 键值；非法结构拒绝（消息含「KEY」）

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

async function loadMcpService() {
  const mod = await import("../../../../../../src/services/mcpService.js").catch(() => null);
  assert.ok(mod, "seam 未就绪：src/services/mcpService.js");
  assert.equal(typeof mod.createMcpService, "function", "导出 createMcpService");
  return mod;
}

describe("REQ-MCP-SSE-001 注册与更新支持 type:sse", () => {
  let workdir;
  let svc;

  beforeEach(async () => {
    workdir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-sse-reg-"));
    process.env.OPC_WORKSTATION_CONFIG_DIR = workdir;
    const mod = await loadMcpService();
    svc = await mod.createMcpService();
  });

  afterEach(() => {
    delete process.env.OPC_WORKSTATION_CONFIG_DIR;
    fs.rmSync(workdir, { recursive: true, force: true });
  });

  it("标准 1：create sse+bearer 成功，type/url/auth 原样，list 同值", async () => {
    // EXPECTED-TRACE: prd.md §6.3 块 1 row 1
    const created = await svc.create({
      name: "crawl4ai",
      type: "sse",
      url: "http://10.0.0.5:11235/mcp/sse",
      auth: "bearer",
      token: "ck-test",
    });
    assert.equal(created.type, "sse");
    assert.equal(created.url, "http://10.0.0.5:11235/mcp/sse");
    assert.equal(created.auth, "bearer");

    const listed = svc.list().find((s) => s.name === "crawl4ai");
    assert.ok(listed, "list 应含 crawl4ai");
    assert.equal(listed.type, "sse");
    assert.equal(listed.url, "http://10.0.0.5:11235/mcp/sse");
    assert.equal(listed.auth, "bearer");
  });

  it("标准 2：create 返回值与 list 输出均不含 token 明文", async () => {
    // EXPECTED-TRACE: prd.md §6.3 块 1 row 1；全局约束「凭据安全不变」
    const created = await svc.create({
      name: "crawl4ai",
      type: "sse",
      url: "http://10.0.0.5:11235/mcp/sse",
      auth: "bearer",
      token: "ck-test",
    });
    assert.ok(!JSON.stringify(created).includes("ck-test"), "create 响应不回显 token 明文");
    assert.ok(!JSON.stringify(svc.list()).includes("ck-test"), "list 输出不回显 token 明文");
  });

  it("标准 3：url=ftp://… 抛「URL 不合法: 仅支持 http/https」", async () => {
    // EXPECTED-TRACE: prd.md §6.3 块 1 row 2, §7 url 行
    await assert.rejects(
      () => svc.create({ name: "x", type: "sse", url: "ftp://h/mcp/sse" }),
      (err) => {
        assert.equal(err.message, "URL 不合法: 仅支持 http/https");
        return true;
      }
    );
  });

  it("标准 4：url 空抛「URL 不合法: url is required」", async () => {
    // EXPECTED-TRACE: prd.md §7 url 行
    await assert.rejects(
      () => svc.create({ name: "x", type: "sse", url: "" }),
      (err) => {
        assert.equal(err.message, "URL 不合法: url is required");
        return true;
      }
    );
  });

  it("标准 5：type=ws 抛「type 不合法: 仅支持 stdio/http/sse」", async () => {
    // EXPECTED-TRACE: prd.md §6.3 块 1 row 3, §7 type 行（WS 范围外决策）
    await assert.rejects(
      () => svc.create({ name: "x", type: "ws", url: "ws://h/mcp/ws" }),
      (err) => {
        assert.equal(err.message, "type 不合法: 仅支持 stdio/http/sse");
        return true;
      }
    );
  });

  it("标准 6：sse+bearer 无 token 抛「auth=bearer 必须提供 token（加密存系统凭据库）」", async () => {
    // EXPECTED-TRACE: prd.md §7 token 行
    await assert.rejects(
      () =>
        svc.create({ name: "x", type: "sse", url: "http://h/mcp/sse", auth: "bearer" }),
      (err) => {
        assert.equal(err.message, "auth=bearer 必须提供 token（加密存系统凭据库）");
        return true;
      }
    );
  });

  it("标准 7：auth=basic 抛「auth 不合法: 仅支持 none/bearer/oauth」", async () => {
    // EXPECTED-TRACE: prd.md §7 auth 行
    await assert.rejects(
      () =>
        svc.create({ name: "x", type: "sse", url: "http://h/mcp/sse", auth: "basic" }),
      (err) => {
        assert.equal(err.message, "auth 不合法: 仅支持 none/bearer/oauth");
        return true;
      }
    );
  });

  it("标准 8：update 仅改 url 保留既有 bearer 密文（快照仍得旧 token）", async () => {
    // EXPECTED-TRACE: prd.md §7.1 行 2（既有 BUG-006 语义，sse 同构）
    await svc.create({
      name: "crawl4ai",
      type: "sse",
      url: "http://10.0.0.5:11235/mcp/sse",
      auth: "bearer",
      token: "ck-test",
    });
    await svc.update("crawl4ai", { url: "http://10.0.0.6:11235/mcp/sse" });

    // 经 effectiveConfig 快照观察解密结果（两层启用后才出现）
    await svc.setGlobalEnabled("crawl4ai", true);
    await svc.setProjectEnabled("p1", "crawl4ai", true);
    const cfg = svc.effectiveConfig("p1");
    assert.equal(cfg.servers.crawl4ai.url, "http://10.0.0.6:11235/mcp/sse");
    assert.equal(cfg.servers.crawl4ai.bearerToken, "ck-test", "更新未给新 token 时保留既有密文");
  });

  it("标准 9：sse 支持 headers 键值；非法结构拒绝", async () => {
    // EXPECTED-TRACE: prd.md §7 headers 行
    const created = await svc.create({
      name: "with-headers",
      type: "sse",
      url: "http://h/mcp/sse",
      headers: { "X-Team": "infra" },
    });
    assert.deepEqual(created.headers, { "X-Team": "infra" });

    await assert.rejects(
      () =>
        svc.create({ name: "bad-headers", type: "sse", url: "http://h/mcp/sse", headers: { "BAD KEY!": "v" } }),
      (err) => {
        assert.ok(String(err.message).includes("KEY"), `消息含 KEY: ${err.message}`);
        return true;
      }
    );
  });
});
