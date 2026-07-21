// REQ-TRACE: 2026-07-19-media-production-line/REQ-CHANNEL-001
// REQ-VERSION: v1-hash:de43bc8607a89efe5512712a188a5f24f259d8109cb31a7a476827dd0883fab9
// CAPABILITY-TRACE: channel-integration
// ENTITY-TRACE: channel
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: false

/**
 * 设置页飞书通道配置区块回归测试。
 * UX 原型映射：ux/settings-channel.html
 *  - Settings 页必须包含「飞书通道」配置卡片。
 *  - 卡片内包含 App ID / App Secret 输入框、「保存凭据并连接」按钮、
 *    状态徽标与「重新连接」按钮。
 *  - 保存错误凭据后显示离线/错误状态（不阻塞保存）。
 */

const { test, expect } = require("@playwright/test");
const { startElectronApp, stopElectronApp } = require("../../../../../e2e/fixtures/electronApp.cjs");
const locators = require("../../../../../e2e/helpers/locators.cjs");

async function setChannelDomain(apiBaseUrl, userDataDir) {
  // 把 channelDomain 指向本地 fake 路径，避免 E2E 访问真实飞书服务器。
  const res = await fetch(`${apiBaseUrl}/api/settings`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ channelDomain: `${apiBaseUrl}/fake-feishu` })
  });
  if (!res.ok) throw new Error("Failed to seed channelDomain");
}

test.describe("REQ-CHANNEL-001 设置页飞书通道配置", () => {
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
    await setChannelDomain(apiBaseUrl, userDataDir);
  });

  test.afterEach(async () => {
    await stopElectronApp(electronApp, userDataDir);
  });

  test("设置页包含飞书通道配置区块", async () => {
    await firstWindow.click(locators.SETTINGS_LINK);
    await expect(firstWindow.locator("[data-testid='channel-settings-card']")).toBeVisible();
    await expect(firstWindow.locator("[data-testid='channel-app-id-input']")).toBeVisible();
    await expect(firstWindow.locator("[data-testid='channel-app-secret-input']")).toBeVisible();
    await expect(firstWindow.locator("[data-testid='save-channel-credentials-button']")).toBeVisible();
    await expect(firstWindow.locator("[data-testid='reconnect-channel-button']")).toBeVisible();
  });

  test("保存无效凭据后显示离线/错误状态", async () => {
    await firstWindow.click(locators.SETTINGS_LINK);

    await firstWindow.locator("[data-testid='channel-app-id-input']").fill("cli_test_invalid");
    await firstWindow.locator("[data-testid='channel-app-secret-input']").fill("invalid-secret");
    await firstWindow.locator("[data-testid='save-channel-credentials-button']").click();

    const badge = firstWindow.locator("[data-testid='channel-status-badge']");
    await expect(badge).toBeVisible();
    // 错误凭据或 fake 端点 404 都会让 adapter 进入 offline。
    await expect(badge).toHaveAttribute("data-status", "offline");
    await expect(firstWindow.locator("[data-testid='channel-status-error']")).toBeVisible();
  });
});
