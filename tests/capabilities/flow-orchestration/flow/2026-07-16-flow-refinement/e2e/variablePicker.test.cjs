// REQ-TRACE: REQ-FLOW-022
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
  openVariablePicker,
} = require("../../../../../e2e/helpers/flowEditor.cjs");

function seedNodes(variables) {
  return [
    {
      id: "n1",
      type: "trigger",
      name: "Start",
      position: { x: 80, y: 120 },
      config: { outputVariables: variables },
    },
    {
      id: "n2",
      type: "condition",
      name: "Check",
      position: { x: 460, y: 120 },
      config: { expression: "1 > 0" },
    },
  ];
}

const SEED_EDGES = [{ id: "e1", sourceNodeId: "n1", targetNodeId: "n2" }];

test.describe("REQ-FLOW-022 变量选择器按节点分组展示", () => {
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
      name: "Variable Picker Project",
      localPath: `${userDataDir}/workspace/variable-picker-project`,
    });
  });

  test.afterAll(async () => {
    await stopElectronApp(electronApp, userDataDir);
  });

  test("变量选择器下拉列表按上游节点分组显示", async () => {
    // 行为：变量选择器按上游节点分组展示可用变量
    await openFlowInEditor(firstWindow, apiBaseUrl, {
      projectId: project.id,
      name: "Picker Groups Flow",
      nodes: seedNodes([
        { name: "count", type: "number", defaultValue: 3 },
        { name: "input", type: "string", defaultValue: "hi" },
      ]),
      edges: SEED_EDGES,
    });

    await nodeById(firstWindow, "n2").click();
    const dropdown = await openVariablePicker(firstWindow);

    // 分组标题和变量名应可见
    await expect(dropdown.getByText("Start")).toBeVisible();
    await expect(dropdown.getByText("count")).toBeVisible();
  });

  test("变量条目显示友好名称和类型标签", async () => {
    // 行为：变量选择器中的每个条目显示变量名和类型
    await openFlowInEditor(firstWindow, apiBaseUrl, {
      projectId: project.id,
      name: "Picker Type Labels Flow",
      nodes: seedNodes([
        { name: "count", type: "number", defaultValue: 3 },
        { name: "input", type: "string", defaultValue: "hi" },
      ]),
      edges: SEED_EDGES,
    });

    await nodeById(firstWindow, "n2").click();
    const dropdown = await openVariablePicker(firstWindow);

    await expect(dropdown.getByText("string")).toBeVisible();
    await expect(dropdown.getByText("number")).toBeVisible();
  });

  test("选中变量后输入框自动插入 fullName", async () => {
    // 行为：选择变量后自动插入 fullName 到当前输入框
    await openFlowInEditor(firstWindow, apiBaseUrl, {
      projectId: project.id,
      name: "Picker Insert Flow",
      nodes: seedNodes([
        { name: "count", type: "number", defaultValue: 3 },
        { name: "input", type: "string", defaultValue: "hi" },
      ]),
      edges: SEED_EDGES,
    });

    await nodeById(firstWindow, "n2").click();
    await firstWindow.getByLabel("Expression").fill("");
    const dropdown = await openVariablePicker(firstWindow);
    await dropdown.getByText("count").click();

    await expect(firstWindow.getByLabel("Expression")).toHaveValue(/n1\.count/);
  });

  test("上游删除或重命名变量后变量选择器列表实时刷新", async () => {
    // 行为：上游变量变更后，变量选择器列表实时更新
    await openFlowInEditor(firstWindow, apiBaseUrl, {
      projectId: project.id,
      name: "Picker Refresh Flow",
      nodes: seedNodes([{ name: "deletedVar", type: "string", defaultValue: "" }]),
      edges: SEED_EDGES,
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

    // 已删除变量不应再出现
    await expect(firstWindow.getByText("deletedVar")).not.toBeVisible();
  });
});
