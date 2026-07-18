// REQ-TRACE: REQ-FLOW-021
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
  saveFlow,
} = require("../../../../../e2e/helpers/flowEditor.cjs");

test.describe("REQ-FLOW-021 节点级错误处理配置", () => {
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
      name: "Error Handling Project",
      localPath: `${userDataDir}/workspace/error-handling-project`,
    });
  });

  test.afterAll(async () => {
    await stopElectronApp(electronApp, userDataDir);
  });

  test("Trigger/Condition/Claude Agent 节点均显示重试次数和失败时下拉选择", async () => {
    // 行为：三个核心节点的配置面板都包含错误处理配置项
    await openFlowInEditor(firstWindow, apiBaseUrl, {
      projectId: project.id,
      name: "Error Handling Fields Flow",
    });

    // Trigger
    await addNodeFromPalette(firstWindow, "Trigger");
    await nodeByIndex(firstWindow, 0).click();
    await expect(firstWindow.getByLabel("Retries")).toBeVisible();
    await expect(firstWindow.getByLabel(/on error/i)).toBeVisible();

    // Condition
    await addNodeFromPalette(firstWindow, "Condition");
    await nodeByIndex(firstWindow, 1).click();
    await expect(firstWindow.getByLabel("Retries")).toBeVisible();
    await expect(firstWindow.getByLabel(/on error/i)).toBeVisible();

    // Agent
    await addNodeFromPalette(firstWindow, "Agent");
    await nodeByIndex(firstWindow, 2).click();
    await expect(firstWindow.getByLabel("Retries")).toBeVisible();
    await expect(firstWindow.getByLabel(/on error/i)).toBeVisible();
  });

  test("retries 默认值为 1，可配置为 0 或正整数", async () => {
    // 行为：retries 字段默认值为 1，可修改为 0 或其他正整数
    await openFlowInEditor(firstWindow, apiBaseUrl, {
      projectId: project.id,
      name: "Retries Default Flow",
    });

    await addNodeFromPalette(firstWindow, "Agent");
    await nodeByIndex(firstWindow, 0).click();

    await expect(firstWindow.getByLabel("Retries")).toHaveValue("1");

    await firstWindow.getByLabel("Retries").fill("0");
    await saveFlow(firstWindow);

    await expect(firstWindow.getByLabel("Retries")).toHaveValue("0");
  });

  test("onError 默认值为 fail，可选 ignore", async () => {
    // 行为：onError 字段默认值为 fail，可切换为 ignore
    await openFlowInEditor(firstWindow, apiBaseUrl, {
      projectId: project.id,
      name: "OnError Default Flow",
    });

    await addNodeFromPalette(firstWindow, "Agent");
    await nodeByIndex(firstWindow, 0).click();

    await expect(firstWindow.getByLabel(/on error/i)).toHaveValue("fail");

    await firstWindow.getByLabel(/on error/i).selectOption("ignore");
    await saveFlow(firstWindow);

    await expect(firstWindow.getByLabel(/on error/i)).toHaveValue("ignore");
  });
});
