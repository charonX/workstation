// REQ-TRACE: 2026-07-19-media-production-line/REQ-FLOW-030
// REQ-VERSION: v1-hash:de43bc8607a89efe5512712a188a5f24f259d8109cb31a7a476827dd0883fab9
// CAPABILITY-TRACE: flow-orchestration
// ENTITY-TRACE: execution
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: false
// NOTE: 本测试经 /test-author 修复：E2E fixture 增加 DB_PATH 隔离；成功 case 在创建执行后立即写产物文件，
// 使 collectArtifacts 能登记到 artifacts。修复后需重新签核。

/**
 * Executions 产物 tab 与打开动作（E2E）。
 * UX 原型映射（ux/execution-detail.html）：
 *  - 详情面板 tab 序列：节点 / 日志 / 变量 / 输出 / 产物（role="tab"）。
 *  - 产物 tab：artifact 列表行含文件名、路径、「打开」「在文件夹中显示」按钮。
 *  - 空态文案「本次执行未登记产物」（失败执行无登记产物）。
 *  - 选中执行的默认 tab：成功 → 产物，失败 → 日志。
 * 不断言像素/颜色/尺寸。文案均按签核（UX 原型文案）。
 */

const { test, expect } = require("@playwright/test");
const fs = require("node:fs");
const path = require("node:path");
const { startElectronApp, stopElectronApp } = require("../../../../../e2e/fixtures/electronApp.cjs");
const { createProject, createFlow, createExecution } = require("../../../../../e2e/helpers/seed.cjs");
const locators = require("../../../../../e2e/helpers/locators.cjs");

const EXECUTIONS_PAGE = "[data-testid='executions-page']";

async function waitForTerminalStatus(apiBaseUrl, executionId) {
  await expect(async () => {
    const res = await fetch(`${apiBaseUrl}/api/executions/${executionId}`);
    const detail = await res.json();
    expect(["success", "error"]).toContain(detail.status);
  }).toPass({ timeout: 15000 });
}

// Executions 列表在页面挂载时拉取一次；先离开再进入强制重新挂载。
async function openExecutionsPage(firstWindow) {
  await firstWindow.click(locators.DASHBOARD_LINK);
  await firstWindow.click(locators.EXECUTIONS_LINK);
  await expect(firstWindow.locator(EXECUTIONS_PAGE)).toBeVisible();
}

test.describe("REQ-FLOW-030 Executions 产物 tab（E2E，UX 原型映射）", () => {
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
      name: "Artifacts Project",
      localPath: `${userDataDir}/workspace/artifacts-project`,
    });
  });

  test.afterAll(async () => {
    await stopElectronApp(electronApp, userDataDir);
  });

  test("执行详情面板包含「产物」tab（UX: TABS 含 artifacts）", async () => {
    const flow = await createFlow(apiBaseUrl, { name: "Artifacts Tab Flow", projectId: project.id });
    const execution = await createExecution(apiBaseUrl, { projectId: project.id, flowId: flow.id });
    await waitForTerminalStatus(apiBaseUrl, execution.id);

    await openExecutionsPage(firstWindow);
    await firstWindow.locator(locators.EXECUTION_ROW).first().click();

    const detailPanel = firstWindow.locator(locators.EXECUTION_DETAIL_PANEL);
    await expect(detailPanel).toBeVisible();
    // 签核 tab 文案「产物」（UX 原型 label）。
    await expect(detailPanel.getByRole("tab", { name: "产物" })).toBeVisible();
  });

  test("成功执行的产物 tab 展示 artifacts 列表（文件名/路径）与打开动作按钮", async () => {
    // 前置：一次成功执行且登记了产物（产物登记由 REQ-SCHEDULE-008 落地）。
    // 空 flow 不会自动产出文件，因此在创建执行后立即写一个产物文件，让 collectArtifacts 登记。
    const flow = await createFlow(apiBaseUrl, { name: "Artifacts List Flow", projectId: project.id });
    const execution = await createExecution(apiBaseUrl, { projectId: project.id, flowId: flow.id });
    const artifactFile = path.join(project.localPath, "outputs/daily/2026-07-19-ai-daily.md");
    fs.mkdirSync(path.dirname(artifactFile), { recursive: true });
    fs.writeFileSync(artifactFile, "# daily digest", "utf8");
    await waitForTerminalStatus(apiBaseUrl, execution.id);

    await openExecutionsPage(firstWindow);
    await firstWindow.locator(locators.EXECUTION_ROW).first().click();
    const detailPanel = firstWindow.locator(locators.EXECUTION_DETAIL_PANEL);
    await detailPanel.getByRole("tab", { name: "产物" }).click();

    // UX: artifact-row 含 artifact-name / artifact-path 与两个动作按钮。
    const firstArtifact = detailPanel.locator(".artifact-row, [data-testid='artifact-row']").first();
    await expect(firstArtifact).toBeVisible();
    // 签核按钮文案「打开」「在文件夹中显示」（UX 原型文案）。
    await expect(firstArtifact.getByRole("button", { name: "打开" })).toBeVisible();
    await expect(firstArtifact.getByRole("button", { name: "在文件夹中显示" })).toBeVisible();
    // 路径以等宽文本展示（UX: artifact-path）。
    await expect(firstArtifact.locator(".artifact-path, [data-testid='artifact-path']")).toBeVisible();
  });

  test("失败执行（无登记产物）产物 tab 为空态", async () => {
    // 未知节点类型 → 引擎置 error，且不登记产物（REQ-SCHEDULE-008 AC2）。
    const flow = await createFlow(apiBaseUrl, {
      name: "Artifacts Empty Flow",
      projectId: project.id,
      nodes: [{ id: "x1", type: "no-such-node-type", name: "Broken", position: { x: 0, y: 0 }, config: {} }],
      edges: [],
    });
    const execution = await createExecution(apiBaseUrl, { projectId: project.id, flowId: flow.id });
    await waitForTerminalStatus(apiBaseUrl, execution.id);

    await openExecutionsPage(firstWindow);
    // 选中刚创建的失败执行（列表按时间倒序，最新在最前）。
    await firstWindow.locator(locators.EXECUTION_ROW).first().click();
    const detailPanel = firstWindow.locator(locators.EXECUTION_DETAIL_PANEL);
    await detailPanel.getByRole("tab", { name: "产物" }).click();

    // 签核空态文案「本次执行未登记产物」（UX 原型 detail-placeholder 文案）。
    await expect(detailPanel.getByText("本次执行未登记产物")).toBeVisible();
  });

  test("选中执行后的默认 tab：成功落「产物」，失败落「日志」（UX 行为映射）", async () => {
    const okFlow = await createFlow(apiBaseUrl, { name: "Default Tab Ok Flow", projectId: project.id });
    const okExecution = await createExecution(apiBaseUrl, { projectId: project.id, flowId: okFlow.id });
    await waitForTerminalStatus(apiBaseUrl, okExecution.id);

    const badFlow = await createFlow(apiBaseUrl, {
      name: "Default Tab Bad Flow",
      projectId: project.id,
      nodes: [{ id: "x1", type: "no-such-node-type", name: "Broken", position: { x: 0, y: 0 }, config: {} }],
      edges: [],
    });
    const badExecution = await createExecution(apiBaseUrl, { projectId: project.id, flowId: badFlow.id });
    await waitForTerminalStatus(apiBaseUrl, badExecution.id);

    await openExecutionsPage(firstWindow);
    const detailPanel = firstWindow.locator(locators.EXECUTION_DETAIL_PANEL);

    // 最新为失败执行 → 默认「日志」tab active（签核 tab 文案「日志」）。
    await firstWindow.locator(locators.EXECUTION_ROW).first().click();
    await expect(detailPanel.getByRole("tab", { name: "日志" })).toHaveAttribute("aria-selected", "true");

    // 选中成功执行 → 默认「产物」tab active。
    await firstWindow.locator(locators.EXECUTION_ROW).filter({ hasText: "Default Tab Ok Flow" }).click();
    await expect(detailPanel.getByRole("tab", { name: "产物" })).toHaveAttribute("aria-selected", "true");
  });
});
