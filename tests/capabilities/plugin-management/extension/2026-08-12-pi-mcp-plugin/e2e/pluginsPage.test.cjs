// REQ-TRACE: 2026-08-12-pi-mcp-plugin/REQ-AGENT-083
// REQ-VERSION: v1-hash:742cddf72b44df8cb71bb4b0cf6a8dae7a21d22df2b4c3788bdf3065208b848d
// CAPABILITY-TRACE: plugin-management
// ENTITY-TRACE: extension
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true (2026-08-13 assertion signoff)

// 管理区「插件」页（REQ-083）。
// BUG-013（2026-08-16，req-gap 就地补全）：MCP server 管理用例迁出至
//   plugin-management/mcp-server/.../e2e/mcpPage.test.cjs（独立页 #/mcp + AC7 工具探测）。
//
// UX 参照：ux/plugins-page.html（已定稿 2026-08-13；BUG-013 起只留扩展插件）。结构契约锚点：
//   [data-testid='plugins-page']          页面容器
//   [data-testid='plugin-add-button']     添加插件按钮
//   [data-testid='plugin-add-modal']      添加弹窗（含来源类型 seg + M2 告知条）
//   [data-testid='plugin-source-input']   来源输入
//   [data-testid='plugin-source-error']   来源格式错误
//   [data-testid='plugin-safety-note']    「第三方代码拥有完全系统权限」告知（M2 定稿：常驻告知条）
//   [data-testid='plugin-row-<name>']     插件行
//   [data-testid='plugin-row-error']      错误态行（含 .error-detail）
//   [data-testid='plugin-project-toggle'] 行内项目启用切换
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
