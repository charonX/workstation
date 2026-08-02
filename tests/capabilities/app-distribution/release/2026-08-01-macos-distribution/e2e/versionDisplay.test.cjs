// REQ-TRACE: 2026-08-01-macos-distribution/REQ-DIST-002, 2026-08-01-macos-distribution/REQ-DIST-003, 2026-08-01-macos-distribution/REQ-DIST-004
// REQ-VERSION: v1-hash:3167cf207baf471a951b02c4bd09915f1cd79b25cab37ebdb4632c3bb2d63b10
// CAPABILITY-TRACE: app-distribution
// ENTITY-TRACE: release
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true (2026-08-02 assertion signoff)

const { test, expect } = require("@playwright/test");
const { startElectronApp, stopElectronApp } = require("../../../../../e2e/fixtures/electronApp.cjs");
const locators = require("../../../../../e2e/helpers/locators.cjs");

// REQ-DIST-002/003/004：Settings 页"关于/更新"区（版本号 + 检查更新 + 引导文案）。
//
// 实现约定（待 implementer 落地，testid 保持一致）：
//   update-section       关于/更新区容器
//   update-version       当前版本号
//   update-check-button  检查更新按钮
//   update-status        检查结果状态区（三种状态之一）
//   update-guide         首次安装引导文案
//
// 说明：检查更新的"有新版/无新版"具体状态依赖真实 GitHub release（E2E 无法稳定
// 复现），E2E 只断言结构与交互存在性；状态逻辑由 api/checkUpdates.test.js 单元覆盖。

test.describe("Settings 关于/更新区", () => {
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

  test("REQ-DIST-003: 当前版本号可见且非空", async () => {
    await firstWindow.click(locators.SETTINGS_LINK);
    await expect(firstWindow.locator(locators.SETTINGS_PAGE)).toBeVisible();
    const version = firstWindow.locator(locators.UPDATE_VERSION);
    await expect(version).toBeVisible();
    // 断言（签核 2026-08-02）：版本号文本非空；与 package.json 一致由实现保证（弱断言）
    expect((await version.textContent()).trim().length).toBeGreaterThan(0);
  });

  test("REQ-DIST-002 AC8: 检查更新按钮存在，点击后出现状态区", async () => {
    await firstWindow.click(locators.SETTINGS_LINK);
    await expect(firstWindow.locator(locators.UPDATE_SECTION)).toBeVisible();
    await firstWindow.locator(locators.UPDATE_CHECK_BUTTON).click();
    // 三种状态之一（有新版/已最新/检查失败）——宽松断言：状态区可见
    await expect(firstWindow.locator(locators.UPDATE_STATUS)).toBeVisible({ timeout: 15000 });
  });

  test("REQ-DIST-004 AC2: 首次安装引导文案存在", async () => {
    await firstWindow.click(locators.SETTINGS_LINK);
    const guide = firstWindow.locator(locators.UPDATE_GUIDE);
    await expect(guide).toBeVisible();
    // 断言（签核 2026-08-02）：引导文案含批准路径关键词（System Settings/Privacy &
    // Security）与 /Applications 建议
    const text = await guide.textContent();
    expect(text).toMatch(/System Settings|Privacy & Security|Privacy &amp; Security/i);
    expect(text).toContain("/Applications");
  });
});
