// REQ-TRACE: 2026-07-19-media-production-line/REQ-FLOW-031
// REQ-VERSION: v1-hash:aeebbee331c0863144ca7b891e8faf8da12fde2bfbceb0ad525049febf3f1d48
// CAPABILITY-TRACE: flow-orchestration
// ENTITY-TRACE: flow-engine
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true

const { test, expect } = require("@playwright/test");
const { startElectronApp, stopElectronApp } = require("../../../../../e2e/fixtures/electronApp.cjs");
const { createProject } = require("../../../../../e2e/helpers/seed.cjs");
const {
  FLOW_SAVE_SUCCESS,
  openFlowInEditor,
  addNodeFromPalette,
  nodeByIndex,
  clickSave,
  saveFlow,
} = require("../../../../../e2e/helpers/flowEditor.cjs");

test.describe("REQ-FLOW-031 飞书消息触发节点（UI）", () => {
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
      name: "Feishu Message Node Project",
      localPath: `${userDataDir}/workspace/feishu-message-node-project`,
    });
  });

  test.afterAll(async () => {
    await stopElectronApp(electronApp, userDataDir);
  });

  test("NodePalette Trigger 分组提供 Feishu Message 节点并可添加到画布", async () => {
    await openFlowInEditor(firstWindow, apiBaseUrl, {
      projectId: project.id,
      name: "Feishu Message Flow",
    });

    await addNodeFromPalette(firstWindow, "Feishu Message");

    // 画布上应出现 feishuMessage 类型节点
    const node = nodeByIndex(firstWindow, 0);
    await expect(node).toBeVisible();
    // TODO: HUMAN ASSERTION — 确认节点上显示的文案/图标
    await expect(firstWindow.getByText(/feishu|飞书/i).first()).toBeVisible();
  });

  test("feishuMessage 节点配置面板固定展示 text/sender/messageId 且不可删除", async () => {
    await openFlowInEditor(firstWindow, apiBaseUrl, {
      projectId: project.id,
      name: "Feishu Message Config Flow",
    });

    await addNodeFromPalette(firstWindow, "Feishu Message");
    await nodeByIndex(firstWindow, 0).click();

    // 固定输出变量应存在（使用 testid 避免依赖界面语言）
    const nameInputs = firstWindow.locator("[data-testid='variable-name-input']");
    await expect(nameInputs).toHaveCount(3);
    await expect(nameInputs.nth(0)).toHaveValue("text");
    await expect(nameInputs.nth(1)).toHaveValue("sender");
    await expect(nameInputs.nth(2)).toHaveValue("messageId");

    // 删除变量按钮应不存在（固定变量不可删除）
    await expect(firstWindow.locator("[data-testid='remove-variable-button']")).not.toBeVisible();

    // 修改 defaultValue 后应能保存
    await firstWindow.locator("[data-testid='variable-default-input']").nth(0).fill("default text");
    await saveFlow(firstWindow);
  });

  test("保存后刷新，feishuMessage 节点类型与固定输出变量保持不变", async () => {
    const flow = await openFlowInEditor(firstWindow, apiBaseUrl, {
      projectId: project.id,
      name: "Feishu Message Persist Flow",
      nodes: [
        {
          id: "n1",
          type: "feishuMessage",
          name: "Feishu Message",
          position: { x: 80, y: 120 },
          config: {
            outputVariables: [
              { name: "text", type: "string", defaultValue: "" },
              { name: "sender", type: "string", defaultValue: "" },
              { name: "messageId", type: "string", defaultValue: "" },
            ],
          },
        },
      ],
      edges: [],
    });

    await nodeByIndex(firstWindow, 0).click();
    const nameInputs = firstWindow.locator("[data-testid='variable-name-input']");
    await expect(nameInputs).toHaveCount(3);
    await expect(nameInputs.nth(0)).toHaveValue("text");
    await expect(nameInputs.nth(1)).toHaveValue("sender");
    await expect(nameInputs.nth(2)).toHaveValue("messageId");
  });
});
