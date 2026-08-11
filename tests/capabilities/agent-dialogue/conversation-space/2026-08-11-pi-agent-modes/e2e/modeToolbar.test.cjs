// REQ-TRACE: 2026-08-11-pi-agent-modes/REQ-AGENT-071, 2026-08-11-pi-agent-modes/REQ-AGENT-072
// REQ-VERSION: v1-hash:3e5839b75173b7b59c41c0da8085ff7f09755fdb443f22c43ebfa310d7813add
// CAPABILITY-TRACE: agent-dialogue
// ENTITY-TRACE: conversation-space
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true

// 对话区模式工具栏 E2E（REQ-AGENT-071 工具栏 / 072 lastMode 初始模式）。
//
// UX 参照：ux/mode-toolbar.html（composer 下方工具栏，三档下拉）：
//   [data-testid='mode-toolbar']          工具栏容器（composer 下方）
//   [data-testid='mode-select']           三档下拉容器
//   [data-testid='mode-trigger']          触发按钮（显示当前模式 + 色点）
//   [data-mode='strict'|'standard'|'auto'] 档位选项（含描述）
//   [data-testid='toolbar-slot-model'|'toolbar-slot-attach']  未来扩展槽位（灰显）
//
// 环境：FAUX（零网络）+ seedAgentConfig + 既有 startElectronApp 模式。
// 断言语义（签核 TODO）：元素存在/可见性/状态切换/纵向顺序，不验像素。

const { test, expect } = require("@playwright/test");
const { startElectronApp, stopElectronApp } = require("../../../../../e2e/fixtures/electronApp.cjs");
const locators = require("../../../../../e2e/helpers/locators.cjs");

const SCREEN_ASSISTANT = "[data-testid='screen-assistant']";
const MODE_TOOLBAR = "[data-testid='mode-toolbar']";
const MODE_SELECT = "[data-testid='mode-select']";
const MODE_TRIGGER = "[data-testid='mode-trigger']";
const MODE_OPTION = (m) => `[data-mode='${m}']`;
const SLOT_MODEL = "[data-testid='toolbar-slot-model']";
const SLOT_ATTACH = "[data-testid='toolbar-slot-attach']";
const COMPOSER = "[data-testid='composer-input']";

async function seedAgentConfig(apiBaseUrl) {
  const res = await fetch(`${apiBaseUrl}/api/settings/agent`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider: "deepseek", apiKey: "sk-e2e-faux-placeholder", identity: "" }),
  });
  expect(res.ok).toBe(true);
}

test.describe("对话区模式工具栏（E2E）", () => {
  let electronApp;
  let firstWindow;
  let apiBaseUrl;
  let userDataDir;

  test.beforeEach(async () => {
    const ctx = await startElectronApp({ extraEnv: { OPC_AGENT_FAUX: "1" } });
    electronApp = ctx.electronApp;
    firstWindow = ctx.firstWindow;
    apiBaseUrl = ctx.apiBaseUrl;
    userDataDir = ctx.userDataDir;
    await seedAgentConfig(apiBaseUrl);
  });

  test.afterEach(async () => {
    await stopElectronApp(electronApp, userDataDir);
  });

  test("REQ-AGENT-071 标准 1：工具栏位于 composer 下方（纵向顺序）", async () => {
    await expect(firstWindow.locator(SCREEN_ASSISTANT)).toBeVisible();
    await expect(firstWindow.locator(MODE_TOOLBAR)).toBeVisible();
    await expect(firstWindow.locator(COMPOSER)).toBeVisible();

    // 纵向顺序：composer.y + height ≤ toolbar.y + 容差
    // TODO: HUMAN ASSERTION — 确认工具栏在 composer 下方（既有 MessageList→StatusBar→Composer 顺序不被破坏）
    const composerBox = await firstWindow.locator(COMPOSER).boundingBox();
    const toolbarBox = await firstWindow.locator(MODE_TOOLBAR).boundingBox();
    expect(composerBox.y + composerBox.height).toBeLessThanOrEqual(toolbarBox.y + 1);
  });

  test("REQ-AGENT-071 标准 2/3：三档下拉——展开显示三档 + 选择更新触发按钮", async () => {
    await expect(firstWindow.locator(MODE_TRIGGER)).toBeVisible();

    // 展开下拉
    await firstWindow.click(MODE_TRIGGER);
    // TODO: HUMAN ASSERTION — 确认三档选项可见（严格/标准/自动）
    await expect(firstWindow.locator(MODE_OPTION("strict"))).toBeVisible();
    await expect(firstWindow.locator(MODE_OPTION("standard"))).toBeVisible();
    await expect(firstWindow.locator(MODE_OPTION("auto"))).toBeVisible();

    // 切到 auto → 触发按钮文案更新
    await firstWindow.click(MODE_OPTION("auto"));
    // TODO: HUMAN ASSERTION — 确认触发按钮显示「自动」（当前档更新）
    await expect(firstWindow.locator(MODE_TRIGGER)).toContainText("自动");
  });

  test("REQ-AGENT-071 标准 4：未来扩展槽位灰显占位存在", async () => {
    await expect(firstWindow.locator(SLOT_MODEL)).toBeVisible();
    await expect(firstWindow.locator(SLOT_ATTACH)).toBeVisible();
  });

  test("REQ-AGENT-071 标准 5：auto 切换无额外提示", async () => {
    await firstWindow.click(MODE_TRIGGER);
    await firstWindow.click(MODE_OPTION("auto"));
    // 切换后无 toast/banner（宽松：无 data-testid 提示条出现）
    // TODO: HUMAN ASSERTION — 确认无提示条（mode 切换即生效）
    const banners = await firstWindow.locator("[data-testid*='mode-toast'], [data-testid*='mode-banner']").count();
    expect(banners).toBe(0);
  });

  test("REQ-AGENT-072 标准 2（E2E 面）：新会话初始模式 = lastMode", async () => {
    // 先切到 auto（记录 lastMode），重启应用（新会话）→ 初始模式 = auto
    await firstWindow.click(MODE_TRIGGER);
    await firstWindow.click(MODE_OPTION("auto"));
    await expect(firstWindow.locator(MODE_TRIGGER)).toContainText("自动");

    await firstWindow.reload();
    await expect(firstWindow.locator(SCREEN_ASSISTANT)).toBeVisible();
    // TODO: HUMAN ASSERTION — 确认 reload 后初始模式 = auto（lastMode 生效）
    await expect(firstWindow.locator(MODE_TRIGGER)).toContainText("自动");
  });
});
