// REQ-TRACE: codex-harness-desktop/REQ-FLOW-013, REQ-FLOW-014, REQ-FLOW-015
// REQ-VERSION: v1-hash:f12220372b41cbed0bfddcb26a76fc3b0429c542234e5e8c8403a4830026f352
// CAPABILITY-TRACE: flow-orchestration
// ENTITY-TRACE: flow
// BUG-TRACE: BUG-010
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: false

const { test, expect } = require("@playwright/test");
const { startElectronApp, stopElectronApp } = require("../../../../../e2e/fixtures/electronApp.cjs");
const { createProject, createFlow } = require("../../../../../e2e/helpers/seed.cjs");
const locators = require("../../../../../e2e/helpers/locators.cjs");

test.describe("Flow Editor Node Design", () => {
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

  async function openNewFlow(name) {
    const project = await createProject(apiBaseUrl, {
      name: "Flow Editor Node Project",
      localPath: `${userDataDir}/workspace/flow-editor-node-project`,
    });

    await firstWindow.click(locators.FLOWS_LINK);
    await firstWindow.click(locators.NEW_FLOW_BUTTON);
    await expect(firstWindow.locator(locators.FLOW_FORM_MODAL)).toBeVisible();

    await firstWindow.fill(locators.FLOW_NAME_INPUT, name);
    await firstWindow.selectOption(locators.FLOW_PROJECT_SELECT, { label: project.name });
    await firstWindow.click(locators.SUBMIT_FLOW_BUTTON);

    await expect(firstWindow.locator(locators.FLOW_FORM_MODAL)).not.toBeVisible();
    await firstWindow.locator(locators.FLOW_CARD).filter({ hasText: name }).click();
    await expect(firstWindow.locator(locators.FLOW_EDITOR_PAGE)).toBeVisible();
    return project;
  }

  test("REQ-FLOW-013: user can delete a selected node and its connected edges", async () => {
    await openNewFlow("Delete Node Flow");

    // Add two nodes and connect them.
    await firstWindow.getByText("Execution").click();
    await firstWindow.getByText("Execution").click();
    await expect(firstWindow.locator(locators.FLOW_NODE)).toHaveCount(2);

    const nodes = firstWindow.locator(locators.FLOW_NODE);
    const sourceHandle = nodes.first().locator(".react-flow__handle-right");
    const targetHandle = nodes.nth(1).locator(".react-flow__handle-left");
    await sourceHandle.dragTo(targetHandle);
    await expect(firstWindow.locator(".react-flow__edge")).toHaveCount(1);

    // Select first node and delete it.
    await nodes.first().click();
    await firstWindow.click(locators.NODE_DELETE_BUTTON);

    // Expected: node removed and connected edge removed.
    await expect(firstWindow.locator(locators.FLOW_NODE)).toHaveCount(1);
    await expect(firstWindow.locator(".react-flow__edge")).toHaveCount(0);

    // Save and reload; deletion persists.
    await firstWindow.getByRole("button", { name: "Save" }).click();
    await firstWindow.reload();
    await expect(firstWindow.locator(locators.FLOW_NODE)).toHaveCount(1);
    await expect(firstWindow.locator(".react-flow__edge")).toHaveCount(0);
  });

  test("REQ-FLOW-014: Agent node config persists after save and reload", async () => {
    await openNewFlow("Agent Config Flow");

    await firstWindow.getByText("Execution").click();
    await expect(firstWindow.locator(locators.FLOW_NODE)).toHaveCount(1);

    await firstWindow.locator(locators.FLOW_NODE).first().click();

    // Edit node-specific fields in the Properties panel.
    await firstWindow.fill(locators.NODE_NAME_INPUT, "Fetch Headlines");
    await firstWindow.selectOption(locators.AGENT_MODEL_SELECT, { label: "Codex" });
    await firstWindow.fill(locators.AGENT_SYSTEM_PROMPT_TEXTAREA, "Summarize top tech news.");
    await firstWindow.fill(locators.NODE_OUTPUT_VARIABLE_INPUT, "headlines");

    await firstWindow.getByRole("button", { name: "Save" }).click();
    await firstWindow.reload();

    await firstWindow.locator(locators.FLOW_NODE).first().click();
    await expect(firstWindow.locator(locators.NODE_NAME_INPUT)).toHaveValue("Fetch Headlines");
    await expect(firstWindow.locator(locators.AGENT_MODEL_SELECT)).toHaveValue("codex");
    await expect(firstWindow.locator(locators.AGENT_SYSTEM_PROMPT_TEXTAREA)).toHaveValue("Summarize top tech news.");
    await expect(firstWindow.locator(locators.NODE_OUTPUT_VARIABLE_INPUT)).toHaveValue("headlines");
  });

  test("REQ-FLOW-014: Condition node expression and outputVariable persist", async () => {
    await openNewFlow("Condition Config Flow");

    await firstWindow.getByText("Condition").click();
    await expect(firstWindow.locator(locators.FLOW_NODE)).toHaveCount(1);

    await firstWindow.locator(locators.FLOW_NODE).first().click();
    await firstWindow.fill(locators.NODE_NAME_INPUT, "Has News?");
    await firstWindow.fill(locators.CONDITION_EXPRESSION_INPUT, "headlines.length > 0");
    await firstWindow.fill(locators.NODE_OUTPUT_VARIABLE_INPUT, "hasNews");

    await firstWindow.getByRole("button", { name: "Save" }).click();
    await firstWindow.reload();

    await firstWindow.locator(locators.FLOW_NODE).first().click();
    await expect(firstWindow.locator(locators.NODE_NAME_INPUT)).toHaveValue("Has News?");
    await expect(firstWindow.locator(locators.CONDITION_EXPRESSION_INPUT)).toHaveValue("headlines.length > 0");
    await expect(firstWindow.locator(locators.NODE_OUTPUT_VARIABLE_INPUT)).toHaveValue("hasNews");
  });

  test("REQ-FLOW-014: ForEach and While node configs persist", async () => {
    await openNewFlow("Loop Config Flow");

    // ForEach
    await firstWindow.getByText("ForEach").click();
    await firstWindow.locator(locators.FLOW_NODE).first().click();
    await firstWindow.fill(locators.NODE_NAME_INPUT, "Iterate Headlines");
    await firstWindow.fill(locators.FOREACH_ARRAY_INPUT, "headlines");
    await firstWindow.fill(locators.NODE_OUTPUT_VARIABLE_INPUT, "headline");

    // While
    await firstWindow.getByText("While").click();
    const nodes = firstWindow.locator(locators.FLOW_NODE);
    await nodes.nth(1).click();
    await firstWindow.fill(locators.NODE_NAME_INPUT, "Keep Running");
    await firstWindow.fill(locators.WHILE_EXPRESSION_INPUT, "context.iteration < 3");
    await firstWindow.fill(locators.NODE_OUTPUT_VARIABLE_INPUT, "iterationResult");

    await firstWindow.getByRole("button", { name: "Save" }).click();
    await firstWindow.reload();

    // Verify ForEach persisted.
    await nodes.first().click();
    await expect(firstWindow.locator(locators.NODE_NAME_INPUT)).toHaveValue("Iterate Headlines");
    await expect(firstWindow.locator(locators.FOREACH_ARRAY_INPUT)).toHaveValue("headlines");
    await expect(firstWindow.locator(locators.NODE_OUTPUT_VARIABLE_INPUT)).toHaveValue("headline");

    // Verify While persisted.
    await nodes.nth(1).click();
    await expect(firstWindow.locator(locators.NODE_NAME_INPUT)).toHaveValue("Keep Running");
    await expect(firstWindow.locator(locators.WHILE_EXPRESSION_INPUT)).toHaveValue("context.iteration < 3");
    await expect(firstWindow.locator(locators.NODE_OUTPUT_VARIABLE_INPUT)).toHaveValue("iterationResult");
  });

  test("REQ-FLOW-014: Output node path persists", async () => {
    await openNewFlow("Output Config Flow");

    await firstWindow.getByText("Output").click();
    await firstWindow.locator(locators.FLOW_NODE).first().click();
    await firstWindow.fill(locators.NODE_NAME_INPUT, "Save Output");
    await firstWindow.fill(locators.OUTPUT_PATH_INPUT, "./output/daily-news.md");

    await firstWindow.getByRole("button", { name: "Save" }).click();
    await firstWindow.reload();

    await firstWindow.locator(locators.FLOW_NODE).first().click();
    await expect(firstWindow.locator(locators.NODE_NAME_INPUT)).toHaveValue("Save Output");
    await expect(firstWindow.locator(locators.OUTPUT_PATH_INPUT)).toHaveValue("./output/daily-news.md");
  });

  test("REQ-FLOW-015: Condition node has true and false source handles", async () => {
    await openNewFlow("Condition Branch Flow");

    // Add one Condition node and two Agent nodes.
    await firstWindow.getByText("Condition").click();
    await firstWindow.getByText("Agent").click();
    await firstWindow.getByText("Agent").click();
    await expect(firstWindow.locator(locators.FLOW_NODE)).toHaveCount(3);

    const conditionNode = firstWindow.locator(locators.FLOW_NODE).first();
    const trueTarget = firstWindow.locator(locators.FLOW_NODE).nth(1);
    const falseTarget = firstWindow.locator(locators.FLOW_NODE).nth(2);

    // React Flow exposes handles with data-handleid.
    const trueHandle = conditionNode.locator("[data-handleid='true']");
    const falseHandle = conditionNode.locator("[data-handleid='false']");
    await expect(trueHandle).toBeVisible();
    await expect(falseHandle).toBeVisible();

    // Connect true branch and false branch.
    await trueHandle.dragTo(trueTarget.locator(".react-flow__handle-left"));
    await falseHandle.dragTo(falseTarget.locator(".react-flow__handle-left"));
    await expect(firstWindow.locator(".react-flow__edge")).toHaveCount(2);

    // Save and reload; edges remain connected to the correct handles.
    await firstWindow.getByRole("button", { name: "Save" }).click();
    await firstWindow.reload();
    await expect(firstWindow.locator(locators.FLOW_NODE)).toHaveCount(3);
    await expect(firstWindow.locator(".react-flow__edge")).toHaveCount(2);
  });
});
