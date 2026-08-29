// REQ-TRACE: 2026-08-24-embedded-browser/REQ-BROWSER-002, 2026-08-24-embedded-browser/REQ-BROWSER-006
// REQ-VERSION: v1-hash:28b4d67858fda6ad607eac25ec8b9fe9abdd805baa59ba5c36f3d47e9e8b7b59
// CAPABILITY-TRACE: embedded-browser
// ENTITY-TRACE: browser-tools
// EXPECTED-TRACE: prd.md §6.3 块2 rows 5-6, §6.3 块5 rows 2/5, §10.4 接口2 golden values, §10.4 接口6 CLI 声明表, §8-E8
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: false
//
// 状态：哨兵已移除（2026-08-29，Slice 2 落地）。
// 覆盖 seam：CLI 工具面（toolAdapter browser 命令声明）+ HTTP（/api/browser/*，工具后端）。
// read 结构/截断、scroll、screenshot 四用例为 Electron-only（需真实 WebContentsView），
// 已迁移至 e2e/browserPanel.test.cjs（本文件不含）。

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import { createToolSurface, TOOL_DEFS } from "../../../../../../src/agent/toolAdapter.js";
import { startServer, stopServer } from "../../../../../../src/http/server.js";

describe("REQ-BROWSER-002 agent 浏览器读取工具集（toolAdapter 声明与回执）", () => {
  it("riskLevel 声明：四个 browser 命令均为 query（锚点 §6.3 块2 row6）", () => {
    // EXPECTED-TRACE: prd.md §6.3 块2 row 6（navigate/read/scroll/screenshot 均 query）
    const defs = TOOL_DEFS.filter((d) => d.name.startsWith("browser "));
    const byName = Object.fromEntries(defs.map((d) => [d.name, d]));
    for (const name of ["browser navigate", "browser read", "browser scroll", "browser screenshot"]) {
      assert.ok(byName[name], `TOOL_DEFS 缺少 ${name}`);
      assert.equal(byName[name].riskLevel, "query");
    }
  });

  it("riskLevel 声明：browser auth-check 为 query（锚点 §6.3 块2 row6 / REQ-006 标准4）", () => {
    // EXPECTED-TRACE: prd.md §6.3 块2 row 6（auth-check riskLevel=query）
    const def = TOOL_DEFS.find((d) => d.name === "browser auth-check");
    assert.ok(def, "TOOL_DEFS 缺少 browser auth-check");
    assert.equal(def.riskLevel, "query");
  });

  describe("工具回执（经 /api/browser/*，本地 http stub 页）", () => {
    let workdir;
    let serverCtx;
    let baseUrl;
    let stubServer;
    let stubPort;
    let surface;

    beforeEach(async () => {
      workdir = fs.mkdtempSync(path.join(os.tmpdir(), "browser-tools-test-"));
      process.env.OPC_WORKSTATION_CONFIG_DIR = workdir;
      stubServer = await new Promise((resolve) => {
        const s = http.createServer((req, res) => {
          res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
          res.end(
            `<!doctype html><html><head><title>My App</title></head><body>` +
              `<h1>My App</h1><a class="md-cta" href="/next">立即开始</a></body></html>`
          );
        });
        s.listen(0, "127.0.0.1", () => resolve(s));
      });
      stubPort = stubServer.address().port;
      serverCtx = await startServer({ port: 0 });
      baseUrl = serverCtx.baseUrl;
      // 生产接线：worker 经 OPC_AGENT_SERVER_BASE_URL 直连主 server（BUG-007 先例）。
      surface = createToolSurface({ baseUrl, sessionKey: "ui:copilot:test" });
    });

    afterEach(async () => {
      if (serverCtx) await stopServer(serverCtx);
      if (stubServer) stubServer.close();
      stubServer = null;
      fs.rmSync(workdir, { recursive: true, force: true });
    });

    it("navigate 回执：{ok:true, url, title}（锚点 §6.3 块2 row5）", async () => {
      // EXPECTED-TRACE: prd.md §6.3 块2 row 5（{ok:true,url:"http://localhost:<port>/",title:<stub标题>}）
      const out = await surface.invoke(`browser navigate --url http://localhost:${stubPort}`);
      const parsed = JSON.parse(out);
      assert.equal(parsed.ok, true);
      assert.equal(parsed.url, `http://localhost:${stubPort}/`);
      assert.equal(parsed.title, "My App");
    });

    it("read 未就绪：实例从未创建返回 E-BROWSER-NOT-READY（锚点 §8-E3）", async () => {
      // EXPECTED-TRACE: prd.md §10.4 接口2 样例（未就绪 → E-BROWSER-NOT-READY）
      const out = await surface.invoke("browser read");
      const parsed = JSON.parse(out);
      assert.equal(parsed.ok, false);
      assert.equal(parsed.error.code, "E-BROWSER-NOT-READY");
    });

    it("expand 事件：面板收起时 navigate --expand 请求展开（REQ-002 标准8；E2E 深验证见 e2e/）", async () => {
      // EXPECTED-TRACE: prd.md §10.3 数据流副作用（expand → panel-request-open 事件）
      const out = await surface.invoke(`browser navigate --url http://localhost:${stubPort} --expand`);
      assert.equal(JSON.parse(out).ok, true);
      // 事件到达渲染进程的端到端验证归 E2E（e2e/browserPanel.test.cjs）。
    });
  });
});

describe("REQ-BROWSER-006 agent 登录探测 auth-check", () => {
  let workdir;
  let serverCtx;
  let baseUrl;
  let surface;
  let seedCookie;

  beforeEach(async () => {
    workdir = fs.mkdtempSync(path.join(os.tmpdir(), "browser-auth-test-"));
    process.env.OPC_WORKSTATION_CONFIG_DIR = workdir;
    serverCtx = await startServer({ port: 0 });
    baseUrl = serverCtx.baseUrl;
    surface = createToolSurface({ baseUrl, sessionKey: "ui:copilot:test" });
    // 种 Cookie：dev-only seam POST /api/browser/_test/seed-cookies（仅 NODE_ENV=test）。
    seedCookie = async (names = ["SESSDATA", "bili_jct"]) => {
      const values = { SESSDATA: "abc123", bili_jct: "xyz" };
      const cookies = names.map((name) => ({ name, value: values[name], domain: ".bilibili.com", path: "/" }));
      const r = await fetch(`${baseUrl}/api/browser/_test/seed-cookies`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cookies }),
      });
      assert.equal((await r.json()).ok, true);
    };
  });

  afterEach(async () => {
    if (serverCtx) await stopServer(serverCtx);
    fs.rmSync(workdir, { recursive: true, force: true });
  });

  it("已登录：required-cookies 全部存在 → authenticated:true（锚点 §6.3 块5 row2）", async () => {
    // EXPECTED-TRACE: prd.md §6.3 块5 row 2（{authenticated:true}）
    await seedCookie();
    const out = await surface.invoke("browser auth-check --domain .bilibili.com --required-cookies SESSDATA");
    assert.deepEqual(JSON.parse(out), { authenticated: true });
  });

  it("未登录：缺失名单返回 missing 数组，非错误（锚点 §8-E8 / REQ-006 标准2）", async () => {
    // EXPECTED-TRACE: prd.md §8-E8（{authenticated:false, missing:["SESSDATA"]}）
    await seedCookie(["bili_jct"]); // 仅种 bili_jct（SESSDATA 缺失）
    const out = await surface.invoke("browser auth-check --domain .bilibili.com --required-cookies SESSDATA");
    assert.deepEqual(JSON.parse(out), { authenticated: false, missing: ["SESSDATA"] });
  });

  it("空 required-cookies：无任何 Cookie → {authenticated:false, missing:[]}（§7.1 row3）", async () => {
    // EXPECTED-TRACE: prd.md §7.1 row 3（空名单=存在任意 Cookie）
    const out = await surface.invoke("browser auth-check --domain .bilibili.com");
    assert.deepEqual(JSON.parse(out), { authenticated: false, missing: [] });
  });

  it("BAD-DOMAIN 透传：无前导点拒绝（REQ-006 标准5）", async () => {
    // EXPECTED-TRACE: prd.md §8-E7（E-BROWSER-BAD-DOMAIN）
    const out = await surface.invoke("browser auth-check --domain bilibili.com");
    const parsed = JSON.parse(out);
    assert.equal(parsed.ok, false);
    assert.equal(parsed.error.code, "E-BROWSER-BAD-DOMAIN");
  });
});
