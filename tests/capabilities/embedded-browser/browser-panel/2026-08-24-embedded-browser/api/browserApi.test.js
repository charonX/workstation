// REQ-TRACE: 2026-08-24-embedded-browser/REQ-BROWSER-001, 2026-08-24-embedded-browser/REQ-BROWSER-003, 2026-08-24-embedded-browser/REQ-BROWSER-005
// REQ-VERSION: v2-hash:1b26fe9dc10d23ac1d650a76dd952f2458c3492d4981e96c435e9fc819d7b622
// CAPABILITY-TRACE: embedded-browser
// ENTITY-TRACE: browser-panel
// EXPECTED-TRACE: prd.md §6.3 块1 rows 1-4（块内编号）, §6.3 块3 rows 1/3, §6.3 块5 rows 1-2/4-6, §7 row1, §7.1 rows 1-2, §8 E2/E7, §10.4 接口1/3/4 golden values, §10.7 凭据边界访问控制段
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true（2026-08-28 assertion signoff，见 signoff.md）
//
// 状态：骨架哨兵已移除（2026-08-29，Slice 1 fix 落地后替换为真实断言）。
// 2026-08-30 v2 同步：REQ-VERSION 升 v2 hash；§6.3 行号统一为块内编号约定；
// source 通道化（HTTP 面忽略请求体 source，一律 agent）——「手动导航解除 revoked」改经
// 渲染进程 IPC 等价 seam（manager.navigate({source:"user"})），新增 REQ-003 AC7
// （HTTP 伪造 source:user 仍 DENIED）与 REQ-005 AC8（Host/Origin/Sec-Fetch-Site 闸）。
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
    // 外网可达性容忍（review 2026-08-30 flake 风险项）：离线/出口被拦时 headless fallback
    // 导航失败（E-BROWSER-NAV-FAILED）不使本用例红；锚点值断言不删除——ok:true 时规范化
    // URL 必须严格等于 https://example.com/。
    const r1 = await postJson(baseUrl, "/api/browser/navigate", { url: "example.com" });
    if (r1.body.ok === true) {
      assert.equal(r1.body.url, "https://example.com/");
    } else {
      assert.equal(r1.body.error.code, "E-BROWSER-NAV-FAILED");
    }

    // EXPECTED-TRACE: prd.md §6.3 块1 row 2（localhost:3000 → http://localhost:3000/）
    const r2 = await postJson(baseUrl, "/api/browser/navigate", {
      url: `localhost:${stubPort}`,
    });
    assert.equal(r2.body.ok, true);
    assert.equal(r2.body.url, `http://localhost:${stubPort}/`);
    assert.equal(r2.body.title, "My App");
  });

  it("白名单拒绝：file:// 与 javascript: 返回 E-BROWSER-BAD-URL 且当前页不变（锚点 §7 row1 / §7.1 row1）", async () => {
    // EXPECTED-TRACE: prd.md §7 row 1 无效例子（javascript:alert(1) → 拒绝）+ §7.1 row 1（file:///etc/passwd → E-BROWSER-BAD-URL）
    await postJson(baseUrl, "/api/browser/navigate", { url: `localhost:${stubPort}` });
    for (const bad of ["file:///etc/passwd", "javascript:alert(1)"]) {
      const r = await postJson(baseUrl, "/api/browser/navigate", { url: bad });
      assert.deepEqual(r.body, { ok: false, error: { code: "E-BROWSER-BAD-URL" } });
    }
    const state = await getJson(baseUrl, "/api/browser/state");
    assert.equal(state.body.url, `http://localhost:${stubPort}/`); // 当前页不变
  });

  it("空输入与无主机输入拒绝导航（§7 有效/无效例子）", async () => {
    // EXPECTED-TRACE: prd.md §7 row 1（空 → 不导航；http:// 无主机 → 地址不完整）
    const r1 = await postJson(baseUrl, "/api/browser/navigate", { url: "" });
    assert.equal(r1.body.ok, false);
    assert.equal(r1.body.error.code, "E-BROWSER-BAD-URL");
    const r2 = await postJson(baseUrl, "/api/browser/navigate", { url: "http://" });
    assert.equal(r2.body.error.code, "E-BROWSER-BAD-URL");
  });

  it("导航失败透传 Chromium 错误码（锚点 §8-E2 / §10.4 接口1 连接失败样例）", async () => {
    // EXPECTED-TRACE: prd.md §10.4 接口1 样例（localhost:59999 → ERR_CONNECTION_REFUSED）
    const r = await postJson(baseUrl, "/api/browser/navigate", {
      url: "http://localhost:59999",
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
    // HTTP 面 navigate 一律 agent 来源（§10.4 接口1 通道化），请求体 source 字段无效
    await postJson(baseUrl, "/api/browser/navigate", { url: `localhost:${stubPort}` });
    const stop = await postJson(baseUrl, "/api/browser/control", { action: "stop-agent-control" });
    assert.equal(stop.status, 200);

    const read = await postJson(baseUrl, "/api/browser/read", {});
    assert.equal(read.body.error.code, "E-BROWSER-DENIED");
    const nav = await postJson(baseUrl, "/api/browser/navigate", {
      url: `localhost:${stubPort}/next`,
    });
    assert.equal(nav.body.error.code, "E-BROWSER-DENIED");

    // EXPECTED-TRACE: prd.md §6.1 流程C 步骤1（停止控制不关页面：URL 不变）
    const state = await getJson(baseUrl, "/api/browser/state");
    assert.equal(state.body.url, `http://localhost:${stubPort}/`);
    assert.equal(state.body.agentControlRevoked, true);
  });

  it("手动导航一次即解除 revoked，agent 工具恢复（锚点 §6.3 块3 row3 后半 / 流程C 步骤3）", async () => {
    // EXPECTED-TRACE: prd.md §6.1 流程C 步骤3（用户手动导航 → 解除 → read ok:true）
    // 通道语义（REQ-003 AC7 / §10.4 接口1/5）：source=user 仅来自渲染进程 IPC
    // （main.js opc-browser-navigate handler 固定 source:"user"）——集成层以同一
    // manager.navigate({source:"user"}) 调用面模拟该 IPC 通道，不经 HTTP。
    await postJson(baseUrl, "/api/browser/control", { action: "stop-agent-control" });
    const manager = serverCtx.server.services.getBrowserViewManager();
    await manager.navigate({ url: `localhost:${stubPort}`, source: "user" });
    const state = await getJson(baseUrl, "/api/browser/state");
    assert.equal(state.body.agentControlRevoked, false);
    const read = await postJson(baseUrl, "/api/browser/read", {});
    assert.equal(read.body.ok, true);
  });

  it("source 由通道决定：HTTP 请求体伪造 source:user 仍 DENIED 且 revoked 不解除（REQ-003 AC7 / §10.4 接口1）", async () => {
    // EXPECTED-TRACE: prd.md §10.4 接口1 输入行（HTTP 面一律 agent，请求体 source 字段无效）
    // + 接口1 停止控制中 golden（revoked=true → E-BROWSER-DENIED）+ requirements REQ-BROWSER-003 AC7
    await postJson(baseUrl, "/api/browser/navigate", { url: `localhost:${stubPort}` });
    await postJson(baseUrl, "/api/browser/control", { action: "stop-agent-control" });
    const forged = await postJson(baseUrl, "/api/browser/navigate", {
      url: `localhost:${stubPort}/next`,
      source: "user", // 伪造：HTTP 面该字段必须无效
    });
    assert.equal(forged.body.ok, false);
    assert.equal(forged.body.error.code, "E-BROWSER-DENIED");
    const state = await getJson(baseUrl, "/api/browser/state");
    assert.equal(state.body.agentControlRevoked, true); // revoked 不解除
    assert.equal(state.body.url, `http://localhost:${stubPort}/`); // 页面状态不变
  });

  it("面板收起（visible=false）状态下 read 照常返回 ok:true（锚点 §6.3 块3 row1：可见性解耦）", async () => {
    // EXPECTED-TRACE: prd.md §6.3 块3 row 1（收起不断连）
    await postJson(baseUrl, "/api/browser/navigate", { url: `localhost:${stubPort}` });
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

  it("空态：从未访问的域返回 cookieString 空串与空数组（锚点 §6.3 块5 row4 / §10.4 接口4 空态样例）", async () => {
    // EXPECTED-TRACE: prd.md §6.3 块5 row 4（{ok:true, domain, cookieString:"", cookies:[]}）
    const r = await getJson(baseUrl, "/api/browser/cookies?domain=.bilibili.com");
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, {
      ok: true,
      domain: ".bilibili.com",
      cookieString: "",
      cookies: [],
    });
  });

  it("读取已种 Cookie：cookieString 明文拼接 + 七字段结构（锚点 §6.3 块5 row1 / 接口4 已登录样例）", async () => {
    // EXPECTED-TRACE: prd.md §6.3 块5 row 1（SESSDATA=...; bili_jct=...）
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

  it("删除与幂等：12 条删净返回 deletedCount=12，重复删返回 0（锚点 §6.3 块5 row5 / 接口4 清理幂等样例）", async () => {
    // EXPECTED-TRACE: prd.md §6.3 块5 row 5（12 → {deletedCount:12}；再删 {deletedCount:0}）
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

  it("日志脱敏：GET/DELETE 过程日志不含明文 cookie 值（锚点 §6.3 块5 row6）", async () => {
    // EXPECTED-TRACE: prd.md §6.3 块5 row 6（禁止全值入日志；Cookie 名与 <redacted> 占位
    // 「允许出现」——REQ-BROWSER-005 标准 7 措辞为允许而非必须，故本用例只锚定禁令半支：
    // 无明文值 + 日志非空转。实现当前采用更严策略：日志只落域与计数，不含名/值/占位）
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
    // 防空转通过：GET/DELETE 必须确实产生日志行（域级/计数审计，§10.7 可观测性）
    assert.ok(lines.length > 0, "GET/DELETE 过程应产生日志行");
    for (const line of lines) {
      assert.ok(!line.includes("abc123"), `日志泄漏明文: ${line.slice(0, 200)}`);
      assert.ok(!line.includes("xyz"), `日志泄漏明文: ${line.slice(0, 200)}`);
    }
  });
});

describe("REQ-BROWSER-005 AC8 导出端点访问控制（Host/Origin/Sec-Fetch-Site 闸）", () => {
  let workdir;
  let serverCtx;
  let baseUrl;
  let port;

  beforeEach(async () => {
    workdir = fs.mkdtempSync(path.join(os.tmpdir(), "browser-guard-test-"));
    process.env.OPC_WORKSTATION_CONFIG_DIR = workdir;
    serverCtx = await startServer({ port: 0 });
    baseUrl = serverCtx.baseUrl;
    port = serverCtx.server.address().port;
  });

  afterEach(async () => {
    if (serverCtx) await stopServer(serverCtx);
    fs.rmSync(workdir, { recursive: true, force: true });
  });

  // 伪造 Host/Origin/Sec-Fetch-Site 需原始 http.request（fetch 规范禁止覆写这些头）
  function rawGet(urlPath, headers = {}) {
    return new Promise((resolve, reject) => {
      const req = http.request(
        { host: "127.0.0.1", port, path: urlPath, method: "GET", headers },
        (res) => {
          let data = "";
          res.on("data", (c) => (data += c));
          res.on("end", () =>
            resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(data || "null") })
          );
        }
      );
      req.on("error", reject);
      req.end();
    });
  }

  it("伪造 Host（evil.com，DNS rebinding 形态）→ 403（锚点 §10.7 凭据边界访问控制段 / REQ-005 AC8）", async () => {
    // EXPECTED-TRACE: prd.md §10.7（cookies 端点仅接受 Host=127.0.0.1/localhost，其余一律 403）
    const r = await rawGet("/api/browser/cookies?domain=.bilibili.com", { host: "evil.com" });
    assert.equal(r.status, 403);
    assert.equal(r.body.error, "FORBIDDEN");
    assert.equal(r.headers["access-control-allow-origin"], undefined); // 不输出 ACAO
  });

  it("伪造跨源 Origin（https://evil.example）→ 403（锚点 §10.7 / REQ-005 AC8）", async () => {
    // EXPECTED-TRACE: prd.md §10.7（带跨源 Origin 的请求一律 403）
    const r = await rawGet("/api/browser/cookies?domain=.bilibili.com", { origin: "https://evil.example" });
    assert.equal(r.status, 403);
    assert.equal(r.body.error, "FORBIDDEN");
  });

  it("Sec-Fetch-Site: cross-site → 403（锚点 §10.7 / REQ-005 AC8）", async () => {
    // EXPECTED-TRACE: prd.md §10.7（Sec-Fetch-Site: cross-site|cross-origin 一律 403）
    const r = await rawGet("/api/browser/cookies?domain=.bilibili.com", { "sec-fetch-site": "cross-site" });
    assert.equal(r.status, 403);
    assert.equal(r.body.error, "FORBIDDEN");
  });

  it("本机 CLI 形态（Host=127.0.0.1、无 Origin）→ 200 且响应无 ACAO 头（锚点 §10.7 / REQ-005 AC8）", async () => {
    // EXPECTED-TRACE: prd.md §10.7（本机请求放行；/api/browser/* 响应不输出 Access-Control-Allow-Origin）
    const res = await fetch(`${baseUrl}/api/browser/cookies?domain=.bilibili.com`);
    assert.equal(res.status, 200);
    assert.equal((await res.json()).ok, true);
    assert.equal(res.headers.get("access-control-allow-origin"), null);
  });
});
