// REQ-TRACE: codex-harness-desktop/REQ-DASH-001
// REQ-VERSION: v1-hash:d430fc9129f2087e72c0880464a7bd5430c420753cace446dc54475760bc46c1
// CAPABILITY-TRACE: information-aggregation
// ENTITY-TRACE: dashboard
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: false

const { test, expect } = require("@playwright/test");
const { startElectronApp, stopElectronApp } = require("../../../../../e2e/fixtures/electronApp");
const { createProject, createFlow, createExecution } = require("../../../../../e2e/helpers/seed");
const locators = require("../../../../../e2e/helpers/locators");

test.describe("Dashboard", () => {
  let electronApp;
  let firstWindow;
  let apiBaseUrl;
  let userDataDir;

  test.beforeEach(async () => {
    const ctx = await startElectronApp();
    electronApp = ctx.electronApp;
    firstWindow = ctx.firstWindow;
    apiBaseUrl = ctx.apiBaseUrl;
    userDataDir = ctx.userDataDir;

    // Seed some state so the dashboard has metrics to display.
    // TODO: HUMAN ASSERTION — verify seed bodies match API contract
    const project = await createProject(apiBaseUrl, {
      name: "Dashboard Project",
      localPath: "/tmp/opc-workspace/dashboard-project",
    });
    const flow = await createFlow(apiBaseUrl, {
      name: "Dashboard Flow",
      projectId: project.id,
    });
    await createExecution(apiBaseUrl, {
      projectId: project.id,
      flowId: flow.id,
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

    // TODO: HUMAN ASSERTION — assert expected numeric values or non-empty state
    await expect(firstWindow.locator(locators.PROJECT_COUNT_CARD)).toContainText("1");
  });

  test("lists recent executions", async () => {
    await firstWindow.click(locators.DASHBOARD_LINK);
    await expect(firstWindow.locator(locators.RECENT_EXECUTIONS_LIST)).toBeVisible();

    // TODO: HUMAN ASSERTION — assert expected execution label/status
    await expect(firstWindow.locator(locators.RECENT_EXECUTIONS_LIST)).toContainText("Dashboard Flow");
  });

  test("provides quick project links", async () => {
    await firstWindow.click(locators.DASHBOARD_LINK);

    // TODO: HUMAN ASSERTION — identify quick-link element and expected target
    const quickLink = firstWindow.getByText("Dashboard Project").first();
    await expect(quickLink).toBeVisible();
    await quickLink.click();
    // Expected: navigate to workspace or project detail
    // await expect(firstWindow).toHaveURL(/\/workspace/);
  });
});
