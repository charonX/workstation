// REQ-TRACE: 2026-08-02-builtin-agent/REQ-AGENT-023, REQ-AGENT-024, REQ-AGENT-025
// REQ-VERSION: v1-hash:16f30c7bbd781fb9f86f573f3c92dc0c96a1aa38aecf3bd08c54caa0cdb712f4
// CAPABILITY-TRACE: agent-dialogue
// ENTITY-TRACE: settings
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true (2026-08-05 incremental assertion signoff)

// REQ-AGENT-023~025：Settings 页 tab 化与分区保存（PRD 稳定块 S10，
// UX 参照 .aiassist/stories/2026-08-02-builtin-agent/ux/settings-tabs.html）。
//
// 实现约定（待 implementer 落地，testid/属性与本文件保持一致）：
//   [role='tablist']                    tab 栏容器
//   [role='tab'][data-tab='<name>']     四个 tab；name ∈ general|agent|channel|about
//   aria-selected                       当前 tab 为 "true"，其余 "false"
//   [data-tab-panel='<name>']           四个面板；未选中面板 hidden（不可见）
//   save-general-settings-button        通用 tab 区内保存按钮（新增）
//   general-settings-success            通用 tab 保存成功反馈（新增）
//   （沿用）settings-form                通用 tab 表单容器
//   （沿用）agent-* / channel-* / update-* 各区 testid 不变
//   （移除）save-settings-button         右上角全局保存按钮不再存在
//
// 说明：
// - 默认语言 en-US（settingsService 默认）；中文文案断言统一先 PATCH language=zh-CN
//   再 reload（S10 拍板文案为中文原型）。
// - en-US 下四个 tab 与 API key placeholder 的英文译文：签核裁决 2（2026-08-05）——
//   实现按 i18n 惯例直译，英文观感入 REFLECT 人工验收；本文件只签 zh-CN 文案。

const { test, expect } = require("@playwright/test");
const { startElectronApp, stopElectronApp } = require("../../../../../e2e/fixtures/electronApp.cjs");
const { goToAdminRoute } = require("../../../../../e2e/helpers/navigation.cjs");
const locators = require("../../../../../e2e/helpers/locators.cjs");

const TAB_NAMES = ["general", "agent", "channel", "about"];
const tab = (page, name) => page.locator(`[role='tab'][data-tab='${name}']`);
const panel = (page, name) => page.locator(`[data-tab-panel='${name}']`);

async function openSettings(page) {
  // T-8 适配（2026-08-06）：默认落地 = 会话区（/assistant，REQ-AGENT-026 AC1）——
  // 管理区左导 nav-settings 不在会话区；直接 goto 设置路由（管理区壳，AC5）；
  // 断言语义不变。
  await goToAdminRoute(page, "#/settings");
  await expect(page.locator(locators.SETTINGS_PAGE)).toBeVisible();
}

test.describe("Settings 页 tab 化与分区保存", () => {
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

  test("REQ-AGENT-023 AC1: tab 栏四 tab + aria 语义 + 默认通用选中", async () => {
    await openSettings(firstWindow);

    await expect(firstWindow.locator("[role='tablist']")).toBeVisible();
    await expect(firstWindow.locator("[role='tab']")).toHaveCount(TAB_NAMES.length);
    for (const name of TAB_NAMES) {
      await expect(tab(firstWindow, name)).toBeVisible();
    }

    // 默认选中「通用」，其余未选中；通用面板可见，其余面板不可见。
    await expect(tab(firstWindow, "general")).toHaveAttribute("aria-selected", "true");
    for (const name of ["agent", "channel", "about"]) {
      await expect(tab(firstWindow, name)).toHaveAttribute("aria-selected", "false");
      await expect(panel(firstWindow, name)).toBeHidden();
    }
    await expect(panel(firstWindow, "general")).toBeVisible();
  });

  test("REQ-AGENT-023 AC1/AC3: tab 中文文案与 API key placeholder（zh-CN）", async () => {
    // S10 拍板文案为中文；先切语言再断言（英文译文见文件头 TODO）。
    await openSettings(firstWindow);
    await fetch(`${apiBaseUrl}/api/settings`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ language: "zh-CN" }),
    });
    await firstWindow.reload();
    await openSettings(firstWindow);

    await expect(tab(firstWindow, "general")).toHaveText("通用");
    await expect(tab(firstWindow, "agent")).toHaveText("Agent 配置");
    await expect(tab(firstWindow, "channel")).toHaveText("飞书通道");
    await expect(tab(firstWindow, "about")).toHaveText("关于与更新");

    await tab(firstWindow, "agent").click();
    await expect(firstWindow.locator("[data-testid='agent-api-key-input']")).toHaveAttribute(
      "placeholder",
      "已加密存储，输入则更换"
    );
  });

  test("REQ-AGENT-023 AC1: 点击 tab 切换面板显隐与 aria-selected 联动", async () => {
    await openSettings(firstWindow);

    for (const name of ["agent", "channel", "about", "general"]) {
      await tab(firstWindow, name).click();
      await expect(tab(firstWindow, name)).toHaveAttribute("aria-selected", "true");
      await expect(panel(firstWindow, name)).toBeVisible();
      for (const other of TAB_NAMES.filter((n) => n !== name)) {
        await expect(tab(firstWindow, other)).toHaveAttribute("aria-selected", "false");
        await expect(panel(firstWindow, other)).toBeHidden();
      }
    }
  });

  test("REQ-AGENT-023 AC2: 各区内容归入对应 tab", async () => {
    await openSettings(firstWindow);

    // 通用（默认面板）：工作区/技能库/主题/语言/密度
    await expect(firstWindow.locator(locators.WORKSPACE_ROOT_INPUT)).toBeVisible();
    await expect(firstWindow.locator(locators.SKILL_REPO_PATH_INPUT)).toBeVisible();
    await expect(firstWindow.locator(locators.THEME_SELECT)).toBeVisible();
    await expect(firstWindow.locator(locators.LANGUAGE_SELECT)).toBeVisible();
    await expect(firstWindow.locator(locators.DENSITY_SELECT)).toBeVisible();

    // Agent 配置：供应商/key/测试连接/身份/绑定（未绑定态为开始绑定入口）
    await tab(firstWindow, "agent").click();
    await expect(firstWindow.locator("[data-testid='agent-provider-select']")).toBeVisible();
    await expect(firstWindow.locator("[data-testid='agent-api-key-input']")).toBeVisible();
    await expect(firstWindow.locator("[data-testid='agent-test-connection-button']")).toBeVisible();
    await expect(firstWindow.locator("[data-testid='agent-identity-input']")).toBeVisible();
    await expect(firstWindow.locator("[data-testid='agent-begin-binding-button']")).toBeVisible();

    // 飞书通道：App ID/App Secret/重连
    await tab(firstWindow, "channel").click();
    await expect(firstWindow.locator("[data-testid='channel-app-id-input']")).toBeVisible();
    await expect(firstWindow.locator("[data-testid='channel-app-secret-input']")).toBeVisible();
    await expect(firstWindow.locator("[data-testid='reconnect-channel-button']")).toBeVisible();

    // 关于与更新：版本/检查更新
    await tab(firstWindow, "about").click();
    await expect(firstWindow.locator(locators.UPDATE_VERSION)).toBeVisible();
    await expect(firstWindow.locator(locators.UPDATE_CHECK_BUTTON)).toBeVisible();
  });

  test("REQ-AGENT-024 AC1: 全局保存移除，分区保存各就各位，关于 tab 只读", async () => {
    await openSettings(firstWindow);

    // 右上角全局保存不再存在于页面任何位置。
    await expect(firstWindow.locator("[data-testid='save-settings-button']")).toHaveCount(0);

    await expect(firstWindow.locator(locators.SAVE_GENERAL_SETTINGS_BUTTON)).toBeVisible();

    await tab(firstWindow, "agent").click();
    await expect(firstWindow.locator("[data-testid='save-agent-config-button']")).toBeVisible();

    await tab(firstWindow, "channel").click();
    await expect(firstWindow.locator("[data-testid='save-channel-credentials-button']")).toBeVisible();

    // 关于 tab 只读：面板内无任何保存按钮。
    await tab(firstWindow, "about").click();
    await expect(panel(firstWindow, "about").locator("button[data-testid*='save']")).toHaveCount(0);
  });

  test("REQ-AGENT-024 AC2: 通用保存请求体仅含通用字段，区内显示成功反馈", async () => {
    await openSettings(firstWindow);

    let capturedBody = null;
    await firstWindow.route("**/api/settings", async (route) => {
      if (route.request().method() === "PATCH") {
        capturedBody = route.request().postDataJSON();
      }
      await route.continue();
    });

    await firstWindow.click(locators.SAVE_GENERAL_SETTINGS_BUTTON);

    await expect(firstWindow.locator(locators.GENERAL_SETTINGS_SUCCESS)).toBeVisible();
    expect(capturedBody).not.toBeNull();
    const allowedKeys = ["workspaceRoot", "skillRepoPath", "theme", "language", "density"];
    for (const key of Object.keys(capturedBody)) {
      expect(allowedKeys).toContain(key);
    }
    expect(capturedBody).not.toHaveProperty("agent");
    expect(capturedBody).not.toHaveProperty("channelCredentials");
    expect(capturedBody).not.toHaveProperty("apiKey");
  });

  test("REQ-AGENT-024 AC3: Agent 保存 keepExistingKey——未输新 key 请求体不含 apiKey", async () => {
    // 预置已配置状态（E2E 假 key，仅用于接通已配置路径）。
    const seed = await fetch(`${apiBaseUrl}/api/settings/agent`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "deepseek", apiKey: "sk-e2e-placeholder-key", identity: "" }),
    });
    expect(seed.ok).toBe(true);

    await openSettings(firstWindow);
    await tab(firstWindow, "agent").click();
    await expect(firstWindow.locator("[data-testid='agent-config-status-badge']")).toBeVisible();

    let capturedBody = null;
    await firstWindow.route("**/api/settings/agent", async (route) => {
      if (route.request().method() === "PUT") {
        capturedBody = route.request().postDataJSON();
      }
      await route.continue();
    });

    // 不输入新 key 直接保存（key 永不回显，输入框为空）。
    await firstWindow.click("[data-testid='save-agent-config-button']");

    await expect(firstWindow.locator("[data-testid='agent-settings-success']")).toBeVisible();
    expect(capturedBody).not.toBeNull();
    expect(capturedBody.apiKey).toBeUndefined();
  });

  test("REQ-AGENT-024 AC4: 飞书通道保存提交 appId/appSecret，区内显示成功反馈", async () => {
    await openSettings(firstWindow);
    await tab(firstWindow, "channel").click();

    // 保存会触发 adapter 重启连接飞书；E2E 不依赖真实外网，mock 成功响应。
    let capturedBody = null;
    await firstWindow.route("**/api/channel/credentials", async (route) => {
      capturedBody = route.request().postDataJSON();
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({ appId: capturedBody.appId, status: "online", error: null }),
      });
    });

    await firstWindow.fill("[data-testid='channel-app-id-input']", "cli_e2e_placeholder");
    await firstWindow.fill("[data-testid='channel-app-secret-input']", "e2e-placeholder-secret");
    await firstWindow.click("[data-testid='save-channel-credentials-button']");

    await expect(firstWindow.locator("[data-testid='channel-status-success']")).toBeVisible();
    expect(capturedBody).toEqual({ appId: "cli_e2e_placeholder", appSecret: "e2e-placeholder-secret" });
  });

  test("REQ-AGENT-024 AC5: Agent 保存失败，错误显示在 Agent tab 区内", async () => {
    await openSettings(firstWindow);
    await tab(firstWindow, "agent").click();

    await firstWindow.route("**/api/settings/agent", async (route) => {
      if (route.request().method() === "PUT") {
        await route.fulfill({
          status: 400,
          contentType: "application/json",
          body: JSON.stringify({ message: "API key 不能为空", error: "E-CONFIG-INVALID" }),
        });
      } else {
        await route.continue();
      }
    });

    // 输入 key 绕过客户端非空校验，让请求真实发出。
    await firstWindow.fill("[data-testid='agent-api-key-input']", "sk-e2e-invalid-key");
    await firstWindow.click("[data-testid='save-agent-config-button']");

    await expect(panel(firstWindow, "agent").locator("[data-testid='agent-settings-error']")).toBeVisible();
    // 错误文案透传（如「API key 不能为空」）由 API 层测试断言（签核裁决 1），
    // 本用例只签「错误显示在对应 tab 区内」这一结构行为。
  });

  test("REQ-AGENT-025 AC1: 未保存编辑跨 tab 切换保留且不生效", async () => {
    await openSettings(firstWindow);
    const initialTheme = await firstWindow.locator("html").getAttribute("data-theme");

    // 通用 tab：改主题不保存
    await firstWindow.selectOption(locators.THEME_SELECT, initialTheme === "dark" ? "light" : "dark");
    const unsavedTheme = initialTheme === "dark" ? "light" : "dark";

    // Agent tab：改身份不保存
    await tab(firstWindow, "agent").click();
    await firstWindow.fill("[data-testid='agent-identity-input']", "未保存的身份草稿");

    // 切走再切回：两处编辑都在
    await tab(firstWindow, "channel").click();
    await tab(firstWindow, "general").click();
    await expect(firstWindow.locator(locators.THEME_SELECT)).toHaveValue(unsavedTheme);
    // 未保存的主题不生效
    await expect(firstWindow.locator("html")).toHaveAttribute("data-theme", initialTheme);

    await tab(firstWindow, "agent").click();
    await expect(firstWindow.locator("[data-testid='agent-identity-input']")).toHaveValue("未保存的身份草稿");
  });

  test("REQ-AGENT-025 AC2: tab 切换不触发任何保存请求", async () => {
    await openSettings(firstWindow);

    const mutations = [];
    firstWindow.on("request", (req) => {
      if (req.url().includes("/api/") && req.method() !== "GET") {
        mutations.push(`${req.method()} ${req.url()}`);
      }
    });

    for (const name of ["agent", "channel", "about", "general"]) {
      await tab(firstWindow, name).click();
      await expect(panel(firstWindow, name)).toBeVisible();
    }

    expect(mutations).toEqual([]);
  });
});
