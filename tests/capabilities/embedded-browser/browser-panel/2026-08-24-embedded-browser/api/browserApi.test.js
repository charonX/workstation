// REQ-TRACE: 2026-08-24-embedded-browser/REQ-BROWSER-001, 2026-08-24-embedded-browser/REQ-BROWSER-003, 2026-08-24-embedded-browser/REQ-BROWSER-005
// REQ-VERSION: v1-hash:28b4d67858fda6ad607eac25ec8b9fe9abdd805baa59ba5c36f3d47e9e8b7b59
// CAPABILITY-TRACE: embedded-browser
// ENTITY-TRACE: browser-panel
// EXPECTED-TRACE: prd.md §6.3 块1 rows 1-5, §6.3 块3 rows 3-4, §6.3 块5 rows 1-5, §7 地址栏规则, §7.1 domain 规则, §8 E2/E7, §10.4 接口1/3/4 golden values
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: false
//
// 状态：骨架哨兵已移除（2026-08-29，Slice 1 fix 落地后替换为真实断言）。
// Cookie 种入经 dev-only seam `POST /api/browser/_test/seed-cookies`（仅 NODE_ENV=test 可达）。
// expected 值未改动（实现者对业务测试只读契约）。
//
// 覆盖 seam：HTTP API（/api/browser/*）——worker 工具面与渲染进程共用的真实边界。
// E2E（面板展开/地址栏/控制指示/链接点击）另见 e2e/browserPanel.test.cjs。

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import { startServer, stopServer } from "../../../../../../src/http/server.js";

// —— 本地 http stub 页面（真实依赖：提供 title/元素/重定向目标）——
let stubServer;
let stubPort;

function startStubServer() {
  return new Promise((resolve) => {
    stubServer = http.createServer((req, res) => {
      if (req.url === "/") {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(
          `<!doctype html><html><head><title>My App</title></head><body>` +
            `<h1>My App</h1><a class="md-cta" href="/next">立即开始</a>` +
            `<a target="_blank" href="/blank">新窗口</a></body></html>`
        );
      } else {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(`<!doctype html><html><head><title>Next</title></head><body>next</body></html>`);
      }
    });
    stubServer.listen(0, "127.0.0.1", () => resolve(stubServer.address().port));
  });
}

async function getJson(baseUrl, urlPath) {
  const res = await fetch(`${baseUrl}${urlPath}`);
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function postJson(baseUrl, urlPath, payload) {
  const res = await fetch(`${baseUrl}${urlPath}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

describe("REQ-BROWSER-001 浏览器面板骨架与手动导航（POST /api/browser/navigate, GET /api/browser/state）", () => {
  let workdir;
  let serverCtx;
  let baseUrl;

  beforeEach(async () => {
    workdir = fs.mkdtempSync(path.join(os.tmpdir(), "browser-panel-test-"));
    process.env.OPC_WORKSTATION_CONFIG_DIR = workdir;
    stubPort = await startStubServer();
    serverCtx = await startServer({ port: 0 });
    baseUrl = serverCtx.baseUrl;
  });

  afterEach(async () => {
    if (serverCtx) await stopServer(serverCtx);
    if (stubServer) stubServer.close();
    stubServer = null;
    fs.rmSync(workdir, { recursive: true, force: true });
  });

  it("协议补全：example.com → https，localhost → http（锚点 §6.3 块1 row1-2）", async () => {
    // EXPECTED-TRACE: prd.md §6.3 块1 row 1（example.com → https://example.com/）
    const r1 = await postJson(baseUrl, "/api/browser/navigate", { url: "example.com", source: "user" });
    assert.equal(r1.body.ok, true);
    assert.equal(r1.body.url, "https://example.com/");

    // EXPECTED-TRACE: prd.md §6.3 块1 row 2（localhost:3000 → http://localhost:3000/）
    const r2 = await postJson(baseUrl, "/api/browser/navigate", {
      url: `localhost:${stubPort}`,
      source: "user",
    });
    assert.equal(r2.body.ok, true);
    assert.equal(r2.body.url, `http://localhost:${stubPort}/`);
    assert.equal(r2.body.title, "My App");
  });

  it("白名单拒绝：file:// 与 javascript: 返回 E-BROWSER-BAD-URL 且当前页不变（锚点 §6.3 块1 row4 / §7.1）", async () => {
    // EXPECTED-TRACE: prd.md §6.3 块1 row 4 + §7.1（file:///etc/passwd → E-BROWSER-BAD-URL）
    await postJson(baseUrl, "/api/browser/navigate", { url: `localhost:${stubPort}`, source: "user" });
    for (const bad of ["file:///etc/passwd", "javascript:alert(1)"]) {
      const r = await postJson(baseUrl, "/api/browser/navigate", { url: bad, source: "user" });
      assert.deepEqual(r.body, { ok: false, error: { code: "E-BROWSER-BAD-URL" } });
    }
    const state = await getJson(baseUrl, "/api/browser/state");
    assert.equal(state.body.url, `http://localhost:${stubPort}/`); // 当前页不变
  });

  it("空输入与无主机输入拒绝导航（§7 有效/无效例子）", async () => {
    // EXPECTED-TRACE: prd.md §7 row 1（空 → 不导航；http:// 无主机 → 地址不完整）
    const r1 = await postJson(baseUrl, "/api/browser/navigate", { url: "", source: "user" });
    assert.equal(r1.body.ok, false);
    assert.equal(r1.body.error.code, "E-BROWSER-BAD-URL");
    const r2 = await postJson(baseUrl, "/api/browser/navigate", { url: "http://", source: "user" });
    assert.equal(r2.body.error.code, "E-BROWSER-BAD-URL");
  });

  it("导航失败透传 Chromium 错误码（锚点 §8-E2 / §10.4 接口1 连接失败样例）", async () => {
    // EXPECTED-TRACE: prd.md §10.4 接口1 样例（localhost:59999 → ERR_CONNECTION_REFUSED）
    const r = await postJson(baseUrl, "/api/browser/navigate", {
      url: "http://localhost:59999",
      source: "user",
    });
    assert.equal(r.body.ok, false);
    assert.equal(r.body.error.code, "E-BROWSER-NAV-FAILED");
    assert.equal(r.body.error.reason, "ERR_CONNECTION_REFUSED");
  });

  it("应用启动后面板初始收起，state.open=false（锚点 §6.3 块1 row3）", async () => {
    // EXPECTED-TRACE: prd.md §6.3 块1 row 3（启动后面板收起不展示）
    const state = await getJson(baseUrl, "/api/browser/state");
    assert.equal(state.body.ok, true);
    assert.equal(state.body.open, false);
  });

  it("state 返回完整契约字段（锚点 §10.4 接口3 state golden）", async () => {
    // EXPECTED-TRACE: prd.md §10.4 接口3（{ok,open,url,title,agentControl,agentControlRevoked,crashed}）
    const state = await getJson(baseUrl, "/api/browser/state");
    for (const key of ["ok", "open", "url", "title", "agentControl", "agentControlRevoked", "crashed"]) {
      assert.ok(key in state.body, `state 缺字段 ${key}`);
    }
  });
});

describe("REQ-BROWSER-003 人机共驾与停止控制状态机", () => {
  let workdir;
  let serverCtx;
  let baseUrl;

  beforeEach(async () => {
    workdir = fs.mkdtempSync(path.join(os.tmpdir(), "browser-control-test-"));
    process.env.OPC_WORKSTATION_CONFIG_DIR = workdir;
    stubPort = await startStubServer();
    serverCtx = await startServer({ port: 0 });
    baseUrl = serverCtx.baseUrl;
  });

  afterEach(async () => {
    if (serverCtx) await stopServer(serverCtx);
    if (stubServer) stubServer.close();
    stubServer = null;
    fs.rmSync(workdir, { recursive: true, force: true });
  });

  it("停止控制后 agent 工具全部 DENIED，页面状态不变（锚点 §6.3 块3 row3 / §8-E5）", async () => {
    // EXPECTED-TRACE: prd.md §6.3 块3 row 3（停止控制后 read 返 E-BROWSER-DENIED）
    await postJson(baseUrl, "/api/browser/navigate", { url: `localhost:${stubPort}`, source: "agent" });
    const stop = await postJson(baseUrl, "/api/browser/control", { action: "stop-agent-control" });
    assert.equal(stop.status, 200);

    const read = await postJson(baseUrl, "/api/browser/read", {});
    assert.equal(read.body.error.code, "E-BROWSER-DENIED");
    const nav = await postJson(baseUrl, "/api/browser/navigate", {
      url: `localhost:${stubPort}/next`,
      source: "agent",
    });
    assert.equal(nav.body.error.code, "E-BROWSER-DENIED");

    // EXPECTED-TRACE: prd.md §6.1 流程C 步骤1（停止控制不关页面：URL 不变）
    const state = await getJson(baseUrl, "/api/browser/state");
    assert.equal(state.body.url, `http://localhost:${stubPort}/`);
    assert.equal(state.body.agentControlRevoked, true);
  });

  it("手动导航一次即解除 revoked，agent 工具恢复（锚点 §6.3 块3 row3 后半 / 流程C 步骤3）", async () => {
    // EXPECTED-TRACE: prd.md §6.1 流程C 步骤3（用户手动导航 → 解除 → read ok:true）
    await postJson(baseUrl, "/api/browser/control", { action: "stop-agent-control" });
    await postJson(baseUrl, "/api/browser/navigate", { url: `localhost:${stubPort}`, source: "user" });
    const read = await postJson(baseUrl, "/api/browser/read", {});
    assert.equal(read.body.ok, true);
  });

  it("面板收起（visible=false）状态下 read 照常返回 ok:true（锚点 §6.3 块3 row2：可见性解耦）", async () => {
    // EXPECTED-TRACE: prd.md §6.3 块3 row 2（收起不断连）
    await postJson(baseUrl, "/api/browser/navigate", { url: `localhost:${stubPort}`, source: "agent" });
    // 模拟渲染进程推 bounds：visible=false
    await postJson(baseUrl, "/api/browser/bounds", { x: 0, y: 0, width: 0, height: 0, visible: false });
    const read = await postJson(baseUrl, "/api/browser/read", {});
    assert.equal(read.body.ok, true);
    assert.equal(read.body.url, `http://localhost:${stubPort}/`);
    const state = await getJson(baseUrl, "/api/browser/state");
    assert.equal(state.body.open, false);
  });

  it("read 未就绪：实例从未创建返回 E-BROWSER-NOT-READY（锚点 §8-E3 / §10.4 接口2 未就绪样例）", async () => {
    // EXPECTED-TRACE: prd.md §10.4 接口2 样例（实例从未导航 → E-BROWSER-NOT-READY）
    const read = await postJson(baseUrl, "/api/browser/read", {});
    assert.deepEqual(read.body, { ok: false, error: { code: "E-BROWSER-NOT-READY" } });
  });
});

describe("REQ-BROWSER-005 登录态 Cookie 受控导出（GET/DELETE /api/browser/cookies）", () => {
  let workdir;
  let serverCtx;
  let baseUrl;
  let seedCookie;

  beforeEach(async () => {
    workdir = fs.mkdtempSync(path.join(os.tmpdir(), "browser-cookies-test-"));
    process.env.OPC_WORKSTATION_CONFIG_DIR = workdir;
    serverCtx = await startServer({ port: 0 });
    baseUrl = serverCtx.baseUrl;
    // 种 Cookie：dev-only seam POST /api/browser/_test/seed-cookies（仅 NODE_ENV=test 可达）。
    seedCookie = async () => {
      const cookies = [
        { name: "SESSDATA", value: "abc123", domain: ".bilibili.com", path: "/", httpOnly: true, secure: true },
        { name: "bili_jct", value: "xyz", domain: ".bilibili.com", path: "/" },
        ...Array.from({ length: 10 }, (_, i) => ({ name: `aux_${i}`, value: `v${i}`, domain: ".bilibili.com", path: "/" })),
      ];
      const r = await postJson(baseUrl, "/api/browser/_test/seed-cookies", { cookies });
      assert.equal(r.body.ok, true);
    };
  });

  afterEach(async () => {
    if (serverCtx) await stopServer(serverCtx);
    fs.rmSync(workdir, { recursive: true, force: true });
  });

  it("空态：从未访问的域返回 cookieString 空串与空数组（锚点 §6.3 块5 row3 / §10.4 接口4 空态样例）", async () => {
    // EXPECTED-TRACE: prd.md §6.3 块5 row 3（{ok:true, domain, cookieString:"", cookies:[]}）
    const r = await getJson(baseUrl, "/api/browser/cookies?domain=.bilibili.com");
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, {
      ok: true,
      domain: ".bilibili.com",
      cookieString: "",
      cookies: [],
    });
  });

  it("读取已种 Cookie：cookieString 明文拼接 + 七字段结构（锚点 §6.3 块5 row2 / 接口4 已登录样例）", async () => {
    // EXPECTED-TRACE: prd.md §6.3 块5 row 2（SESSDATA=...; bili_jct=...）
    await seedCookie();
    const r = await getJson(baseUrl, "/api/browser/cookies?domain=.bilibili.com");
    assert.equal(r.body.ok, true);
    assert.match(r.body.cookieString, /SESSDATA=abc123/);
    assert.match(r.body.cookieString, /bili_jct=xyz/);
    const c = r.body.cookies.find((x) => x.name === "SESSDATA");
    for (const key of ["name", "value", "domain", "path", "expires", "httpOnly", "secure"]) {
      assert.ok(key in c, `cookie 缺字段 ${key}`);
    }
  });

  it("单名过滤：name=SESSDATA 仅返回该条（§10.4 接口4 单名过滤样例）", async () => {
    // EXPECTED-TRACE: prd.md §10.4 接口4 样例（cookies 仅含 SESSDATA，cookieString=SESSDATA=...）
    await seedCookie();
    const r = await getJson(baseUrl, "/api/browser/cookies?domain=.bilibili.com&name=SESSDATA");
    assert.equal(r.body.cookies.length, 1);
    assert.equal(r.body.cookies[0].name, "SESSDATA");
    assert.equal(r.body.cookieString, "SESSDATA=abc123");
  });

  it("BAD-DOMAIN：空 domain 与无前导点均拒绝（锚点 §7.1 / §8-E7）", async () => {
    // EXPECTED-TRACE: prd.md §7.1 row 2（domain= 空/无前导点 → E-BROWSER-BAD-DOMAIN）
    const r1 = await getJson(baseUrl, "/api/browser/cookies?domain=");
    assert.equal(r1.body.error.code, "E-BROWSER-BAD-DOMAIN");
    const r2 = await getJson(baseUrl, "/api/browser/cookies?domain=bilibili.com");
    assert.equal(r2.body.error.code, "E-BROWSER-BAD-DOMAIN");
  });

  it("删除与幂等：12 条删净返回 deletedCount=12，重复删返回 0（锚点 §6.3 块5 row4 / 接口4 清理幂等样例）", async () => {
    // EXPECTED-TRACE: prd.md §6.3 块5 row 4（12 → {deletedCount:12}；再删 {deletedCount:0}）
    await seedCookie();
    const d1 = await fetch(`${baseUrl}/api/browser/cookies?domain=.bilibili.com`, { method: "DELETE" });
    assert.deepEqual(await d1.json(), { ok: true, deletedCount: 12 });
    const g = await getJson(baseUrl, "/api/browser/cookies?domain=.bilibili.com");
    assert.deepEqual(g.body.cookies, []);
    const d2 = await fetch(`${baseUrl}/api/browser/cookies?domain=.bilibili.com`, { method: "DELETE" });
    assert.deepEqual(await d2.json(), { ok: true, deletedCount: 0 });
  });

  it("无实例可读：未创建浏览器实例时 GET cookies 正常返回（接口4 系统错误行：分区独立于实例）", async () => {
    // EXPECTED-TRACE: prd.md §10.4 接口4 系统错误行（实例未创建仍可读，非 NOT-READY）
    const r = await getJson(baseUrl, "/api/browser/cookies?domain=.example.org");
    assert.equal(r.status, 200);
    assert.equal(r.body.ok, true);
  });

  it("日志脱敏：GET/DELETE 过程日志不含明文 cookie 值（锚点 §6.3 块5 row5）", async () => {
    // EXPECTED-TRACE: prd.md §6.3 块5 row 5（日志展示 NAME=<redacted>，禁全值）
    await seedCookie();
    const lines = [];
    const origLog = console.log;
    console.log = (...args) => lines.push(args.join(" "));
    try {
      await getJson(baseUrl, "/api/browser/cookies?domain=.bilibili.com");
      await fetch(`${baseUrl}/api/browser/cookies?domain=.bilibili.com`, { method: "DELETE" });
    } finally {
      console.log = origLog;
    }
    for (const line of lines) {
      assert.ok(!line.includes("abc123"), `日志泄漏明文: ${line.slice(0, 200)}`);
      assert.ok(!line.includes("xyz"), `日志泄漏明文: ${line.slice(0, 200)}`);
    }
  });
});
