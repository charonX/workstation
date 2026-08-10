// REQ-TRACE: 2026-08-02-ui-copilot/REQ-AGENT-034, REQ-AGENT-033, REQ-AGENT-029, REQ-AGENT-028
// REQ-VERSION: v1-hash:8432c0cff25d5ef4a71d5c8fd95b3045977d65430eb968d7063be5fc81d67012
// CAPABILITY-TRACE: agent-dialogue
// ENTITY-TRACE: conversation-space
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true

// REQ-AGENT-034 标准 1/3（E2E 面）+ REQ-AGENT-033 标准 6 + REQ-AGENT-029 标准 2（孤儿，
// E2E 面）+ REQ-AGENT-028 标准 3（未配置引导，UI 面）：飞书只读视图 / 孤儿会话 /
// 无权限配置面 / 未配置引导态（PRD S9 + §8 错误态，
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
//   [data-testid='composer-readonly']        只读输入区容器（替代 composer；
//                                            只读空间无 composer-input / send-button）
//   [data-testid='readonly-reason']          只读原因文本
//   [data-project-row].deleted               孤儿会话项目行（划线呈现，无＋按钮）
//   [data-testid='unconfigured-state']       agent 未配置引导态（输入禁用）
//
// 造数据 seam（飞书会话/孤儿会话无 HTTP 创建面——feishu:* 会话由通道入站产生、
// 403 只读不可经 POST 写入，孤儿会话的项目引用必须不存在于 projects 表）：
//   测试基建种子 seam window.opc.__seedAgentSessions(rows)（仿 opc-seed-notifications
//   先例：preload contextBridge 暴露 + 主进程 IPC 处理器，NODE_ENV=development 守卫；
//   写 <userDataDir>/agent-sessions.db，与 sessionStore 同库）。
//   rows: [{ spaceKey, title?, createdAt?, lastActiveAt?, messages?: [{ role, text, time? }] }]
//   - role 词表 = PI JSONL 原生（"user"|"assistant"），非 UI 气泡角色（"agent"）——
//     投影契约 projectMessagesFromJsonl 只放行 user/assistant（BUG-009 后收紧，
//     2026-08-10 修正：原 seed 写 "agent" 导致历史气泡被过滤，UI 气泡角色由渲染层
//     从原生 role 映射，见 MessageList.jsx data-message-role）。
//   - 新 spaceKey → INSERT agent_sessions 行 + 写入历史（必须可被
//     GET /api/agent/sessions/:spaceKey/messages 投影读到，气泡渲染源）；
//   - 已有 spaceKey → 追加 messages 并更新 lastActiveAt（模拟飞书侧新消息到达）；
//   - title 对齐 REQ-AGENT-029 标准 5 显示名语义（飞书取通道元数据 chat 名的种子等价物）。
//   孤儿造法：直接 seed spaceKey = ui:project:<不存在的 pid>:<sid> 的会话行，不建项目。
//
// E2E 环境（FAUX，零网络；细则见 assistantChat.test.cjs 文件头同段注释）：
//   OPC_AGENT_FAUX=1 经 extraEnv 透传；需 agent 已配置态的用例自行调 seedAgentConfig()
//   （未配置引导态用例刻意不调用）。

const { test, expect } = require("@playwright/test");
const { startElectronApp, stopElectronApp } = require("../../../../../e2e/fixtures/electronApp.cjs");
const locators = require("../../../../../e2e/helpers/locators.cjs");

const SCREEN_ASSISTANT = "[data-testid='screen-assistant']";
const MESSAGE_LIST = "[data-testid='message-list']";
const COMPOSER_INPUT = "[data-testid='composer-input']";
const SEND_BUTTON = "[data-testid='send-button']";
const COMPOSER_READONLY = "[data-testid='composer-readonly']";
const READONLY_REASON = "[data-testid='readonly-reason']";
const CHAT_SPACE_BADGE = "[data-testid='chat-space-badge']";
const UNCONFIGURED_STATE = "[data-testid='unconfigured-state']";
const USER_BUBBLE = "[data-message-role='user']";
const AGENT_BUBBLE = "[data-message-role='agent']";
const sessionItem = (spaceKey) => `[data-session-item='${spaceKey}']`;
const sessionGroup = (name) => `[data-session-group='${name}']`;
const projectRow = (pid) => `[data-project-row='${pid}']`;

const FEISHU_KEY = "feishu:oc_e2e_chat1";
const ORPHAN_PID = "ghost-project";
const ORPHAN_KEY = `ui:project:${ORPHAN_PID}:e2e1`;

async function seedAgentConfig(apiBaseUrl) {
  const res = await fetch(`${apiBaseUrl}/api/settings/agent`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider: "deepseek", apiKey: "sk-e2e-faux-placeholder", identity: "" }),
  });
  expect(res.ok).toBe(true);
}

async function seedSessions(firstWindow, rows) {
  await firstWindow.evaluate((list) => window.opc.__seedAgentSessions(list), rows);
}

async function reloadAssistant(firstWindow) {
  await firstWindow.reload();
  await expect(firstWindow.locator(SCREEN_ASSISTANT)).toBeVisible();
}

test.describe("飞书只读视图 / 孤儿会话 / 无权限面 / 未配置引导", () => {
  let electronApp;
  let firstWindow;
  let apiBaseUrl;
  let userDataDir;

  test.beforeEach(async () => {
    const ctx = await startElectronApp({ extraEnv: { OPC_AGENT_FAUX: "1" } });
    electronApp = ctx.electronApp;
    firstWindow = ctx.firstWindow;
    apiBaseUrl = ctx.apiBaseUrl;
    userDataDir = ctx.userDataDir;
  });

  test.afterEach(async () => {
    await stopElectronApp(electronApp, userDataDir);
  });

  test("REQ-AGENT-034 AC1: 飞书会话选中 → 历史气泡只读、无输入区、只读标注", async () => {
    await seedAgentConfig(apiBaseUrl);
    await seedSessions(firstWindow, [
      {
        spaceKey: FEISHU_KEY,
        title: "与 OPC 助手的单聊",
        lastActiveAt: new Date().toISOString(),
        messages: [
          { role: "user", text: "看看最近的执行情况" },
          { role: "assistant", text: "最近 24 小时共 6 次执行：4 成功 / 1 失败 / 1 执行中。" },
        ],
      },
    ]);

    await reloadAssistant(firstWindow);

    // 飞书分组平铺呈现（2026-08-06 拍板：独立「飞书」分组），选中会话。
    await expect(firstWindow.locator(sessionGroup("feishu")).locator(sessionItem(FEISHU_KEY))).toBeVisible();
    await firstWindow.click(sessionItem(FEISHU_KEY));

    // 历史气泡渲染（用户 + agent）。
    await expect(firstWindow.locator(MESSAGE_LIST).locator(USER_BUBBLE).filter({ hasText: "看看最近的执行情况" })).toBeVisible();
    await expect(firstWindow.locator(MESSAGE_LIST).locator(AGENT_BUBBLE).filter({ hasText: "最近 24 小时" })).toBeVisible();

    // 无输入区（composer 不存在）；只读标注可见（REQ 原文文案）。
    await expect(firstWindow.locator(COMPOSER_INPUT)).toHaveCount(0);
    await expect(firstWindow.locator(SEND_BUTTON)).toHaveCount(0);
    await expect(firstWindow.locator(COMPOSER_READONLY)).toBeVisible();
    await expect(firstWindow.locator(READONLY_REASON)).toHaveText("飞书会话 · 请到飞书继续对话");
    // 空间徽标含「飞书」。
    await expect(firstWindow.locator(CHAT_SPACE_BADGE)).toContainText("飞书");
  });

  test("REQ-AGENT-034 AC3（E2E 面）: 飞书侧新消息到达后列表与历史更新可见", async () => {
    await seedAgentConfig(apiBaseUrl);
    await seedSessions(firstWindow, [
      {
        spaceKey: FEISHU_KEY,
        title: "与 OPC 助手的单聊",
        lastActiveAt: new Date(Date.now() - 3600_000).toISOString(),
        messages: [{ role: "user", text: "第一条" }],
      },
    ]);
    await reloadAssistant(firstWindow);
    await firstWindow.click(sessionItem(FEISHU_KEY));
    await expect(firstWindow.locator(MESSAGE_LIST).locator(USER_BUBBLE)).toHaveCount(1);

    // 模拟通道侧新消息到达：同一 spaceKey 追加消息并更新 lastActiveAt。
    await seedSessions(firstWindow, [
      {
        spaceKey: FEISHU_KEY,
        lastActiveAt: new Date().toISOString(),
        messages: [{ role: "assistant", text: "【通知】日报生成已完成（执行 #118）" }],
      },
    ]);
    await reloadAssistant(firstWindow);
    await firstWindow.click(sessionItem(FEISHU_KEY));

    // 新消息进入历史可见；旧消息不丢。
    await expect(firstWindow.locator(MESSAGE_LIST).locator(USER_BUBBLE).filter({ hasText: "第一条" })).toBeVisible();
    await expect(
      firstWindow.locator(MESSAGE_LIST).locator(AGENT_BUBBLE).filter({ hasText: "日报生成已完成" })
    ).toBeVisible();
    // SSE 实时增量（不刷新页面即时呈现）由集成套件覆盖（feishuReadonly.test.js /
    // sessionEvents.test.js，通道入站 seam 在 node 层可注入）；E2E 只验可见性更新。
    // signoff 2026-08-06: assertion signed（裁决见 signoff.md）
  });

  test("REQ-AGENT-029 AC2（E2E 面）: 孤儿会话 → 项目行 deleted 态、输入区禁用并标注", async () => {
    await seedAgentConfig(apiBaseUrl);
    // 孤儿造数：会话行 projectId（ghost-project）不存在于 projects 表——不建项目直接 seed。
    await seedSessions(firstWindow, [
      {
        spaceKey: ORPHAN_KEY,
        title: "日报模板再改一版",
        lastActiveAt: new Date().toISOString(),
        messages: [
          { role: "user", text: "日报模板再改一版，标题带上日期" },
          { role: "assistant", text: "已更新 templates/daily.md。" },
        ],
      },
    ]);

    await reloadAssistant(firstWindow);

    // 项目分组内孤儿行：deleted 态（划线呈现），无行内「＋」。
    const row = firstWindow.locator(sessionGroup("projects")).locator(projectRow(ORPHAN_PID));
    await expect(row).toBeVisible();
    await expect(row).toHaveClass(/deleted/);
    await expect(row.locator(`[data-add-project='${ORPHAN_PID}']`)).toHaveCount(0);

    // 展开选中孤儿会话：历史可读，输入区禁用 + 标注「项目已删除」（仅可回看）。
    await row.click();
    await firstWindow.click(sessionItem(ORPHAN_KEY));
    await expect(firstWindow.locator(MESSAGE_LIST).locator(USER_BUBBLE).filter({ hasText: "日报模板" })).toBeVisible();
    await expect(firstWindow.locator(COMPOSER_INPUT)).toHaveCount(0);
    await expect(firstWindow.locator(COMPOSER_READONLY)).toBeVisible();
    // 标注措辞按原型拍板（「项目已删除，仅可回看」）；断言稳定片段。
    await expect(firstWindow.locator(READONLY_REASON)).toContainText("项目已删除");
    await expect(firstWindow.locator(CHAT_SPACE_BADGE)).toContainText("项目已删除");
    // 发送 409（E-SESSION-ORPHAN）由 API 套件兜底（REQ-AGENT-028 标准 3），本用例只验 UI 禁用面。
  });

  test("REQ-AGENT-033 AC6: 设置页无任何权限相关 tab/区", async () => {
    // 进管理区 → 设置（旧路由页面本体不变）。
    await expect(firstWindow.locator(SCREEN_ASSISTANT)).toBeVisible();
    await firstWindow.click("[data-testid='open-admin-button']");
    await firstWindow.click(locators.SETTINGS_LINK);
    await expect(firstWindow.locator(locators.SETTINGS_PAGE)).toBeVisible();

    // tab 仍为拍板四个（general/agent/channel/about），无 permission tab/面板/按钮。
    await expect(firstWindow.locator("[role='tab']")).toHaveCount(4);
    await expect(firstWindow.locator("[role='tab'][data-tab='permission']")).toHaveCount(0);
    await expect(firstWindow.locator("[data-tab-panel='permission']")).toHaveCount(0);
    await expect(firstWindow.locator(locators.SETTINGS_PAGE).locator("[data-testid*='permission']")).toHaveCount(0);
    await expect(
      firstWindow.locator(locators.SETTINGS_PAGE).getByRole("button", { name: /权限|permission/i })
    ).toHaveCount(0);
  });

  test("REQ-AGENT-028 AC3（UI 面）: agent 未配置 → 引导态可见且输入禁用", async () => {
    // 「清配置」裁决：settings 无 DELETE/clear 端点——靠测试数据隔离实现：
    // fixture 每用例独立 userDataDir（beforeEach 新实例），本用例刻意不调用
    // seedAgentConfig()，即未配置态；其他用例的 PUT /api/settings/agent 只落在
    // 各自实例的 settings.json，互不污染。

    await reloadAssistant(firstWindow);

    // 未配置引导态可见（§8 错误态；原型 guide-card 含「去配置」入口）。
    await expect(firstWindow.locator(UNCONFIGURED_STATE)).toBeVisible();

    // 输入禁用：composer 呈现但 input/send 均 disabled（原型未配置态行为）。
    await expect(firstWindow.locator(COMPOSER_INPUT)).toBeDisabled();
    await expect(firstWindow.locator(SEND_BUTTON)).toBeDisabled();
    // 发送 409（E-AGENT-CONFIG）由 API 套件兜底（REQ-AGENT-028 标准 3），本用例只验 UI 引导面。
  });
});
