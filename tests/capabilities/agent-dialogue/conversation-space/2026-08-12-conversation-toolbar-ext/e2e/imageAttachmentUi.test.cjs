// REQ-TRACE: 2026-08-12-conversation-toolbar-ext/REQ-AGENT-098
// REQ-VERSION: v4-hash:6561019623cc0a639dbe9590db95fdec1ac812b68be7d1e3e31617668a4ef5c7
// CAPABILITY-TRACE: agent-dialogue
// ENTITY-TRACE: conversation-space
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true

// 图片附件 UI + 非视觉阻止 E2E（REQ-AGENT-098，B6 前端）。
//
// UX 参照：ux/conversation-toolbar.html：
//   [data-testid='attach-button']      附件按钮（替代灰显槽位 toolbar-slot-attach）
//   [data-testid='attachment-chip']    附件 chip（输入区上方行，可移除）
//   [data-testid='msg-attachment']     消息附件块
//   非视觉阻止提示（E11 文案「当前模型不支持图片…」）
//
// 环境：FAUX + startElectronApp + 新形态 settings seed。文件选择器用
//   page.setInputFiles 或 Electron 侧注入（真实文件路径 + File.path 语义）。
// 视觉能力判定 = 会话当前模型（pi-ai input.includes('image')：kimi-k3 ✓ / deepseek ✗）。

const { test, expect } = require("@playwright/test");
const { startElectronApp, stopElectronApp } = require("../../../../../e2e/fixtures/electronApp.cjs");
const path = require("node:path");

const SCREEN_ASSISTANT = "[data-testid='screen-assistant']";
const ATTACH_BUTTON = "[data-testid='attach-button']";
const ATTACH_CHIP = "[data-testid='attachment-chip']";
const MSG_ATTACHMENT = "[data-testid='msg-attachment']";
const COMPOSER = "[data-testid='composer-input']";
const SEND_BUTTON = "[data-testid='send-button']";
const MODEL_TRIGGER = "[data-testid='model-trigger']";
const MODEL_OPTION = (p, m) => `[data-testid='model-option'][data-provider='${p}'][data-model='${m}']`;

// fixture 图片（复用 api 测试的 tiny.png；E2E 用真实小文件验证 File.path 链路）
const FIXTURE_PNG = path.join(__dirname, "..", "..", "..", "fixtures", "tiny.png");

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

test.describe("图片附件 UI + 非视觉阻止（E2E）", () => {
  let electronApp;
  let firstWindow;
  let apiBaseUrl;
  let userDataDir;

  test.beforeEach(async () => {
    ({ electronApp, firstWindow, apiBaseUrl, userDataDir } = await startElectronApp());
    await seedAgentConfig(apiBaseUrl, [
      { provider: "moonshotai", apiKey: "sk-e2e-m", models: ["kimi-k3"] },
      { provider: "deepseek", apiKey: "sk-e2e-d", models: ["deepseek-v4-flash"] },
    ], { provider: "moonshotai", model: "kimi-k3" });
  });

  test.afterEach(async () => {
    await stopElectronApp(electronApp);
  });

  test("标准 1：附件按钮替代灰显槽位（toolbar-slot-attach 不再渲染）", async () => {
    const spaceKey = await createSession(apiBaseUrl);
    await openSession(firstWindow, spaceKey);
    // 行为变更契约：旧灰显槽位移除，attach-button 存在
    await expect(firstWindow.locator("[data-testid='toolbar-slot-attach']")).toHaveCount(0);
    await expect(firstWindow.locator(ATTACH_BUTTON)).toBeVisible();
  });

  test("标准 2：选图 → chip 出现（名称+大小）→ 可移除 → 发送后消息附件块", async () => {
    const spaceKey = await createSession(apiBaseUrl);
    await openSession(firstWindow, spaceKey);
    // 确保 fixture 存在（API 测试的同款 tiny.png）
    ensureFixture();
    await firstWindow.setInputFiles("input[type='file']", FIXTURE_PNG);
    await expect(firstWindow.locator(ATTACH_CHIP)).toHaveCount(1);
    await expect(firstWindow.locator(ATTACH_CHIP)).toContainText("tiny.png");
    // 移除 → chip 消失
    await firstWindow.locator(ATTACH_CHIP).locator(".chip-remove").click();
    await expect(firstWindow.locator(ATTACH_CHIP)).toHaveCount(0);
    // 重新附加并发送 → 消息附件块出现
    await firstWindow.setInputFiles("input[type='file']", FIXTURE_PNG);
    await expect(firstWindow.locator(ATTACH_CHIP)).toHaveCount(1);
    await firstWindow.click(SEND_BUTTON);
    await expect(firstWindow.locator(MSG_ATTACHMENT)).toContainText("tiny.png");
  });

  test("标准 3：视觉模型（kimi）会话附加图片成功", async () => {
    const spaceKey = await createSession(apiBaseUrl);
    await openSession(firstWindow, spaceKey);
    // 默认组合 kimi-k3（视觉）：选图 → chip 可见、无阻止提示
    ensureFixture();
    await firstWindow.setInputFiles("input[type='file']", FIXTURE_PNG);
    await expect(firstWindow.locator(ATTACH_CHIP)).toHaveCount(1);
    await expect(firstWindow.locator("[data-testid='attach-blocked']")).toHaveCount(0);
  });

  test("标准 4：非视觉模型（deepseek）会话附加图片被阻止 + 提示", async () => {
    const spaceKey = await createSession(apiBaseUrl);
    await openSession(firstWindow, spaceKey);
    await firstWindow.click(MODEL_TRIGGER);
    await firstWindow.click(MODEL_OPTION("deepseek", "deepseek-v4-flash"));
    ensureFixture();
    await firstWindow.setInputFiles("input[type='file']", FIXTURE_PNG);
    // E11：无 chip + 阻止提示可见
    await expect(firstWindow.locator(ATTACH_CHIP)).toHaveCount(0);
    await expect(firstWindow.locator("[data-testid='attach-blocked']")).toContainText("当前模型不支持图片");
  });

  test("标准 5：附加后切换到非视觉模型再发送 → 发送时复核拦截", async () => {
    const spaceKey = await createSession(apiBaseUrl);
    await openSession(firstWindow, spaceKey);
    ensureFixture();
    await firstWindow.setInputFiles("input[type='file']", FIXTURE_PNG);
    await expect(firstWindow.locator(ATTACH_CHIP)).toHaveCount(1);
    // 切到 deepseek（非视觉）→ 发送 → 复核拦截：消息未发送 + 提示
    await firstWindow.click(MODEL_TRIGGER);
    await firstWindow.click(MODEL_OPTION("deepseek", "deepseek-v4-flash"));
    await firstWindow.click(SEND_BUTTON);
    await expect(firstWindow.locator(MSG_ATTACHMENT)).toHaveCount(0);
    await expect(firstWindow.locator("[data-testid='attach-blocked']")).toContainText("当前模型不支持图片");
  });

  test("标准 6：项目外图片直接附加（无确认弹窗、无特殊标记）", async () => {
    const spaceKey = await createSession(apiBaseUrl);
    await openSession(firstWindow, spaceKey);
    // 项目外路径（模拟 ~/Downloads）：dialog 监听断言零触发（附加即授权，A7）
    let dialogSeen = false;
    firstWindow.on("dialog", () => { dialogSeen = true; });
    ensureFixture();
    await firstWindow.setInputFiles("input[type='file']", FIXTURE_PNG); // fixture 路径位于测试目录（项目外）
    await expect(firstWindow.locator(ATTACH_CHIP)).toHaveCount(1);
    expect(dialogSeen).toBe(false);
  });

  test("标准 7：附件数量 >10 时第 11 个被拒 + 提示", async () => {
    const spaceKey = await createSession(apiBaseUrl);
    await openSession(firstWindow, spaceKey);
    ensureFixture();
    for (let i = 0; i < 10; i++) {
      await firstWindow.setInputFiles("input[type='file']", FIXTURE_PNG);
    }
    await expect(firstWindow.locator(ATTACH_CHIP)).toHaveCount(10);
    // 第 11 个被拒 + 数量提示（E5）
    await firstWindow.setInputFiles("input[type='file']", FIXTURE_PNG);
    await expect(firstWindow.locator(ATTACH_CHIP)).toHaveCount(10);
    await expect(firstWindow.locator("[data-testid='attach-blocked']")).toContainText("最多附加 10 个文件");
  });

  test("标准 8：新 provider 非视觉模型附加图片被阻止（catalog 数据生效，v0.6/REQ-102）", async () => {
    // 从 catalog 找一个非 deepseek 的 text-only 模型（数据驱动，不依赖具体 id）
    const catalog = await (await fetch(`${apiBaseUrl}/api/settings/agent/catalog`)).json();
    const entry = catalog.providers
      .filter((p) => !["deepseek", "moonshotai", "moonshotai-cn", "faux"].includes(p.provider))
      .map((p) => ({ provider: p.provider, model: p.models.find((m) => !m.vision) }))
      .find((x) => x.model);
    expect(entry, "目录中应存在非视觉模型（数据驱动前提）").toBeTruthy();
    // 先配置该 provider 条目（REQ-094「选择器仅列已配置条目」+ REQ-093「组合 ∈ 条目」契约），
    // 再建会话切换——切到已配置组合后附加图片被阻止（catalog 视觉数据生效）
    await seedAgentConfig(apiBaseUrl, [
      { provider: "moonshotai", apiKey: "sk-e2e-m", models: ["kimi-k3"] },
      { provider: entry.provider, apiKey: "sk-e2e-t", models: [entry.model.model] },
    ], { provider: "moonshotai", model: "kimi-k3" });
    const spaceKey = await createSession(apiBaseUrl);
    await openSession(firstWindow, spaceKey);
    await firstWindow.click(MODEL_TRIGGER);
    await firstWindow.click(MODEL_OPTION(entry.provider, entry.model.model));
    ensureFixture();
    await firstWindow.setInputFiles("input[type='file']", FIXTURE_PNG);
    await expect(firstWindow.locator(ATTACH_CHIP)).toHaveCount(0);
    await expect(firstWindow.locator("[data-testid='attach-blocked']")).toContainText("当前模型不支持图片");
  });

  test("标准 9：catalog 加载失败 → 附加图片保守拒绝（不静默放行，v0.6/REQ-102）", async () => {
    // mock catalog 失败（route 拦截 500）→ 视觉判定不可用 → 附加被拒
    await firstWindow.route("**/api/settings/agent/catalog", (route) =>
      route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "E-CATALOG" }) })
    );
    const spaceKey = await createSession(apiBaseUrl);
    await openSession(firstWindow, spaceKey);
    ensureFixture();
    await firstWindow.setInputFiles("input[type='file']", FIXTURE_PNG);
    await expect(firstWindow.locator(ATTACH_CHIP)).toHaveCount(0);
    await expect(firstWindow.locator("[data-testid='attach-blocked']")).toContainText("不支持图片");
  });
});

// fixture 确保（与 api 测试共用 tests/.../conversation-space/fixtures/tiny.png）
function ensureFixture() {
  const fs = require("node:fs");
  if (!fs.existsSync(FIXTURE_PNG)) {
    fs.mkdirSync(path.dirname(FIXTURE_PNG), { recursive: true });
    fs.writeFileSync(FIXTURE_PNG, Buffer.from(
      "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489" +
      "0000000d49444154789c626001000000ffff03000006000557bfabd40000000049454e44ae426082",
      "hex"
    ));
  }
}
