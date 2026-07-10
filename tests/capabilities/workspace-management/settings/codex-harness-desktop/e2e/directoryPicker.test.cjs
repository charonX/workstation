// REQ-TRACE: codex-harness-desktop/REQ-WORKSPACE-001, REQ-WORKSPACE-002
// REQ-VERSION: v1-hash:d430fc9129f2087e72c0880464a7bd5430c420753cace446dc54475760bc46c1
// CAPABILITY-TRACE: workspace-management
// ENTITY-TRACE: settings
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: false

const { test, expect } = require("@playwright/test");
const { startElectronApp, stopElectronApp } = require("../../../../../e2e/fixtures/electronApp.cjs");
const locators = require("../../../../../e2e/helpers/locators.cjs");
const { mockSelectDirectory } = require("../../../../../e2e/helpers/mockDirectoryPicker.cjs");

test.describe("Settings directory picker", () => {
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

  test("browse button fills workspace root input", async () => {
    await firstWindow.click(locators.SETTINGS_LINK);
    await mockSelectDirectory(firstWindow, "/tmp/mock-workspace");
    await firstWindow.click(locators.WORKSPACE_ROOT_BROWSE_BUTTON);
    await expect(firstWindow.locator(locators.WORKSPACE_ROOT_INPUT)).toHaveValue("/tmp/mock-workspace");
  });

  test("browse button fills skill repo path input", async () => {
    await firstWindow.click(locators.SETTINGS_LINK);
    await mockSelectDirectory(firstWindow, "/tmp/mock-skills");
    await firstWindow.click(locators.SKILL_REPO_PATH_BROWSE_BUTTON);
    await expect(firstWindow.locator(locators.SKILL_REPO_PATH_INPUT)).toHaveValue("/tmp/mock-skills");
  });
});
