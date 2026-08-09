// REQ-TRACE: 2026-08-02-ui-copilot/REQ-AGENT-028
// REQ-VERSION: v1-hash:8432c0cff25d5ef4a71d5c8fd95b3045977d65430eb968d7063be5fc81d67012
// CAPABILITY-TRACE: agent-dialogue
// ENTITY-TRACE: conversation-space
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true

// REQ-AGENT-028：对话收发与 SSE 流式渲染（PRD S3，验收标准 4/5 的 E2E 面，
// UX 参照 .aiassist/stories/2026-08-02-ui-copilot/ux/assistant.html）。
//
// 实现约定（待 implementer 落地，testid/属性与本文件保持一致）：
//   双区壳：
//   [data-testid='screen-assistant']         会话区容器（默认落地，路由 /assistant）
//   [data-testid='screen-admin']             管理区容器（旧应用壳原样保留 + 返回对话）
//   会话区左导：
//   [data-testid='new-chat-button']          顶部「新对话」（归属 = 通用空间）
//   [data-session-group='general|projects|feishu']  三个会话分组容器
//   [data-project-row='<pid>']               项目行（点击展开/收起，aria-expanded 反映状态）
//   [data-add-project='<pid>']               项目行内「＋」新建（悬停显现；已删除项目行无）
//   [data-project-sessions='<pid>']          项目行下会话列表容器（收起时 hidden）
//   [data-session-item='<spaceKey>']         会话项；选中态带 data-active='true'
//   [data-testid='open-admin-button']        左下 ⚙ 设置 → 管理区
//   管理区：
//   [data-testid='back-to-chat-button']      顶部「← 返回对话」
//   旧左导条目沿用既有 locators（locators.cjs）
//   对话窗：
//   [data-testid='chat-title']               会话标题
//   [data-testid='chat-space-badge']         空间徽标（通用 / 项目 · <名> / 飞书 · 只读 / 项目已删除）
//   [data-testid='message-list']             消息列表容器
//   [data-message-role='user|agent']         消息气泡
//   [data-message-role='agent'][data-streaming='true']  流式中的 agent 气泡（完成即移除该属性）
//   [data-testid='composer-input']           输入框
//   [data-testid='send-button']              发送按钮（流式中 disabled）
//   空态（2026-08-06 拍板：仅标题 + 当前空间，无引导卡）：
//   [data-testid='empty-state']              空态容器
//   [data-testid='empty-space-name']         空态当前空间名
//   确认卡：
//   [data-confirm-card]                      内联确认卡（含操作描述）
//   [data-testid='confirm-approve-button']   确认执行
//   [data-testid='confirm-reject-button']    拒绝
//   [data-confirm-card][data-state='done']   已处理态（置灰，按钮不再可点）
//   只读/禁用：
//   [data-testid='composer-readonly']        只读输入区容器（替代 composer）
//   [data-testid='readonly-reason']          只读原因文本
//   [data-project-row].deleted               孤儿会话项目行（划线呈现，无＋按钮）
//   [data-testid='unconfigured-state']       agent 未配置引导态（输入禁用）
//
// E2E 环境 agent 配置（FAUX，零网络，先例见
// tests/capabilities/agent-dialogue/conversation-space/2026-08-02-builtin-agent/api/*）：
// - startElectronApp({ extraEnv: { OPC_AGENT_FAUX: "1" } })：env 经
//   agentService spawnChild 的 { ...process.env } 透传到 worker（src/services/agentService.js），
//   worker FAUX_MODE 注册 pi-ai fauxProvider（src/agent/worker.js），resolveModel 直取
//   faux 模型、忽略实际 provider —— 全程零网络。
// - OPC_AGENT_FAUX_TPS=200：调慢 faux 流式（同 agentHeartbeatBusy.test.js 的 TPS seam），
//   把流式窗口拉长到秒级，保证「流式中」断言（streaming 属性 / 按钮置灰）可稳定观测。
// - agent 配置经 PUT /api/settings/agent 播种（provider: "deepseek" 仅为通过路由枚举校验
//   的占位，E2E 假 key 先例见 settingsTabs.test.cjs「接通已配置路径」；FAUX 下不会真实调用）。
// - FAUX 回复 = 确定性上下文回声（fauxEchoFor：system prompt + 全部消息序列化），
//   因此 agent 气泡必含所发用户文本——本套件以此做确定性内容断言。

const { test, expect } = require("@playwright/test");
const { startElectronApp, stopElectronApp } = require("../../../../../e2e/fixtures/electronApp.cjs");

const SCREEN_ASSISTANT = "[data-testid='screen-assistant']";
const MESSAGE_LIST = "[data-testid='message-list']";
const COMPOSER_INPUT = "[data-testid='composer-input']";
const SEND_BUTTON = "[data-testid='send-button']";
const USER_BUBBLE = "[data-message-role='user']";
const AGENT_BUBBLE = "[data-message-role='agent']";
const AGENT_STREAMING = "[data-message-role='agent'][data-streaming='true']";
const sessionItem = (spaceKey) => `[data-session-item='${spaceKey}']`;

// FAUX 流式窗口为秒级（TPS=200，回声含 system prompt 为 KB 级文本），给足观测余量。
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
  expect(typeof body.spaceKey).toBe("string");
  return body.spaceKey;
}

async function openSession(firstWindow, spaceKey) {
  await expect(firstWindow.locator(SCREEN_ASSISTANT)).toBeVisible();
  await firstWindow.click(sessionItem(spaceKey));
  await expect(firstWindow.locator(sessionItem(spaceKey))).toHaveAttribute("data-active", "true");
  await expect(firstWindow.locator(COMPOSER_INPUT)).toBeVisible();
}

test.describe("对话收发与 SSE 流式渲染", () => {
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

  test("REQ-AGENT-028 AC4: 发送 → 用户气泡即时 → agent 流式增量 → 完成恢复发送", async () => {
    const spaceKey = await createGeneralSession(apiBaseUrl);
    await firstWindow.reload();
    await openSession(firstWindow, spaceKey);

    const text = "你好，助手";
    await firstWindow.fill(COMPOSER_INPUT, text);
    await firstWindow.click(SEND_BUTTON);

    // 用户气泡即时出现（不等 agent）。
    await expect(firstWindow.locator(MESSAGE_LIST).locator(USER_BUBBLE).filter({ hasText: text })).toBeVisible();

    // BUG-001 语义（2026-08-09 req-gap 就地补全）：发送成功后输入框清空。
    await expect(firstWindow.locator(COMPOSER_INPUT)).toHaveValue("");

    // agent 气泡进入流式态；流式中发送按钮置灰 + 等待态文案「回复中…」（防重复提交）。
    const streamingBubble = firstWindow.locator(AGENT_STREAMING);
    await expect(streamingBubble).toBeVisible({ timeout: STREAM_APPEAR_TIMEOUT });
    await expect(firstWindow.locator(SEND_BUTTON)).toBeDisabled();
    await expect(firstWindow.locator(SEND_BUTTON)).toHaveText("回复中…");

    // 流式增量渲染：气泡文本持续增长（采样两次长度，后者更大）。
    const lenBefore = (await streamingBubble.textContent())?.length ?? 0;
    await expect
      .poll(async () => (await streamingBubble.textContent())?.length ?? 0, { timeout: STREAM_APPEAR_TIMEOUT })
      .toBeGreaterThan(lenBefore);

    // 完成：streaming 属性消失，等待态结束（按钮文案恢复「发送」；按钮态随输入框内容——
    // 文本已清空 → disabled 常态，不再断言 enabled——BUG-001 语义修正）。
    await expect(firstWindow.locator(AGENT_STREAMING)).toHaveCount(0, { timeout: STREAM_DONE_TIMEOUT });
    await expect(firstWindow.locator(SEND_BUTTON)).toHaveText("发送");
    await expect(firstWindow.locator(SEND_BUTTON)).toBeDisabled();

    // FAUX 回声确定性断言：最终 agent 气泡含所发用户文本。
    await expect(firstWindow.locator(MESSAGE_LIST).locator(AGENT_BUBBLE).last()).toContainText(text);
  });

  test("REQ-AGENT-028 AC5: SSE 断线重连后历史完整（全量对齐再续流）", async () => {
    const spaceKey = await createGeneralSession(apiBaseUrl);

    // SSE 断线模拟：首次 events 订阅直接 abort；EventSource 原生自动重连，
    // 渲染层重连后须先 GET .../messages 全量对齐再续流（tech-design F2）。
    let aborted = false;
    await firstWindow.route("**/api/agent/sessions/*/events", async (route) => {
      if (!aborted) {
        aborted = true;
        return route.abort();
      }
      return route.continue();
    });

    await firstWindow.reload();
    await openSession(firstWindow, spaceKey);

    const text = "断线重连后还能看到完整对话";
    await firstWindow.fill(COMPOSER_INPUT, text);
    await firstWindow.click(SEND_BUTTON);

    // 重连后收发恢复正常：用户气泡 + agent 流式回复均呈现（放宽窗口覆盖 EventSource 重试间隔）。
    await expect(
      firstWindow.locator(MESSAGE_LIST).locator(USER_BUBBLE).filter({ hasText: text })
    ).toBeVisible({ timeout: STREAM_APPEAR_TIMEOUT });
    await expect(firstWindow.locator(AGENT_STREAMING)).toBeVisible({ timeout: STREAM_DONE_TIMEOUT });
    await expect(firstWindow.locator(AGENT_STREAMING)).toHaveCount(0, { timeout: STREAM_DONE_TIMEOUT });

    // 历史完整：用户消息与 agent 回复都在（重连不丢消息、不重复渲染用户气泡）。
    await expect(firstWindow.locator(MESSAGE_LIST).locator(AGENT_BUBBLE).last()).toContainText(text);
    await expect(firstWindow.locator(MESSAGE_LIST).locator(USER_BUBBLE).filter({ hasText: text })).toHaveCount(1);
  });
});
