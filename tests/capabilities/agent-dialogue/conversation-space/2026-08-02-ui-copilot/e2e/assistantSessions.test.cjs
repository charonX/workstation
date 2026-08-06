// REQ-TRACE: 2026-08-02-ui-copilot/REQ-AGENT-029, 2026-08-02-ui-copilot/REQ-AGENT-027
// REQ-VERSION: v1-hash:8432c0cff25d5ef4a71d5c8fd95b3045977d65430eb968d7063be5fc81d67012
// CAPABILITY-TRACE: agent-dialogue
// ENTITY-TRACE: conversation-space
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true

// REQ-AGENT-029 标准 6 + REQ-AGENT-027 标准 4（E2E 面）：分组会话列表与历史回看、
// 新对话归属与 /reset（PRD S2/S4，
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
//   [data-testid='empty-space-name']         空态当前空间名（「通用」或「项目 · <项目名>」，格式按原型拍板）
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
// E2E 环境（FAUX，零网络；细则见 assistantChat.test.cjs 文件头同段注释）：
// - OPC_AGENT_FAUX=1 经 extraEnv 透传 worker；agent 配置经 PUT /api/settings/agent
//   播种占位 provider/key。本套件不断言流式中间态，TPS 用默认值（1000）。
// - 会话经 POST /api/agent/sessions 创建（tech-design 接口契约）；历史经
//   POST .../messages 真实发送 + 轮询 GET .../messages 等 agent 回声落历史后构造。
//   GET .../messages 响应形态假设：数组或 { messages: [...] }，元素含 role
//   （user/agent/assistant）——implementer 对齐。

const { test, expect } = require("@playwright/test");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { startElectronApp, stopElectronApp } = require("../../../../../e2e/fixtures/electronApp.cjs");
const { createProject } = require("../../../../../e2e/helpers/seed.cjs");

const SCREEN_ASSISTANT = "[data-testid='screen-assistant']";
const NEW_CHAT_BUTTON = "[data-testid='new-chat-button']";
const MESSAGE_LIST = "[data-testid='message-list']";
const COMPOSER_INPUT = "[data-testid='composer-input']";
const SEND_BUTTON = "[data-testid='send-button']";
const EMPTY_STATE = "[data-testid='empty-state']";
const EMPTY_SPACE_NAME = "[data-testid='empty-space-name']";
const CHAT_TITLE = "[data-testid='chat-title']";
const USER_BUBBLE = "[data-message-role='user']";
const AGENT_BUBBLE = "[data-message-role='agent']";
const sessionItem = (spaceKey) => `[data-session-item='${spaceKey}']`;
const sessionGroup = (name) => `[data-session-group='${name}']`;
const projectRow = (pid) => `[data-project-row='${pid}']`;
const addProjectButton = (pid) => `[data-add-project='${pid}']`;
const projectSessions = (pid) => `[data-project-sessions='${pid}']`;

const REPLY_TIMEOUT = 60000;

async function seedAgentConfig(apiBaseUrl) {
  const res = await fetch(`${apiBaseUrl}/api/settings/agent`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider: "deepseek", apiKey: "sk-e2e-faux-placeholder", identity: "" }),
  });
  expect(res.ok).toBe(true);
}

async function createSession(apiBaseUrl, body) {
  const res = await fetch(`${apiBaseUrl}/api/agent/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  expect(res.ok).toBe(true);
  const json = await res.json();
  expect(typeof json.spaceKey).toBe("string");
  return json.spaceKey;
}

async function sendMessage(apiBaseUrl, spaceKey, text) {
  const res = await fetch(`${apiBaseUrl}/api/agent/sessions/${encodeURIComponent(spaceKey)}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  expect(res.status).toBe(202);
}

// 等 agent 回声落历史（POST 为 202 异步；轮询 GET .../messages 直到 agent 消息出现）。
async function waitForAgentReply(apiBaseUrl, spaceKey) {
  const deadline = Date.now() + REPLY_TIMEOUT;
  while (Date.now() < deadline) {
    const res = await fetch(`${apiBaseUrl}/api/agent/sessions/${encodeURIComponent(spaceKey)}/messages`);
    if (res.ok) {
      const body = await res.json();
      const msgs = Array.isArray(body) ? body : body.messages ?? [];
      if (msgs.some((m) => m.role === "agent" || m.role === "assistant")) return;
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`waitForAgentReply timed out: ${spaceKey}`);
}

test.describe("分组会话列表与历史回看", () => {
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

  async function makeProject(name) {
    projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "opc-ui-copilot-e2e-"));
    return createProject(apiBaseUrl, { name, localPath: projectDir });
  }

  test("REQ-AGENT-029 AC6: 点会话 → 右栏渲染完整历史气泡，active 态跟随", async () => {
    // 两个通用会话各造一轮历史（FAUX 回声含用户文本，内容可区分）。
    const keyA = await createSession(apiBaseUrl, { spaceKind: "general" });
    await sendMessage(apiBaseUrl, keyA, "ALPHA 消息");
    await waitForAgentReply(apiBaseUrl, keyA);
    const keyB = await createSession(apiBaseUrl, { spaceKind: "general" });
    await sendMessage(apiBaseUrl, keyB, "BETA 消息");
    await waitForAgentReply(apiBaseUrl, keyB);

    await firstWindow.reload();
    await expect(firstWindow.locator(SCREEN_ASSISTANT)).toBeVisible();

    // 点 A：A 的历史气泡渲染（用户气泡 + agent 气泡），active 落在 A。
    await firstWindow.click(sessionItem(keyA));
    await expect(firstWindow.locator(sessionItem(keyA))).toHaveAttribute("data-active", "true");
    await expect(firstWindow.locator(MESSAGE_LIST).locator(USER_BUBBLE).filter({ hasText: "ALPHA 消息" })).toBeVisible();
    await expect(firstWindow.locator(MESSAGE_LIST).locator(AGENT_BUBBLE).first()).toBeVisible();

    // 点 B：active 跟随到 B，右栏换成 B 的历史（A 的气泡不再渲染）。
    await firstWindow.click(sessionItem(keyB));
    await expect(firstWindow.locator(sessionItem(keyB))).toHaveAttribute("data-active", "true");
    await expect(firstWindow.locator(sessionItem(keyA))).not.toHaveAttribute("data-active", "true");
    await expect(firstWindow.locator(MESSAGE_LIST).locator(USER_BUBBLE).filter({ hasText: "BETA 消息" })).toBeVisible();
    await expect(firstWindow.locator(MESSAGE_LIST).locator(USER_BUBBLE).filter({ hasText: "ALPHA 消息" })).toHaveCount(0);
  });

  test("REQ-AGENT-029 AC6: 项目分组可展开/收起（aria-expanded 联动）", async () => {
    const project = await makeProject("分组项目");
    await createSession(apiBaseUrl, { spaceKind: "project", projectId: project.id });

    await firstWindow.reload();
    await expect(firstWindow.locator(SCREEN_ASSISTANT)).toBeVisible();
    const row = firstWindow.locator(projectRow(project.id));
    await expect(row).toBeVisible();

    // 默认展开/收起不锁定（实现自由）；连点两次须往返，aria-expanded 与列表显隐联动。
    const initial = await row.getAttribute("aria-expanded");
    await row.click();
    const afterFirst = initial === "true" ? "false" : "true";
    await expect(row).toHaveAttribute("aria-expanded", afterFirst);
    if (afterFirst === "true") {
      await expect(firstWindow.locator(projectSessions(project.id))).toBeVisible();
    } else {
      await expect(firstWindow.locator(projectSessions(project.id))).toBeHidden();
    }

    await row.click();
    await expect(row).toHaveAttribute("aria-expanded", initial === "true" ? "true" : "false");
  });

  test("REQ-AGENT-029 AC6 + 新对话归属: 项目行＋ → 空态显示「项目 · <名>」", async () => {
    const project = await makeProject("归属项目");
    await createSession(apiBaseUrl, { spaceKind: "project", projectId: project.id });

    await firstWindow.reload();
    await expect(firstWindow.locator(SCREEN_ASSISTANT)).toBeVisible();

    // 悬停项目行显现「＋」（原型：hover 显现）；点击后该分组自动展开。
    const row = firstWindow.locator(projectRow(project.id));
    await row.hover();
    await firstWindow.click(addProjectButton(project.id));

    // 空态：仅标题 + 当前空间（无引导卡，2026-08-06 拍板）。
    await expect(firstWindow.locator(EMPTY_STATE)).toBeVisible();
    await expect(firstWindow.locator(EMPTY_SPACE_NAME)).toHaveText(`项目 · ${project.name}`);
    await expect(firstWindow.locator(CHAT_TITLE)).toHaveText("新对话");
    await expect(row).toHaveAttribute("aria-expanded", "true");
    // 空态下输入区可用（新对话可首发）。
    await expect(firstWindow.locator(COMPOSER_INPUT)).toBeVisible();
    await expect(firstWindow.locator(COMPOSER_INPUT)).toBeEnabled();
  });

  test("REQ-AGENT-029 AC6 + 新对话归属: 顶部新对话 → 空态「通用」", async () => {
    const keyA = await createSession(apiBaseUrl, { spaceKind: "general" });
    await sendMessage(apiBaseUrl, keyA, "历史消息");
    await waitForAgentReply(apiBaseUrl, keyA);

    await firstWindow.reload();
    await expect(firstWindow.locator(SCREEN_ASSISTANT)).toBeVisible();
    // 先选中历史会话，再点新对话 —— 验证从会话中切到空态。
    await firstWindow.click(sessionItem(keyA));
    await expect(firstWindow.locator(MESSAGE_LIST).locator(USER_BUBBLE)).toHaveCount(1);

    await firstWindow.click(NEW_CHAT_BUTTON);

    await expect(firstWindow.locator(EMPTY_STATE)).toBeVisible();
    await expect(firstWindow.locator(EMPTY_SPACE_NAME)).toHaveText("通用");
    await expect(firstWindow.locator(CHAT_TITLE)).toHaveText("新对话");
    // 原会话 active 态清除（归属切换，无选中会话）。
    await expect(firstWindow.locator(sessionItem(keyA))).not.toHaveAttribute("data-active", "true");
  });

  test("REQ-AGENT-027 AC4（E2E 面）: /reset → 同分组新会话出现且旧会话历史仍在", async () => {
    const keyOld = await createSession(apiBaseUrl, { spaceKind: "general" });
    await sendMessage(apiBaseUrl, keyOld, "重置前的历史");
    await waitForAgentReply(apiBaseUrl, keyOld);

    await firstWindow.reload();
    await expect(firstWindow.locator(SCREEN_ASSISTANT)).toBeVisible();
    await firstWindow.click(sessionItem(keyOld));
    await expect(firstWindow.locator(MESSAGE_LIST).locator(USER_BUBBLE).filter({ hasText: "重置前的历史" })).toBeVisible();

    const generalItems = firstWindow.locator(sessionGroup("general")).locator("[data-session-item]");
    const countBefore = await generalItems.count();

    // UI 无独立 /reset 按钮（原型未提供）——经 composer 发送 "/reset" 斜杠命令触发
    // （tech-design F4：UI 会话内 /reset = 同分组新建会话并切换，旧行保留）。
    // signoff 2026-08-06: assertion signed（裁决见 signoff.md）
    await firstWindow.fill(COMPOSER_INPUT, "/reset");
    await firstWindow.click(SEND_BUTTON);

    // 新会话出现（通用分组行数 +1）且切换为当前选中；旧会话仍在列表。
    await expect(generalItems).toHaveCount(countBefore + 1, { timeout: 15000 });
    await expect(firstWindow.locator(sessionItem(keyOld))).toBeVisible();
    const activeItem = firstWindow.locator(sessionGroup("general")).locator("[data-session-item][data-active='true']");
    await expect(activeItem).toHaveCount(1);
    const newKey = await activeItem.getAttribute("data-session-item");
    expect(newKey).not.toBe(keyOld);

    // 旧会话历史仍可读（REQ-AGENT-027 标准 4：旧行保留且历史仍可读）。
    await firstWindow.click(sessionItem(keyOld));
    await expect(firstWindow.locator(MESSAGE_LIST).locator(USER_BUBBLE).filter({ hasText: "重置前的历史" })).toBeVisible();
  });
});
