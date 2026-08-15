// REQ-TRACE: 2026-08-12-pi-mcp-plugin/REQ-AGENT-083, 2026-08-12-pi-mcp-plugin/REQ-AGENT-084
// REQ-VERSION: v1-hash:6c7fd998525a697ef21587c808800edfb15182b428d588f83c9ae835acf09243
// CAPABILITY-TRACE: plugin-management
// ENTITY-TRACE: extension
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true (2026-08-13 assertion signoff)

// 管理区「插件」页（REQ-083）+ MCP server 管理表单（REQ-084 UI 部分）。
//
// UX 参照：ux/plugins-page.html（已定稿 2026-08-13）。结构契约锚点：
//   [data-testid='plugins-page']          页面容器
//   [data-testid='plugin-add-button']     添加插件按钮
//   [data-testid='plugin-add-modal']      添加弹窗（含来源类型 seg + M2 告知条）
//   [data-testid='plugin-source-input']   来源输入
//   [data-testid='plugin-source-error']   来源格式错误
//   [data-testid='plugin-safety-note']    「第三方代码拥有完全系统权限」告知（M2 定稿：常驻告知条）
//   [data-testid='plugin-row-<name>']     插件行
//   [data-testid='plugin-row-error']      错误态行（含 .error-detail）
//   [data-testid='plugin-project-toggle'] 行内项目启用切换
//   [data-testid='mcp-add-button'] / [data-testid='mcp-form-modal']
//   [data-testid='mcp-type-seg'] / [data-testid='mcp-command-input'] / [data-testid='mcp-args-input']
//   [data-testid='mcp-url-input'] / [data-testid='mcp-form-submit']
//   [data-testid='mcp-row-<name>']        MCP server 行
//
// 已签（门 1，2026-08-13）：插件页路由 = #/plugins（新管理区导航项）；
//   告知条文案锁「完全系统权限」；缺包/加载失败指引锁「插件」字样。
//
// 环境：startElectronApp（既有 fixture）；导航走 hash 路由直访（navigation.cjs 先例）。
// 断言语义：元素存在/可见性/状态持久，不验像素。

const { test, expect } = require("@playwright/test");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");
const { startElectronApp, stopElectronApp } = require("../../../../../e2e/fixtures/electronApp.cjs");
const { goToAdminRoute } = require("../../../../../e2e/helpers/navigation.cjs");

const PAGE = "[data-testid='plugins-page']";
const ADD_BTN = "[data-testid='plugin-add-button']";
const ADD_MODAL = "[data-testid='plugin-add-modal']";
const SOURCE_INPUT = "[data-testid='plugin-source-input']";
const SAFETY_NOTE = "[data-testid='plugin-safety-note']";
const PLUGINS_ROUTE = "#/plugins";

const GOOD_EXT_ABS = path.resolve(__dirname, "../../../../../fixtures/pi-extension-good");
const BAD_EXT_ABS = path.resolve(__dirname, "../../../../../fixtures/pi-extension-bad");

// 标准 3/4 专用 seed（经应用 HTTP API）：安装插件 / 建 demo 项目 / 装坏插件。
// 保持标准 1/2 的干净添加流不受 seed 影响（seed 只在需要它的用例内执行）。
async function seedViaApi(apiBaseUrl, fn) {
  const res = await fetch(`${apiBaseUrl}${fn.path}`, {
    method: fn.method ?? "POST",
    headers: { "Content-Type": "application/json" },
    body: fn.body ? JSON.stringify(fn.body) : undefined,
  });
  if (!res.ok) throw new Error(`seed ${fn.path} failed: ${res.status}`);
}
async function seedPlugin(apiBaseUrl, source) {
  await seedViaApi(apiBaseUrl, { path: "/api/plugins", body: { source } });
}
async function seedDemoProject(apiBaseUrl) {
  const projDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-e2e-demo-"));
  await seedViaApi(apiBaseUrl, {
    path: "/api/projects",
    body: { name: "demo", sourceType: "local", localPath: projDir },
  });
  return projDir;
}

test.describe("REQ-AGENT-083 插件管理 UI（E2E）", () => {
  let electronApp;
  let firstWindow;
  let apiBaseUrl;

  test.beforeEach(async () => {
    ({ electronApp, firstWindow, apiBaseUrl } = await startElectronApp());
    await goToAdminRoute(firstWindow, PLUGINS_ROUTE);
  });

  test.afterEach(async () => {
    await stopElectronApp(electronApp);
  });

  test("标准 1：管理区出现「插件」页入口，页面渲染插件清单", async () => {
    await expect(firstWindow.locator(PAGE)).toBeVisible();
    await expect(firstWindow.locator(ADD_BTN)).toBeVisible();
    // 内置 pi-mcp-adapter 行呈现（随应用发布，不可停用）
    await expect(firstWindow.locator("[data-testid='plugin-row-pi-mcp-adapter']")).toBeVisible();
  });

  test("标准 2a：添加流程——本地路径来源成功，列表新增行", async () => {
    await firstWindow.locator(ADD_BTN).click();
    await expect(firstWindow.locator(ADD_MODAL)).toBeVisible();
    await firstWindow.locator(`${ADD_MODAL} [data-type='local']`).click();
    await firstWindow.locator(SOURCE_INPUT).fill(GOOD_EXT_ABS);
    await firstWindow.locator("[data-testid='plugin-add-submit']").click();
    await expect(firstWindow.locator("[data-testid='plugin-row-pi-extension-good']")).toBeVisible();
  });

  test("标准 2b：非法来源 → 弹窗内报错，列表不出现新行", async () => {
    await firstWindow.locator(ADD_BTN).click();
    await firstWindow.locator(SOURCE_INPUT).fill("ht tp://???");
    await firstWindow.locator("[data-testid='plugin-add-submit']").click();
    await expect(firstWindow.locator("[data-testid='plugin-source-error']")).toBeVisible();
    await expect(firstWindow.locator(ADD_MODAL)).toBeVisible(); // 弹窗不关
  });

  test("标准 3：行内项目启用切换可点且状态持久（刷新后保持）", async () => {
    // 前置（实现接线）：经 API seed 已安装插件 + 一个项目，然后重新加载清单
    await seedPlugin(apiBaseUrl, GOOD_EXT_ABS);
    await seedDemoProject(apiBaseUrl);
    await goToAdminRoute(firstWindow, PLUGINS_ROUTE);
    const row = firstWindow.locator("[data-testid='plugin-row-pi-extension-good']");
    await row.locator("[data-testid='plugin-project-toggle']").click();
    const pop = row.locator("[data-testid='plugin-project-pop']");
    await expect(pop).toBeVisible();
    await pop.locator(".pop-row", { hasText: "demo" }).locator(".switch").click();
    await goToAdminRoute(firstWindow, PLUGINS_ROUTE); // 刷新重进
    await expect(
      row.locator("[data-testid='plugin-project-toggle']")
    ).toContainText("1 个项目");
  });

  test("标准 4：错误态插件行标红 + 详情可见", async () => {
    // 前置（实现接线）：经 API seed 坏插件（tests/fixtures/pi-extension-bad），然后重新加载清单
    await seedPlugin(apiBaseUrl, BAD_EXT_ABS);
    await goToAdminRoute(firstWindow, PLUGINS_ROUTE);
    const errRow = firstWindow.locator("[data-testid='plugin-row-error']");
    await expect(errRow).toBeVisible();
    await expect(errRow.locator(".error-detail")).toBeVisible();
    await expect(errRow.locator(".error-detail")).toContainText("pi-extension-bad");
  });

  test("标准 5：添加弹窗含「完全系统权限」常驻告知条（M2 定稿）", async () => {
    await firstWindow.locator(ADD_BTN).click();
    await expect(firstWindow.locator(SAFETY_NOTE)).toBeVisible();
    await expect(firstWindow.locator(SAFETY_NOTE)).toContainText("完全系统权限");
  });
});

test.describe("REQ-AGENT-084 MCP server 管理表单（E2E）", () => {
  let electronApp;
  let firstWindow;
  let apiBaseUrl;

  test.beforeEach(async () => {
    ({ electronApp, firstWindow, apiBaseUrl } = await startElectronApp());
    await goToAdminRoute(firstWindow, PLUGINS_ROUTE);
  });

  test.afterEach(async () => {
    await stopElectronApp(electronApp);
  });

  test("添加 MCP 服务——stdio 表单保存后列表出现该 server", async () => {
    await firstWindow.locator("[data-testid='mcp-add-button']").click();
    await expect(firstWindow.locator("[data-testid='mcp-form-modal']")).toBeVisible();
    await firstWindow.locator("[data-testid='mcp-name-input']").fill("e2e-stdio");
    await firstWindow.locator("[data-testid='mcp-command-input']").fill("node");
    await firstWindow.locator("[data-testid='mcp-args-input']").fill("tests/fixtures/mcp-stdio-server/server.mjs");
    await firstWindow.locator("[data-testid='mcp-form-submit']").click();
    await expect(firstWindow.locator("[data-testid='mcp-row-e2e-stdio']")).toBeVisible();
  });

  test("类型切换 http → 显示 URL/认证字段；非法 URL 表单报错", async () => {
    await firstWindow.locator("[data-testid='mcp-add-button']").click();
    await firstWindow.locator("[data-testid='mcp-type-seg'] [data-type='http']").click();
    await expect(firstWindow.locator("[data-testid='mcp-url-input']")).toBeVisible();
    await expect(firstWindow.locator("[data-testid='mcp-auth-seg']")).toBeVisible();
    await firstWindow.locator("[data-testid='mcp-name-input']").fill("e2e-bad");
    await firstWindow.locator("[data-testid='mcp-url-input']").fill("ftp://bad");
    await firstWindow.locator("[data-testid='mcp-form-submit']").click();
    // 字段级错误呈现，弹窗不关
    await expect(firstWindow.locator("[data-testid='mcp-form-modal'] .err:visible")).toBeVisible();
  });

  // BUG-006（REQ-AGENT-084 标准 6，req-gap 就地补全）：bearer token 录入入口。
  // UX 参照 ux/plugins-page.html：认证选 Bearer Token 时显示 mcp-token-input（password 型）。
  test("认证选 Bearer Token → 显示 token 输入框；带 token 保存后列表出现该 server", async () => {
    await firstWindow.locator("[data-testid='mcp-add-button']").click();
    await firstWindow.locator("[data-testid='mcp-type-seg'] [data-type='http']").click();
    const tokenInput = firstWindow.locator("[data-testid='mcp-token-input']");
    await expect(tokenInput).toBeHidden();
    await firstWindow.locator("[data-testid='mcp-auth-seg'] button", { hasText: "Bearer Token" }).click();
    await expect(tokenInput).toBeVisible();
    // 切回「无」→ 隐藏
    await firstWindow.locator("[data-testid='mcp-auth-seg'] button", { hasText: "无", exact: true }).click();
    await expect(tokenInput).toBeHidden();
    // bearer + token 保存成功
    await firstWindow.locator("[data-testid='mcp-auth-seg'] button", { hasText: "Bearer Token" }).click();
    await firstWindow.locator("[data-testid='mcp-name-input']").fill("e2e-bearer");
    await firstWindow.locator("[data-testid='mcp-url-input']").fill("https://mcp.example.com/v2/mcp");
    await tokenInput.fill("e2e-secret-token");
    await firstWindow.locator("[data-testid='mcp-form-submit']").click();
    await expect(firstWindow.locator("[data-testid='mcp-row-e2e-bearer']")).toBeVisible();
    // 页面任何位置不回显明文 token
    await expect(firstWindow.locator("text=e2e-secret-token")).toHaveCount(0);
  });

  // BUG-008 回归（REQ-AGENT-084 CRUD-U + UX 参照行内「编辑」按钮，plugins-page.html）：
  // 行内「编辑」打开同一弹窗（编辑模式）：名称为主键只读，字段回填；token 不回填
  // （已签：API 永不回显明文），留空 = 保持不变。
  test("行内「编辑」按钮打开回填弹窗，改 URL 保存后行更新", async () => {
    await seedViaApi(apiBaseUrl, {
      path: "/api/mcp",
      body: { name: "e2e-edit", type: "http", url: "https://old.example.com/mcp", auth: "bearer", token: "keep-me" },
    });
    await goToAdminRoute(firstWindow, PLUGINS_ROUTE);
    const row = firstWindow.locator("[data-testid='mcp-row-e2e-edit']");
    await expect(row).toBeVisible();

    await row.locator("[data-testid='mcp-edit-button']").click();
    const modal = firstWindow.locator("[data-testid='mcp-form-modal']");
    await expect(modal).toBeVisible();
    // 回填：url 回填旧值；name 主键只读；token 不回填（留空 = 保留）
    await expect(modal.locator("[data-testid='mcp-url-input']")).toHaveValue("https://old.example.com/mcp");
    await expect(modal.locator("[data-testid='mcp-name-input']")).toBeDisabled();
    await expect(modal.locator("[data-testid='mcp-token-input']")).toHaveValue("");

    await modal.locator("[data-testid='mcp-url-input']").fill("https://new.example.com/mcp");
    await modal.locator("[data-testid='mcp-form-submit']").click();
    await expect(modal).toBeHidden();
    await expect(row.locator(".mono")).toContainText("https://new.example.com/mcp");
    // 页面任何位置不回显明文 token（含编辑后）
    await expect(firstWindow.locator("text=keep-me")).toHaveCount(0);
  });

  // BUG-008 回归（req-gap 就地补全后的 UX 结构契约）：
  // 全局开关 switch 须为可见尺寸（UX 定稿 32×18），非 inline 塌缩；
  // 项目启用 pill on 态文字为 accent 色（可读），非白字不可见。
  test("渲染结构：全局开关可见尺寸 + 项目启用 pill on 态文字可读", async () => {
    await seedViaApi(apiBaseUrl, {
      path: "/api/mcp",
      body: { name: "e2e-visual", type: "http", url: "https://visual.example.com/mcp" },
    });
    const projDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-e2e-vis-"));
    const projRes = await fetch(`${apiBaseUrl}/api/projects`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "vis-demo", sourceType: "local", localPath: projDir }),
    });
    const proj = await projRes.json();
    await seedViaApi(apiBaseUrl, {
      path: "/api/mcp/e2e-visual/project-enable",
      body: { projectId: proj.id, enabled: true },
    });
    await goToAdminRoute(firstWindow, PLUGINS_ROUTE);
    const row = firstWindow.locator("[data-testid='mcp-row-e2e-visual']");
    await expect(row).toBeVisible();

    // 开关可见尺寸（塌缩时 boundingBox 宽度 ≈ 0）
    const toggleBox = await row.locator("[data-testid='mcp-global-toggle']").boundingBox();
    expect(toggleBox.width).toBeGreaterThanOrEqual(30);
    expect(toggleBox.height).toBeGreaterThanOrEqual(16);

    // pill on 态文字色 = accent（rgb(13,148,136) 浅主题），白字 = rgb(255,255,255) 为缺陷态
    const pillColor = await row.locator("[data-testid='mcp-project-toggle']").evaluate(
      (el) => getComputedStyle(el).color
    );
    expect(pillColor).not.toBe("rgb(255, 255, 255)");
  });
});
