// REQ-TRACE: REQ-FLOW-020
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
  saveFlow,
  openVariablePicker,
} = require("../../../../../e2e/helpers/flowEditor.cjs");

test.describe("REQ-FLOW-020 Claude Agent 节点配置面板", () => {
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
      name: "Agent Config Project",
      localPath: `${userDataDir}/workspace/agent-config-project`,
    });
  });

  test.afterAll(async () => {
    await stopElectronApp(electronApp, userDataDir);
  });

  test("Claude Agent 节点配置面板提供统一 prompt 文本框", async () => {
    // 行为：Agent 节点配置面板包含多行 prompt 文本框
    await openFlowInEditor(firstWindow, apiBaseUrl, {
      projectId: project.id,
      name: "Agent Prompt Flow",
    });

    await addNodeFromPalette(firstWindow, "Agent");
    await nodeByIndex(firstWindow, 0).click();

    // prompt 文本框应为多行输入（textarea）
    await expect(firstWindow.getByLabel("Prompt", { exact: true })).toBeVisible();
  });

  test("Claude Agent 节点 prompt 支持变量选择器插入 {{fullName}}", async () => {
    // 行为：用户能从变量选择器选择上游变量并插入到 prompt
    await openFlowInEditor(firstWindow, apiBaseUrl, {
      projectId: project.id,
      name: "Agent Picker Flow",
      nodes: [
        {
          id: "n1",
          type: "trigger",
          name: "Start",
          position: { x: 80, y: 120 },
          config: {
            outputVariables: [{ name: "input", type: "string", defaultValue: "hello" }],
          },
        },
        {
          id: "n2",
          type: "agent",
          name: "Agent",
          position: { x: 460, y: 120 },
          config: { model: "codex", systemPrompt: "", prompt: "", retries: 1, onError: "fail" },
        },
      ],
      edges: [{ id: "e1", sourceNodeId: "n1", targetNodeId: "n2" }],
    });

    await nodeById(firstWindow, "n2").click();
    const dropdown = await openVariablePicker(firstWindow);
    await dropdown.getByText("input").click();

    // prompt 中应插入 {{n1.input}} 格式的变量引用
    await expect(firstWindow.getByLabel("Prompt", { exact: true })).toHaveValue(/\{\{n1\.input\}\}/);
  });

  test("Claude Agent 节点可配置 provider/model/outputVariable/retries/onError", async () => {
    // 行为：Agent 节点支持配置 provider/model/outputVariable/retries/onError 并保存
    await openFlowInEditor(firstWindow, apiBaseUrl, {
      projectId: project.id,
      name: "Agent Fields Flow",
    });

    await addNodeFromPalette(firstWindow, "Agent");
    await nodeByIndex(firstWindow, 0).click();

    await firstWindow.getByLabel("Provider").selectOption("anthropic");
    await firstWindow.getByLabel("Model").selectOption("claude-sonnet-5");
    await firstWindow.getByLabel(/output variable/i).fill("summary");
    await firstWindow.getByLabel("Retries").fill("2");
    await firstWindow.getByLabel(/on error/i).selectOption("ignore");

    await saveFlow(firstWindow);

    await expect(firstWindow.getByText("summary")).toBeVisible();
  });
});
