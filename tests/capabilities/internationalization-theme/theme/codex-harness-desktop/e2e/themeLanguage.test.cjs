// REQ-TRACE: codex-harness-desktop/REQ-I18N-001, REQ-I18N-002
// REQ-VERSION: v1-hash:5d0bdb3d2786189d093861e7afc37e0431ca15d5e7ae871afd42b421bf45f108
// CAPABILITY-TRACE: internationalization-theme
// ENTITY-TRACE: theme, language
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: false

// 2026-08-05 适配：Settings tab 化（REQ-AGENT-023 AC4 测试侧接替）——右上角全局
// 保存移除，改用通用 tab（默认选中）区内保存按钮；断言语义不变。

const { test, expect } = require("@playwright/test");
const { startElectronApp, stopElectronApp } = require("../../../../../e2e/fixtures/electronApp.cjs");
const { goToAdminRoute } = require("../../../../../e2e/helpers/navigation.cjs");
const locators = require("../../../../../e2e/helpers/locators.cjs");

// T-8 适配（2026-08-06）：默认落地 = 会话区（/assistant）——管理区左导 nav-settings
// 不在会话区；进入设置页统一先 goto 设置路由（管理区壳，AC5）；断言语义不变。
async function openSettingsPage(firstWindow) {
  await goToAdminRoute(firstWindow, "#/settings");
}

test.describe("Theme and Language", () => {
  let electronApp;
  let firstWindow;
  let userDataDir;

  test.beforeEach(async () => {
    const ctx = await startElectronApp();
    electronApp = ctx.electronApp;
    firstWindow = ctx.firstWindow;
    userDataDir = ctx.userDataDir;
  });

  test.afterEach(async () => {
    await stopElectronApp(electronApp, userDataDir);
  });

  test("switching theme updates DOM data-theme attribute", async () => {
    await openSettingsPage(firstWindow);

    await firstWindow.selectOption(locators.THEME_SELECT, "dark");
    await firstWindow.click(locators.SAVE_GENERAL_SETTINGS_BUTTON);
    await expect(firstWindow.locator("html")).toHaveAttribute("data-theme", "dark");

    await firstWindow.selectOption(locators.THEME_SELECT, "light");
    await firstWindow.click(locators.SAVE_GENERAL_SETTINGS_BUTTON);
    await expect(firstWindow.locator("html")).toHaveAttribute("data-theme", "light");
  });

  test("theme preference persists after reload", async () => {
    await openSettingsPage(firstWindow);
    await firstWindow.selectOption(locators.THEME_SELECT, "dark");
    await firstWindow.click(locators.SAVE_GENERAL_SETTINGS_BUTTON);

    await firstWindow.reload();
    await openSettingsPage(firstWindow);
    await expect(firstWindow.locator(locators.THEME_SELECT)).toHaveValue("dark");
    await expect(firstWindow.locator("html")).toHaveAttribute("data-theme", "dark");
  });

  test("switching language updates html lang and UI text", async () => {
    await openSettingsPage(firstWindow);

    await firstWindow.selectOption(locators.LANGUAGE_SELECT, "zh-CN");
    await firstWindow.click(locators.SAVE_GENERAL_SETTINGS_BUTTON);
    await expect(firstWindow.locator("html")).toHaveAttribute("lang", "zh-CN");
    await expect(firstWindow.locator(locators.WORKSPACE_LINK)).toContainText("工作区");

    await firstWindow.selectOption(locators.LANGUAGE_SELECT, "en-US");
    await firstWindow.click(locators.SAVE_GENERAL_SETTINGS_BUTTON);
    await expect(firstWindow.locator("html")).toHaveAttribute("lang", "en-US");
    await expect(firstWindow.locator(locators.WORKSPACE_LINK)).toContainText("Workspace");
  });

  test("language preference persists after reload", async () => {
    await openSettingsPage(firstWindow);
    await firstWindow.selectOption(locators.LANGUAGE_SELECT, "zh-CN");
    await firstWindow.click(locators.SAVE_GENERAL_SETTINGS_BUTTON);

    await firstWindow.reload();
    await openSettingsPage(firstWindow);
    await expect(firstWindow.locator(locators.LANGUAGE_SELECT)).toHaveValue("zh-CN");
    await expect(firstWindow.locator("html")).toHaveAttribute("lang", "zh-CN");
  });
});
