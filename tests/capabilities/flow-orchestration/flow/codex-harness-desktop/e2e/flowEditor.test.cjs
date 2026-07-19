// REQ-TRACE: codex-harness-desktop/REQ-FLOW-013, REQ-FLOW-014, REQ-FLOW-015, REQ-FLOW-016, REQ-FLOW-017
// REQ-VERSION: v1-hash:5d0bdb3d2786189d093861e7afc37e0431ca15d5e7ae871afd42b421bf45f108
// CAPABILITY-TRACE: flow-orchestration
// ENTITY-TRACE: flow
// BUG-TRACE: BUG-010, BUG-013
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
    await firstWindow.locator(locators.NODE_PALETTE).getByRole("button", { name: "Agent" }).click();
    await firstWindow.locator(locators.NODE_PALETTE).getByRole("button", { name: "Agent" }).click();
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
    await firstWindow.getByRole("button", { name: "Save", exact: true }).click();
    await firstWindow.reload();
    await expect(firstWindow.locator(locators.FLOW_NODE)).toHaveCount(1);
    await expect(firstWindow.locator(".react-flow__edge")).toHaveCount(0);
  });

  test("REQ-FLOW-014: Agent node config persists after save and reload", async () => {
    await openNewFlow("Agent Config Flow");

    await firstWindow.locator(locators.NODE_PALETTE).getByRole("button", { name: "Agent" }).click();
    await expect(firstWindow.locator(locators.FLOW_NODE)).toHaveCount(1);

    await firstWindow.locator(locators.FLOW_NODE).first().click();

    // Edit node-specific fields in the Properties panel.
    await firstWindow.fill(locators.NODE_NAME_INPUT, "Fetch Headlines");
    await firstWindow.fill(locators.AGENT_SYSTEM_PROMPT_TEXTAREA, "Summarize top tech news.");
    await firstWindow.fill(locators.NODE_OUTPUT_VARIABLE_INPUT, "headlines");

    await firstWindow.getByRole("button", { name: "Save", exact: true }).click();
    await firstWindow.reload();

    await firstWindow.locator(locators.FLOW_NODE).first().click();
    await expect(firstWindow.locator(locators.NODE_NAME_INPUT)).toHaveValue("Fetch Headlines");
    await expect(firstWindow.locator(locators.AGENT_SYSTEM_PROMPT_TEXTAREA)).toHaveValue("Summarize top tech news.");
    await expect(firstWindow.locator(locators.NODE_OUTPUT_VARIABLE_INPUT)).toHaveValue("headlines");
  });

  test("REQ-FLOW-014: Condition node expression and outputVariable persist", async () => {
    await openNewFlow("Condition Config Flow");

    await firstWindow.locator(locators.NODE_PALETTE).getByRole("button", { name: "Condition" }).click();
    await expect(firstWindow.locator(locators.FLOW_NODE)).toHaveCount(1);

    await firstWindow.locator(locators.FLOW_NODE).first().click();
    await firstWindow.fill(locators.NODE_NAME_INPUT, "Has News?");
    await firstWindow.fill(locators.CONDITION_EXPRESSION_INPUT, "headlines.length > 0");
    await firstWindow.fill(locators.NODE_OUTPUT_VARIABLE_INPUT, "hasNews");

    await firstWindow.getByRole("button", { name: "Save", exact: true }).click();
    await firstWindow.reload();

    await firstWindow.locator(locators.FLOW_NODE).first().click();
    await expect(firstWindow.locator(locators.NODE_NAME_INPUT)).toHaveValue("Has News?");
    await expect(firstWindow.locator(locators.CONDITION_EXPRESSION_INPUT)).toHaveValue("headlines.length > 0");
    await expect(firstWindow.locator(locators.NODE_OUTPUT_VARIABLE_INPUT)).toHaveValue("hasNews");
  });

  test("REQ-FLOW-014: ForEach and While node configs persist", async () => {
    await openNewFlow("Loop Config Flow");

    // ForEach
    await firstWindow.locator(locators.NODE_PALETTE).getByRole("button", { name: "ForEach" }).click();
    await firstWindow.locator(locators.FLOW_NODE).first().click();
    await firstWindow.fill(locators.NODE_NAME_INPUT, "Iterate Headlines");
    await firstWindow.fill(locators.FOREACH_ARRAY_INPUT, "headlines");
    await firstWindow.fill(locators.NODE_OUTPUT_VARIABLE_INPUT, "headline");

    // While
    await firstWindow.locator(locators.NODE_PALETTE).getByRole("button", { name: "While" }).click();
    const nodes = firstWindow.locator(locators.FLOW_NODE);
    await nodes.nth(1).locator(".flow-node-header").click();
    await firstWindow.fill(locators.NODE_NAME_INPUT, "Keep Running");
    await firstWindow.fill(locators.WHILE_EXPRESSION_INPUT, "context.iteration < 3");
    await firstWindow.fill(locators.NODE_OUTPUT_VARIABLE_INPUT, "iterationResult");

    await firstWindow.getByRole("button", { name: "Save", exact: true }).click();
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

    await firstWindow.locator(locators.NODE_PALETTE).getByRole("button", { name: "Output" }).click();
    await firstWindow.locator(locators.FLOW_NODE).first().click();
    await firstWindow.fill(locators.NODE_NAME_INPUT, "Save Output");
    await firstWindow.fill(locators.OUTPUT_PATH_INPUT, "./output/daily-news.md");

    await firstWindow.getByRole("button", { name: "Save", exact: true }).click();
    await firstWindow.reload();

    await firstWindow.locator(locators.FLOW_NODE).first().click();
    await expect(firstWindow.locator(locators.NODE_NAME_INPUT)).toHaveValue("Save Output");
    await expect(firstWindow.locator(locators.OUTPUT_PATH_INPUT)).toHaveValue("./output/daily-news.md");
  });

  test("REQ-FLOW-015: Condition node has true and false source handles", async () => {
    await openNewFlow("Condition Branch Flow");

    // Add one Condition node and two Agent nodes.
    await firstWindow.locator(locators.NODE_PALETTE).getByRole("button", { name: "Condition" }).click();
    await firstWindow.locator(locators.NODE_PALETTE).getByRole("button", { name: "Agent" }).click();
    await firstWindow.locator(locators.NODE_PALETTE).getByRole("button", { name: "Agent" }).click();
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

    // BUG-001（2026-07-17 用户确认 test-gap）：REQ-FLOW-019 v1.1 契约要求 condition
    // 必须有合法 expression 才能保存；本测试聚焦 handles 语义，补齐 setup 数据。
    await conditionNode.click();
    await firstWindow.fill(locators.CONDITION_EXPRESSION_INPUT, "1 > 0");

    // Save and reload; edges remain connected to the correct handles.
    await firstWindow.getByRole("button", { name: "Save", exact: true }).click();
    await firstWindow.reload();
    await expect(firstWindow.locator(locators.FLOW_NODE)).toHaveCount(3);
    await expect(firstWindow.locator(".react-flow__edge")).toHaveCount(2);
  });

  test("BUG-013: Save shows success feedback after saving", async () => {
    await openNewFlow("Save Feedback Flow");

    await firstWindow.locator(locators.NODE_PALETTE).getByRole("button", { name: "Agent" }).click();
    await expect(firstWindow.locator(locators.FLOW_NODE)).toHaveCount(1);

    await firstWindow.getByRole("button", { name: "Save", exact: true }).click();

    // After save completes, success feedback should appear.
    await expect(firstWindow.locator('[data-testid="flow-save-success"]')).toBeVisible();
  });

  test("REQ-FLOW-016: Publish button publishes the flow and shows published status", async () => {
    await openNewFlow("Publish UI Flow");

    await firstWindow.locator(locators.NODE_PALETTE).getByRole("button", { name: "Agent" }).click();
    await expect(firstWindow.locator(locators.FLOW_NODE)).toHaveCount(1);

    await firstWindow.getByRole("button", { name: "Save", exact: true }).click();
    await expect(firstWindow.locator('[data-testid="flow-save-success"]')).toBeVisible();

    await firstWindow.click(locators.PUBLISH_FLOW_BUTTON);
    await expect(firstWindow.locator(locators.FLOW_STATUS_BADGE)).toHaveText(/Published|已发布/);

    // Add a second node as a draft edit; published status should remain.
    await firstWindow.locator(locators.NODE_PALETTE).getByRole("button", { name: "Agent" }).click();
    await expect(firstWindow.locator(locators.FLOW_NODE)).toHaveCount(2);
    await expect(firstWindow.locator(locators.FLOW_STATUS_BADGE)).toHaveText(/Draft|草稿/);
  });

  test("REQ-FLOW-017: Debug button opens modal and shows execution-like output", async () => {
    await openNewFlow("Debug UI Flow");

    await firstWindow.locator(locators.NODE_PALETTE).getByRole("button", { name: "Agent" }).click();
    await firstWindow.locator(locators.FLOW_NODE).first().click();
    await firstWindow.fill(locators.NODE_NAME_INPUT, "Echo");

    // Query executions before debug.
    const beforeRes = await fetch(`${apiBaseUrl}/api/executions`);
    const before = await beforeRes.json();

    await firstWindow.click(locators.DEBUG_FLOW_BUTTON);
    await expect(firstWindow.locator(locators.DEBUG_MODAL)).toBeVisible();
    await expect(firstWindow.locator(locators.DEBUG_OUTPUT_PANEL)).not.toBeEmpty();

    await firstWindow.click(locators.DEBUG_CLOSE_BUTTON);
    await expect(firstWindow.locator(locators.DEBUG_MODAL)).not.toBeVisible();

    // No execution record should be created.
    const afterRes = await fetch(`${apiBaseUrl}/api/executions`);
    const after = await afterRes.json();
    expect(after.length).toBe(before.length);
  });
});
