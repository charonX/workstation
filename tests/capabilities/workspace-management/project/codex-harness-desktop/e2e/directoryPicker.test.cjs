// REQ-TRACE: codex-harness-desktop/REQ-WORKSPACE-003
// REQ-VERSION: v1-hash:5d0bdb3d2786189d093861e7afc37e0431ca15d5e7ae871afd42b421bf45f108
// CAPABILITY-TRACE: workspace-management
// ENTITY-TRACE: project
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: false

const { test, expect } = require("@playwright/test");
const { startElectronApp, stopElectronApp } = require("../../../../../e2e/fixtures/electronApp.cjs");
const locators = require("../../../../../e2e/helpers/locators.cjs");
const { mockSelectDirectory } = require("../../../../../e2e/helpers/mockDirectoryPicker.cjs");

test.describe("Project form directory picker", () => {
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

  test("browse button fills local path input", async () => {
    await firstWindow.click(locators.WORKSPACE_LINK);
    await firstWindow.click(locators.ADD_PROJECT_BUTTON);
    await expect(firstWindow.locator(locators.PROJECT_FORM_MODAL)).toBeVisible();

    await mockSelectDirectory(firstWindow, "/tmp/mock-project");
    await firstWindow.click(locators.PROJECT_LOCAL_PATH_BROWSE_BUTTON);
    await expect(firstWindow.locator(locators.PROJECT_LOCAL_PATH_INPUT)).toHaveValue("/tmp/mock-project");
  });
});
