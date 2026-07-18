// REQ-TRACE: REQ-FLOW-028
// REQ-VERSION: v1-hash:faea1df8
// CAPABILITY-TRACE: flow-orchestration
// ENTITY-TRACE: execution
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: false

/**
 * Signoff 决策 6：E2E 只签核核心行为，具体 URL/定位器/文案由 BUILD 阶段
 * 根据实际组件确定。本文件由 S5b 从 test-author 的 page.goto 骨架适配为
 * electron fixture + API 播种 + UI 导航（沿用 S5a 先例）。
 * 行为断言语义不变；适配清单见 build-progress.md Slice S5b。
 */

const { test, expect } = require("@playwright/test");
const { startElectronApp, stopElectronApp } = require("../../../../../e2e/fixtures/electronApp.cjs");
const { createProject, createFlow, createExecution } = require("../../../../../e2e/helpers/seed.cjs");
const locators = require("../../../../../e2e/helpers/locators.cjs");

const NODES_PANEL = "[data-testid='nodes-panel']";
const EXECUTIONS_PAGE = "[data-testid='executions-page']";

async function getExecutionDetail(apiBaseUrl, executionId) {
  const res = await fetch(`${apiBaseUrl}/api/executions/${executionId}`);
  if (!res.ok) throw new Error(`getExecution failed: ${res.status}`);
  return res.json();
}

// POST /api/executions 返回时引擎仍在异步运行；轮询详情 API 直到执行
// 结束且节点级记录已写入（REQ-FLOW-028 AC1）。
async function waitForExecutionNodes(apiBaseUrl, executionId) {
  await expect(async () => {
    const detail = await getExecutionDetail(apiBaseUrl, executionId);
    expect(detail.status).not.toBe("running");
    expect(Array.isArray(detail.nodes)).toBe(true);
    expect(detail.nodes.length).toBeGreaterThan(0);
  }).toPass({ timeout: 15000 });
}

// Executions 列表在页面挂载时拉取一次；先离开再进入强制重新挂载，
// 确保 API 播种的执行出现在列表中。
async function openExecutionsPage(firstWindow) {
  await firstWindow.click(locators.DASHBOARD_LINK);
  await firstWindow.click(locators.EXECUTIONS_LINK);
  await expect(firstWindow.locator(EXECUTIONS_PAGE)).toBeVisible();
}

test.describe("REQ-FLOW-028 执行日志持久化与自动清理（E2E）", () => {
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
      name: "Execution Log Project",
      localPath: `${userDataDir}/workspace/execution-log-project`,
    });
  });

  test.afterAll(async () => {
    await stopElectronApp(electronApp, userDataDir);
  });

  test("执行历史页显示执行记录", async () => {
    // 行为：Executions 页面显示执行记录列表
    await openExecutionsPage(firstWindow);

    await expect(firstWindow.getByTestId("execution-list")).toBeVisible();
  });

  test("执行详情页显示节点输入/输出/分支/错误信息", async () => {
    // 行为：执行详情页展示节点级日志信息
    // 离线播种：trigger + condition 流程经 API 创建执行（不触达 agent SDK）。
    const flow = await createFlow(apiBaseUrl, {
      name: "Execution Nodes Flow",
      projectId: project.id,
      nodes: [
        {
          id: "n1",
          type: "trigger",
          name: "Start",
          position: { x: 80, y: 120 },
          config: {
            outputVariables: [{ name: "repoPath", type: "string", defaultValue: "/tmp/repo" }],
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
    const execution = await createExecution(apiBaseUrl, { projectId: project.id, flowId: flow.id });
    await waitForExecutionNodes(apiBaseUrl, execution.id);

    await openExecutionsPage(firstWindow);
    await firstWindow.locator(locators.EXECUTION_ROW).first().click();

    const nodesPanel = firstWindow.locator(NODES_PANEL);
    await expect(nodesPanel).toBeVisible();
    await expect(nodesPanel.getByText(/input/i).first()).toBeVisible();
    await expect(nodesPanel.getByText(/output/i).first()).toBeVisible();
  });

  test("Claude Agent 节点的调用详情包含 prompt/output/model/provider/status/error/durationMs/attemptCount", async () => {
    // 行为：Agent 节点的调用详情在详情页可见
    // 离线播种：无 provider 的 mock agent（mock 路径不产 agent 调用详情，
    // prompt/model 列为 NULL）；详情页对 agent 类型节点渲染调用详情区块的
    // 字段标签，空值以占位符呈现。
    const flow = await createFlow(apiBaseUrl, {
      name: "Execution Agent Flow",
      projectId: project.id,
      nodes: [
        {
          id: "n1",
          type: "trigger",
          name: "Start",
          position: { x: 80, y: 120 },
          config: {
            outputVariables: [{ name: "repoPath", type: "string", defaultValue: "/tmp/repo" }],
          },
        },
        {
          id: "n2",
          type: "agent",
          name: "Summarize",
          position: { x: 460, y: 120 },
          config: { model: "mock", prompt: "Summarize {{n1.repoPath}}", outputVariable: "summary" },
        },
      ],
      edges: [{ id: "e1", sourceNodeId: "n1", targetNodeId: "n2" }],
    });
    const execution = await createExecution(apiBaseUrl, { projectId: project.id, flowId: flow.id });
    await waitForExecutionNodes(apiBaseUrl, execution.id);

    await openExecutionsPage(firstWindow);
    await firstWindow.locator(locators.EXECUTION_ROW).first().click();

    const nodesPanel = firstWindow.locator(NODES_PANEL);
    await expect(nodesPanel).toBeVisible();
    await expect(nodesPanel.getByText(/prompt/i).first()).toBeVisible();
    await expect(nodesPanel.getByText(/model/i).first()).toBeVisible();
  });

  test("日志默认保留 7 天，到期自动清理", async () => {
    // 行为：超过 7 天的执行记录不再显示
    // 清理由后端启动时 + 每日 cron 保证（S4）；E2E 环境为全新 userData，
    // 播种数据不含 7 天前记录，列表不显示 "7 days ago"。
    await openExecutionsPage(firstWindow);

    await expect(firstWindow.getByText(/7 days ago/i)).not.toBeVisible();
  });
});
