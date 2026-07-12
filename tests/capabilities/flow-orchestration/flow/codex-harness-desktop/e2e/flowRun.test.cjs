// REQ-TRACE: codex-harness-desktop/REQ-FLOW-002, REQ-FLOW-003, REQ-FLOW-004, REQ-FLOW-005, REQ-FLOW-011, REQ-SCHEDULE-001, REQ-SCHEDULE-003
// REQ-VERSION: v1-hash:9ef9310da8e2e2737ea32e521ee7f83fcee2c5d30f8d7d435ae367124e240b22
// CAPABILITY-TRACE: flow-orchestration, scheduling-execution
// ENTITY-TRACE: flow, task
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: false

const { test, expect } = require("@playwright/test");
const { startElectronApp, stopElectronApp } = require("../../../../../e2e/fixtures/electronApp.cjs");
const { createProject, createFlow, createExecution } = require("../../../../../e2e/helpers/seed.cjs");
const locators = require("../../../../../e2e/helpers/locators.cjs");

test.describe("Flow Run", () => {
  let electronApp;
  let firstWindow;
  let apiBaseUrl;
  let userDataDir;
  let seededProject;

  test.beforeEach(async () => {
    const ctx = await startElectronApp();
    electronApp = ctx.electronApp;
    firstWindow = ctx.firstWindow;
    apiBaseUrl = ctx.apiBaseUrl;
    userDataDir = ctx.userDataDir;

    seededProject = await createProject(apiBaseUrl, {
      name: "Flow Run Project",
      localPath: `${userDataDir}/workspace/flow-run-project`,
    });
  });

  test.afterEach(async () => {
    await stopElectronApp(electronApp, userDataDir);
  });

  test("user can create a new flow", async () => {
    await firstWindow.click(locators.FLOWS_LINK);
    await firstWindow.click(locators.NEW_FLOW_BUTTON);
    await expect(firstWindow.locator(locators.FLOW_FORM_MODAL)).toBeVisible();

    await firstWindow.fill(locators.FLOW_NAME_INPUT, "News Fetcher");
    await firstWindow.selectOption(locators.FLOW_PROJECT_SELECT, { label: "Flow Run Project" });
    await firstWindow.click(locators.SUBMIT_FLOW_BUTTON);

    // Expected: modal closes and flow card appears in the list
    await expect(firstWindow.locator(locators.FLOW_FORM_MODAL)).not.toBeVisible();
    await expect(firstWindow.locator(locators.FLOW_CARD).filter({ hasText: "News Fetcher" })).toBeVisible();
  });

  test("Flow Editor renders node palette and canvas", async () => {
    await firstWindow.click(locators.FLOWS_LINK);
    await firstWindow.click(locators.NEW_FLOW_BUTTON);
    await firstWindow.fill(locators.FLOW_NAME_INPUT, "Editor Test Flow");
    await firstWindow.selectOption(locators.FLOW_PROJECT_SELECT, { label: "Flow Run Project" });
    await firstWindow.click(locators.SUBMIT_FLOW_BUTTON);

    await firstWindow.locator(locators.FLOW_CARD).filter({ hasText: "Editor Test Flow" }).click();
    await expect(firstWindow.locator(locators.FLOW_EDITOR_PAGE)).toBeVisible();
    await expect(firstWindow.locator(locators.NODE_PALETTE)).toBeVisible();
    await expect(firstWindow.locator(locators.FLOW_CANVAS)).toBeVisible();

    // Node palette categories for MVP: Trigger, logic, loop
    await expect(firstWindow.getByText("Trigger")).toBeVisible();
    await expect(firstWindow.getByText("logic")).toBeVisible();
    await expect(firstWindow.getByText("loop")).toBeVisible();
  });

  test("selecting a node shows properties panel", async () => {
    await firstWindow.click(locators.FLOWS_LINK);
    await firstWindow.click(locators.NEW_FLOW_BUTTON);
    await firstWindow.fill(locators.FLOW_NAME_INPUT, "Properties Test Flow");
    await firstWindow.selectOption(locators.FLOW_PROJECT_SELECT, { label: "Flow Run Project" });
    await firstWindow.click(locators.SUBMIT_FLOW_BUTTON);

    await firstWindow.locator(locators.FLOW_CARD).filter({ hasText: "Properties Test Flow" }).click();
    await expect(firstWindow.locator(locators.PROPERTIES_PANEL)).toContainText("Select a node to edit");

    // Add a node by clicking its category in the palette.
    await firstWindow.getByText("logic").click();
    await expect(firstWindow.locator(locators.FLOW_NODE)).toHaveCount(1);
    await firstWindow.locator(locators.FLOW_NODE).first().click();
    await expect(firstWindow.locator(locators.PROPERTIES_PANEL)).not.toContainText("Select a node to edit");
    await expect(firstWindow.locator(locators.PROPERTIES_PANEL)).toBeVisible();
  });

  test("Run button creates an execution", async () => {
    await firstWindow.click(locators.FLOWS_LINK);
    await firstWindow.click(locators.NEW_FLOW_BUTTON);
    await firstWindow.fill(locators.FLOW_NAME_INPUT, "Runnable Flow");
    await firstWindow.selectOption(locators.FLOW_PROJECT_SELECT, { label: "Flow Run Project" });
    await firstWindow.click(locators.SUBMIT_FLOW_BUTTON);

    await firstWindow.locator(locators.FLOW_CARD).filter({ hasText: "Runnable Flow" }).click();
    await firstWindow.click(locators.RUN_FLOW_BUTTON);

    // Expected: navigate to Tasks/Executions and a new execution row appears
    await firstWindow.click(locators.TASKS_LINK);
    await firstWindow.click(locators.EXECUTIONS_TAB);
    await expect(firstWindow.locator(locators.EXECUTION_ROW).first()).toBeVisible();
  });

  test("zoom controls adjust canvas view", async () => {
    await firstWindow.click(locators.FLOWS_LINK);
    await firstWindow.click(locators.NEW_FLOW_BUTTON);
    await firstWindow.fill(locators.FLOW_NAME_INPUT, "Zoom Test Flow");
    await firstWindow.selectOption(locators.FLOW_PROJECT_SELECT, { label: "Flow Run Project" });
    await firstWindow.click(locators.SUBMIT_FLOW_BUTTON);

    await firstWindow.locator(locators.FLOW_CARD).filter({ hasText: "Zoom Test Flow" }).click();
    const viewport = firstWindow.locator(".react-flow__viewport");
    await expect(viewport).toBeVisible();

    const getScale = async () => {
      const transform = await viewport.evaluate((el) => el.style.transform);
      const match = transform.match(/scale\(([^)]+)\)/);
      return match ? parseFloat(match[1]) : 1;
    };

    const initialScale = await getScale();

    await firstWindow.click(locators.ZOOM_IN_BUTTON);
    const zoomedInScale = await getScale();
    expect(zoomedInScale).toBeGreaterThan(initialScale);

    await firstWindow.click(locators.ZOOM_OUT_BUTTON);
    const zoomedOutScale = await getScale();
    expect(zoomedOutScale).toBeLessThan(zoomedInScale);

    await firstWindow.click(locators.ZOOM_RESET_BUTTON);
    const resetScale = await getScale();
    expect(resetScale).toBeCloseTo(initialScale, 1);
  });

  test("user can delete a flow with confirmation", async () => {
    await firstWindow.click(locators.FLOWS_LINK);
    await firstWindow.click(locators.NEW_FLOW_BUTTON);
    await firstWindow.fill(locators.FLOW_NAME_INPUT, "Delete Me Flow");
    await firstWindow.selectOption(locators.FLOW_PROJECT_SELECT, { label: "Flow Run Project" });
    await firstWindow.click(locators.SUBMIT_FLOW_BUTTON);

    const flowCard = firstWindow.locator(locators.FLOW_CARD).filter({ hasText: "Delete Me Flow" });
    await flowCard.locator(locators.FLOW_DELETE_BUTTON).click();

    await expect(firstWindow.locator(locators.CONFIRM_DIALOG)).toBeVisible();
    await firstWindow.click(locators.CONFIRM_OK_BUTTON);
    await expect(firstWindow.locator(locators.CONFIRM_DIALOG)).not.toBeVisible();
    await expect(flowCard).not.toBeVisible();
  });

  test("execution detail shows Logs / Variables / Output tabs", async () => {
    // Seed a flow and execution via API so the detail view has data without UI setup.
    const flow = await createFlow(apiBaseUrl, {
      name: "Detail Flow",
      projectId: seededProject.id,
    });
    await createExecution(apiBaseUrl, { projectId: seededProject.id, flowId: flow.id });

    await firstWindow.click(locators.TASKS_LINK);
    await firstWindow.click(locators.EXECUTIONS_TAB);
    await firstWindow.locator(locators.EXECUTION_ROW).first().click();

    await expect(firstWindow.locator(locators.EXECUTION_DETAIL_PANEL)).toBeVisible();
    await expect(firstWindow.locator(locators.LOGS_TAB)).toBeVisible();
    await expect(firstWindow.locator(locators.VARIABLES_TAB)).toBeVisible();
    await expect(firstWindow.locator(locators.OUTPUT_TAB)).toBeVisible();
  });
});
