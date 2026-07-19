// REQ-TRACE: REQ-FLOW-028
// REQ-VERSION: v1-hash:faea1df8
// CAPABILITY-TRACE: flow-orchestration
// ENTITY-TRACE: flow
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: false

const { test, expect } = require("@playwright/test");
const { startElectronApp, stopElectronApp } = require("../../../../../e2e/fixtures/electronApp.cjs");
const { createProject } = require("../../../../../e2e/helpers/seed.cjs");
const { openFlowInEditor } = require("../../../../../e2e/helpers/flowEditor.cjs");
const locators = require("../../../../../e2e/helpers/locators.cjs");

test.describe("REQ-FLOW-028 Flow Editor 调试弹窗行为", () => {
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
      name: "Debug Modal Project",
      localPath: `${userDataDir}/workspace/debug-modal-project`,
    });
  });

  test.afterAll(async () => {
    await stopElectronApp(electronApp, userDataDir);
  });

  test("调试弹窗打开后不自动运行，输入变量后手动运行并展示日志", async () => {
    const flow = await openFlowInEditor(firstWindow, apiBaseUrl, {
      projectId: project.id,
      name: "Debug Modal Flow",
      nodes: [
        {
          id: "n1",
          type: "trigger",
          name: "Start",
          position: { x: 80, y: 120 },
          config: {
            outputVariables: [{ name: "name", type: "string", defaultValue: "world" }],
          },
        },
        {
          id: "n2",
          type: "agent",
          name: "Greet",
          position: { x: 360, y: 120 },
          config: {
            outputVariable: "greeting",
            prompt: "say hello to {{n1.name}}",
            retries: 0,
            onError: "fail",
          },
        },
      ],
      edges: [{ id: "e1", sourceNodeId: "n1", targetNodeId: "n2" }],
    });

    await firstWindow.locator(locators.DEBUG_FLOW_BUTTON).click();
    await expect(firstWindow.locator(locators.DEBUG_MODAL)).toBeVisible();

    // BUG-007 回归：打开弹窗后不应自动运行，输出面板应显示无输出。
    const outputPanel = firstWindow.locator(locators.DEBUG_OUTPUT_PANEL);
    await expect(outputPanel).toContainText(/no output/i);

    // 手动输入变量并运行调试。
    const variablesTextarea = firstWindow.locator(".debug-modal-body textarea");
    await variablesTextarea.fill(JSON.stringify({ name: "playwright" }));
    await firstWindow.getByRole("button", { name: /run debug/i }).click();

    // 等待运行完成。
    await expect(outputPanel).not.toContainText(/debugging\.\.\./i, { timeout: 15000 });

    // BUG-006 回归：结果面板应同时展示 Output 和 Execution logs。
    await expect(outputPanel).toContainText(/output/i);
    await expect(outputPanel).toContainText(/execution logs/i);
    await expect(outputPanel).toContainText(/mock agent executed/i);
  });
});
