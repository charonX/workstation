// REQ-TRACE: REQ-FLOW-026
// REQ-VERSION: v1-hash:faea1df8
// CAPABILITY-TRACE: flow-orchestration
// ENTITY-TRACE: flow
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: false

const { test, expect } = require("@playwright/test");
const { startElectronApp, stopElectronApp } = require("../../../../../e2e/fixtures/electronApp.cjs");
const { createProject } = require("../../../../../e2e/helpers/seed.cjs");
const {
  REMOVE_VARIABLE_BUTTON,
  openFlowInEditor,
  nodeById,
  saveFlow,
  openVariablePicker,
} = require("../../../../../e2e/helpers/flowEditor.cjs");

test.describe("REQ-FLOW-026 悬空引用前端行为", () => {
  let electronApp;
  let firstWindow;
  let apiBaseUrl;
  let userDataDir;
  let project;

  test.beforeAll(async () => {
    const ctx = await startElectronApp();
    electronApp = ctx.electronApp;
    firstWindow = ctx.firstWindow;
    apiBaseUrl = ctx.apiBaseUrl;
    userDataDir = ctx.userDataDir;
    project = await createProject(apiBaseUrl, {
      name: "Dangling Reference Project",
      localPath: `${userDataDir}/workspace/dangling-reference-project`,
    });
  });

  test.afterAll(async () => {
    await stopElectronApp(electronApp, userDataDir);
  });

  test("上游删除或重命名变量后，下游保存时不做强制阻断", async () => {
    // 行为：上游变量删除后，下游节点配置仍可保存
    await openFlowInEditor(firstWindow, apiBaseUrl, {
      projectId: project.id,
      name: "Dangling Save Flow",
      nodes: [
        {
          id: "n1",
          type: "trigger",
          name: "Start",
          position: { x: 80, y: 120 },
          config: {
            outputVariables: [{ name: "deletedVar", type: "string", defaultValue: "" }],
          },
        },
        {
          id: "n2",
          type: "condition",
          name: "Check",
          position: { x: 460, y: 120 },
          config: { expression: "n1.deletedVar > 1" },
        },
      ],
      edges: [{ id: "e1", sourceNodeId: "n1", targetNodeId: "n2" }],
    });

    // 删除上游变量（下游表达式仍引用 n1.deletedVar）
    await nodeById(firstWindow, "n1").click();
    await firstWindow.locator(REMOVE_VARIABLE_BUTTON).click();

    // 保存不应被阻断
    await saveFlow(firstWindow);
    await expect(firstWindow.getByText(/cannot save/i)).not.toBeVisible();
  });

  test("前端变量选择器实时刷新，删除后不再显示已删除变量", async () => {
    // 行为：上游变量删除后，变量选择器列表实时更新
    await openFlowInEditor(firstWindow, apiBaseUrl, {
      projectId: project.id,
      name: "Dangling Picker Flow",
      nodes: [
        {
          id: "n1",
          type: "trigger",
          name: "Start",
          position: { x: 80, y: 120 },
          config: {
            outputVariables: [{ name: "deletedVar", type: "string", defaultValue: "" }],
          },
        },
        {
          id: "n2",
          type: "condition",
          name: "Check",
          position: { x: 460, y: 120 },
          config: { expression: "1 > 0" },
        },
      ],
      edges: [{ id: "e1", sourceNodeId: "n1", targetNodeId: "n2" }],
    });

    // 前置确认：变量选择器能看到该变量
    await nodeById(firstWindow, "n2").click();
    let dropdown = await openVariablePicker(firstWindow);
    await expect(dropdown.getByText("deletedVar")).toBeVisible();
    await firstWindow.getByRole("button", { name: /insert variable/i }).click();

    // 删除变量
    await nodeById(firstWindow, "n1").click();
    await firstWindow.locator(REMOVE_VARIABLE_BUTTON).click();

    // 打开变量选择器
    await nodeById(firstWindow, "n2").click();
    dropdown = await openVariablePicker(firstWindow);

    await expect(firstWindow.getByText("deletedVar")).not.toBeVisible();
  });
});
