// REQ-TRACE: 2026-08-02-ui-copilot/REQ-AGENT-026
// REQ-VERSION: v1-hash:8432c0cff25d5ef4a71d5c8fd95b3045977d65430eb968d7063be5fc81d67012
// CAPABILITY-TRACE: agent-dialogue
// ENTITY-TRACE: conversation-space
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true

// REQ-AGENT-026：双区信息架构与默认落地（PRD S1，
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
//   旧左导条目沿用既有 locators（locators.cjs）：nav-dashboard/nav-workspace/nav-flows/
//   nav-executions/nav-sources/nav-skills/nav-settings；新增 nav-notifications
//   （现行左导仅七条目无「通知」，管理区须补齐八条目，REQ-AGENT-026 标准 2）
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
// 说明：
// - 本套件只验双区壳与路由，不需要 agent 配置 / FAUX provider（纯导航结构行为）。
// - HashRouter：路由断言走 URL hash（#/assistant、#/flows）。

const { test, expect } = require("@playwright/test");
const { startElectronApp, stopElectronApp } = require("../../../../../e2e/fixtures/electronApp.cjs");
const locators = require("../../../../../e2e/helpers/locators.cjs");

const SCREEN_ASSISTANT = "[data-testid='screen-assistant']";
const SCREEN_ADMIN = "[data-testid='screen-admin']";
const NEW_CHAT_BUTTON = "[data-testid='new-chat-button']";
const OPEN_ADMIN_BUTTON = "[data-testid='open-admin-button']";
const BACK_TO_CHAT_BUTTON = "[data-testid='back-to-chat-button']";
const sessionGroup = (name) => `[data-session-group='${name}']`;

// 管理区八条目（REQ-AGENT-026 标准 2）：七个沿用既有 locators，nav-notifications 新增。
const ADMIN_NAV_ITEMS = [
  locators.DASHBOARD_LINK,
  locators.WORKSPACE_LINK,
  locators.FLOWS_LINK,
  locators.EXECUTIONS_LINK,
  "[data-testid='nav-sources']",
  locators.SKILLS_LINK,
  "[data-testid='nav-notifications']",
  locators.SETTINGS_LINK,
];

test.describe("双区信息架构与默认落地", () => {
  let electronApp;
  let firstWindow;
  let userDataDir;

  test.beforeEach(async () => {
    const ctx = await startElectronApp();
    electronApp = ctx.electronApp;
    firstWindow = ctx.firstWindow;
    userDataDir = ctx.userDataDir;
  });

  test.afterEach(async () => {
    await stopElectronApp(electronApp, userDataDir);
  });

  test("REQ-AGENT-026 AC1: 启动默认落地会话区，左导五要素齐备", async () => {
    // 默认路由 = 会话区（/assistant）。
    await expect(firstWindow.locator(SCREEN_ASSISTANT)).toBeVisible();
    await expect(firstWindow).toHaveURL(/#\/assistant/);
    await expect(firstWindow.locator(SCREEN_ADMIN)).toBeHidden();

    // 左导五要素：新对话 + 通用分组 + 项目分组 + 飞书分组 + ⚙ 设置。
    await expect(firstWindow.locator(NEW_CHAT_BUTTON)).toBeVisible();
    await expect(firstWindow.locator(sessionGroup("general"))).toBeVisible();
    await expect(firstWindow.locator(sessionGroup("projects"))).toBeVisible();
    await expect(firstWindow.locator(sessionGroup("feishu"))).toBeVisible();
    await expect(firstWindow.locator(OPEN_ADMIN_BUTTON)).toBeVisible();
  });

  test("REQ-AGENT-026 AC2: ⚙ → 管理区（旧左导八条目 + 返回对话）", async () => {
    await expect(firstWindow.locator(SCREEN_ASSISTANT)).toBeVisible();

    await firstWindow.click(OPEN_ADMIN_BUTTON);

    await expect(firstWindow.locator(SCREEN_ADMIN)).toBeVisible();
    await expect(firstWindow.locator(SCREEN_ASSISTANT)).toBeHidden();
    await expect(firstWindow.locator(BACK_TO_CHAT_BUTTON)).toBeVisible();

    // 旧左导八条目：仪表盘/工作区/流程/执行/内容源/技能/通知/设置。
    for (const item of ADMIN_NAV_ITEMS) {
      await expect(firstWindow.locator(SCREEN_ADMIN).locator(item)).toBeVisible();
    }
  });

  test("REQ-AGENT-026 AC3: 管理区点旧条目路由与页面本体不变（抽查 /flows）", async () => {
    await expect(firstWindow.locator(SCREEN_ASSISTANT)).toBeVisible();
    await firstWindow.click(OPEN_ADMIN_BUTTON);
    await expect(firstWindow.locator(SCREEN_ADMIN)).toBeVisible();

    await firstWindow.locator(SCREEN_ADMIN).locator(locators.FLOWS_LINK).click();

    // 旧路由可达且渲染内容不变：流程页本体（新建流程按钮）在管理区壳内呈现。
    await expect(firstWindow).toHaveURL(/#\/flows/);
    await expect(firstWindow.locator(SCREEN_ADMIN)).toBeVisible();
    await expect(firstWindow.locator(locators.NEW_FLOW_BUTTON)).toBeVisible();
    await expect(firstWindow.locator(SCREEN_ASSISTANT)).toBeHidden();
  });

  test("REQ-AGENT-026 AC4: 「← 返回对话」回到会话区", async () => {
    await expect(firstWindow.locator(SCREEN_ASSISTANT)).toBeVisible();
    await firstWindow.click(OPEN_ADMIN_BUTTON);
    await expect(firstWindow.locator(SCREEN_ADMIN)).toBeVisible();

    await firstWindow.click(BACK_TO_CHAT_BUTTON);

    await expect(firstWindow.locator(SCREEN_ASSISTANT)).toBeVisible();
    await expect(firstWindow.locator(SCREEN_ADMIN)).toBeHidden();
    await expect(firstWindow).toHaveURL(/#\/assistant/);
    // 会话区左导仍在（新对话按钮）。
    await expect(firstWindow.locator(NEW_CHAT_BUTTON)).toBeVisible();
  });

  test("REQ-AGENT-026 AC5: 直接访问旧路由 → 以管理区壳呈现", async () => {
    // 直接以旧路由整页加载（非 SPA 内跳转）。
    const base = firstWindow.url().split("#")[0];
    await firstWindow.goto(`${base}#/flows`);

    // 旧路由不再裸呈现：套管理区壳（含返回对话），页面本体内容不变。
    await expect(firstWindow.locator(SCREEN_ADMIN)).toBeVisible();
    await expect(firstWindow.locator(BACK_TO_CHAT_BUTTON)).toBeVisible();
    await expect(firstWindow.locator(SCREEN_ASSISTANT)).toBeHidden();
    await expect(firstWindow.locator(locators.NEW_FLOW_BUTTON)).toBeVisible();

    // 从管理区壳可返回会话区。
    await firstWindow.click(BACK_TO_CHAT_BUTTON);
    await expect(firstWindow.locator(SCREEN_ASSISTANT)).toBeVisible();
  });
});
