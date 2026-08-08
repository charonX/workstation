// REQ-TRACE: 2026-08-07-pi-agent-consolidation/REQ-AGENT-044
// REQ-VERSION: v1-hash:b8623e43fa224a212bb884effd47066c81d246467aa97a9ff2be12e5c10c3c09
// CAPABILITY-TRACE: agent-dialogue
// ENTITY-TRACE: confirmation
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true

// REQ-AGENT-044 T-9 bash pre-gate→授权桥生产全链（B9）——验收标准 1-3。
// 覆盖：agent 主动发起 bash 命中不可见族命令 → pre-gate 预分类 / gotgenes gate
// → 授权桥挂起 → UI 确认卡批准 → 命令真实执行（副作用可见）；批准前不执行、
// 批准后恰一次（唯一执行者 ADR-017）。
//
// [Slice 6 收尾修正记录（test-gap 就地补全，2026-08-08 人裁决「新 seam 方案」）]
// 处置同 confirmChainUi.test.cjs（D1-D5）：startElectronApp 接线 + 注入缝
// OPC_FAUX_TOOL_SEQUENCE（worker.js FAUX 专属）→ agent 真实发起 bash 工具调用 →
// 生产链（pre-gate/授权桥 → 确认卡 → 决议 → 执行），零短路；locator 对齐
// [data-confirm-card] / [data-testid='confirm-approve-button']（「确认执行」）；
// 恰一卡用容器计数（D4）；fs 副作用断言方式（mkdtemp 目标，E2E 与 Electron
// 同机可直读）沿用原签核设计（build-progress Slice 6 结论：本方式可用）。
// 断言语义（验收标准 1-3）不变。
//
// 运行：npm run test:e2e（先 rebuild:electron；ABI 备忘见 testing.md）。

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
const CONFIRM_CARD = "[data-confirm-card]";
const CONFIRM_DONE = "[data-confirm-card][data-state='done']";
const CONFIRM_APPROVE = "[data-testid='confirm-approve-button']";
const sessionItem = (spaceKey) => `[data-session-item='${spaceKey}']`;
const projectRow = (projectId) => `[data-project-row='${projectId}']`;
const projectSessions = (projectId) => `[data-project-sessions='${projectId}']`;

async function seedAgentConfig(apiBaseUrl) {
  const res = await fetch(`${apiBaseUrl}/api/settings/agent`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider: "deepseek", apiKey: "sk-e2e-faux-placeholder", identity: "" }),
  });
  expect(res.ok).toBe(true);
}

// 测试根目录（启动前创建，路径确定性供注入缝参数）：projectDir = <root>/project；
// 标准3 的 `../` 相对重定向落在 <root>/confirm-outside.txt（唯一，不撞车）。
async function makeTestRoot() {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "opc-pi-confirm-"));
  const projectDir = path.join(root, "project");
  await fsp.mkdir(projectDir);
  return { root, projectDir };
}

async function launchApp(toolSequence) {
  const ctx = await startElectronApp({
    extraEnv: { OPC_AGENT_FAUX: "1", OPC_FAUX_TOOL_SEQUENCE: JSON.stringify(toolSequence) },
  });
  await seedAgentConfig(ctx.apiBaseUrl);
  return ctx;
}

async function setupProjectSession(apiBaseUrl, projectDir) {
  const project = await createProject(apiBaseUrl, { name: "T9 确认项目", localPath: projectDir });
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

test.describe("REQ-AGENT-044 T-9 bash pre-gate→授权桥生产全链", () => {
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

  test("标准1：bash 不可见族 → pre-gate/授权桥挂起 → 批准 → 命令真实执行（副作用可见）", async () => {
    const { root, projectDir } = await makeTestRoot();
    const target = path.join(root, "out.txt");
    const ctx = await launchApp([{ tool: "bash", args: { command: `echo e2e > ${target}` } }]);
    electronApp = ctx.electronApp;
    firstWindow = ctx.firstWindow;
    apiBaseUrl = ctx.apiBaseUrl;
    userDataDir = ctx.userDataDir;
    rootDir = root;

    const { projectId, spaceKey } = await setupProjectSession(apiBaseUrl, projectDir);
    await openProjectSession(firstWindow, projectId, spaceKey);

    // 不可见族命令（绝对路径 → cwd 外 → 双命中：重定向 + external → gotgenes
    // 优先单卡，判别表双命中行）→ 授权桥挂起 → 确认卡。
    await sendPrompt(firstWindow, `执行 bash 命令：echo e2e > ${target}`);
    const card = firstWindow.locator(MESSAGE_LIST).locator(CONFIRM_CARD);
    await expect(card).toBeVisible({ timeout: 60000 });

    // 批准 → 命令真实执行（副作用可见：目标文件存在且内容含 e2e）。
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
    ).toContain("e2e");
  });

  test("标准2：批准前命令不执行（无副作用）；批准后恰执行一次（唯一执行者）", async () => {
    const { root, projectDir } = await makeTestRoot();
    const target = path.join(root, "out2.txt");
    const ctx = await launchApp([{ tool: "bash", args: { command: `echo once > ${target}` } }]);
    electronApp = ctx.electronApp;
    firstWindow = ctx.firstWindow;
    apiBaseUrl = ctx.apiBaseUrl;
    userDataDir = ctx.userDataDir;
    rootDir = root;

    const { projectId, spaceKey } = await setupProjectSession(apiBaseUrl, projectDir);
    await openProjectSession(firstWindow, projectId, spaceKey);

    await sendPrompt(firstWindow, `执行 bash 命令：echo once > ${target}`);
    const card = firstWindow.locator(MESSAGE_LIST).locator(CONFIRM_CARD);
    await expect(card).toBeVisible({ timeout: 60000 });

    // 批准前：文件不存在（命令未执行，无副作用）。
    expect(fs.existsSync(target)).toBe(false);

    // 批准 → 存在且内容恰一次（唯一执行者——内容不重复）。
    await card.locator(CONFIRM_APPROVE).click();
    await expect(firstWindow.locator(MESSAGE_LIST).locator(CONFIRM_DONE)).toBeVisible({ timeout: 60000 });
    await expect.poll(
      () => {
        try {
          return fs.readFileSync(target, "utf8").trim();
        } catch {
          return "";
        }
      },
      { timeout: 30000 }
    ).toBe("once");
  });

  test("标准3：双命中语料（echo hi > ../confirm-outside.txt 相对重定向出 cwd）E2E 恰一卡", async () => {
    const { root, projectDir } = await makeTestRoot();
    const ctx = await launchApp([{ tool: "bash", args: { command: "echo hi > ../confirm-outside.txt" } }]);
    electronApp = ctx.electronApp;
    firstWindow = ctx.firstWindow;
    apiBaseUrl = ctx.apiBaseUrl;
    userDataDir = ctx.userDataDir;
    rootDir = root;

    const { projectId, spaceKey } = await setupProjectSession(apiBaseUrl, projectDir);
    await openProjectSession(firstWindow, projectId, spaceKey);

    // 双命中：重定向 + cwd 外路径 → gotgenes 优先单卡（042 标准1 归属）。
    await sendPrompt(firstWindow, "执行 bash 命令：echo hi > ../confirm-outside.txt");
    const card = firstWindow.locator(MESSAGE_LIST).locator(CONFIRM_CARD);
    await expect(card).toBeVisible({ timeout: 60000 });
    // 恰一卡（[data-confirm-card] 容器计数——不含按钮）。
    await expect(firstWindow.locator(MESSAGE_LIST).locator(CONFIRM_CARD)).toHaveCount(1);
  });
});
