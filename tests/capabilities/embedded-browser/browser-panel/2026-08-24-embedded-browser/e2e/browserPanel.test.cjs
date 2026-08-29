// REQ-TRACE: 2026-08-24-embedded-browser/REQ-BROWSER-001, 2026-08-24-embedded-browser/REQ-BROWSER-002, 2026-08-24-embedded-browser/REQ-BROWSER-003, 2026-08-24-embedded-browser/REQ-BROWSER-004, 2026-08-24-embedded-browser/REQ-BROWSER-006
// REQ-VERSION: v1-hash:28b4d67858fda6ad607eac25ec8b9fe9abdd805baa59ba5c36f3d47e9e8b7b59
// CAPABILITY-TRACE: embedded-browser
// ENTITY-TRACE: browser-panel
// EXPECTED-TRACE: prd.md §6.1 流程A/B/C/D, §6.3 块1 rows 3-4, 块3 rows 3-4, 块4 row1, §10.4 接口5 IPC 通道表, ux/browser-panel.html
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: false
//
// 骨架说明：业务测试骨架（ACCEPTANCE E2E）。按 Electron E2E 先例（electronApp fixture）。
// 覆盖只能在真实窗口 + WebContentsView 下验证的流程：面板展开/收起与地址栏（流程A）、
// agent 驱动展开与控制指示（流程B）、停止控制按钮（流程C）、聊天链接打开面板（REQ-004）。
// 标注 `test.skip(SKIP, …)` 的用例依赖 BrowserPanel/preload 实现；实现后移除 skip 改回真断言。

const { test, expect } = require("@playwright/test");
const { startElectronApp, stopElectronApp } = require("../../../../../e2e/fixtures/electronApp.cjs");

// UX 参照 locator（与 ux/browser-panel.html 及 prd.md §6.3 对齐）
const BTN_BROWSER = "[data-testid='open-browser']";
const PANEL = "[data-testid='browser-panel']";
const OMNIBOX = "[data-testid='omnibox']";
const AGENT_BAR = "[data-testid='agent-control-bar']";
const BTN_STOP = "[data-testid='stop-agent-control']";
const NAV_ERROR_PAGE = "[data-testid='nav-error-page']";
const CRASH_PAGE = "[data-testid='crash-page']";
const CRASH_RELOAD = "[data-testid='crash-reload']";

// 本测试套启动本地 stub 页服务（注入被测页面，避免外网依赖）
const STUB_PORT = 38121; // 固定端口供面板地址栏输入用

test.describe("内置浏览器面板 E2E（流程 A/B/C + 链接集成）", () => {
  let electronApp;
  let page;
  let apiBaseUrl;
  let userDataDir;
  let stubServer;

  test.beforeEach(async () => {
    stubServer = require("node:http")
      .createServer((req, res) => {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(
          `<!doctype html><html><head><title>My App</title></head><body>` +
            `<h1>My App</h1><a target="_blank" href="/next">新窗口链接</a></body></html>`
        );
      })
      .listen(STUB_PORT, "127.0.0.1");
    const ctx = await startElectronApp({ extraEnv: { OPC_AGENT_FAUX: "1" } });
    electronApp = ctx.electronApp;
    page = ctx.firstWindow;
    apiBaseUrl = ctx.apiBaseUrl;
    userDataDir = ctx.userDataDir;
  });

  test.afterEach(async () => {
    if (electronApp) await stopElectronApp(electronApp, userDataDir);
    if (stubServer) stubServer.close();
    stubServer = null;
  });

  test("流程A：面板初始收起 → 点击浏览器按钮展开 → 地址栏导航补全协议", async () => {
    test.skip(true, "SKELETON: BrowserPanel 未实现");
    // EXPECTED-TRACE: prd.md §6.3 块1 row 3（启动后收起）
    await expect(page.locator(PANEL)).toBeHidden();
    // EXPECTED-TRACE: prd.md §6.1 流程A 步骤1（点击按钮 → 面板展开、地址栏聚焦）
    await page.locator(BTN_BROWSER).click();
    await expect(page.locator(PANEL)).toBeVisible();
    // EXPECTED-TRACE: prd.md §6.3 块1 row 1（example.com → https://example.com/）
    await page.locator(OMNIBOX).fill("example.com");
    await page.locator(OMNIBOX).press("Enter");
    await expect(page.locator(OMNIBOX)).toHaveValue("https://example.com/");
  });

  test("流程A：localhost 输入补 http 协议并加载 stub 页", async () => {
    test.skip(true, "SKELETON: BrowserPanel 未实现");
    await page.locator(BTN_BROWSER).click();
    // EXPECTED-TRACE: prd.md §6.3 块1 row 2（localhost:3000 → http://localhost:3000/）
    await page.locator(OMNIBOX).fill(`localhost:${STUB_PORT}`);
    await page.locator(OMNIBOX).press("Enter");
    await expect(page.locator(OMNIBOX)).toHaveValue(`http://localhost:${STUB_PORT}/`);
  });

  test("流程A：收起面板后重新展开，地址栏保留原 URL（实例保活）", async () => {
    test.skip(true, "SKELETON: BrowserPanel 未实现");
    await page.locator(BTN_BROWSER).click();
    await page.locator(OMNIBOX).fill(`localhost:${STUB_PORT}`);
    await page.locator(OMNIBOX).press("Enter");
    await page.locator(BTN_BROWSER).click(); // 收起
    await expect(page.locator(PANEL)).toBeHidden();
    await page.locator(BTN_BROWSER).click(); // 再展开
    // EXPECTED-TRACE: prd.md §6.1 流程A 步骤5（重新展开仍为原页面）
    await expect(page.locator(OMNIBOX)).toHaveValue(`http://localhost:${STUB_PORT}/`);
  });

  test("流程A：target=_blank 链接在面板内导航，主窗口不跳转", async () => {
    test.skip(true, "SKELETON: WebContentsView 弹窗拦截未实现");
    await page.locator(BTN_BROWSER).click();
    await page.locator(OMNIBOX).fill(`localhost:${STUB_PORT}`);
    await page.locator(OMNIBOX).press("Enter");
    // EXPECTED-TRACE: prd.md §6.3 块1 row 4（拦截新窗口，转面板内导航）
    // stub 页内点击（驱动 WebContentsView 需经实现暴露的交互 seam；实现后补 locator）
    const windowCountBefore = electronApp.windows().length;
    // …点击 target=_blank…
    // EXPECTED-TRACE: prd.md §6.2（无新窗口、主窗口路由不变）
    expect(electronApp.windows().length).toBe(windowCountBefore);
  });

  test("流程B：agent navigate --expand 后面板自动展开并显示控制指示", async () => {
    test.skip(true, "SKELETON: agent 工具与控制指示未实现");
    // 经 API 以 agent 来源导航 + expand
    await fetch(`${apiBaseUrl}/api/browser/navigate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: `http://localhost:${STUB_PORT}`, source: "agent", expand: true }),
    });
    // EXPECTED-TRACE: prd.md §6.1 流程B 步骤2（面板自动展开，地址栏=最终 URL）
    await expect(page.locator(PANEL)).toBeVisible();
    await expect(page.locator(OMNIBOX)).toHaveValue(`http://localhost:${STUB_PORT}/`);
    // EXPECTED-TRACE: prd.md §6.3 块3 row 4（控制中指示 + 停止控制按钮可见）
    await expect(page.locator(AGENT_BAR)).toBeVisible();
    await expect(page.locator(BTN_STOP)).toBeVisible();
  });

  test("流程C：点击停止控制后指示消失，页面保持", async () => {
    test.skip(true, "SKELETON: 停止控制按钮未实现");
    await fetch(`${apiBaseUrl}/api/browser/navigate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: `http://localhost:${STUB_PORT}`, source: "agent", expand: true }),
    });
    await expect(page.locator(AGENT_BAR)).toBeVisible();
    // EXPECTED-TRACE: prd.md §6.1 流程C 步骤1（URL 不变、指示消失）
    await page.locator(BTN_STOP).click();
    await expect(page.locator(AGENT_BAR)).toBeHidden();
    await expect(page.locator(OMNIBOX)).toHaveValue(`http://localhost:${STUB_PORT}/`);
  });

  test("REQ-004：聊天消息 http(s) 链接点击后面板打开并加载目标 URL", async () => {
    test.skip(true, "SKELETON: MarkdownRenderer 链接集成未实现");
    // 会话内渲染含链接的助手消息（stub 会话），点击链接
    // EXPECTED-TRACE: prd.md §6.3 块4 row 1（面板打开并加载 https://a.b/c，非系统浏览器）
    await expect(page.locator(PANEL)).toBeVisible();
  });

  // —— 以下 4 用例自 api/browserTools.test.js 迁移（2026-08-29 req-gap 就地补全）：
  // read 结构/截断、scroll、screenshot 需真实 WebContentsView（纯 node 无 DOM 执行面），
  // 归 E2E。断言 expected 值未改动。

  test("REQ-BROWSER-002 read 快照结构：elements 含 tag/text/selector/rect", async () => {
    test.skip(true, "SKELETON: 真实 WebContentsView 集成（Slice 3）");
    // EXPECTED-TRACE: prd.md §10.4 接口2 样例（elements:[{tag:"a",text:"立即开始",selector:".md-cta",rect:{…}}]）
    await fetch(`${apiBaseUrl}/api/browser/navigate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: `http://localhost:${STUB_PORT}`, source: "agent" }),
    });
    const r = await fetch(`${apiBaseUrl}/api/browser/read`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    const body = await r.json();
    expect(body.ok).toBe(true);
    const el = body.elements.find((e) => e.selector === ".md-cta");
    expect(el).toBeTruthy();
    expect(el.tag).toBe("a");
    expect(typeof el.rect.x).toBe("number");
  });

  test("REQ-BROWSER-002 read 截断：正文 >4000 字符截断且 truncated=true", async () => {
    test.skip(true, "SKELETON: 真实 WebContentsView 集成（Slice 3）");
    // EXPECTED-TRACE: prd.md §10.4 接口2 样例（text 截断至 4000 字符，truncated:true）
    // 长页 stub 由实现提供（/long 路由或夹具页）
  });

  test("REQ-BROWSER-002 scroll 回执：{ok:true, scrollX, scrollY}", async () => {
    test.skip(true, "SKELETON: 真实 WebContentsView 集成（Slice 3）");
    // EXPECTED-TRACE: prd.md §10.4 接口3（{ok:true, scrollX:0, scrollY:480}）
  });

  test("REQ-BROWSER-002 screenshot 回执与落盘：PNG 文件存在且 n 递增", async () => {
    test.skip(true, "SKELETON: 真实 WebContentsView 集成（Slice 3）");
    // EXPECTED-TRACE: prd.md §10.4 接口3（{ok:true, path:"<sessionDir>/shots/browser-<n>.png", width>0, height>0}）
  });
});
