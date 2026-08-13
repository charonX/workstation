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
//
// [Slice 5 接线修正记录（2026-08-12，test-gap 就地补全，断言语义不变）]
//   S4 concern 2：无会话下 selectedKey=null → 切档为 no-op（renderer 默认 auto =
//   服务端首次默认，切换断言退化为默认值断言——恒绿但不走真实 PUT 流）。
//   修正：切档类用例（标准 2/3、标准 5、072）前置建会话并打开（POST
//   /api/agent/sessions {spaceKind:"general"} → reload → 点 [data-session-item]，
//   statusBar 先例），使「点击 → PUT /mode → settings lastMode 持久化 → reload 后
//   GET /mode 取位」真实链路被断言。标准 2/3 与标准 5 先切 strict 再切 auto——
//   首次默认 = auto（REQ-AGENT-072 标准 3），直接切 auto 无文案变化可断言；
//   072 用例切 strict（默认首档 auto → strict 真实变化），reload 后断言取位恢复
//   strict（持久化链路失效时 reload 后回落 auto，断言可区分）。

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

// 建通用空间会话（statusBar 先例：POST /api/agent/sessions { spaceKind } → { spaceKey }）。
// S5 接线：切档链路依赖已选中会话（selectedKey 非空 → 点击 → PUT /mode 真实落盘）。
async function createSession(apiBaseUrl, body) {
  const res = await fetch(`${apiBaseUrl}/api/agent/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  expect(res.ok).toBe(true);
  return (await res.json()).spaceKey;
}

// 打开会话（statusBar 先例）：reload 后按精确 spaceKey 点击会话行——renderer 首载
// 自动选中最近活跃会话，点击使选中确定化（切档链路必达）。
async function openSession(firstWindow, spaceKey) {
  await firstWindow.reload();
  await expect(firstWindow.locator(SCREEN_ASSISTANT)).toBeVisible();
  await firstWindow.click(`[data-session-item='${spaceKey}']`);
  await expect(firstWindow.locator(COMPOSER)).toBeVisible();
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
    // S5 接线：建会话并打开——切档走真实链路（点击 → PUT /mode → 取位更新）。
    const spaceKey = await createSession(apiBaseUrl, { spaceKind: "general" });
    await openSession(firstWindow, spaceKey);

    await expect(firstWindow.locator(MODE_TRIGGER)).toBeVisible();

    // 展开下拉
    await firstWindow.click(MODE_TRIGGER);
    // TODO: HUMAN ASSERTION — 确认三档选项可见（严格/标准/自动）
    await expect(firstWindow.locator(MODE_OPTION("strict"))).toBeVisible();
    await expect(firstWindow.locator(MODE_OPTION("standard"))).toBeVisible();
    await expect(firstWindow.locator(MODE_OPTION("auto"))).toBeVisible();

    // 切到 strict → 触发按钮文案更新（默认首档 auto → 严格，文案变化真实可断言）
    await firstWindow.click(MODE_OPTION("strict"));
    // TODO: HUMAN ASSERTION — 确认触发按钮显示「严格」（当前档更新）
    await expect(firstWindow.locator(MODE_TRIGGER)).toContainText("严格");

    // 再切到 auto → 触发按钮文案更新（严格 → 自动）
    await firstWindow.click(MODE_TRIGGER);
    await firstWindow.click(MODE_OPTION("auto"));
    // TODO: HUMAN ASSERTION — 确认触发按钮显示「自动」（当前档更新）
    await expect(firstWindow.locator(MODE_TRIGGER)).toContainText("自动");
  });

  test("REQ-AGENT-071 标准 4：扩展槽位已实现为可用控件（2026-08-12-conversation-toolbar-ext 契约演化）", async () => {
    // 灰显占位槽位（toolbar-slot-model/attach）已由 REQ-AGENT-094/098 实现为功能控件：
    // 模型选择器（model-select）与附件按钮（attach-button）；旧槽位不再渲染。
    await expect(firstWindow.locator(SLOT_MODEL)).toHaveCount(0);
    await expect(firstWindow.locator(SLOT_ATTACH)).toHaveCount(0);
    await expect(firstWindow.locator("[data-testid='model-select']")).toBeVisible();
    await expect(firstWindow.locator("[data-testid='attach-button']")).toBeVisible();
  });

  test("REQ-AGENT-071 标准 5：auto 切换无额外提示", async () => {
    // S5 接线：建会话并打开 + 先切 strict 再切 auto（真实切换链路——直接切 auto
    // 与默认首档相同，切换为 no-op）。
    const spaceKey = await createSession(apiBaseUrl, { spaceKind: "general" });
    await openSession(firstWindow, spaceKey);

    await firstWindow.click(MODE_TRIGGER);
    await firstWindow.click(MODE_OPTION("strict"));
    await expect(firstWindow.locator(MODE_TRIGGER)).toContainText("严格");
    await firstWindow.click(MODE_TRIGGER);
    await firstWindow.click(MODE_OPTION("auto"));
    await expect(firstWindow.locator(MODE_TRIGGER)).toContainText("自动");
    // 切换后无 toast/banner（宽松：无 data-testid 提示条出现）
    // TODO: HUMAN ASSERTION — 确认无提示条（mode 切换即生效）
    const banners = await firstWindow.locator("[data-testid*='mode-toast'], [data-testid*='mode-banner']").count();
    expect(banners).toBe(0);
  });

  test("REQ-AGENT-072 标准 2（E2E 面）：新会话初始模式 = lastMode", async () => {
    // S5 接线修正（S4 concern 2）：前置建会话——切档经真实链路（点击 → PUT /mode
    // → 会话状态 + settings lastMode 持久化）→ reload 后 GET /mode 取位。
    // 切 strict 而非 auto：默认首档 = auto（标准 3），切 strict 使模式真实变化——
    // 持久化链路失效时 reload 后回落 auto，断言可区分（旧写法 auto→auto 恒绿不
    // 能证明 lastMode 持久化生效）。
    const spaceKey = await createSession(apiBaseUrl, { spaceKind: "general" });
    await openSession(firstWindow, spaceKey);

    // 首次（无 lastMode 记录）→ 默认 auto（REQ-AGENT-072 标准 3）
    await expect(firstWindow.locator(MODE_TRIGGER)).toContainText("自动");

    // 切到 strict（真实切换：PUT /mode → lastMode=strict 持久化）
    await firstWindow.click(MODE_TRIGGER);
    await firstWindow.click(MODE_OPTION("strict"));
    // TODO: HUMAN ASSERTION — 确认触发按钮显示「严格」（当前档更新）
    await expect(firstWindow.locator(MODE_TRIGGER)).toContainText("严格");

    // reload（重开应用）→ 初始模式 = lastMode = strict（GET /mode 取位生效）
    await firstWindow.reload();
    await expect(firstWindow.locator(SCREEN_ASSISTANT)).toBeVisible();
    // TODO: HUMAN ASSERTION — 确认 reload 后初始模式 = strict（lastMode 生效）
    await expect(firstWindow.locator(MODE_TRIGGER)).toContainText("严格");
  });
});
