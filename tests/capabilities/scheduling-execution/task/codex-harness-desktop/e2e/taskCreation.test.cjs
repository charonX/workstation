// REQ-TRACE: codex-harness-desktop/REQ-SCHEDULE-005
// REQ-VERSION: v1-hash:c4549c262b3062f8d215c299e057564fbed83e990064ab4153b82cbbf7c40b54
// CAPABILITY-TRACE: scheduling-execution
// ENTITY-TRACE: task
// BUG-TRACE: BUG-011
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true

const { test, expect } = require("@playwright/test");
const { startElectronApp, stopElectronApp } = require("../../../../../e2e/fixtures/electronApp.cjs");
const { createProject, createFlow } = require("../../../../../e2e/helpers/seed.cjs");
const locators = require("../../../../../e2e/helpers/locators.cjs");

test.describe("Tasks Page New Task UI", () => {
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
  });

  test.afterEach(async () => {
    await stopElectronApp(electronApp, userDataDir);
  });

  async function seedProjectAndFlow() {
    const project = await createProject(apiBaseUrl, {
      name: "Task UI Project",
      localPath: `${userDataDir}/workspace/task-ui-project`,
    });
    const flow = await createFlow(apiBaseUrl, {
      name: "Task UI Flow",
      projectId: project.id,
    });
    return { project, flow };
  }

  test("REQ-SCHEDULE-005: Tasks page shows New Task button and modal", async () => {
    await firstWindow.click(locators.TASKS_LINK);
    await expect(firstWindow.locator(locators.NEW_TASK_BUTTON)).toBeVisible();

    await firstWindow.click(locators.NEW_TASK_BUTTON);
    await expect(firstWindow.locator(locators.NEW_TASK_MODAL)).toBeVisible();
    await expect(firstWindow.locator(locators.TASK_NAME_INPUT)).toBeVisible();
    await expect(firstWindow.locator(locators.TASK_PROJECT_SELECT)).toBeVisible();
    await expect(firstWindow.locator(locators.TASK_FLOW_SELECT)).toBeVisible();
    await expect(firstWindow.locator(locators.TASK_TRIGGER_MANUAL)).toBeVisible();
    await expect(firstWindow.locator(locators.TASK_TRIGGER_SCHEDULED)).toBeVisible();
    await expect(firstWindow.locator(locators.TASK_INPUT_VARIABLES_TEXTAREA)).toBeVisible();
  });

  test("REQ-SCHEDULE-005: manual trigger creates an execution from the UI", async () => {
    const { project, flow } = await seedProjectAndFlow();

    await firstWindow.click(locators.TASKS_LINK);
    await firstWindow.click(locators.NEW_TASK_BUTTON);
    await expect(firstWindow.locator(locators.NEW_TASK_MODAL)).toBeVisible();

    await firstWindow.fill(locators.TASK_NAME_INPUT, "Manual Run");
    await firstWindow.selectOption(locators.TASK_PROJECT_SELECT, { value: project.id });
    await firstWindow.selectOption(locators.TASK_FLOW_SELECT, { value: flow.id });
    await firstWindow.click(locators.TASK_TRIGGER_MANUAL);
    await firstWindow.fill(locators.TASK_INPUT_VARIABLES_TEXTAREA, '{"foo":"bar"}');

    await firstWindow.click(locators.SUBMIT_TASK_BUTTON);
    await expect(firstWindow.locator(locators.NEW_TASK_MODAL)).not.toBeVisible();

    // New execution appears in the executions list.
    await firstWindow.click(locators.EXECUTIONS_TAB);
    await expect(firstWindow.locator(locators.EXECUTION_ROW)).toHaveCount(1);
    await expect(firstWindow.locator(locators.EXECUTION_ROW).first()).toContainText(flow.name);
  });

  test("REQ-SCHEDULE-005: scheduled trigger creates a schedule from the UI", async () => {
    const { project, flow } = await seedProjectAndFlow();

    await firstWindow.click(locators.TASKS_LINK);
    await firstWindow.click(locators.NEW_TASK_BUTTON);
    await expect(firstWindow.locator(locators.NEW_TASK_MODAL)).toBeVisible();

    await firstWindow.fill(locators.TASK_NAME_INPUT, "Scheduled Run");
    await firstWindow.selectOption(locators.TASK_PROJECT_SELECT, { value: project.id });
    await firstWindow.selectOption(locators.TASK_FLOW_SELECT, { value: flow.id });
    await firstWindow.click(locators.TASK_TRIGGER_SCHEDULED);
    await expect(firstWindow.locator(locators.TASK_CRON_INPUT)).toBeVisible();
    await firstWindow.fill(locators.TASK_CRON_INPUT, "0 9 * * *");

    await firstWindow.click(locators.SUBMIT_TASK_BUTTON);
    await expect(firstWindow.locator(locators.NEW_TASK_MODAL)).not.toBeVisible();

    // Verify via API that a schedule was created.
    const res = await fetch(`${apiBaseUrl}/api/schedules`);
    expect(res.status).toBe(200);
    const schedules = await res.json();
    expect(schedules.some((s) => s.projectId === project.id && s.flowId === flow.id && s.cron === "0 9 * * *")).toBe(true);
  });

  test("REQ-SCHEDULE-005: missing project shows validation error", async () => {
    await firstWindow.click(locators.TASKS_LINK);
    await firstWindow.click(locators.NEW_TASK_BUTTON);
    await expect(firstWindow.locator(locators.NEW_TASK_MODAL)).toBeVisible();

    await firstWindow.fill(locators.TASK_NAME_INPUT, "No Project");
    await firstWindow.selectOption(locators.TASK_PROJECT_SELECT, { value: "" });
    await firstWindow.click(locators.TASK_TRIGGER_MANUAL);
    await firstWindow.click(locators.SUBMIT_TASK_BUTTON);

    // Modal stays open and shows an error.
    await expect(firstWindow.locator(locators.NEW_TASK_MODAL)).toBeVisible();
    await expect(firstWindow.locator("[data-testid='new-task-error']")).toBeVisible();
  });
});
