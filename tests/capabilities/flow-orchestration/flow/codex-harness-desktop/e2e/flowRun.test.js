// REQ-TRACE: codex-harness-desktop/REQ-FLOW-002, REQ-FLOW-003, REQ-FLOW-004, REQ-FLOW-005, REQ-SCHEDULE-001, REQ-SCHEDULE-003
// REQ-VERSION: v1-hash:d430fc9129f2087e72c0880464a7bd5430c420753cace446dc54475760bc46c1
// CAPABILITY-TRACE: flow-orchestration, scheduling-execution
// ENTITY-TRACE: flow, task
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: false

const { test, expect } = require("@playwright/test");
const { startElectronApp, stopElectronApp } = require("../../../../../e2e/fixtures/electronApp");
const { createProject } = require("../../../../../e2e/helpers/seed");
const locators = require("../../../../../e2e/helpers/locators");

test.describe("Flow Run", () => {
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

    // Seed a project so the flow creation form has a project to choose.
    // TODO: HUMAN ASSERTION — verify project body matches API contract
    await createProject(apiBaseUrl, {
      name: "Flow Run Project",
      localPath: "/tmp/opc-workspace/flow-run-project",
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

    // TODO: HUMAN ASSERTION — confirm node categories expected in palette
    await expect(firstWindow.getByText("Agent")).toBeVisible();
    await expect(firstWindow.getByText("Logic")).toBeVisible();
  });

  test("selecting a node shows properties panel", async () => {
    await firstWindow.click(locators.FLOWS_LINK);
    await firstWindow.click(locators.NEW_FLOW_BUTTON);
    await firstWindow.fill(locators.FLOW_NAME_INPUT, "Properties Test Flow");
    await firstWindow.selectOption(locators.FLOW_PROJECT_SELECT, { label: "Flow Run Project" });
    await firstWindow.click(locators.SUBMIT_FLOW_BUTTON);

    await firstWindow.locator(locators.FLOW_CARD).filter({ hasText: "Properties Test Flow" }).click();
    await expect(firstWindow.locator(locators.PROPERTIES_PANEL)).toContainText("Select a node to edit");

    // TODO: HUMAN ASSERTION — confirm how to add a node (drag from palette or click)
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
    await expect(firstWindow.locator(locators.FLOW_CANVAS)).toBeVisible();

    // TODO: HUMAN ASSERTION — assert on a measurable side effect of zoom (e.g. transform scale)
    await firstWindow.click(locators.ZOOM_IN_BUTTON);
    await firstWindow.click(locators.ZOOM_OUT_BUTTON);
    await firstWindow.click(locators.ZOOM_RESET_BUTTON);
    await expect(firstWindow.locator(locators.FLOW_CANVAS)).toBeVisible();
  });

  test("execution detail shows Logs / Variables / Output tabs", async () => {
    // Seed a flow and execution via API to avoid setup clicks.
    // TODO: HUMAN ASSERTION — verify bodies match API contract
    const flow = await createFlow(apiBaseUrl, {
      name: "Detail Flow",
      projectId: "TODO", // TODO: HUMAN ASSERTION — use real project id from seeded project
    });
    await createExecution(apiBaseUrl, { projectId: flow.projectId, flowId: flow.id });

    await firstWindow.click(locators.TASKS_LINK);
    await firstWindow.click(locators.EXECUTIONS_TAB);
    await firstWindow.locator(locators.EXECUTION_ROW).first().click();

    await expect(firstWindow.locator(locators.EXECUTION_DETAIL_PANEL)).toBeVisible();
    await expect(firstWindow.locator(locators.LOGS_TAB)).toBeVisible();
    await expect(firstWindow.locator(locators.VARIABLES_TAB)).toBeVisible();
    await expect(firstWindow.locator(locators.OUTPUT_TAB)).toBeVisible();
  });
});
