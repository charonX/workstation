// REQ-TRACE: 2026-08-24-embedded-browser/REQ-BROWSER-001, 2026-08-24-embedded-browser/REQ-BROWSER-002, 2026-08-24-embedded-browser/REQ-BROWSER-003, 2026-08-24-embedded-browser/REQ-BROWSER-004, 2026-08-24-embedded-browser/REQ-BROWSER-006
// REQ-VERSION: v1-hash:28b4d67858fda6ad607eac25ec8b9fe9abdd805baa59ba5c36f3d47e9e8b7b59
// CAPABILITY-TRACE: embedded-browser
// ENTITY-TRACE: browser-panel
// EXPECTED-TRACE: prd.md §6.1 流程A/B/C/D, §6.3 块1 rows 3-4, 块3 rows 3-4, 块4 row1, §10.4 接口5 IPC 通道表, ux/browser-panel.html
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: false
//
// 状态：骨架 skip 已全部移除（2026-08-29，Slice 3 落地后替换为真实断言）。
// 覆盖只能在真实窗口 + WebContentsView 下验证的流程：面板展开/收起与地址栏（流程A）、
// agent 驱动展开与控制指示（流程B）、停止控制按钮（流程C）、聊天链接打开面板（REQ-004）、
// read 结构/截断、scroll、screenshot（自 api/browserTools.test.js 迁移的 Electron-only 用例）。
// 弹窗拦截用例经 dev-only seam `opc.__browserTestClick` 驱动视图内点击。

const { test, expect } = require("@playwright/test");
const fs = require("node:fs");
const path = require("node:path");
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

// —— stub 页路由 ——
// "/"：含 target=_blank 链接（弹窗拦截用例）
// "/long"：正文 >4000 字符（read 截断用例）
// "/tall"：长页可滚动（scroll 用例）
function stubHtml(urlPath) {
  if (urlPath === "/long") {
    const longText = "长文本".repeat(1500); // 4500 字符 > 4000 截断阈值
    return `<!doctype html><html><head><title>Long</title></head><body><p>${longText}</p></body></html>`;
  }
  if (urlPath === "/tall") {
    return `<!doctype html><html><head><title>Tall</title></head><body><div style="height:5000px">tall</div></body></html>`;
  }
  if (urlPath === "/next") {
    return `<!doctype html><html><head><title>Next</title></head><body>next</body></html>`;
  }
  return (
    `<!doctype html><html><head><title>My App</title></head><body>` +
    `<h1>My App</h1><a class="md-cta" href="/next">立即开始</a>` +
    `<a target="_blank" href="/next">新窗口链接</a>` +
    `<button class="js-open" onclick="window.open('/next')">window.open</button></body></html>`
  );
}

async function apiPost(apiBaseUrl, urlPath, payload) {
  const res = await fetch(`${apiBaseUrl}${urlPath}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload ?? {}),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

test.describe("内置浏览器面板 E2E（流程 A/B/C + 链接集成 + 工具回执）", () => {
  let electronApp;
  let page;
  let apiBaseUrl;
  let userDataDir;
  let stubServer;

  test.beforeEach(async () => {
    await new Promise((resolve) => {
      stubServer = require("node:http")
        .createServer((req, res) => {
          res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
          res.end(stubHtml(new URL(req.url, "http://localhost").pathname));
        })
        .listen(STUB_PORT, "127.0.0.1", resolve);
    });
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
    // EXPECTED-TRACE: prd.md §6.3 块1 row 3（启动后收起）
    await expect(page.locator(PANEL)).toBeHidden();
    // EXPECTED-TRACE: prd.md §6.1 流程A 步骤1（点击按钮 → 面板展开、地址栏聚焦）
    await page.locator(BTN_BROWSER).click();
    await expect(page.locator(PANEL)).toBeVisible();
    // EXPECTED-TRACE: prd.md §6.3 块1 row 2（localhost 补 http）
    await page.locator(OMNIBOX).fill(`localhost:${STUB_PORT}`);
    await page.locator(OMNIBOX).press("Enter");
    await expect(page.locator(OMNIBOX)).toHaveValue(`http://localhost:${STUB_PORT}/`);
  });

  test("流程A：收起面板后重新展开，地址栏保留原 URL（实例保活）", async () => {
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
    await page.locator(BTN_BROWSER).click();
    await page.locator(OMNIBOX).fill(`localhost:${STUB_PORT}`);
    await page.locator(OMNIBOX).press("Enter");
    await expect(page.locator(OMNIBOX)).toHaveValue(`http://localhost:${STUB_PORT}/`);
    const windowCountBefore = electronApp.windows().length;
    // EXPECTED-TRACE: prd.md §6.3 块1 row 4（拦截新窗口，转面板内导航）
    const clickResult = await page.evaluate(() => window.opc.__browserTestClick("a[target='_blank']"));
    expect(clickResult.ok).toBe(true);
    await expect(page.locator(OMNIBOX)).toHaveValue(`http://localhost:${STUB_PORT}/next`);
    // EXPECTED-TRACE: prd.md §6.2（无新窗口、主窗口路由不变）
    expect(electronApp.windows().length).toBe(windowCountBefore);
  });

  test("流程A：window.open() 同样被拦截转面板内导航（REQ-001 AC5 第二触发面）", async () => {
    // EXPECTED-TRACE: prd.md §6.3 块1 row 4（window.open/新窗口事件被拦截）
    await page.locator(BTN_BROWSER).click();
    await page.locator(OMNIBOX).fill(`localhost:${STUB_PORT}`);
    await page.locator(OMNIBOX).press("Enter");
    await expect(page.locator(OMNIBOX)).toHaveValue(`http://localhost:${STUB_PORT}/`);
    const windowCountBefore = electronApp.windows().length;
    const clickResult = await page.evaluate(() => window.opc.__browserTestClick("button.js-open"));
    expect(clickResult.ok).toBe(true);
    await expect(page.locator(OMNIBOX)).toHaveValue(`http://localhost:${STUB_PORT}/next`);
    expect(electronApp.windows().length).toBe(windowCountBefore);
  });

  test("流程A：面板展开后地址栏聚焦（REQ-001 AC6 步骤1）", async () => {
    // EXPECTED-TRACE: prd.md §6.1 流程A 步骤1（面板展开，地址栏聚焦）
    await page.locator(BTN_BROWSER).click();
    await expect(page.locator(PANEL)).toBeVisible();
    await expect(page.locator(OMNIBOX)).toBeFocused();
  });

  test("E1：地址栏输入 javascript: 协议 → 内联提示且不导航（§7 row1 无效例子）", async () => {
    // EXPECTED-TRACE: prd.md §7 row 1（javascript:alert(1) → 拒绝，提示「仅支持 http/https 地址」）
    await page.locator(BTN_BROWSER).click();
    await page.locator(OMNIBOX).fill("javascript:alert(1)");
    await page.locator(OMNIBOX).press("Enter");
    await expect(page.locator(".bp-omnibox-hint")).toBeVisible();
    await expect(page.locator(".bp-omnibox-hint")).toContainText("http");
    // 未导航：状态 url 保持空
    const state = await (await fetch(`${apiBaseUrl}/api/browser/state`)).json();
    expect(state.url).toBeFalsy();
  });

  test("E2：导航失败显示错误页含 ERR 码与重试按钮", async () => {
    // EXPECTED-TRACE: prd.md §8-E2（面板内错误页，显示失败原因，可重试）
    await page.locator(BTN_BROWSER).click();
    await page.locator(OMNIBOX).fill("localhost:59999");
    await page.locator(OMNIBOX).press("Enter");
    await expect(page.locator(NAV_ERROR_PAGE)).toBeVisible();
    await expect(page.locator(NAV_ERROR_PAGE)).toContainText("ERR_CONNECTION_REFUSED");
    // 重试按钮存在且可点（stub 不通则仍错误页——重试行为本身即契约）
    await page.locator(`${NAV_ERROR_PAGE} button`).click();
    await expect(page.locator(NAV_ERROR_PAGE)).toBeVisible();
  });

  test("E4：渲染进程崩溃后面板显示崩溃页与重新加载按钮", async () => {
    // EXPECTED-TRACE: prd.md §8-E4（render-process-gone → 崩溃态 + 重载按钮）
    await apiPost(apiBaseUrl, "/api/browser/navigate", {
      url: `http://localhost:${STUB_PORT}`,
      source: "agent",
      expand: true,
    });
    await expect(page.locator(PANEL)).toBeVisible();
    const crashResult = await page.evaluate(() => window.opc.__browserTestCrash());
    expect(crashResult.ok).toBe(true);
    await expect(page.locator(CRASH_PAGE)).toBeVisible();
    await expect(page.locator(CRASH_RELOAD)).toBeVisible();
    // 重新加载 → 页面恢复（stub 页 title 回显）
    await page.locator(CRASH_RELOAD).click();
    await expect(page.locator(CRASH_PAGE)).toBeHidden();
    await expect(page.locator(OMNIBOX)).toHaveValue(`http://localhost:${STUB_PORT}/`);
  });

  test("流程B：agent navigate --expand 后面板自动展开并显示控制指示", async () => {
    // 经 API 以 agent 来源导航 + expand
    await apiPost(apiBaseUrl, "/api/browser/navigate", {
      url: `http://localhost:${STUB_PORT}`,
      source: "agent",
      expand: true,
    });
    // EXPECTED-TRACE: prd.md §6.1 流程B 步骤2（面板自动展开，地址栏=最终 URL）
    await expect(page.locator(PANEL)).toBeVisible();
    await expect(page.locator(OMNIBOX)).toHaveValue(`http://localhost:${STUB_PORT}/`);
    // EXPECTED-TRACE: prd.md §6.3 块3 row 4（控制中指示 + 停止控制按钮可见）
    await expect(page.locator(AGENT_BAR)).toBeVisible();
    await expect(page.locator(BTN_STOP)).toBeVisible();
  });

  test("流程C：点击停止控制后指示消失，页面保持", async () => {
    await apiPost(apiBaseUrl, "/api/browser/navigate", {
      url: `http://localhost:${STUB_PORT}`,
      source: "agent",
      expand: true,
    });
    await expect(page.locator(AGENT_BAR)).toBeVisible();
    // EXPECTED-TRACE: prd.md §6.1 流程C 步骤1（URL 不变、指示消失）
    await page.locator(BTN_STOP).click();
    await expect(page.locator(AGENT_BAR)).toBeHidden();
    await expect(page.locator(OMNIBOX)).toHaveValue(`http://localhost:${STUB_PORT}/`);
  });

  // —— REQ-004 用例共享的会话种子：FAUX 回声（用户消息原文回显为 agent 气泡 → markdown 链接可点击）——
  async function seedChatWithText(text) {
    await fetch(`${apiBaseUrl}/api/settings/agent`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "deepseek", apiKey: "sk-e2e-faux-placeholder", identity: "" }),
    });
    const sess = await fetch(`${apiBaseUrl}/api/agent/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ spaceKind: "general" }),
    });
    const { spaceKey } = await sess.json();
    await page.reload();
    await expect(page.locator("[data-testid='screen-assistant']")).toBeVisible();
    await page.click(`[data-session-item='${spaceKey}']`);
    await page.fill("[data-testid='composer-input']", text);
    await page.click("[data-testid='send-button']");
  }

  test("REQ-004：聊天消息 http(s) 链接点击后面板打开并加载目标 URL", async () => {
    // EXPECTED-TRACE: prd.md §6.3 块4 row 1（面板打开并加载目标 URL，非系统浏览器）
    await seedChatWithText(`看一下这个 http://localhost:${STUB_PORT}`);
    const link = page.locator("[data-message-role='agent'] .md-link-wrap a");
    await expect(link).toBeVisible({ timeout: 120000 });
    await link.click();
    await expect(page.locator(PANEL)).toBeVisible();
    await expect(page.locator(OMNIBOX)).toHaveValue(`http://localhost:${STUB_PORT}/`);
  });

  test("REQ-004 AC2：右键链接出现关联菜单，含「在面板中打开」与「在系统浏览器打开」两个入口", async () => {
    // EXPECTED-TRACE: requirements.md REQ-BROWSER-004 AC2（系统浏览器入口）
    await seedChatWithText(`看一下这个 http://localhost:${STUB_PORT}`);
    const link = page.locator("[data-message-role='agent'] .md-link-wrap a");
    await expect(link).toBeVisible({ timeout: 120000 });
    await link.click({ button: "right" });
    const menu = page.locator("[data-message-role='agent'] .md-link-menu");
    await expect(menu).toBeVisible();
    await expect(menu.locator("button")).toHaveCount(2);
    // 系统浏览器入口存在（点击会真实唤起系统浏览器，E2E 不点——结构断言即契约面）
    await expect(menu.locator("button").nth(1)).toBeVisible();
    // 菜单项点击「在面板中打开」→ 面板打开（非系统浏览器路径）
    await menu.locator("button").nth(0).click();
    await expect(page.locator(PANEL)).toBeVisible();
    await expect(page.locator(OMNIBOX)).toHaveValue(`http://localhost:${STUB_PORT}/`);
  });

  test("REQ-004 AC3：mailto: 链接不拦截（保持默认锚点，无 md-link-wrap，点击不开面板）", async () => {
    // EXPECTED-TRACE: requirements.md REQ-BROWSER-004 AC3（非 http(s) 协议不走面板）
    await seedChatWithText("联系我 [邮箱](mailto:a@b.c)");
    const link = page.locator("[data-message-role='agent'] a", { hasText: "邮箱" });
    await expect(link).toBeVisible({ timeout: 120000 });
    // 非 http(s) 链接不经 MdLink 拦截：无 .md-link-wrap 包裹
    await expect(page.locator("[data-message-role='agent'] .md-link-wrap a", { hasText: "邮箱" })).toHaveCount(0);
    await link.click();
    await expect(page.locator(PANEL)).toBeHidden();
  });

  // —— 以下 4 用例自 api/browserTools.test.js 迁移（2026-08-29 req-gap 就地补全）：
  // read 结构/截断、scroll、screenshot 需真实 WebContentsView（纯 node 无 DOM 执行面），
  // 归 E2E。断言 expected 值未改动。

  test("REQ-BROWSER-002 read 快照结构：elements 含 tag/text/selector/rect", async () => {
    // EXPECTED-TRACE: prd.md §10.4 接口2 样例（elements:[{tag:"a",text:"立即开始",selector:".md-cta",rect:{…}}]）
    await apiPost(apiBaseUrl, "/api/browser/navigate", { url: `http://localhost:${STUB_PORT}`, source: "agent" });
    const { body } = await apiPost(apiBaseUrl, "/api/browser/read", {});
    expect(body.ok).toBe(true);
    expect(body.title).toBe("My App");
    const el = body.elements.find((e) => e.selector === ".md-cta");
    expect(el).toBeTruthy();
    expect(el.tag).toBe("a");
    expect(el.text).toBe("立即开始");
    expect(typeof el.rect.x).toBe("number");
  });

  test("REQ-BROWSER-002 read 截断：正文 >4000 字符截断且 truncated=true", async () => {
    // EXPECTED-TRACE: prd.md §10.4 接口2 样例（text 截断至 4000 字符，truncated:true）
    await apiPost(apiBaseUrl, "/api/browser/navigate", { url: `http://localhost:${STUB_PORT}/long`, source: "agent" });
    const { body } = await apiPost(apiBaseUrl, "/api/browser/read", {});
    expect(body.ok).toBe(true);
    expect(body.text.length).toBe(4000);
    expect(body.truncated).toBe(true);
  });

  test("REQ-BROWSER-002 scroll 回执：{ok:true, scrollX, scrollY}", async () => {
    // EXPECTED-TRACE: prd.md §10.4 接口3（{ok:true, scrollX:0, scrollY:480}）
    await apiPost(apiBaseUrl, "/api/browser/navigate", { url: `http://localhost:${STUB_PORT}/tall`, source: "agent" });
    const { body } = await apiPost(apiBaseUrl, "/api/browser/scroll", { dy: 480 });
    expect(body.ok).toBe(true);
    expect(body.scrollX).toBe(0);
    expect(body.scrollY).toBeGreaterThan(0);
  });

  test("REQ-BROWSER-002 screenshot 回执与落盘：PNG 文件存在且 n 递增", async () => {
    // EXPECTED-TRACE: prd.md §10.4 接口3（{ok:true, path:"<configDir>/browser-shots/browser-<n>.png", width>0, height>0}）
    await apiPost(apiBaseUrl, "/api/browser/navigate", { url: `http://localhost:${STUB_PORT}`, source: "agent" });
    const r1 = await apiPost(apiBaseUrl, "/api/browser/screenshot", {});
    expect(r1.body.ok).toBe(true);
    expect(r1.body.path).toMatch(/browser-1\.png$/);
    expect(r1.body.width).toBeGreaterThan(0);
    expect(r1.body.height).toBeGreaterThan(0);
    const p1 = path.join(userDataDir, "browser-shots", "browser-1.png");
    expect(fs.existsSync(p1)).toBe(true);
    const png = fs.readFileSync(p1);
    expect(png[0] === 0x89 && png[1] === 0x50).toBe(true); // PNG 魔数
    const r2 = await apiPost(apiBaseUrl, "/api/browser/screenshot", {});
    expect(r2.body.path).toMatch(/browser-2\.png$/);
  });
});
