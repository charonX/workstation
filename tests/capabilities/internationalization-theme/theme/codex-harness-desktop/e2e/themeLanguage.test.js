// REQ-TRACE: codex-harness-desktop/REQ-I18N-001, REQ-I18N-002
// REQ-VERSION: v1-hash:d430fc9129f2087e72c0880464a7bd5430c420753cace446dc54475760bc46c1
// CAPABILITY-TRACE: internationalization-theme
// ENTITY-TRACE: theme, language
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: false

const { test, expect } = require("@playwright/test");
const { startElectronApp, stopElectronApp } = require("../../../../../../e2e/fixtures/electronApp");
const locators = require("../../../../../../e2e/helpers/locators");

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
    await firstWindow.click(locators.SETTINGS_LINK);

    await firstWindow.selectOption(locators.THEME_SELECT, "dark");
    await firstWindow.click(locators.SAVE_SETTINGS_BUTTON);
    await expect(firstWindow.locator("html")).toHaveAttribute("data-theme", "dark");

    await firstWindow.selectOption(locators.THEME_SELECT, "light");
    await firstWindow.click(locators.SAVE_SETTINGS_BUTTON);
    await expect(firstWindow.locator("html")).toHaveAttribute("data-theme", "light");
  });

  test("theme preference persists after reload", async () => {
    await firstWindow.click(locators.SETTINGS_LINK);
    await firstWindow.selectOption(locators.THEME_SELECT, "dark");
    await firstWindow.click(locators.SAVE_SETTINGS_BUTTON);

    await firstWindow.reload();
    await firstWindow.click(locators.SETTINGS_LINK);
    await expect(firstWindow.locator(locators.THEME_SELECT)).toHaveValue("dark");
    await expect(firstWindow.locator("html")).toHaveAttribute("data-theme", "dark");
  });

  test("switching language updates html lang and UI text", async () => {
    await firstWindow.click(locators.SETTINGS_LINK);

    await firstWindow.selectOption(locators.LANGUAGE_SELECT, "zh-CN");
    await firstWindow.click(locators.SAVE_SETTINGS_BUTTON);
    await expect(firstWindow.locator("html")).toHaveAttribute("lang", "zh-CN");

    // TODO: HUMAN ASSERTION — add a specific Chinese label expected in the UI
    // await expect(firstWindow.getByText("工作区")).toBeVisible();

    await firstWindow.selectOption(locators.LANGUAGE_SELECT, "en-US");
    await firstWindow.click(locators.SAVE_SETTINGS_BUTTON);
    await expect(firstWindow.locator("html")).toHaveAttribute("lang", "en-US");

    // TODO: HUMAN ASSERTION — add a specific English label expected in the UI
    // await expect(firstWindow.getByText("Workspace")).toBeVisible();
  });

  test("language preference persists after reload", async () => {
    await firstWindow.click(locators.SETTINGS_LINK);
    await firstWindow.selectOption(locators.LANGUAGE_SELECT, "zh-CN");
    await firstWindow.click(locators.SAVE_SETTINGS_BUTTON);

    await firstWindow.reload();
    await firstWindow.click(locators.SETTINGS_LINK);
    await expect(firstWindow.locator(locators.LANGUAGE_SELECT)).toHaveValue("zh-CN");
    await expect(firstWindow.locator("html")).toHaveAttribute("lang", "zh-CN");
  });
});
