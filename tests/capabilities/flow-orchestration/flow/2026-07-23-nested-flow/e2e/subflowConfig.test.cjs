// REQ-TRACE: 2026-07-23-nested-flow/REQ-FLOW-043, 2026-07-23-nested-flow/REQ-FLOW-045
// REQ-VERSION: v2.2-hash:b496ef72731fba3105a49d3185d3ca6f430dae96b9cf22e358cf2a2fd589f104
// CAPABILITY-TRACE: flow-orchestration
// ENTITY-TRACE: flow
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true

const { test, expect } = require("@playwright/test");
const { startElectronApp, stopElectronApp } = require("../../../../../e2e/fixtures/electronApp.cjs");
const { createProject, createFlow } = require("../../../../../e2e/helpers/seed.cjs");
const { goToAdminRoute } = require("../../../../../e2e/helpers/navigation.cjs");
const locators = require("../../../../../e2e/helpers/locators.cjs");

// data-testid 约定（实现阶段加在对应 UI 元素上）：
//   palette-node-flowInput / palette-node-flowOutput / palette-node-callFlow
//   flow-canvas (现有), flow-node (现有)
//   node-config-panel (现有)
//   callflow-config-subflow-select      —— 子流程下拉
//   callflow-config-entry-select        —— 入口下拉（单入口时隐藏）
//   callflow-input-mappings             —— 入参映射表
//   callflow-output-mappings            —— 出参只读表
//   callflow-open-child                 —— 打开子流程按钮
//   save-error-banner / inline-error    —— 保存错误（用现有机制）

test.describe("Nested Subflow - Node Palette & Config Panel", () => {
  let electronApp;
  let firstWindow;
  let apiBaseUrl;
  let userDataDir;

  test.beforeEach(async () => {
    const ctx = await startElectronApp();
    electronApp = ctx.electronApp;
    firstWindow = ctx.firstWindow;
    apiBaseUrl = ctx.apiBaseUrl;
    userDataDir = ctx.userDataDir;
  });

  test.afterEach(async () => {
    await stopElectronApp(electronApp, userDataDir);
  });

  test("REQ-FLOW-043 AC1: Node Palette shows flowInput, flowOutput, callFlow entries", async () => {
    const project = await createProject(apiBaseUrl, { name: "Palette", localPath: `${userDataDir}/ws/palette` });
    await createFlow(apiBaseUrl, { name: "Palette Flow", projectId: project.id, nodeList: [], edges: [] });

    // T-8 适配（2026-08-06）：默认落地 = 会话区——直接 goto 流程页路由（断言语义不变）。
    await goToAdminRoute(firstWindow, "#/flows");
    await firstWindow.locator(locators.FLOW_CARD).filter({ hasText: "Palette Flow" }).click();
    await expect(firstWindow.locator(locators.FLOW_EDITOR_PAGE)).toBeVisible();

    await expect(firstWindow.getByTestId("palette-node-flowInput")).toBeVisible();
    await expect(firstWindow.getByTestId("palette-node-flowOutput")).toBeVisible();
    await expect(firstWindow.getByTestId("palette-node-callFlow")).toBeVisible();
  });

  test("REQ-FLOW-043 AC1: Click palette flowInput adds a node to canvas", async () => {
    const project = await createProject(apiBaseUrl, { name: "Add", localPath: `${userDataDir}/ws/add` });
    await createFlow(apiBaseUrl, { name: "Add Flow", projectId: project.id, nodeList: [], edges: [] });

    // T-8 适配（2026-08-06）：默认落地 = 会话区——直接 goto 流程页路由（断言语义不变）。
    await goToAdminRoute(firstWindow, "#/flows");
    await firstWindow.locator(locators.FLOW_CARD).filter({ hasText: "Add Flow" }).click();

    const before = await firstWindow.locator(locators.FLOW_NODE).count();
    await firstWindow.getByTestId("palette-node-flowInput").click();
    await expect(firstWindow.locator(locators.FLOW_NODE)).toHaveCount(before + 1);
  });

  test("REQ-FLOW-043 AC4: callFlow config cascades subflow -> entry -> input mappings", async () => {
    // seed 子流程含 flowInput 声明 msg/messageId 两个入参
    const project = await createProject(apiBaseUrl, { name: "Cfg", localPath: `${userDataDir}/ws/cfg` });
    const child = await createFlow(apiBaseUrl, { name: "link-saver", projectId: project.id, nodeList: [
      { id: "cin", type: "flowInput", name: "fromFeishu", config: { outputVariables: [{ name: "msg" }, { name: "messageId" }] } }
    ], edges: [] });
    await createFlow(apiBaseUrl, { name: "parent", projectId: project.id, nodeList: [
      { id: "fm", type: "feishuMessage", name: "feishu", config: { outputVariables: [
        { name: "text", type: "string" }, { name: "sender", type: "string" }, { name: "messageId", type: "string" }
      ]}}
    ], edges: [] });

    // T-8 适配（2026-08-06）：默认落地 = 会话区——直接 goto 流程页路由（断言语义不变）。
    await goToAdminRoute(firstWindow, "#/flows");
    await firstWindow.locator(locators.FLOW_CARD).filter({ hasText: "parent" }).click();

    // 加 callFlow 节点
    await firstWindow.getByTestId("palette-node-callFlow").click();
    // 点中新节点打开配置面板（使用现有选中机制）
    await firstWindow.locator(locators.FLOW_NODE).last().click();

    // 选子流程
    await firstWindow.getByTestId("callflow-config-subflow-select").selectOption({ label: "link-saver" });

    // 单入口 → 入口下拉应隐藏或自动选中；入参表出现两行（msg, messageId）
    await expect(firstWindow.getByTestId("callflow-input-mappings")).toBeVisible();
    const rows = firstWindow.getByTestId("callflow-input-mappings").locator("[data-testid^=callflow-input-row-]");
    await expect(rows).toHaveCount(2);

    // 每行父变量下拉包含 feishuMessage 的输出变量（text/sender/messageId）
    // msg 行的父变量下拉选择 "fm.text"
    const msgRow = firstWindow.getByTestId("callflow-input-row-msg");
    // 选项 value/label 均为上游变量 fullName（`${nodeId}.${varName}`，见 NodeConfigPanel.ParentVariableSelect）
    await msgRow.getByRole("combobox").selectOption("fm.text");
  });

  test("REQ-FLOW-043 AC4: output mappings shown read-only with namespaced keys", async () => {
    const project = await createProject(apiBaseUrl, { name: "Out", localPath: `${userDataDir}/ws/out` });
    // 子流程含 flowOutput 声明 savedUrl/title
    await createFlow(apiBaseUrl, { name: "child", projectId: project.id, nodeList: [
      { id: "cin", type: "flowInput", config: { outputVariables: [{ name: "x" }] } },
      { id: "out", type: "flowOutput", config: { outputVariables: [{ name: "savedUrl" }, { name: "title" }] } }
    ], edges: [] });
    await createFlow(apiBaseUrl, { name: "parent", projectId: project.id, nodeList: [], edges: [] });

    // T-8 适配（2026-08-06）：默认落地 = 会话区——直接 goto 流程页路由（断言语义不变）。
    await goToAdminRoute(firstWindow, "#/flows");
    await firstWindow.locator(locators.FLOW_CARD).filter({ hasText: "parent" }).click();
    await firstWindow.getByTestId("palette-node-callFlow").click();
    await firstWindow.locator(locators.FLOW_NODE).last().click();
    await firstWindow.getByTestId("callflow-config-subflow-select").selectOption({ label: "child" });

    // 出参只读表展示子流程变量名（unified output model 下为裸变量名，无 callFlow 节点 id 前缀），不可编辑
    const outTable = firstWindow.getByTestId("callflow-output-mappings");
    await expect(outTable).toBeVisible();
    await expect(outTable).toContainText("savedUrl");
    await expect(outTable).toContainText("title");
    // 只读：所有 input/select 被 disabled
    const inputs = outTable.locator("input, select");
    const count = await inputs.count();
    for (let i = 0; i < count; i++) {
      await expect(inputs.nth(i)).toBeDisabled();
    }
  });

  test("REQ-FLOW-043 AC4: multi-input child requires user to pick entry", async () => {
    const project = await createProject(apiBaseUrl, { name: "Multi", localPath: `${userDataDir}/ws/multi` });
    await createFlow(apiBaseUrl, { name: "child", projectId: project.id, nodeList: [
      { id: "fromFeishu", type: "flowInput", config: { outputVariables: [{ name: "msg" }] } },
      { id: "fromSchedule", type: "flowInput", config: { outputVariables: [{ name: "topic" }] } }
    ], edges: [] });
    await createFlow(apiBaseUrl, { name: "parent", projectId: project.id, nodeList: [], edges: [] });

    // T-8 适配（2026-08-06）：默认落地 = 会话区——直接 goto 流程页路由（断言语义不变）。
    await goToAdminRoute(firstWindow, "#/flows");
    await firstWindow.locator(locators.FLOW_CARD).filter({ hasText: "parent" }).click();
    await firstWindow.getByTestId("palette-node-callFlow").click();
    await firstWindow.locator(locators.FLOW_NODE).last().click();
    await firstWindow.getByTestId("callflow-config-subflow-select").selectOption({ label: "child" });

    // 多入口 → 入口下拉可见且未选中
    const entrySelect = firstWindow.getByTestId("callflow-config-entry-select");
    await expect(entrySelect).toBeVisible();
    // 入口下拉包含两个选项
    await expect(entrySelect.locator("option")).toHaveCount(2);
  });

  test("REQ-FLOW-045: 'open subflow' navigates to child flow canvas; back returns", async () => {
    const project = await createProject(apiBaseUrl, { name: "Jump", localPath: `${userDataDir}/ws/jump` });
    const child = await createFlow(apiBaseUrl, { name: "child", projectId: project.id, nodeList: [
      { id: "cin", type: "flowInput", config: { outputVariables: [{ name: "x" }] } }
    ], edges: [] });
    await createFlow(apiBaseUrl, { name: "parent", projectId: project.id, nodeList: [], edges: [] });

    // T-8 适配（2026-08-06）：默认落地 = 会话区——直接 goto 流程页路由（断言语义不变）。
    await goToAdminRoute(firstWindow, "#/flows");
    await firstWindow.locator(locators.FLOW_CARD).filter({ hasText: "parent" }).click();
    await firstWindow.getByTestId("palette-node-callFlow").click();
    await firstWindow.locator(locators.FLOW_NODE).last().click();
    await firstWindow.getByTestId("callflow-config-subflow-select").selectOption({ label: "child" });

    await firstWindow.getByTestId("callflow-open-child").click();

    // 路由跳到 child 编辑器（URL 含 child.id；FLOW_EDITOR_PAGE 可见）
    await expect(firstWindow).toHaveURL(new RegExp(`/flows/${child.id}`));
    await expect(firstWindow.locator(locators.FLOW_EDITOR_PAGE)).toBeVisible();

    // 浏览器后退回到 parent
    await firstWindow.goBack();
    await expect(firstWindow).toHaveURL(/\/flows\//);
  });

  test("REQ-FLOW-043: saving parent with circular reference shows inline error", async () => {
    const project = await createProject(apiBaseUrl, { name: "Circ", localPath: `${userDataDir}/ws/circ` });
    // seed A→B via API，然后打开 B 在画布上配 B→A 闭合
    // A 必须含 flowInput 节点，否则 listCallFlowCandidates 会跳过它（无入口不可作为子流程）
    const a = await createFlow(apiBaseUrl, { name: "A", projectId: project.id, nodeList: [
      { id: "ain", type: "flowInput", config: { outputVariables: [] } }
    ], edges: [] });
    const b = await createFlow(apiBaseUrl, { name: "B", projectId: project.id, nodeList: [
      { id: "bin", type: "flowInput", config: { outputVariables: [] } }
    ], edges: [] });
    // A→B（PATCH 整体替换 nodeList，flowInput 必须一并写入，否则 A 无入口不会出现在候选列表）
    await fetch(`${apiBaseUrl}/api/flows/${a.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nodeList: [
          { id: "ain", type: "flowInput", config: { outputVariables: [] } },
          { id: "t", type: "trigger", config: {} },
          { id: "c", type: "callFlow", config: { targetFlowId: b.id, targetInputNodeId: "bin", inputMappings: [], outputMappings: [] } }
        ],
        edges: [{ sourceNodeId: "t", targetNodeId: "c" }]
      })
    });

    // T-8 适配（2026-08-06）：默认落地 = 会话区——直接 goto 流程页路由（断言语义不变）。
    await goToAdminRoute(firstWindow, "#/flows");
    await firstWindow.locator(locators.FLOW_CARD).filter({ hasText: "B" }).click();
    await firstWindow.getByTestId("palette-node-callFlow").click();
    await firstWindow.locator(locators.FLOW_NODE).last().click();
    await firstWindow.getByTestId("callflow-config-subflow-select").selectOption({ label: "A" });
    // 单入口 → 入口自动选中（targetInputNodeId = "ain"）；保存时服务端 DFS 检测 B->A->B 循环
    await firstWindow.click("[data-testid=save-flow-button]");

    // 断言错误 banner/inline error 出现，含循环提示
    await expect(firstWindow.getByTestId("save-error-banner")).toBeVisible();
    await expect(firstWindow.getByTestId("save-error-banner")).toContainText(/circular|循环/i);
  });

  test("REQ-FLOW-043 i18n: new UI strings resolve in zh and en", async () => {
    // 切 zh: palette 按钮中文；切 en: 英文
    // 依赖现有语言切换机制（locators.LANG_TOGGLE 或 settings）
    const project = await createProject(apiBaseUrl, { name: "I18n", localPath: `${userDataDir}/ws/i18n` });
    await createFlow(apiBaseUrl, { name: "F", projectId: project.id, nodeList: [], edges: [] });
    // T-8 适配（2026-08-06）：默认落地 = 会话区——直接 goto 流程页路由（断言语义不变）。
    await goToAdminRoute(firstWindow, "#/flows");
    await firstWindow.locator(locators.FLOW_CARD).filter({ hasText: "F" }).click();

    // 默认 en
    await expect(firstWindow.getByTestId("palette-node-flowInput")).toContainText(/input/i);
    // 切 zh
    await firstWindow.click(locators.TOPBAR_LANGUAGE_BUTTON);
    await expect(firstWindow.getByTestId("palette-node-flowInput")).toContainText(/输入|入口/);
  });
});
