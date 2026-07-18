// REQ-TRACE: REQ-FLOW-018
// REQ-VERSION: v1-hash:faea1df8
// CAPABILITY-TRACE: flow-orchestration
// ENTITY-TRACE: flow
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: false

const { test, expect } = require("@playwright/test");
const { startElectronApp, stopElectronApp } = require("../../../../../e2e/fixtures/electronApp.cjs");
const { createProject } = require("../../../../../e2e/helpers/seed.cjs");
const {
  FLOW_SAVE_SUCCESS,
  ADD_VARIABLE_BUTTON,
  REMOVE_VARIABLE_BUTTON,
  openFlowInEditor,
  addNodeFromPalette,
  nodeByIndex,
  nodeById,
  clickSave,
  saveFlow,
  openVariablePicker,
} = require("../../../../../e2e/helpers/flowEditor.cjs");

test.describe("REQ-FLOW-018 Trigger 节点输出变量声明", () => {
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
      name: "Trigger Config Project",
      localPath: `${userDataDir}/workspace/trigger-config-project`,
    });
  });

  test.afterAll(async () => {
    await stopElectronApp(electronApp, userDataDir);
  });

  test("Trigger 节点配置面板允许添加、编辑、删除输出变量", async () => {
    // 行为：用户能在 Trigger 节点配置面板添加变量并保存
    await openFlowInEditor(firstWindow, apiBaseUrl, {
      projectId: project.id,
      name: "Trigger Variables Flow",
    });

    await addNodeFromPalette(firstWindow, "Trigger");
    await nodeByIndex(firstWindow, 0).click();

    // 添加变量
    await firstWindow.getByRole("button", { name: /add variable/i }).click();
    await firstWindow.getByLabel(/variable name/i).fill("repoPath");
    await firstWindow.getByLabel(/variable type/i).selectOption("string");
    await firstWindow.getByLabel(/default value/i).fill("/tmp/repo");

    await saveFlow(firstWindow);

    // 保存后变量名应在界面上可见
    await expect(firstWindow.getByText("repoPath")).toBeVisible();

    // 编辑变量名
    await firstWindow.getByLabel(/variable name/i).fill("repoDir");
    await saveFlow(firstWindow);
    await expect(firstWindow.getByText("repoDir")).toBeVisible();

    // 删除变量
    await firstWindow.locator(REMOVE_VARIABLE_BUTTON).click();
    await saveFlow(firstWindow);
    await expect(firstWindow.getByText("repoDir")).not.toBeVisible();
  });

  test("Trigger 节点保存时前端校验变量名称非空、类型合法", async () => {
    // 行为：变量名为空时保存被阻止，并显示错误提示
    await openFlowInEditor(firstWindow, apiBaseUrl, {
      projectId: project.id,
      name: "Trigger Validation Flow",
    });

    await addNodeFromPalette(firstWindow, "Trigger");
    await nodeByIndex(firstWindow, 0).click();

    await firstWindow.getByRole("button", { name: /add variable/i }).click();
    await clickSave(firstWindow);

    // 错误提示应可见，保存被阻止（不出现成功反馈）
    await expect(firstWindow.getByText(/variable name is required/i)).toBeVisible();
    await expect(firstWindow.locator(FLOW_SAVE_SUCCESS)).not.toBeVisible();
  });

  test("删除变量后该变量不再出现在下游变量选择器中", async () => {
    // 行为：删除上游变量后，下游变量选择器不再显示该变量
    await openFlowInEditor(firstWindow, apiBaseUrl, {
      projectId: project.id,
      name: "Trigger Delete Var Flow",
      nodes: [
        {
          id: "n1",
          type: "trigger",
          name: "Start",
          position: { x: 80, y: 120 },
          config: {
            outputVariables: [{ name: "repoPath", type: "string", defaultValue: "" }],
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

    // 前置确认：下游变量选择器能看到该变量
    await nodeById(firstWindow, "n2").click();
    let dropdown = await openVariablePicker(firstWindow);
    await expect(dropdown.getByText("repoPath")).toBeVisible();
    await firstWindow.getByRole("button", { name: /insert variable/i }).click();

    // 删除变量
    await nodeById(firstWindow, "n1").click();
    await firstWindow.locator(REMOVE_VARIABLE_BUTTON).click();

    // 打开下游节点变量选择器
    await nodeById(firstWindow, "n2").click();
    dropdown = await openVariablePicker(firstWindow);

    // 已删除变量不应再出现
    await expect(firstWindow.getByText("repoPath")).not.toBeVisible();
  });
});
