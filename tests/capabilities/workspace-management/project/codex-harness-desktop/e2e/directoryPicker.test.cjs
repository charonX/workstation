// REQ-TRACE: codex-harness-desktop/REQ-WORKSPACE-003
// REQ-VERSION: v1-hash:762b9b7ff4d4891a26d57bdd0dd7ead507d8e0b23271665ae1ff317e3cfa9493
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
