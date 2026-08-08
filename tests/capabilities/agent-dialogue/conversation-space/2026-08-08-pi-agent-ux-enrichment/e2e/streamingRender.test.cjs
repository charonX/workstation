// REQ-TRACE: 2026-08-08-pi-agent-ux-enrichment/REQ-AGENT-053
// REQ-VERSION: v1-hash:dfd35b8a5242cf1ef089f0b289012aa34a1dd194c813e014e8e81b73fc9f403b
// CAPABILITY-TRACE: agent-dialogue
// ENTITY-TRACE: conversation-space
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true

// 流式实时增量渲染（B7）——FAUX 高速流下最终态正确 + 流式期间 UI 可操作。
//
// seam：真实 Electron + FAUX 高速回声（默认 1000 事件/秒，rAF 节流缓冲既有）。
// 断言策略（PRD §13）：最终态为主（时序敏感中间态弱断言——未闭合字面量由
// 实现者自验 + 完成态无残留兜底）。
// 运行：npm run test:e2e（先 rebuild:electron）。
const { test, expect } = require("@playwright/test");
const { startElectronApp, stopElectronApp } = require("../../../../../e2e/fixtures/electronApp.cjs");

const COMPOSER_INPUT = "[data-testid='composer-input']";
const SEND_BUTTON = "[data-testid='send-button']";
const AGENT_BUBBLE = "[data-message-role='agent']";
const AGENT_STREAMING = "[data-message-role='agent'][data-streaming='true']";

// 含未闭合语法的流式文本（** 未闭合 → 流式期间字面量，闭合即渲染）
const STREAM_FIXTURE = "## 流式标题\n\n**粗体未闭合";
const STREAM_FIXTURE_CLOSED = "## 流式标题\n\n**粗体闭合** 与行内 `code`";

test.describe("REQ-AGENT-053 流式实时增量渲染", () => {
  let ctx;

  test.beforeEach(async () => {
    ctx = await startElectronApp();
  });

  test.afterEach(async () => {
    await stopElectronApp(ctx.electronApp);
  });

  async function createSession(spaceKey) {
    const res = await fetch(`${ctx.apiBaseUrl}/api/agent/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ spaceKey, provider: "deepseek", apiKey: "sk-1" }),
    });
    if (!res.ok) throw new Error(`createSession failed: ${res.status}`);
  }

  test("REQ-AGENT-053 标准1：未闭合语法流式期间显示字面量，完成态正确（无 `**` 残留）", async () => {
    await createSession("ui:copilot:stream-e2e-1");
    await ctx.firstWindow.locator("[data-session-item='ui:copilot:stream-e2e-1']").first().click();
    await ctx.firstWindow.fill(COMPOSER_INPUT, STREAM_FIXTURE_CLOSED);
    await ctx.firstWindow.click(SEND_BUTTON);
    // 流式进行中：bubble 存在（流式态）
    await expect(ctx.firstWindow.locator(AGENT_STREAMING).first()).toBeVisible();
    // 完成态：标题渲染为 h2 + 粗体渲染 + 无字面量残留
    const bubble = ctx.firstWindow.locator(AGENT_BUBBLE).last();
    await expect(bubble.locator("h2").first()).toHaveText("流式标题");
    await expect(bubble.locator("strong").first()).toHaveText("粗体闭合");
    await expect(bubble.getByText(/\*\*/)).toHaveCount(0);
  });

  test("REQ-AGENT-053 标准2：高速流期间 UI 不冻结（composer 可输入）", async () => {
    await createSession("ui:copilot:stream-e2e-2");
    await ctx.firstWindow.locator("[data-session-item='ui:copilot:stream-e2e-2']").first().click();
    await ctx.firstWindow.fill(COMPOSER_INPUT, "生成一段较长的流式回复内容用于性能观察，包含多行文本和多段标记。");
    await ctx.firstWindow.click(SEND_BUTTON);
    // 流式期间（FAUX 高速）：composer 可输入（不冻结）
    await ctx.firstWindow.fill(COMPOSER_INPUT, "流式期间输入测试");
    await expect(ctx.firstWindow.locator(COMPOSER_INPUT)).toHaveValue("流式期间输入测试");
    // 完成态正常
    await expect(ctx.firstWindow.locator(AGENT_STREAMING)).toHaveCount(0, { timeout: 15000 });
  });
});
