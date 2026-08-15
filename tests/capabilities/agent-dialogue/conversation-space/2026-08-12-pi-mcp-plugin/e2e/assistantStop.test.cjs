// REQ-TRACE: 2026-08-12-pi-mcp-plugin/REQ-AGENT-091
// REQ-VERSION: v1-hash:6c7fd998525a697ef21587c808800edfb15182b428d588f83c9ae835acf09243
// CAPABILITY-TRACE: agent-dialogue
// ENTITY-TRACE: conversation-space
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true (2026-08-13 assertion signoff)

// BUG-010 回归（REQ-AGENT-091 标准 4）：对话手动停止的 UI 面。
// UX 参照：ux/composer-stop.html（2026-08-15 定稿）——流式中发送键位变「停止」键
// （data-testid='stop-button'，可点），替代现状「回复中…」disabled 死键；
// idle 态恢复原发送键（无停止键）。
//
// 语义边界（REQ-091）：点击停止 → 流式收尾（streaming 属性消失）、已生成文本
// 保留在气泡、发送键复原、可立即再发并正常回复。
//
// 环境：startElectronApp + FAUX（零网络，assistantChat.test.cjs 先例）；
// OPC_AGENT_FAUX_TPS=200 把流式窗口拉长到秒级，停止键观测/点击窗口稳定。

const { test, expect } = require("@playwright/test");
const { startElectronApp, stopElectronApp } = require("../../../../../e2e/fixtures/electronApp.cjs");

const MESSAGE_LIST = "[data-testid='message-list']";
const COMPOSER_INPUT = "[data-testid='composer-input']";
const SEND_BUTTON = "[data-testid='send-button']";
const STOP_BUTTON = "[data-testid='stop-button']";
const AGENT_BUBBLE = "[data-message-role='agent']";
const AGENT_STREAMING = "[data-message-role='agent'][data-streaming='true']";
const sessionItem = (spaceKey) => `[data-session-item='${spaceKey}']`;

const STREAM_APPEAR_TIMEOUT = 30000;
const STREAM_DONE_TIMEOUT = 120000;

async function seedAgentConfig(apiBaseUrl) {
  const res = await fetch(`${apiBaseUrl}/api/settings/agent`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider: "deepseek", apiKey: "sk-e2e-faux-placeholder", identity: "" }),
  });
  expect(res.ok).toBe(true);
}

async function createGeneralSession(apiBaseUrl) {
  const res = await fetch(`${apiBaseUrl}/api/agent/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ spaceKind: "general" }),
  });
  expect(res.ok).toBe(true);
  const body = await res.json();
  return body.spaceKey;
}

test.describe("REQ-AGENT-091 对话手动停止（E2E）", () => {
  let electronApp;
  let firstWindow;
  let apiBaseUrl;
  let userDataDir;

  test.beforeEach(async () => {
    const ctx = await startElectronApp({
      extraEnv: { OPC_AGENT_FAUX: "1", OPC_AGENT_FAUX_TPS: "200" },
    });
    electronApp = ctx.electronApp;
    firstWindow = ctx.firstWindow;
    apiBaseUrl = ctx.apiBaseUrl;
    userDataDir = ctx.userDataDir;
    await seedAgentConfig(apiBaseUrl);
  });

  test.afterEach(async () => {
    await stopElectronApp(electronApp, userDataDir);
  });

  test("流式中停止键替换发送键 → 点击收尾保留文本 → idle 复原发送键并可再发", async () => {
    const spaceKey = await createGeneralSession(apiBaseUrl);
    await firstWindow.reload();
    await firstWindow.click(sessionItem(spaceKey));
    await expect(firstWindow.locator(COMPOSER_INPUT)).toBeVisible();

    // idle 态：发送键在、停止键不在（UX 态 1）。
    await expect(firstWindow.locator(SEND_BUTTON)).toBeVisible();
    await expect(firstWindow.locator(STOP_BUTTON)).toHaveCount(0);

    const text = "停止回归首篇";
    await firstWindow.fill(COMPOSER_INPUT, text);
    await firstWindow.click(SEND_BUTTON);

    // 流式中：停止键同位替换发送键（UX 态 2），且可点（非 disabled 死键）。
    const streamingBubble = firstWindow.locator(AGENT_STREAMING);
    await expect(streamingBubble).toBeVisible({ timeout: STREAM_APPEAR_TIMEOUT });
    await expect(firstWindow.locator(STOP_BUTTON)).toBeVisible();
    await expect(firstWindow.locator(STOP_BUTTON)).toBeEnabled();
    await expect(firstWindow.locator(SEND_BUTTON)).toHaveCount(0);

    // 点击停止 → 流式收尾（streaming 属性消失）；发送键复原（停止键消失）。
    await firstWindow.locator(STOP_BUTTON).click();
    await expect(firstWindow.locator(AGENT_STREAMING)).toHaveCount(0, { timeout: STREAM_APPEAR_TIMEOUT });
    await expect(firstWindow.locator(STOP_BUTTON)).toHaveCount(0);
    await expect(firstWindow.locator(SEND_BUTTON)).toBeVisible();

    // 已生成文本保留在气泡（中断截短 ≠ 清空）。
    const stoppedText = (await firstWindow.locator(MESSAGE_LIST).locator(AGENT_BUBBLE).last().textContent()) ?? "";
    expect(stoppedText.trim().length).toBeGreaterThan(0);

    // 停止后可立即再发并正常回复（会话不损坏；FAUX 回声确定性含用户文本）。
    const second = "停止后再发第二篇";
    await firstWindow.fill(COMPOSER_INPUT, second);
    await firstWindow.click(SEND_BUTTON);
    await expect(firstWindow.locator(AGENT_STREAMING)).toBeVisible({ timeout: STREAM_APPEAR_TIMEOUT });
    await expect(firstWindow.locator(AGENT_STREAMING)).toHaveCount(0, { timeout: STREAM_DONE_TIMEOUT });
    await expect(firstWindow.locator(MESSAGE_LIST).locator(AGENT_BUBBLE).last()).toContainText(second);
  });
});
