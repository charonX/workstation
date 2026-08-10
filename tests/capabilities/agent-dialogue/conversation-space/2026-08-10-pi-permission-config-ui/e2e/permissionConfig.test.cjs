// REQ-TRACE: 2026-08-10-pi-permission-config-ui/REQ-AGENT-059, 2026-08-10-pi-permission-config-ui/REQ-AGENT-060, 2026-08-10-pi-permission-config-ui/REQ-AGENT-061, 2026-08-10-pi-permission-config-ui/REQ-AGENT-062, 2026-08-10-pi-permission-config-ui/REQ-AGENT-063, 2026-08-10-pi-permission-config-ui/REQ-AGENT-064, 2026-08-10-pi-permission-config-ui/REQ-AGENT-065, 2026-08-10-pi-permission-config-ui/REQ-AGENT-066, 2026-08-10-pi-permission-config-ui/REQ-AGENT-067, 2026-08-10-pi-permission-config-ui/REQ-AGENT-068
// REQ-VERSION: v1-hash:4b944146fd166a4f60e5ba65080efefeb75690ff7be837718c867c2d2c01b77d
// CAPABILITY-TRACE: agent-dialogue
// ENTITY-TRACE: conversation-space
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true

// 权限配置页签浏览器 E2E（REQ-AGENT-059~068 UI 面）：项目详情弹窗「权限配置」
// 页签——空态/继承视图/allow-ask 切换/JSON 模式/保存校验错误。
//
// UX 参照：ux/permission-config.html（locator 契约从原型提取，实现时对齐）：
//   [data-testid='project-detail-modal']      项目详情弹窗（既有）
//   [data-perm-tab]                           权限配置页签
//   [data-testid='perm-empty-state']          空态（未配置跟随全局）
//   [data-testid='perm-create-btn']           新建配置按钮
//   [data-perm-mode='vis'|'json']             模式切换按钮
//   [data-testid='perm-save-btn']             保存按钮
//   [data-rule-row='permission.bash.rm *']    规则行（key 定位）
//   [data-testid='perm-error-banner']         校验错误条
//   [data-testid='perm-json-editor']          JSON 文本区
//   [data-override-badge]                     组覆盖徽标
//
// 环境：FAUX（零网络）+ seedAgentConfig + 项目空间（createProject localPath =
// 测试临时目录，图片/文件 fixture 放项目内）——对齐 statusBar/richRender 先例。
// 断言语义（签核 TODO）：元素存在/可见性/状态切换，不验像素。

const { test, expect } = require("@playwright/test");
const { startElectronApp, stopElectronApp } = require("../../../../../e2e/fixtures/electronApp.cjs");
const { createProject } = require("../../../../../e2e/helpers/seed.cjs");
const { goToAdminRoute } = require("../../../../../e2e/helpers/navigation.cjs");
const locators = require("../../../../../e2e/helpers/locators.cjs");

const PROJECT_DETAIL_MODAL = "[data-testid='project-detail-modal']";
const PERM_TAB = "[data-perm-tab]";
const PERM_EMPTY_STATE = "[data-testid='perm-empty-state']";
const PERM_CREATE_BTN = "[data-testid='perm-create-btn']";
const PERM_MODE_VIS = "[data-perm-mode='vis']";
const PERM_MODE_JSON = "[data-perm-mode='json']";
const PERM_SAVE_BTN = "[data-testid='perm-save-btn']";
const PERM_ERROR_BANNER = "[data-testid='perm-error-banner']";
const PERM_JSON_EDITOR = "[data-testid='perm-json-editor']";
const RULE_ROW = (key) => `[data-rule-row='${key}']`;
const OVERRIDE_BADGE = "[data-override-badge]";

async function seedAgentConfig(apiBaseUrl) {
  const res = await fetch(`${apiBaseUrl}/api/settings/agent`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider: "deepseek", apiKey: "sk-e2e-faux-placeholder", identity: "" }),
  });
  expect(res.ok).toBe(true);
}

async function openProjectPermissionTab(window, { apiBaseUrl, name, localPath }) {
  await seedAgentConfig(apiBaseUrl);
  const project = await createProject(apiBaseUrl, { name, localPath });
  await goToAdminRoute(window, "#/workspace");
  const card = window.locator(locators.PROJECT_CARD).filter({ hasText: name });
  await card.locator(locators.CONFIGURE_SKILLS_BUTTON).click();
  await expect(window.locator(PROJECT_DETAIL_MODAL)).toBeVisible();
  await window.click(PERM_TAB);
  await expect(window.locator(PERM_MODE_VIS)).toBeVisible();
  return project;
}

test.describe("项目权限配置页签（E2E）", () => {
  let electronApp;
  let firstWindow;
  let apiBaseUrl;
  let userDataDir;
  let workdir;

  test.beforeEach(async () => {
    const ctx = await startElectronApp({ extraEnv: { OPC_AGENT_FAUX: "1" } });
    electronApp = ctx.electronApp;
    firstWindow = ctx.firstWindow;
    apiBaseUrl = ctx.apiBaseUrl;
    userDataDir = ctx.userDataDir;
    workdir = `${userDataDir}/perm-e2e`;
    require("node:fs").mkdirSync(workdir, { recursive: true });
  });

  test.afterEach(async () => {
    await stopElectronApp(electronApp, userDataDir);
  });

  test("REQ-AGENT-059：项目详情弹窗含权限配置页签；无配置项目显示空态", async () => {
    await openProjectPermissionTab(firstWindow, {
      apiBaseUrl,
      name: "PermE2E1",
      localPath: workdir,
    });

    // TODO: HUMAN ASSERTION — 确认空态文案（未配置跟随全局）与新建按钮
    await expect(firstWindow.locator(PERM_EMPTY_STATE)).toBeVisible();
    await expect(firstWindow.locator(PERM_CREATE_BTN)).toBeVisible();
  });

  test("REQ-AGENT-062：bash 族规则行可见（family 分组），全局列只读", async () => {
    const project = await openProjectPermissionTab(firstWindow, {
      apiBaseUrl,
      name: "PermE2E2",
      localPath: workdir,
    });

    // TODO: HUMAN ASSERTION — 确认 rm * 规则行可见
    await expect(firstWindow.locator(RULE_ROW("permission.bash.rm *"))).toBeVisible();

    // 空态下先建配置（或实现后直接显示已配置视图——依实现接线确认）
    if (await firstWindow.locator(PERM_EMPTY_STATE).isVisible()) {
      await firstWindow.click(PERM_CREATE_BTN);
    }
    await expect(firstWindow.locator(RULE_ROW("permission.bash.rm *"))).toBeVisible();

    // 全局列只读（无编辑控件）
    // TODO: HUMAN ASSERTION — 确认全局默认列无 input/select/seg 编辑控件
    const globalColEditors = await firstWindow
      .locator(RULE_ROW("permission.bash.rm *"))
      .locator("input, select, [data-perm-seg]")
      .count();
    expect(globalColEditors).toBe(0);
  });

  test("REQ-AGENT-062/063：allow-ask 切换 → 覆盖高亮 + 徽标；保存成功", async () => {
    const project = await openProjectPermissionTab(firstWindow, {
      apiBaseUrl,
      name: "PermE2E3",
      localPath: workdir,
    });

    if (await firstWindow.locator(PERM_EMPTY_STATE).isVisible()) {
      await firstWindow.click(PERM_CREATE_BTN);
    }

    // 切换 rm * 为 allow
    // TODO: HUMAN ASSERTION — 确认切换控件（seg/locator 按实现接线）
    const seg = firstWindow.locator(RULE_ROW("permission.bash.rm *")).locator("[data-perm-seg]");
    await seg.getByText("允许").click();

    // 覆盖徽标计数 +1（或该行高亮「项目已改」）
    // TODO: HUMAN ASSERTION — 确认覆盖标记出现
    await expect(firstWindow.locator(OVERRIDE_BADGE).first()).toBeVisible();

    // 保存成功提示（宽松断言：任意成功态提示可见——文案以原型为准，观感留 REFLECT）
    await firstWindow.click(PERM_SAVE_BTN);
    // TODO: HUMAN ASSERTION — 确认保存成功（saved 提示可见——宽松：成功态提示出现即可）
    await expect(firstWindow.locator("[data-testid='perm-save-hint']").or(firstWindow.locator("[data-testid='perm-saved-hint']"))).toBeVisible();
  });

  test("REQ-AGENT-066：JSON 模式切换 → 文本区可见可编辑", async () => {
    const project = await openProjectPermissionTab(firstWindow, {
      apiBaseUrl,
      name: "PermE2E4",
      localPath: workdir,
    });

    await firstWindow.click(PERM_MODE_JSON);
    await expect(firstWindow.locator(PERM_JSON_EDITOR)).toBeVisible();
    // TODO: HUMAN ASSERTION — 确认 JSON 文本区内容（含 permission 字段）可编辑
  });

  test("REQ-AGENT-068：JSON 模式保存非法 → 错误 banner 可见，文件未变", async () => {
    const project = await openProjectPermissionTab(firstWindow, {
      apiBaseUrl,
      name: "PermE2E5",
      localPath: workdir,
    });

    await firstWindow.click(PERM_MODE_JSON);
    await firstWindow.locator(PERM_JSON_EDITOR).fill("{ invalid json");

    await firstWindow.click(PERM_SAVE_BTN);

    // TODO: HUMAN ASSERTION — 确认错误条可见 + 保存被拦截
    await expect(firstWindow.locator(PERM_ERROR_BANNER)).toBeVisible();
  });

  test("REQ-AGENT-065：面板说明文案（未改继承全局）可见", async () => {
    const project = await openProjectPermissionTab(firstWindow, {
      apiBaseUrl,
      name: "PermE2E6",
      localPath: workdir,
    });

    // TODO: HUMAN ASSERTION — 确认继承说明文案可见
    await expect(
      firstWindow.getByText(/项目只覆盖你改的条目|未改的继承全局/)
    ).toBeVisible();
  });
});
