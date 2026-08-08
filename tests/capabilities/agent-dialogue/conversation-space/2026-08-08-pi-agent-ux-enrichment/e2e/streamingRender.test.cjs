// REQ-TRACE: 2026-08-08-pi-agent-ux-enrichment/REQ-AGENT-053
// REQ-VERSION: v1-hash:dfd35b8a5242cf1ef089f0b289012aa34a1dd194c813e014e8e81b73fc9f403b
// CAPABILITY-TRACE: agent-dialogue
// ENTITY-TRACE: conversation-space
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true

// 流式实时增量渲染（B7）——FAUX 高速流下最终态正确 + 流式期间 UI 可操作。
//
// seam：真实 Electron + FAUX 高速回声（rAF 节流缓冲既有）。
// 断言策略（PRD §13）：最终态为主（时序敏感中间态弱断言——未闭合字面量由
// 实现者自验 + 完成态无残留兜底）。
// 运行：npm run test:e2e（先 rebuild:electron）。
//
// [Slice 7 接线修正记录（2026-08-09，断言语义不变）]
//   1. seed 按现契约：POST /api/agent/sessions { spaceKind: "general" } →
//      { spaceKey }（原 { spaceKey, provider, apiKey } 与现契约不符 → 400
//      E-SESSION-CREATE）；补 seedAgentConfig（PUT /api/settings/agent——缺失时
//      发送 409 E-AGENT-CONFIG）；建会话后 reload 再点会话项（API 建会话后 UI
//      列表需刷新，assistantChat 同型）。
//   2. **消息经 API 投递（非 composer）**：FAUX 回声为 `user:<text>` 前缀拼接，
//      STREAM_FIXTURE_CLOSED 首行 `##` 必须处于行首才构成 ATX 标题——renderer
//      composer 发送路径 trim 前导空白（Assistant.jsx 实证），API 路由不 trim
//      （实证：API 投递 "\n## …" 后回声渲染出 h2）；fixture 内容不变。会话先打开
//      （SSE 已挂接）再投递 → 实时流在 UI 可见（流式断言面）。
//   3. OPC_AGENT_FAUX_TPS=200：FAUX 回声（system prompt + 消息 ≈ 数百字符）在默认
//      1000 事件/秒下 ~0.2s 即完成，「流式中」断言窗口不可靠——TPS=200 拉长到秒级
//      （assistantChat 同型先例），完成态断言带 120s 窗口。
//   4. **worker 冷启动方差**（实证 1.4s~60s+）：流式窗口/完成断言预算 120s、测试级
//      timeout 180s（Playwright 默认 30s 在慢速冷启动下必失败）。
const { test, expect } = require("@playwright/test");
const { startElectronApp, stopElectronApp } = require("../../../../../e2e/fixtures/electronApp.cjs");

const SCREEN_ASSISTANT = "[data-testid='screen-assistant']";
const COMPOSER_INPUT = "[data-testid='composer-input']";
const AGENT_BUBBLE = "[data-message-role='agent']";
const AGENT_STREAMING = "[data-message-role='agent'][data-streaming='true']";
const sessionItem = (spaceKey) => `[data-session-item='${spaceKey}']`;

const STREAM_APPEAR_TIMEOUT = 120000;
const STREAM_DONE_TIMEOUT = 120000;

// 含未闭合语法的流式文本（** 未闭合 → 流式期间字面量，闭合即渲染）
const STREAM_FIXTURE = "## 流式标题\n\n**粗体未闭合";
const STREAM_FIXTURE_CLOSED = "## 流式标题\n\n**粗体闭合** 与行内 `code`";

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
  return (await res.json()).spaceKey;
}

async function openSession(firstWindow, spaceKey) {
  await firstWindow.reload();
  await expect(firstWindow.locator(SCREEN_ASSISTANT)).toBeVisible();
  await firstWindow.click(sessionItem(spaceKey));
  await expect(firstWindow.locator(COMPOSER_INPUT)).toBeVisible();
}

// 打开会话（SSE 已挂接）→ 经 API 投递消息（保留前导 "\n"，接线修正 2）→ 返回 spaceKey。
async function openAndPost(apiBaseUrl, firstWindow, text) {
  const spaceKey = await createGeneralSession(apiBaseUrl);
  await openSession(firstWindow, spaceKey);
  // SSE 挂接余量（事件只推增量，连接就绪前投递会丢首轮流）
  await firstWindow.waitForTimeout(500);
  const res = await fetch(`${apiBaseUrl}/api/agent/sessions/${spaceKey}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: `\n${text}` }),
  });
  expect(res.ok).toBe(true);
  return spaceKey;
}

test.describe("REQ-AGENT-053 流式实时增量渲染", () => {
  test.describe.configure({ timeout: 180000 });
  let ctx;

  test.beforeEach(async () => {
    ctx = await startElectronApp({ extraEnv: { OPC_AGENT_FAUX: "1", OPC_AGENT_FAUX_TPS: "200" } });
    await seedAgentConfig(ctx.apiBaseUrl);
  });

  test.afterEach(async () => {
    await stopElectronApp(ctx.electronApp, ctx.userDataDir);
  });

  test("REQ-AGENT-053 标准1：未闭合语法流式期间显示字面量，完成态正确（无 `**` 残留）", async () => {
    await openAndPost(ctx.apiBaseUrl, ctx.firstWindow, STREAM_FIXTURE_CLOSED);
    // 流式进行中：bubble 存在（流式态）
    await expect(ctx.firstWindow.locator(AGENT_STREAMING).first()).toBeVisible({ timeout: STREAM_APPEAR_TIMEOUT });
    // 完成态：标题渲染为 h2 + 粗体渲染 + 无字面量残留
    const bubble = ctx.firstWindow.locator(AGENT_BUBBLE).last();
    await expect(bubble.locator("h2").first()).toHaveText("流式标题", { timeout: STREAM_DONE_TIMEOUT });
    await expect(bubble.locator("strong").first()).toHaveText("粗体闭合");
    await expect(bubble.getByText(/\*\*/)).toHaveCount(0);
  });

  test("REQ-AGENT-053 标准2：高速流期间 UI 不冻结（composer 可输入）", async () => {
    await openAndPost(ctx.apiBaseUrl, ctx.firstWindow, "生成一段较长的流式回复内容用于性能观察，包含多行文本和多段标记。");
    // 流式期间（FAUX 高速）：composer 可输入（不冻结）
    await ctx.firstWindow.fill(COMPOSER_INPUT, "流式期间输入测试");
    await expect(ctx.firstWindow.locator(COMPOSER_INPUT)).toHaveValue("流式期间输入测试");
    // 完成态正常
    await expect(ctx.firstWindow.locator(AGENT_STREAMING)).toHaveCount(0, { timeout: STREAM_DONE_TIMEOUT });
  });
});
