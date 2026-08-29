// REQ-TRACE: 2026-08-24-embedded-browser/REQ-BROWSER-002, 2026-08-24-embedded-browser/REQ-BROWSER-006
// REQ-VERSION: v1-hash:28b4d67858fda6ad607eac25ec8b9fe9abdd805baa59ba5c36f3d47e9e8b7b59
// CAPABILITY-TRACE: embedded-browser
// ENTITY-TRACE: browser-tools
// EXPECTED-TRACE: prd.md §6.3 块2 rows 5-6, §6.3 块5 rows 2/5, §10.4 接口2 golden values, §10.4 接口6 CLI 声明表, §8-E8
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: false
//
// 骨架说明：业务测试骨架（ACCEPTANCE tests）。
// 覆盖 seam：CLI 工具面（toolAdapter browser 命令声明）+ HTTP（/api/browser/*，工具后端）。
// 标注 `skeletonPending()` 的用例依赖 toolAdapter browser 命令组与 browserViewManager 实现，
// 实现落地后替换为真实断言（expected 值不得改动）。

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import { createToolSurface, TOOL_DEFS } from "../../../../../../src/agent/toolAdapter.js";
import { startServer, stopServer } from "../../../../../../src/http/server.js";

function skeletonPending() {
  assert.fail("SKELETON: browser 工具尚未实现（REQ-BROWSER-002/006）");
}

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
    if (!def) skeletonPending();
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
      skeletonPending();
      const out = await surface.invoke(`browser navigate --url http://localhost:${stubPort}`);
      const parsed = JSON.parse(out);
      assert.equal(parsed.ok, true);
      assert.equal(parsed.url, `http://localhost:${stubPort}/`);
      assert.equal(parsed.title, "My App");
    });

    it("read 快照结构：elements 含 tag/text/selector/rect（锚点 §10.4 接口2 正常样例）", async () => {
      // EXPECTED-TRACE: prd.md §10.4 接口2 样例（elements:[{tag:"a",text:"立即开始",selector:".md-cta",rect:{…}}]）
      skeletonPending();
      await surface.invoke(`browser navigate --url http://localhost:${stubPort}`);
      const out = await surface.invoke("browser read");
      const parsed = JSON.parse(out);
      assert.equal(parsed.ok, true);
      assert.equal(parsed.title, "My App");
      const el = parsed.elements.find((e) => e.selector === ".md-cta");
      assert.ok(el, "elements 缺 .md-cta 条目");
      assert.equal(el.tag, "a");
      assert.equal(el.text, "立即开始");
      assert.equal(typeof el.rect.x, "number");
    });

    it("read 截断：正文 >4000 字符截断且 truncated=true（锚点 §6.3 块2 截断阈值）", async () => {
      // EXPECTED-TRACE: prd.md §10.4 接口2 样例（text 截断至 4000 字符，truncated:true）
      skeletonPending();
      await surface.invoke(`browser navigate --url http://localhost:${stubPort}/long`);
      const out = await surface.invoke("browser read");
      const parsed = JSON.parse(out);
      assert.equal(parsed.text.length, 4000);
      assert.equal(parsed.truncated, true);
    });

    it("read 未就绪：实例从未创建返回 E-BROWSER-NOT-READY（锚点 §8-E3）", async () => {
      // EXPECTED-TRACE: prd.md §10.4 接口2 样例（未就绪 → E-BROWSER-NOT-READY）
      skeletonPending();
      const out = await surface.invoke("browser read");
      const parsed = JSON.parse(out);
      assert.equal(parsed.ok, false);
      assert.equal(parsed.error.code, "E-BROWSER-NOT-READY");
    });

    it("scroll 回执：{ok:true, scrollX, scrollY}（§10.4 接口3 scroll golden）", async () => {
      // EXPECTED-TRACE: prd.md §10.4 接口3（{ok:true, scrollX:0, scrollY:480}）
      skeletonPending();
      await surface.invoke(`browser navigate --url http://localhost:${stubPort}/tall`);
      const out = await surface.invoke("browser scroll --dy 480");
      const parsed = JSON.parse(out);
      assert.equal(parsed.ok, true);
      assert.equal(parsed.scrollX, 0);
      assert.ok(parsed.scrollY > 0);
    });

    it("screenshot 回执与落盘：PNG 文件存在且 n 递增（§10.4 接口3 screenshot golden）", async () => {
      // EXPECTED-TRACE: prd.md §10.4 接口3（{ok:true, path:"<sessionDir>/shots/browser-<n>.png", width>0, height>0}）
      skeletonPending();
      await surface.invoke(`browser navigate --url http://localhost:${stubPort}`);
      const out1 = await surface.invoke("browser screenshot");
      const p1 = JSON.parse(out1);
      assert.equal(p1.ok, true);
      assert.match(p1.path, /browser-1\.png$/);
      assert.ok(fs.existsSync(p1.path));
      const png = fs.readFileSync(p1.path);
      assert.ok(png[0] === 0x89 && png[1] === 0x50, "非 PNG 魔数");
      const out2 = await surface.invoke("browser screenshot");
      assert.match(JSON.parse(out2).path, /browser-2\.png$/);
    });

    it("expand 事件：面板收起时 navigate --expand 请求展开（REQ-002 标准8；E2E 深验证见 e2e/）", async () => {
      // EXPECTED-TRACE: prd.md §10.3 数据流副作用（expand → panel-request-open 事件）
      skeletonPending();
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
    seedCookie = async () => skeletonPending(); // 测试 seam：分区种 Cookie（实现后接真实 session）
  });

  afterEach(async () => {
    if (serverCtx) await stopServer(serverCtx);
    fs.rmSync(workdir, { recursive: true, force: true });
  });

  it("已登录：required-cookies 全部存在 → authenticated:true（锚点 §6.3 块5 row2）", async () => {
    // EXPECTED-TRACE: prd.md §6.3 块5 row 2（{authenticated:true}）
    skeletonPending();
    await seedCookie();
    const out = await surface.invoke("browser auth-check --domain .bilibili.com --required-cookies SESSDATA");
    assert.deepEqual(JSON.parse(out), { authenticated: true });
  });

  it("未登录：缺失名单返回 missing 数组，非错误（锚点 §8-E8 / REQ-006 标准2）", async () => {
    // EXPECTED-TRACE: prd.md §8-E8（{authenticated:false, missing:["SESSDATA"]}）
    skeletonPending();
    await seedCookie(); // 仅种 bili_jct
    const out = await surface.invoke("browser auth-check --domain .bilibili.com --required-cookies SESSDATA");
    assert.deepEqual(JSON.parse(out), { authenticated: false, missing: ["SESSDATA"] });
  });

  it("空 required-cookies：无任何 Cookie → {authenticated:false, missing:[]}（§7.1 row3）", async () => {
    // EXPECTED-TRACE: prd.md §7.1 row 3（空名单=存在任意 Cookie）
    skeletonPending();
    const out = await surface.invoke("browser auth-check --domain .bilibili.com");
    assert.deepEqual(JSON.parse(out), { authenticated: false, missing: [] });
  });

  it("BAD-DOMAIN 透传：无前导点拒绝（REQ-006 标准5）", async () => {
    // EXPECTED-TRACE: prd.md §8-E7（E-BROWSER-BAD-DOMAIN）
    skeletonPending();
    const out = await surface.invoke("browser auth-check --domain bilibili.com");
    const parsed = JSON.parse(out);
    assert.equal(parsed.ok, false);
    assert.equal(parsed.error.code, "E-BROWSER-BAD-DOMAIN");
  });
});
