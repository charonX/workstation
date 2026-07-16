// REQ-TRACE: codex-harness-desktop/REQ-I18N-001, REQ-I18N-002, REQ-WORKSPACE-005, REQ-DASH-001
// REQ-VERSION: v1-hash:53fcb918ad26820e6760c66ac610791ceca2a11a981737c76234a70ea8f36569
// CAPABILITY-TRACE: internationalization-theme
// ENTITY-TRACE: theme
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: false

const { test, expect } = require("@playwright/test");
const { startElectronApp, stopElectronApp } = require("../../../../../e2e/fixtures/electronApp.cjs");
const locators = require("../../../../../e2e/helpers/locators.cjs");

test.describe("TopBar", () => {
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

  test("renders brand, search box and action icons", async () => {
    await expect(firstWindow.locator(locators.TOPBAR)).toBeVisible();
    await expect(firstWindow.locator(locators.TOPBAR_LOGO)).toContainText("OPC Workstation");

    const searchInput = firstWindow.locator(locators.TOPBAR_SEARCH_INPUT);
    await expect(searchInput).toBeVisible();
    await expect(searchInput).toHaveAttribute("placeholder", /Search projects, flows, executions/i);

    await expect(firstWindow.locator(locators.TOPBAR_LANGUAGE_BUTTON)).toBeVisible();
    await expect(firstWindow.locator(locators.TOPBAR_THEME_BUTTON)).toBeVisible();
    await expect(firstWindow.locator(locators.TOPBAR_NOTIFICATIONS_BUTTON)).toBeVisible();
    await expect(firstWindow.locator(locators.TOPBAR_SETTINGS_BUTTON)).toBeVisible();

    // The brand should appear only in the top bar, not duplicated in the sidebar.
    await expect(firstWindow.locator(locators.SIDEBAR)).not.toContainText("OPC Workstation");
  });

  test("theme toggle in topbar switches data-theme", async () => {
    await expect(firstWindow.locator(locators.TOPBAR)).toBeVisible();
    const initial = await firstWindow.locator("html").getAttribute("data-theme") || "dark";
    const opposite = initial === "dark" ? "light" : "dark";

    await firstWindow.click(locators.TOPBAR_THEME_BUTTON);
    await expect(firstWindow.locator("html")).toHaveAttribute("data-theme", opposite);

    await firstWindow.click(locators.TOPBAR_THEME_BUTTON);
    await expect(firstWindow.locator("html")).toHaveAttribute("data-theme", initial);
  });

  test("language toggle in topbar cycles language and updates navigation", async () => {
    await expect(firstWindow.locator(locators.TOPBAR)).toBeVisible();
    await firstWindow.click(locators.TOPBAR_LANGUAGE_BUTTON);
    // TopBar language button cycles language: en-US -> zh-CN
    await expect(firstWindow.locator("html")).toHaveAttribute("lang", "zh-CN");
    await expect(firstWindow.locator(locators.WORKSPACE_LINK)).toContainText("工作区");

    await firstWindow.click(locators.TOPBAR_LANGUAGE_BUTTON);
    await expect(firstWindow.locator("html")).toHaveAttribute("lang", "en-US");
    await expect(firstWindow.locator(locators.WORKSPACE_LINK)).toContainText("Workspace");
  });

  test("settings icon navigates to settings page", async () => {
    await firstWindow.click(locators.TOPBAR_SETTINGS_BUTTON);
    await expect(firstWindow).toHaveURL(/\/settings/);
    await expect(firstWindow.locator(locators.SETTINGS_FORM)).toBeVisible();
  });
});
