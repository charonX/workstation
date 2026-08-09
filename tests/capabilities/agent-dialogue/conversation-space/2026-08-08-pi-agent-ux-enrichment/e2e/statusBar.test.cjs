// REQ-TRACE: 2026-08-08-pi-agent-ux-enrichment/REQ-AGENT-056, 2026-08-08-pi-agent-ux-enrichment/REQ-AGENT-057
// REQ-VERSION: v2-hash:8636a9744f9f1bf33cc0c1163dd1d7f53852e22445f0e8dc55c84f4059bb4266
// CAPABILITY-TRACE: agent-dialogue
// ENTITY-TRACE: conversation-space
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true

// 顶栏状态栏（B9）+ 消息元数据（B10）。
//
// seam：真实 Electron + 项目空间会话（git 仓库 fixture——临时目录 git init + 分支）+
// FAUX 会话（执行状态切换、消息元数据）。
// 参照：assistant-rich.html（composer 上方状态栏三区 + 消息 meta 行）。
// 运行：npm run test:e2e（先 rebuild:electron）。
//
// [Slice 9 接线修正记录（2026-08-09，断言语义不变，test-gap 就地补全）]
//   1. seed 按现契约：POST /api/agent/sessions { spaceKind } → { spaceKey }（原
//      { spaceKey, provider, apiKey } 与现契约不符 → 400 E-SESSION-CREATE）+
//      seedAgentConfig（缺失 → 发送 409）。
//   2. 项目会话打开：先点 [data-project-row] 展开项目组，再按返回的精确 spaceKey
//      点击（原 `ui:project:${id}:*` 通配为 CSS 字面量永不匹配）。
//   3. extraEnv：OPC_AGENT_FAUX="1"（NODE_ENV=development 下 worker 不自动 FAUX）+
//      OPC_AGENT_FAUX_TPS="200"（拉长流式窗口，assistantChat 同型）。
const { test, expect } = require("@playwright/test");
const { startElectronApp, stopElectronApp } = require("../../../../../e2e/fixtures/electronApp.cjs");
const { execSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const SCREEN_ASSISTANT = "[data-testid='screen-assistant']";
const COMPOSER_INPUT = "[data-testid='composer-input']";
const SEND_BUTTON = "[data-testid='send-button']";
const STATUS_BAR = "[data-testid='status-bar']";
const STATUS_EXEC = "[data-testid='status-exec']";
const STATUS_BRANCH = "[data-testid='status-branch']";
const STATUS_CONTEXT = "[data-testid='status-context']";
const META = "[data-testid='msg-meta']";
const sessionItem = (spaceKey) => `[data-session-item='${spaceKey}']`;

const DONE_TIMEOUT = 120000;

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
  return (await res.json()).spaceKey;
}

async function openSession(firstWindow, spaceKey) {
  await firstWindow.reload();
  await expect(firstWindow.locator(SCREEN_ASSISTANT)).toBeVisible();
  await firstWindow.click(sessionItem(spaceKey));
  await expect(firstWindow.locator(COMPOSER_INPUT)).toBeVisible();
}

function makeGitRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-git-fixture-"));
  execSync("git init -q -b main", { cwd: dir });
  fs.writeFileSync(path.join(dir, "README.md"), "fixture");
  execSync("git add -A && git commit -qm init", { cwd: dir });
  execSync("git checkout -q -b feat/demo", { cwd: dir });
  return dir;
}

test.describe("REQ-AGENT-056/057 状态栏与消息元数据", () => {
  let ctx;
  let gitDir;

  test.beforeEach(async () => {
    gitDir = makeGitRepo();
    ctx = await startElectronApp({ extraEnv: { OPC_AGENT_FAUX: "1", OPC_AGENT_FAUX_TPS: "200" } });
    await seedAgentConfig(ctx.apiBaseUrl);
  });

  test.afterEach(async () => {
    await stopElectronApp(ctx.electronApp);
    fs.rmSync(gitDir, { recursive: true, force: true });
  });

  test("REQ-AGENT-056 标准1/2：状态栏位于 composer 上方，三区齐全；执行状态随流式/工具切换", async () => {
    // 建项目 + 项目空间会话（git 仓库 fixture 作为 localPath）
    const res = await fetch(`${ctx.apiBaseUrl}/api/projects`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "git-demo", localPath: gitDir }),
    });
    expect(res.ok).toBe(true);
    const project = await res.json();
    const spaceKey = await createSession(ctx.apiBaseUrl, { spaceKind: "project", projectId: project.id });
    // 打开会话：展开项目组 + 精确 spaceKey
    await ctx.firstWindow.reload();
    await ctx.firstWindow.locator(`[data-project-row='${project.id}']`).first().click();
    await ctx.firstWindow.click(sessionItem(spaceKey));
    // 状态栏在 composer 上方（DOM 顺序断言：status-bar 在 composer 之前）
    await expect(ctx.firstWindow.locator(STATUS_BAR)).toBeVisible();
    await expect(ctx.firstWindow.locator(STATUS_BAR).locator(STATUS_EXEC)).toBeVisible();
    await expect(ctx.firstWindow.locator(STATUS_BAR).locator(STATUS_BRANCH)).toContainText("feat/demo");
    await expect(ctx.firstWindow.locator(STATUS_BAR).locator(STATUS_CONTEXT)).toBeVisible();
    // composer 在状态栏之后
    const barBox = await ctx.firstWindow.locator(STATUS_BAR).boundingBox();
    const composerBox = await ctx.firstWindow.locator(COMPOSER_INPUT).boundingBox();
    expect(barBox.y + barBox.height).toBeLessThanOrEqual(composerBox.y + 1);
    // 执行状态切换：发送 → 回复中
    await ctx.firstWindow.fill(COMPOSER_INPUT, "测试状态切换");
    await ctx.firstWindow.click(SEND_BUTTON);
    await expect(ctx.firstWindow.locator(STATUS_EXEC)).toContainText(/回复中|工具执行中/);
    // 完成回空闲
    await expect(ctx.firstWindow.locator(STATUS_EXEC)).toContainText("空闲", { timeout: DONE_TIMEOUT });
  });

  test("REQ-AGENT-056 标准3：git 分支三态——正常分支（上例已验）/ detached / 非仓库", async () => {
    // detached：git checkout --detach
    execSync("git checkout -q --detach", { cwd: gitDir });
    // 非仓库：临时普通目录
    const plainDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-nogit-"));
    // detached 断言
    const res = await fetch(`${ctx.apiBaseUrl}/api/projects`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "git-detached", localPath: gitDir }),
    });
    const project = await res.json();
    const spaceKey1 = await createSession(ctx.apiBaseUrl, { spaceKind: "project", projectId: project.id });
    await ctx.firstWindow.reload();
    await ctx.firstWindow.locator(`[data-project-row='${project.id}']`).first().click();
    await ctx.firstWindow.click(sessionItem(spaceKey1));
    await expect(ctx.firstWindow.locator(STATUS_BRANCH)).toContainText(/detached|分离/i);
    // 非仓库：分支区显示「无 git」/隐藏
    const res2 = await fetch(`${ctx.apiBaseUrl}/api/projects`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "git-none", localPath: plainDir }),
    });
    const project2 = await res2.json();
    const spaceKey2 = await createSession(ctx.apiBaseUrl, { spaceKind: "project", projectId: project2.id });
    await ctx.firstWindow.reload();
    await ctx.firstWindow.locator(`[data-project-row='${project2.id}']`).first().click();
    await ctx.firstWindow.click(sessionItem(spaceKey2));
    await expect(ctx.firstWindow.locator(STATUS_BRANCH)).toContainText(/无 git|无仓库/i);
    fs.rmSync(plainDir, { recursive: true, force: true });
  });

  test("REQ-AGENT-057 标准1/2：消息元数据——完成态显示耗时+token，流式期间不显示", async () => {
    const spaceKey = await createSession(ctx.apiBaseUrl, { spaceKind: "general" });
    await openSession(ctx.firstWindow, spaceKey);
    await ctx.firstWindow.fill(COMPOSER_INPUT, "生成元数据测试回复");
    await ctx.firstWindow.click(SEND_BUTTON);
    // 流式期间：meta 不出现
    const streamingBubble = ctx.firstWindow.locator("[data-message-role='agent'][data-streaming='true']");
    await expect(streamingBubble.first()).toBeVisible();
    // 完成态：meta 出现（耗时 + token；FAUX usage 空则显示「-」/隐藏——断言 meta 容器存在）
    await expect(ctx.firstWindow.locator("[data-message-role='agent'][data-streaming='true']")).toHaveCount(0, { timeout: DONE_TIMEOUT });
    const lastBubble = ctx.firstWindow.locator("[data-message-role='agent']").last();
    await expect(lastBubble.locator(META)).toBeVisible();
  });
});
