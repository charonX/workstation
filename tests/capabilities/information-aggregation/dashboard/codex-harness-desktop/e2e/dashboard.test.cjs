// REQ-TRACE: codex-harness-desktop/REQ-DASH-001
// REQ-VERSION: v1-hash:762b9b7ff4d4891a26d57bdd0dd7ead507d8e0b23271665ae1ff317e3cfa9493
// CAPABILITY-TRACE: information-aggregation
// ENTITY-TRACE: dashboard
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: false

const { test, expect } = require("@playwright/test");
const { startElectronApp, stopElectronApp } = require("../../../../../e2e/fixtures/electronApp.cjs");
const { createProject, createFlow, createExecution } = require("../../../../../e2e/helpers/seed.cjs");
const locators = require("../../../../../e2e/helpers/locators.cjs");

test.describe("Dashboard", () => {
  let electronApp;
  let firstWindow;
  let apiBaseUrl;
  let userDataDir;
  let seededProject;
  let seededFlow;

  test.beforeEach(async () => {
    const ctx = await startElectronApp();
    electronApp = ctx.electronApp;
    firstWindow = ctx.firstWindow;
    apiBaseUrl = ctx.apiBaseUrl;
    userDataDir = ctx.userDataDir;

    // Seed some state so the dashboard has metrics to display.
    seededProject = await createProject(apiBaseUrl, {
      name: "Dashboard Project",
      localPath: `${userDataDir}/workspace/dashboard-project`,
    });
    seededFlow = await createFlow(apiBaseUrl, {
      name: "Dashboard Flow",
      projectId: seededProject.id,
    });
    await createExecution(apiBaseUrl, {
      projectId: seededProject.id,
      flowId: seededFlow.id,
    });
  });

  test.afterEach(async () => {
    await stopElectronApp(electronApp, userDataDir);
  });

  test("renders key metric cards", async () => {
    await firstWindow.click(locators.DASHBOARD_LINK);
    await expect(firstWindow.locator(locators.DASHBOARD_PAGE)).toBeVisible();

    await expect(firstWindow.locator(locators.PROJECT_COUNT_CARD)).toBeVisible();
    await expect(firstWindow.locator(locators.ACTIVE_SCHEDULE_COUNT_CARD)).toBeVisible();
    await expect(firstWindow.locator(locators.RECENT_RUN_COUNT_CARD)).toBeVisible();
    await expect(firstWindow.locator(locators.SUCCESS_RATE_CARD)).toBeVisible();

    await expect(firstWindow.locator(locators.PROJECT_COUNT_CARD)).toContainText("1");
    await expect(firstWindow.locator(locators.ACTIVE_SCHEDULE_COUNT_CARD)).toContainText("0");
    await expect(firstWindow.locator(locators.RECENT_RUN_COUNT_CARD)).toContainText("1");
    await expect(firstWindow.locator(locators.SUCCESS_RATE_CARD)).toContainText("1");
  });

  test("lists recent executions", async () => {
    await firstWindow.click(locators.DASHBOARD_LINK);
    await expect(firstWindow.locator(locators.RECENT_EXECUTIONS_LIST)).toBeVisible();

    const executionRow = firstWindow.locator(locators.RECENT_EXECUTIONS_LIST).locator("tr, li, [role='listitem']").first();
    await expect(executionRow).toContainText("Dashboard Flow");
    await expect(executionRow).toContainText("success");
  });

  test("provides quick project links", async () => {
    await firstWindow.click(locators.DASHBOARD_LINK);

    const quickLink = firstWindow.locator(locators.DASHBOARD_PAGE).getByText("Dashboard Project").first();
    await expect(quickLink).toBeVisible();
    await quickLink.click();

    // Expected: navigate to the workspace page where the project is listed.
    await expect(firstWindow).toHaveURL(/\/workspace/);
    await expect(firstWindow.locator(locators.PROJECT_CARD).filter({ hasText: "Dashboard Project" })).toBeVisible();
  });
});
