// REQ-TRACE: 2026-08-02-ui-copilot/REQ-AGENT-030
// REQ-VERSION: v1-hash:8432c0cff25d5ef4a71d5c8fd95b3045977d65430eb968d7063be5fc81d67012
// CAPABILITY-TRACE: agent-dialogue
// ENTITY-TRACE: conversation-space
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true

// REQ-AGENT-030：内联高危确认卡（PRD S5，验收标准 2/3/4 的 E2E 面，
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
//   [data-confirm-card]                      内联确认卡，渲染操作描述（含命令名与关键参数）
//   [data-testid='confirm-approve-button']   确认执行
//   [data-testid='confirm-reject-button']    拒绝
//   [data-confirm-card][data-state='done']   已处理态：置灰，按钮不再渲染（以结果标注替代）
//   只读/禁用：
//   [data-testid='composer-readonly']        只读输入区容器（替代 composer）
//   [data-testid='readonly-reason']          只读原因文本
//   [data-project-row].deleted               孤儿会话项目行（划线呈现，无＋按钮）
//   [data-testid='unconfigured-state']       agent 未配置引导态（输入禁用）
//   历史投影：GET .../messages 须把该会话的 agent_confirmations 行并入消息流渲染为
//   确认卡（pending 可点；approved/rejected 呈现 done 态）——挂起队列 = SQLite 真相
//   （REQ-AGENT-030 标准 3）。
//
// 触发 seam 裁决（二选一，采纳 ②）：
//   ① composer 发送删除类指令让 FAUX agent 发起高危工具调用 —— 不可行：FAUX provider
//      为确定性上下文回声（src/agent/worker.js fauxEchoFor），不发起任何工具调用。
//   ② 直写 agent_confirmations 挂起行再开 UI —— 采纳。经测试基建种子 seam
//      window.opc.__seedAgentConfirmations(rows)（仿 opc-seed-notifications 先例：
//      preload contextBridge 暴露 + 主进程 IPC 处理器，NODE_ENV=development 守卫；
//      写 <userDataDir>/agent-sessions.db，与 confirmationService 同库）。
//      rows: [{ confirmId, sessionKey, command, args?, riskLevel? }] → INSERT pending 行。
//      SSE confirmation-pending 实时推送路径由集成套件 uiConfirmation.test.js 覆盖，
//      本套件只验「渲染 + 回调 + 稍后处理 + 已处理态」。
//
// E2E 环境（FAUX，零网络；细则见 assistantChat.test.cjs 文件头同段注释）：
//   OPC_AGENT_FAUX=1 经 extraEnv 透传；agent 配置经 PUT /api/settings/agent 播种。
//   approve 驱动真实命令模块执行（confirmationService execute → executeToolCommand），
//   故先经 API 建真实 flow，确认卡命令为 "flow delete"（confirm 级，REQ-AGENT-015 分类），
//   args = { id: <flowId> }（toolAdapter argsSchema）。

const { test, expect } = require("@playwright/test");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { startElectronApp, stopElectronApp } = require("../../../../../e2e/fixtures/electronApp.cjs");
const { createProject, createFlow } = require("../../../../../e2e/helpers/seed.cjs");

const SCREEN_ASSISTANT = "[data-testid='screen-assistant']";
const MESSAGE_LIST = "[data-testid='message-list']";
const AGENT_BUBBLE = "[data-message-role='agent']";
const AGENT_STREAMING = "[data-message-role='agent'][data-streaming='true']";
const CONFIRM_CARD = "[data-confirm-card]";
const CONFIRM_APPROVE = "[data-testid='confirm-approve-button']";
const CONFIRM_REJECT = "[data-testid='confirm-reject-button']";
const sessionItem = (spaceKey) => `[data-session-item='${spaceKey}']`;

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
  return (await res.json()).spaceKey;
}

async function seedPendingConfirmation(firstWindow, row) {
  await firstWindow.evaluate(
    (rows) => window.opc.__seedAgentConfirmations(rows),
    [{ riskLevel: "confirm", ...row }]
  );
}

test.describe("内联高危确认卡", () => {
  let electronApp;
  let firstWindow;
  let apiBaseUrl;
  let userDataDir;
  let projectDir;

  test.beforeEach(async () => {
    const ctx = await startElectronApp({ extraEnv: { OPC_AGENT_FAUX: "1" } });
    electronApp = ctx.electronApp;
    firstWindow = ctx.firstWindow;
    apiBaseUrl = ctx.apiBaseUrl;
    userDataDir = ctx.userDataDir;
    await seedAgentConfig(apiBaseUrl);
  });

  test.afterEach(async () => {
    await stopElectronApp(electronApp, userDataDir);
    if (projectDir) {
      await fs.rm(projectDir, { recursive: true, force: true });
      projectDir = null;
    }
  });

  // 建真实 flow（approve 时确认服务驱动真实命令模块执行，删除对象须存在）。
  async function makeDeletableFlow() {
    projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "opc-ui-copilot-e2e-"));
    const project = await createProject(apiBaseUrl, { name: "确认卡项目", localPath: projectDir });
    return createFlow(apiBaseUrl, { name: "待删除流程", projectId: project.id });
  }

  async function openSessionWithCard(spaceKey) {
    await firstWindow.reload();
    await expect(firstWindow.locator(SCREEN_ASSISTANT)).toBeVisible();
    await firstWindow.click(sessionItem(spaceKey));
    await expect(firstWindow.locator(MESSAGE_LIST).locator(CONFIRM_CARD)).toBeVisible();
  }

  test("REQ-AGENT-030 AC2: 确认卡渲染描述与两按钮；点确认 → 结果流式呈现", async () => {
    const flow = await makeDeletableFlow();
    const spaceKey = await createGeneralSession(apiBaseUrl);
    await seedPendingConfirmation(firstWindow, {
      confirmId: randomUUID(),
      sessionKey: spaceKey,
      command: "flow delete",
      args: { id: flow.id },
    });

    await openSessionWithCard(spaceKey);

    // 确认卡渲染操作描述（含命令名）+ 确认/拒绝两按钮。
    const card = firstWindow.locator(MESSAGE_LIST).locator(CONFIRM_CARD);
    await expect(card).toContainText("flow delete");
    await expect(card.locator(CONFIRM_APPROVE)).toBeVisible();
    await expect(card.locator(CONFIRM_REJECT)).toBeVisible();

    // 点确认 → 调既有端点 → 执行结果以 agent 消息流式呈现。
    const bubblesBefore = await firstWindow.locator(MESSAGE_LIST).locator(AGENT_BUBBLE).count();
    await card.locator(CONFIRM_APPROVE).click();

    await expect(firstWindow.locator(AGENT_STREAMING)).toBeVisible({ timeout: 30000 });
    await expect(firstWindow.locator(AGENT_STREAMING)).toHaveCount(0, { timeout: STREAM_DONE_TIMEOUT });
    // 结果回投为新增 agent 气泡（流式完成后留存历史）。
    await expect(firstWindow.locator(MESSAGE_LIST).locator(AGENT_BUBBLE)).toHaveCount(bubblesBefore + 1);

    // 卡片进入已处理态（置灰、按钮不再渲染）。
    await expect(firstWindow.locator(`${CONFIRM_CARD}[data-state='done']`)).toBeVisible();
    // signoff 2026-08-06: assertion signed（裁决见 signoff.md）
  });

  test("REQ-AGENT-030 AC2: 点拒绝 → agent 告知已取消，操作不执行", async () => {
    const flow = await makeDeletableFlow();
    const spaceKey = await createGeneralSession(apiBaseUrl);
    await seedPendingConfirmation(firstWindow, {
      confirmId: randomUUID(),
      sessionKey: spaceKey,
      command: "flow delete",
      args: { id: flow.id },
    });

    await openSessionWithCard(spaceKey);
    const card = firstWindow.locator(MESSAGE_LIST).locator(CONFIRM_CARD);

    const bubblesBefore = await firstWindow.locator(MESSAGE_LIST).locator(AGENT_BUBBLE).count();
    await card.locator(CONFIRM_REJECT).click();

    // agent 回投告知（流式呈现），flow 未被删除（操作不执行）。
    await expect(firstWindow.locator(MESSAGE_LIST).locator(AGENT_BUBBLE)).toHaveCount(bubblesBefore + 1, {
      timeout: 60000,
    });
    await expect(firstWindow.locator(`${CONFIRM_CARD}[data-state='done']`)).toBeVisible();

    const flowRes = await fetch(`${apiBaseUrl}/api/flows/${flow.id}`);
    expect(flowRes.ok).toBe(true);
    // signoff 2026-08-06: assertion signed（裁决见 signoff.md）
  });

  test("REQ-AGENT-030 AC3: 暂不处理 —— 重启后卡片仍挂起可确认（SQLite 真相）", async () => {
    const flow = await makeDeletableFlow();
    const spaceKey = await createGeneralSession(apiBaseUrl);
    await seedPendingConfirmation(firstWindow, {
      confirmId: randomUUID(),
      sessionKey: spaceKey,
      command: "flow delete",
      args: { id: flow.id },
    });

    await openSessionWithCard(spaceKey);
    await expect(firstWindow.locator(MESSAGE_LIST).locator(CONFIRM_CARD).locator(CONFIRM_APPROVE)).toBeVisible();

    // 用户暂不处理，直接重启应用（复用同一 userDataDir，DB 保留；
    // 注意不能用 stopElectronApp——它会删除 userDataDir）。
    await electronApp.close();
    const restarted = await startElectronApp({ userDataDir, extraEnv: { OPC_AGENT_FAUX: "1" } });
    electronApp = restarted.electronApp;
    firstWindow = restarted.firstWindow;

    // 稍后处理仍有效：卡片仍在历史中且可确认（确认与执行解耦）。
    await openSessionWithCard(spaceKey);
    const card = firstWindow.locator(MESSAGE_LIST).locator(CONFIRM_CARD);
    await expect(card.locator(CONFIRM_APPROVE)).toBeVisible();
    await card.locator(CONFIRM_APPROVE).click();
    await expect(firstWindow.locator(`${CONFIRM_CARD}[data-state='done']`)).toBeVisible({ timeout: 60000 });

    // 确认真实生效：flow 已删除。
    const flowRes = await fetch(`${apiBaseUrl}/api/flows/${flow.id}`);
    expect(flowRes.status).toBe(404);
  });

  test("REQ-AGENT-030 AC4: 已处理卡片置灰且不可再操作（幂等回归）", async () => {
    const flow = await makeDeletableFlow();
    const spaceKey = await createGeneralSession(apiBaseUrl);
    await seedPendingConfirmation(firstWindow, {
      confirmId: randomUUID(),
      sessionKey: spaceKey,
      command: "flow delete",
      args: { id: flow.id },
    });

    await openSessionWithCard(spaceKey);
    const card = firstWindow.locator(MESSAGE_LIST).locator(CONFIRM_CARD);
    await card.locator(CONFIRM_APPROVE).click();
    await expect(firstWindow.locator(`${CONFIRM_CARD}[data-state='done']`)).toBeVisible({ timeout: 60000 });

    // 已处理态：两按钮均不再渲染（以结果标注替代），不可再次点击。
    const doneCard = firstWindow.locator(`${CONFIRM_CARD}[data-state='done']`);
    await expect(doneCard.locator(CONFIRM_APPROVE)).toHaveCount(0);
    await expect(doneCard.locator(CONFIRM_REJECT)).toHaveCount(0);

    // 重新加载历史：已处理态持久呈现（非仅本次渲染临时态）。
    await firstWindow.reload();
    await expect(firstWindow.locator(SCREEN_ASSISTANT)).toBeVisible();
    await firstWindow.click(sessionItem(spaceKey));
    const reloadedCard = firstWindow.locator(MESSAGE_LIST).locator(`${CONFIRM_CARD}[data-state='done']`);
    await expect(reloadedCard).toBeVisible();
    await expect(reloadedCard.locator(CONFIRM_APPROVE)).toHaveCount(0);
    // signoff 2026-08-06: assertion signed（裁决见 signoff.md）
  });
});
