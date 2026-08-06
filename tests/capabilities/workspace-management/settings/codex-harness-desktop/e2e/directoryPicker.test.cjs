// REQ-TRACE: codex-harness-desktop/REQ-WORKSPACE-001, REQ-WORKSPACE-002
// REQ-VERSION: v1-hash:5d0bdb3d2786189d093861e7afc37e0431ca15d5e7ae871afd42b421bf45f108
// CAPABILITY-TRACE: workspace-management
// ENTITY-TRACE: settings
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: false

const { test, expect } = require("@playwright/test");
const { startElectronApp, stopElectronApp } = require("../../../../../e2e/fixtures/electronApp.cjs");
const { goToAdminRoute } = require("../../../../../e2e/helpers/navigation.cjs");
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
    // T-8 适配（2026-08-06）：默认落地 = 会话区——直接 goto 设置路由（断言语义不变）。
    await goToAdminRoute(firstWindow, "#/settings");
    await mockSelectDirectory(firstWindow, "/tmp/mock-workspace");
    await firstWindow.click(locators.WORKSPACE_ROOT_BROWSE_BUTTON);
    await expect(firstWindow.locator(locators.WORKSPACE_ROOT_INPUT)).toHaveValue("/tmp/mock-workspace");
  });

  test("browse button fills skill repo path input", async () => {
    // T-8 适配（2026-08-06）：默认落地 = 会话区——直接 goto 设置路由（断言语义不变）。
    await goToAdminRoute(firstWindow, "#/settings");
    await mockSelectDirectory(firstWindow, "/tmp/mock-skills");
    await firstWindow.click(locators.SKILL_REPO_PATH_BROWSE_BUTTON);
    await expect(firstWindow.locator(locators.SKILL_REPO_PATH_INPUT)).toHaveValue("/tmp/mock-skills");
  });
});
