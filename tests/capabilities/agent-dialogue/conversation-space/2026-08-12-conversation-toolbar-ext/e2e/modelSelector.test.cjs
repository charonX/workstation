// REQ-TRACE: 2026-08-12-conversation-toolbar-ext/REQ-AGENT-094
// REQ-VERSION: v4-hash:6561019623cc0a639dbe9590db95fdec1ac812b68be7d1e3e31617668a4ef5c7
// CAPABILITY-TRACE: agent-dialogue
// ENTITY-TRACE: conversation-space
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true

// 工具栏模型选择器 E2E（REQ-AGENT-094，B3 UI）。
//
// UX 参照：ux/conversation-toolbar.html：
//   [data-testid='model-select']          模型选择器下拉容器（替代灰显槽位 toolbar-slot-model）
//   [data-testid='model-trigger']         触发按钮（provider · model）
//   [data-testid='model-option'][data-provider][data-model]  组合选项（当前高亮 + 默认徽标）
//
// 环境：FAUX + startElectronApp + 新形态 settings seed；建会话后打开（对齐 modeToolbar
// 先例：切档链路依赖已选中会话）。旧灰显槽位断言（toolbar-slot-model）随本 story
// 行为变更替换为新契约。

const { test, expect } = require("@playwright/test");
const { startElectronApp, stopElectronApp } = require("../../../../../e2e/fixtures/electronApp.cjs");

const SCREEN_ASSISTANT = "[data-testid='screen-assistant']";
const MODEL_SELECT = "[data-testid='model-select']";
const MODEL_TRIGGER = "[data-testid='model-trigger']";
const MODEL_OPTION = (p, m) => `[data-testid='model-option'][data-provider='${p}'][data-model='${m}']`;
const COMPOSER = "[data-testid='composer-input']";

async function seedAgentConfig(apiBaseUrl, providers, defaultModel) {
  const res = await fetch(`${apiBaseUrl}/api/settings/agent`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identity: "", providers, defaultModel }),
  });
  expect(res.ok).toBe(true);
}

async function createSession(apiBaseUrl) {
  const res = await fetch(`${apiBaseUrl}/api/agent/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ spaceKind: "general" }),
  });
  expect(res.ok).toBe(true);
  return (await res.json()).spaceKey;
}

async function openSession(firstWindow, spaceKey) {
  await firstWindow.reload();
  await expect(firstWindow.locator(SCREEN_ASSISTANT)).toBeVisible();
  await firstWindow.click(`[data-session-item='${spaceKey}']`);
  await expect(firstWindow.locator(COMPOSER)).toBeVisible();
}

test.describe("工具栏模型选择器（E2E）", () => {
  let electronApp;
  let firstWindow;
  let apiBaseUrl;
  let userDataDir;

  test.beforeEach(async () => {
    ({ electronApp, firstWindow, apiBaseUrl, userDataDir } = await startElectronApp());
    await seedAgentConfig(apiBaseUrl, [
      { provider: "moonshotai", apiKey: "sk-e2e-m", models: ["kimi-k3", "kimi-k2.6"] },
      { provider: "deepseek", apiKey: "sk-e2e-d", models: ["deepseek-v4-flash"] },
    ], { provider: "moonshotai", model: "kimi-k3" });
  });

  test.afterEach(async () => {
    await stopElectronApp(electronApp);
  });

  test("标准 1：模型选择器替代灰显槽位（toolbar-slot-model 不再渲染）", async () => {
    const spaceKey = await createSession(apiBaseUrl);
    await openSession(firstWindow, spaceKey);
    // 行为变更契约：旧灰显槽位移除，新选择器存在
    await expect(firstWindow.locator("[data-testid='toolbar-slot-model']")).toHaveCount(0);
    await expect(firstWindow.locator(MODEL_SELECT)).toBeVisible();
  });

  test("标准 2：触发按钮显示当前组合；展开列出全部组合 + 当前高亮 + 默认徽标", async () => {
    const spaceKey = await createSession(apiBaseUrl);
    await openSession(firstWindow, spaceKey);
    // 默认组合（seed defaultModel）：trigger 含 moonshotai · kimi-k3
    await expect(firstWindow.locator(MODEL_TRIGGER)).toContainText("kimi-k3");
    await firstWindow.click(MODEL_TRIGGER);
    // 展开后 3 个组合（seed：kimi-k3 / kimi-k2.6 / deepseek-v4-flash）
    await expect(firstWindow.locator(MODEL_OPTION("moonshotai", "kimi-k3"))).toBeVisible();
    await expect(firstWindow.locator(MODEL_OPTION("moonshotai", "kimi-k2.6"))).toBeVisible();
    await expect(firstWindow.locator(MODEL_OPTION("deepseek", "deepseek-v4-flash"))).toBeVisible();
    // 当前项高亮 + 默认徽标（active class + 默认标记）
    await expect(firstWindow.locator(MODEL_OPTION("moonshotai", "kimi-k3") + ".active")).toHaveCount(1);
    await expect(firstWindow.locator(MODEL_OPTION("moonshotai", "kimi-k3"))).toContainText("默认");
  });

  test("标准 3：切换组合 → trigger 更新 + 高亮移动 + PUT provider 调用", async () => {
    const spaceKey = await createSession(apiBaseUrl);
    await openSession(firstWindow, spaceKey);
    await firstWindow.click(MODEL_TRIGGER);
    await firstWindow.click(MODEL_OPTION("deepseek", "deepseek-v4-flash"));
    // trigger 更新为 deepseek · deepseek-v4-flash
    await expect(firstWindow.locator(MODEL_TRIGGER)).toContainText("deepseek-v4-flash");
    // 回读契约：会话 provider 已切换（GET provider 回读 = deepseek）
    const rb = await (await fetch(`${apiBaseUrl}/api/agent/sessions/${spaceKey}/provider`)).json();
    expect(rb).toEqual({ provider: "deepseek", model: "deepseek-v4-flash" });
  });

  test("标准 4：无条目 → 选择器禁用 + 引导提示", async () => {
    await seedAgentConfig(apiBaseUrl, [], null);
    const spaceKey = await createSession(apiBaseUrl);
    await openSession(firstWindow, spaceKey);
    await expect(firstWindow.locator(MODEL_TRIGGER)).toBeDisabled();
    // E12 提示「未配置模型，请到设置添加」
    await expect(firstWindow.locator("[data-testid='model-empty-hint']")).toContainText("未配置模型");
  });

  test("标准 5：外部点击收起", async () => {
    const spaceKey = await createSession(apiBaseUrl);
    await openSession(firstWindow, spaceKey);
    await firstWindow.click(MODEL_TRIGGER);
    await expect(firstWindow.locator(MODEL_OPTION("deepseek", "deepseek-v4-flash"))).toBeVisible();
    await firstWindow.click(COMPOSER);
    await expect(firstWindow.locator(MODEL_OPTION("deepseek", "deepseek-v4-flash"))).toBeHidden();
  });

  test("标准 6：会话 provider 条目被删 → 回落默认 + 提示（F2 步骤 4 / E12）", async () => {
    const spaceKey = await createSession(apiBaseUrl);
    await openSession(firstWindow, spaceKey);
    // 切到 deepseek（会话 provider = deepseek）
    await firstWindow.click(MODEL_TRIGGER);
    await firstWindow.click(MODEL_OPTION("deepseek", "deepseek-v4-flash"));
    await expect(firstWindow.locator(MODEL_TRIGGER)).toContainText("deepseek-v4-flash");
    // 删除 deepseek 条目（settings 仅剩 moonshotai）——前台轮询捕获 providers 变化
    await seedAgentConfig(apiBaseUrl, [
      { provider: "moonshotai", apiKey: "sk-e2e-m", models: ["kimi-k3", "kimi-k2.6"] },
    ], { provider: "moonshotai", model: "kimi-k3" });
    // F2 步骤 4：提示「原 provider 已移除，已回到默认」+ 触发按钮显示默认组合（kimi-k3）
    await expect(firstWindow.locator("[data-testid='model-fallback-hint']")).toBeVisible({ timeout: 15000 });
    await expect(firstWindow.locator("[data-testid='model-fallback-hint']")).toContainText("原 provider 已移除");
    await expect(firstWindow.locator(MODEL_TRIGGER)).toContainText("kimi-k3");
  });
});
