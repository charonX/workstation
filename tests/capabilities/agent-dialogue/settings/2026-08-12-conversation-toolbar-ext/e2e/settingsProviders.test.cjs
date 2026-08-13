// REQ-TRACE: 2026-08-12-conversation-toolbar-ext/REQ-AGENT-091
// REQ-VERSION: v1-hash:ff3ce6c28851eddb44986c153881ae32c5547116942bab700427cfca94e46514
// CAPABILITY-TRACE: agent-dialogue
// ENTITY-TRACE: settings
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true

// Settings 多 provider 管理 UI（REQ-AGENT-091，B1）。
//
// UX 参照：ux/settings-providers.html：
//   [data-testid='provider-entry']          条目容器（provider 名 + 模型 chips + 默认徽标）
//   [data-testid='entry-models']            条目模型区
//   [data-testid='model-chip']              模型 chip（含星标：移动默认组合）
//   添加表单：provider 下拉 + key + 模型多选（勾选子集）+ 保存
//
// 环境：FAUX + startElectronApp（既有 fixture）+ 新形态 settings seed。
// 断言语义：元素存在/可见性/状态切换，不验像素。

const { test, expect } = require("@playwright/test");
const { startElectronApp, stopElectronApp } = require("../../../../../e2e/fixtures/electronApp.cjs");
const { goToAdminRoute } = require("../../../../../e2e/helpers/navigation.cjs");
const locators = require("../../../../../e2e/helpers/locators.cjs");

const TAB_AGENT = "[role='tab'][data-tab='agent']";
const PANEL_AGENT = "[data-tab-panel='agent']";
const PROVIDER_ENTRY = "[data-testid='provider-entry']";
const ENTRY_MODELS = "[data-testid='entry-models']";
const MODEL_CHIP = "[data-testid='model-chip']";

// 新形态 settings seed（存量迁移等价物：旧单条 → 第一条 + 默认）
async function seedAgentConfig(apiBaseUrl, providers, defaultModel) {
  const res = await fetch(`${apiBaseUrl}/api/settings/agent`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identity: "", providers, defaultModel }),
  });
  expect(res.ok).toBe(true);
}

async function openSettings(page) {
  await goToAdminRoute(page, "#/settings");
  await expect(page.locator(locators.SETTINGS_PAGE)).toBeVisible();
  await page.click(TAB_AGENT);
  await expect(page.locator(PANEL_AGENT)).toBeVisible();
}

test.describe("Settings 多 provider 管理（E2E）", () => {
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

  test("标准 1：显示条目列表（provider + 模型 chips + 唯一默认徽标）", async () => {
    await firstWindow.reload();
    await openSettings(firstWindow);
    await expect(firstWindow.locator(PROVIDER_ENTRY)).toHaveCount(2);
    // 默认组合唯一：默认徽标仅 1 个，且落在 kimi-k3 chip 上（seed defaultModel）
    await expect(firstWindow.locator(MODEL_CHIP + ".default")).toHaveCount(1);
    await expect(firstWindow.locator(MODEL_CHIP + ".default")).toContainText("kimi-k3");
  });

  test("标准 2：添加条目（provider+key → 拉取列表 → 勾选子集 → 保存 → 列表更新）", async () => {
    await firstWindow.reload();
    await openSettings(firstWindow);
    await firstWindow.click("[data-testid='add-provider-button']");
    // 填 key → 模型多选区出现拉取结果（kimi 含能力标签）
    await firstWindow.fill("[data-testid='provider-key-input']", "sk-e2e-new");
    await expect(firstWindow.locator("[data-testid='model-option']").first()).toBeVisible();
    // 勾选 2 个模型子集 → 保存 → 新条目出现且含勾选模型
    const opts = firstWindow.locator("[data-testid='model-option'] input[type='checkbox']");
    await opts.nth(0).check();
    await opts.nth(1).check();
    await firstWindow.click("[data-testid='save-provider']");
    await expect(firstWindow.locator(PROVIDER_ENTRY)).toHaveCount(3);
  });

  test("标准 3：星标切换默认组合（全局唯一）", async () => {
    await firstWindow.reload();
    await openSettings(firstWindow);
    // 点 deepseek chip 星标 → 默认徽标移动到 deepseek；刷新后保持（PUT settings 持久化）
    await firstWindow.click("[data-testid='model-chip'][data-provider='deepseek'] .star");
    await expect(firstWindow.locator(MODEL_CHIP + ".default")).toHaveCount(1);
    await expect(firstWindow.locator(MODEL_CHIP + ".default")).toContainText("deepseek-v4-flash");
    await firstWindow.reload();
    await openSettings(firstWindow);
    await expect(firstWindow.locator(MODEL_CHIP + ".default")).toContainText("deepseek-v4-flash");
  });

  test("标准 4：删除条目（默认条目被删 → 默认重定向剩余条目）", async () => {
    await firstWindow.reload();
    await openSettings(firstWindow);
    firstWindow.on("dialog", (d) => d.accept()); // 删除确认（原型语义）
    await firstWindow.locator(PROVIDER_ENTRY).first().locator("[data-testid='delete-provider']").click();
    await expect(firstWindow.locator(PROVIDER_ENTRY)).toHaveCount(1);
    // 默认重定向：唯一剩余条目（deepseek）成为默认
    await expect(firstWindow.locator(MODEL_CHIP + ".default")).toContainText("deepseek-v4-flash");
  });

  test("标准 5：存量迁移提示可见", async () => {
    // 旧格式 settings（无 providers 字段）→ 迁移提示 + 第一条带默认徽标
    const res = await fetch(`${apiBaseUrl}/api/settings/agent`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "moonshotai", apiKey: "sk-legacy", identity: "" }), // 旧格式
    });
    expect(res.ok).toBe(true);
    await firstWindow.reload();
    await openSettings(firstWindow);
    await expect(firstWindow.locator("[data-testid='migrate-note']")).toBeVisible();
    await expect(firstWindow.locator(MODEL_CHIP + ".default")).toContainText("kimi-k3");
  });
});
