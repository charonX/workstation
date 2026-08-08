// REQ-TRACE: 2026-08-07-pi-agent-consolidation/REQ-AGENT-043
// REQ-VERSION: v1-hash:b8623e43fa224a212bb884effd47066c81d246467aa97a9ff2be12e5c10c3c09
// CAPABILITY-TRACE: agent-dialogue
// ENTITY-TRACE: confirmation
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true

// REQ-AGENT-043 T-7 UI confirm 生产全链（B8）——验收标准 1-3。
// 覆盖：agent 主动发起 confirm 级工具调用（write）→ worker 生产 confirm/授权桥链
// → UI 内联确认卡 → 批准/拒绝 → 工具执行/不执行 → 结果回投对话窗
// （真实 Electron 生产链，非直桥 seam）。
//
// [Slice 6 收尾修正记录（test-gap 就地补全，2026-08-08 人裁决「新 seam 方案」）]
// 原签核文件 6/6 在 page.goto 即失败（build-progress Slice 6 D1-D5）。处置：
//   D1 接线：复用 startElectronApp 夹具（同 assistantConfirm/assistantChat）——
//      startElectronApp → seedAgentConfig → API 建项目 + 项目空间会话 → 打开会话
//      再发消息；注入缝环境变量经 extraEnv 透传（worker 子进程继承主进程 env）；
//   D2 locator：确认卡 = [data-confirm-card]（既有已验收约定；原
//      getByTestId("confirm-card") 无对应元素——卡为裸 data-confirm-card 属性）；
//   D3 按钮：批准 = [data-testid='confirm-approve-button']（文案「确认执行」）、
//      拒绝 = [data-testid='confirm-reject-button']（文案「拒绝」）；原
//      getByRole(/批准|允许/) 永不匹配；
//   D4 计数：恰一卡断言改 [data-confirm-card] toHaveCount(1)（原
//      [data-testid*='confirm'] 匹配 approve+reject 两按钮，任何卡状态都 ≠1）；
//   D5 seam：新增可编程工具调用注入缝 OPC_FAUX_TOOL_SEQUENCE（worker.js FAUX
//      专属，[build] 实现）：FAUX 模型响应携带 fauxToolCall → pi 模型循环经
//      工具面**真实执行**（生产链：gotgenes gate（write=ask）→ 授权桥
//      permission-ask → 确认服务入队 → UI 卡 → 决议回传 → 工具执行 → 结果
//      入上下文 → 回声回投，零短路）；序列耗尽回落确定性回声。
// 断言语义（验收标准 1-3）不变。
//
// 运行：npm run test:e2e（先 rebuild:electron；ABI 备忘见 testing.md）。
// UX 参照：.aiassist/stories/2026-08-02-ui-copilot/ux/assistant.html（内联确认卡）。
// locator 沿用既有 assistantConfirm.test.cjs 约定。

const { test, expect } = require("@playwright/test");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { startElectronApp, stopElectronApp } = require("../../../../../e2e/fixtures/electronApp.cjs");
const { createProject } = require("../../../../../e2e/helpers/seed.cjs");

const SCREEN_ASSISTANT = "[data-testid='screen-assistant']";
const MESSAGE_LIST = "[data-testid='message-list']";
const COMPOSER_INPUT = "[data-testid='composer-input']";
const SEND_BUTTON = "[data-testid='send-button']";
const USER_BUBBLE = "[data-message-role='user']";
const AGENT_BUBBLE = "[data-message-role='agent']";
const CONFIRM_CARD = "[data-confirm-card]";
const CONFIRM_DONE = "[data-confirm-card][data-state='done']";
const CONFIRM_APPROVE = "[data-testid='confirm-approve-button']";
const CONFIRM_REJECT = "[data-testid='confirm-reject-button']";
const sessionItem = (spaceKey) => `[data-session-item='${spaceKey}']`;
const projectRow = (projectId) => `[data-project-row='${projectId}']`;
const projectSessions = (projectId) => `[data-project-sessions='${projectId}']`;

const STREAM_DONE_TIMEOUT = 120000;

async function seedAgentConfig(apiBaseUrl) {
  const res = await fetch(`${apiBaseUrl}/api/settings/agent`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider: "deepseek", apiKey: "sk-e2e-faux-placeholder", identity: "" }),
  });
  expect(res.ok).toBe(true);
}

// 测试根目录（启动前创建）：注入缝工具参数（绝对路径）必须在该时刻确定——
// mkdtemp 根 → projectDir = <root>/project（项目 localPath，确定性）；
// 标准3 的 `../` 相对重定向落在 <root>/confirm-outside.txt（唯一，多文件并行不撞车）。
async function makeTestRoot() {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "opc-pi-confirm-"));
  const projectDir = path.join(root, "project");
  await fsp.mkdir(projectDir);
  return { root, projectDir };
}

// 启动真实 Electron（FAUX，零网络）+ 注入可编程工具调用序列（D1/D5 接线）。
// toolSequence: [{ tool, args }]——启动前已知的确定性参数（路径基于 makeTestRoot）。
async function launchApp(toolSequence) {
  const ctx = await startElectronApp({
    extraEnv: { OPC_AGENT_FAUX: "1", OPC_FAUX_TOOL_SEQUENCE: JSON.stringify(toolSequence) },
  });
  await seedAgentConfig(ctx.apiBaseUrl);
  return ctx;
}

// 用已知 localPath 建项目 + 项目空间会话。
async function setupProjectSession(apiBaseUrl, projectDir) {
  const project = await createProject(apiBaseUrl, { name: "T7 确认项目", localPath: projectDir });
  const res = await fetch(`${apiBaseUrl}/api/agent/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ spaceKind: "project", projectId: project.id }),
  });
  expect(res.ok).toBe(true);
  const body = await res.json();
  expect(typeof body.spaceKey).toBe("string");
  return { projectId: project.id, spaceKey: body.spaceKey };
}

async function openProjectSession(firstWindow, projectId, spaceKey) {
  await firstWindow.reload();
  await expect(firstWindow.locator(SCREEN_ASSISTANT)).toBeVisible();
  await firstWindow.click(projectRow(projectId));
  await expect(firstWindow.locator(projectSessions(projectId))).toBeVisible();
  await firstWindow.click(sessionItem(spaceKey));
  await expect(firstWindow.locator(COMPOSER_INPUT)).toBeVisible();
}

async function sendPrompt(firstWindow, text) {
  await firstWindow.fill(COMPOSER_INPUT, text);
  await firstWindow.click(SEND_BUTTON);
  await expect(
    firstWindow.locator(MESSAGE_LIST).locator(USER_BUBBLE).filter({ hasText: text })
  ).toBeVisible();
}

test.describe("REQ-AGENT-043 T-7 UI confirm 生产全链", () => {
  let electronApp;
  let firstWindow;
  let apiBaseUrl;
  let userDataDir;
  let rootDir;

  test.afterEach(async () => {
    await stopElectronApp(electronApp, userDataDir);
    electronApp = null;
    if (rootDir) {
      await fsp.rm(rootDir, { recursive: true, force: true });
      rootDir = null;
    }
  });

  test("标准1：agent 发起 write 工具调用 → 确认卡渲染 → 批准 → 工具执行 → 结果回投对话窗", async () => {
    const { root, projectDir } = await makeTestRoot();
    const target = path.join(projectDir, "confirm-e2e.txt");
    const ctx = await launchApp([{ tool: "write", args: { path: target, content: "ok" } }]);
    electronApp = ctx.electronApp;
    firstWindow = ctx.firstWindow;
    apiBaseUrl = ctx.apiBaseUrl;
    userDataDir = ctx.userDataDir;
    rootDir = root;

    const { projectId, spaceKey } = await setupProjectSession(apiBaseUrl, projectDir);
    await openProjectSession(firstWindow, projectId, spaceKey);

    // agent 主动发起 write（注入缝）→ 确认卡出现（含工具描述）。
    await sendPrompt(firstWindow, "在项目目录写入文件 confirm-e2e.txt 内容为 ok");
    const card = firstWindow.locator(MESSAGE_LIST).locator(CONFIRM_CARD);
    await expect(card).toBeVisible({ timeout: 60000 });
    await expect(card.locator(CONFIRM_APPROVE)).toBeVisible();

    // 批准 → 工具真实执行（fs 副作用：目标文件产生且内容正确）。
    await card.locator(CONFIRM_APPROVE).click();
    await expect(firstWindow.locator(MESSAGE_LIST).locator(CONFIRM_DONE)).toBeVisible({ timeout: 60000 });
    await expect.poll(
      () => {
        try {
          return fs.readFileSync(target, "utf8");
        } catch {
          return "";
        }
      },
      { timeout: 30000 }
    ).toBe("ok");

    // 结果回投对话窗：agent 气泡（流式完成）含工具执行结果。
    const lastAgentBubble = firstWindow.locator(MESSAGE_LIST).locator(AGENT_BUBBLE).last();
    await expect(lastAgentBubble).toContainText(/已写入|完成/, { timeout: STREAM_DONE_TIMEOUT });
  });

  test("标准2：拒绝路径——拒绝 → 工具不执行 → 对话窗可见拒绝回执", async () => {
    const { root, projectDir } = await makeTestRoot();
    const target = path.join(projectDir, "confirm-reject.txt");
    const ctx = await launchApp([{ tool: "write", args: { path: target, content: "nope" } }]);
    electronApp = ctx.electronApp;
    firstWindow = ctx.firstWindow;
    apiBaseUrl = ctx.apiBaseUrl;
    userDataDir = ctx.userDataDir;
    rootDir = root;

    const { projectId, spaceKey } = await setupProjectSession(apiBaseUrl, projectDir);
    await openProjectSession(firstWindow, projectId, spaceKey);

    await sendPrompt(firstWindow, "在项目目录写入文件 confirm-reject.txt");
    const card = firstWindow.locator(MESSAGE_LIST).locator(CONFIRM_CARD);
    await expect(card).toBeVisible({ timeout: 60000 });
    await expect(card.locator(CONFIRM_REJECT)).toBeVisible();

    // 拒绝 → 卡片已处理态 + 对话窗可见拒绝回执 + 文件不产生（工具不执行）。
    await card.locator(CONFIRM_REJECT).click();
    await expect(firstWindow.locator(MESSAGE_LIST).locator(CONFIRM_DONE)).toBeVisible({ timeout: 60000 });
    const lastAgentBubble = firstWindow.locator(MESSAGE_LIST).locator(AGENT_BUBBLE).last();
    await expect(lastAgentBubble).toContainText(/拒绝|已取消|未执行/i, { timeout: STREAM_DONE_TIMEOUT });
    expect(fs.existsSync(target)).toBe(false);
  });

  test("标准3：全链恰好一张确认卡（REQ-AGENT-042 契约 E2E 层对应）", async () => {
    const { root, projectDir } = await makeTestRoot();
    const ctx = await launchApp([{ tool: "bash", args: { command: "echo hi > ../confirm-outside.txt" } }]);
    electronApp = ctx.electronApp;
    firstWindow = ctx.firstWindow;
    apiBaseUrl = ctx.apiBaseUrl;
    userDataDir = ctx.userDataDir;
    rootDir = root;

    const { projectId, spaceKey } = await setupProjectSession(apiBaseUrl, projectDir);
    await openProjectSession(firstWindow, projectId, spaceKey);

    // 双命中语料（重定向 + cwd 外，见 042 标准1 归属：gotgenes 优先单卡）。
    await sendPrompt(firstWindow, "执行 bash 命令：echo hi > ../confirm-outside.txt");
    const card = firstWindow.locator(MESSAGE_LIST).locator(CONFIRM_CARD);
    await expect(card).toBeVisible({ timeout: 60000 });
    // 恰一卡（[data-confirm-card] 容器计数——不含按钮）。
    await expect(firstWindow.locator(MESSAGE_LIST).locator(CONFIRM_CARD)).toHaveCount(1);
  });
});
