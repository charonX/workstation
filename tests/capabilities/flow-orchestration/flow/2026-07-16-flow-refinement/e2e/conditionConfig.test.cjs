// REQ-TRACE: REQ-FLOW-019
// REQ-VERSION: v1-hash:faea1df8
// CAPABILITY-TRACE: flow-orchestration
// ENTITY-TRACE: flow
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: false

const { test, expect } = require("@playwright/test");
const { startElectronApp, stopElectronApp } = require("../../../../../e2e/fixtures/electronApp.cjs");
const { createProject } = require("../../../../../e2e/helpers/seed.cjs");
const {
  openFlowInEditor,
  addNodeFromPalette,
  nodeByIndex,
  nodeById,
  clickSave,
  pickerDropdown,
  openVariablePicker,
} = require("../../../../../e2e/helpers/flowEditor.cjs");

test.describe("REQ-FLOW-019 Condition 节点表达式与 true/false 分支", () => {
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
      name: "Condition Config Project",
      localPath: `${userDataDir}/workspace/condition-config-project`,
    });
  });

  test.afterAll(async () => {
    await stopElectronApp(electronApp, userDataDir);
  });

  test("Condition 节点配置面板提供表达式输入框和变量选择器", async () => {
    // 行为：Condition 节点配置面板包含表达式输入框和变量选择器
    await openFlowInEditor(firstWindow, apiBaseUrl, {
      projectId: project.id,
      name: "Condition Panel Flow",
    });

    await addNodeFromPalette(firstWindow, "Condition");
    await nodeByIndex(firstWindow, 0).click();

    await expect(firstWindow.getByLabel("Expression")).toBeVisible();
    await expect(firstWindow.getByRole("button", { name: /insert variable/i })).toBeVisible();
  });

  test("Condition 节点画布上显示 true/false 两个输出端口", async () => {
    // 行为：画布上 Condition 节点有两个明确标识的输出端口
    await openFlowInEditor(firstWindow, apiBaseUrl, {
      projectId: project.id,
      name: "Condition Ports Flow",
      nodes: [
        {
          id: "n1",
          type: "condition",
          name: "Check",
          position: { x: 200, y: 120 },
          config: { expression: "1 > 0" },
        },
      ],
    });

    // true/false 端口应在画布上可见
    await expect(firstWindow.getByTestId("node-n1-output-true")).toBeVisible();
    await expect(firstWindow.getByTestId("node-n1-output-false")).toBeVisible();
  });

  test("Condition 节点保存时前端校验表达式非空", async () => {
    // 行为：表达式为空时保存被阻止，并显示错误提示
    await openFlowInEditor(firstWindow, apiBaseUrl, {
      projectId: project.id,
      name: "Condition Validation Flow",
    });

    await addNodeFromPalette(firstWindow, "Condition");
    await nodeByIndex(firstWindow, 0).click();

    await firstWindow.getByLabel("Expression").fill("");
    await clickSave(firstWindow);

    await expect(firstWindow.getByText(/expression is required/i)).toBeVisible();
  });

  test("变量选择器可从上游节点选择变量并插入 fullName", async () => {
    // 行为：用户能从变量选择器选择上游变量并插入到表达式
    await openFlowInEditor(firstWindow, apiBaseUrl, {
      projectId: project.id,
      name: "Condition Picker Flow",
      nodes: [
        {
          id: "n1",
          type: "trigger",
          name: "Start",
          position: { x: 80, y: 120 },
          config: {
            outputVariables: [{ name: "count", type: "number", defaultValue: 1 }],
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

    await nodeById(firstWindow, "n2").click();
    await firstWindow.getByLabel("Expression").fill("");
    const dropdown = await openVariablePicker(firstWindow);
    await dropdown.getByText("count").click();

    // 表达式输入框中应包含插入的 fullName
    await expect(firstWindow.getByLabel("Expression")).toHaveValue(/n1\.count/);
  });
});
