// REQ-TRACE: 2026-08-31-file-preview/REQ-PREVIEW-001, REQ-PREVIEW-002, REQ-PREVIEW-003, REQ-PREVIEW-004, REQ-PREVIEW-005, REQ-PREVIEW-006, REQ-PREVIEW-009
// REQ-VERSION: v1-hash:d06296e2ed011b1fc699777634a8b2f4eaa7c17954962e28f76383a725ccefb9
// CAPABILITY-TRACE: file-preview
// ENTITY-TRACE: file-preview-panel
// EXPECTED-TRACE: prd.md §6.1 流A/流C, §6.2 围栏行, §6.3 块1 rows 1-2/块2 rows 1-2/块4, §8 E1-E4, ux/file-preview.html
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true（2026-09-02 assertion signoff，见 signoff.md）
//
// 覆盖只能在真实窗口 + 真实 HTTP/SSE 通道下验证的面板流程：
// 聊天路径点击打开（流A）、围栏不识别、渲染/源码切换、代码高亮、图片直渲、
// 错误态页文案、与浏览器面板槽位互斥、外部修改自动刷新（流C）、外部删除切 E2。
// store/纯函数层契约见 component/filePreviewStore.test.js、component/pathRecognition.test.js；
// 服务端契约见 api/filesApi.test.js、api/filesWatch.test.js。
//
// data-testid 契约（ux/file-preview.html 结构对齐，实现必须落地）：
//   open-file-tree / file-tree / tree-toggle-all / tree-entry-<name>（目录树）
//   file-preview-panel / preview-path / preview-kind / preview-view-render /
//   preview-view-source / preview-close / preview-error / preview-error-code /
//   preview-open-external / preview-retry / preview-toast
// 聊天内可点击路径：agent 消息内 [data-file-path="<path>"]。
// seed 依赖 FAUX 回声（src/agent/worker.js fauxEchoFor 原样回传 user 文本，markdown 保留）。

const { test, expect } = require("@playwright/test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { startElectronApp, stopElectronApp } = require("../../../../../e2e/fixtures/electronApp.cjs");

const BTN_FILES = "[data-testid='open-file-tree']";
const TREE = "[data-testid='file-tree']";
const PANEL = "[data-testid='file-preview-panel']";
const PV_PATH = "[data-testid='preview-path']";
const PV_RENDER = "[data-testid='preview-view-render']";
const PV_SOURCE = "[data-testid='preview-view-source']";
const PV_CLOSE = "[data-testid='preview-close']";
const PV_ERROR = "[data-testid='preview-error']";
const PV_ERROR_CODE = "[data-testid='preview-error-code']";
const PV_OPEN_EXTERNAL = "[data-testid='preview-open-external']";
const PV_TOAST = "[data-testid='preview-toast']";
const BROWSER_PANEL = "[data-testid='browser-panel']";
const BTN_BROWSER = "[data-testid='open-browser']";

let electronApp, page, apiBaseUrl, userDataDir, rootDir, projectId, spaceKey;

async function apiPost(urlPath, payload) {
  const res = await fetch(`${apiBaseUrl}${urlPath}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload ?? {}),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

test.beforeEach(async () => {
  // —— 真实 fs fixture 项目（§10.4 接口1 golden 对齐 + 本套信用例文件）——
  rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "fp-e2e-"));
  fs.mkdirSync(path.join(rootDir, ".git"), { recursive: true });
  fs.mkdirSync(path.join(rootDir, "node_modules"), { recursive: true });
  fs.mkdirSync(path.join(rootDir, "src"), { recursive: true });
  fs.writeFileSync(path.join(rootDir, "src", "auth.js"), "const x = 1;");
  fs.mkdirSync(path.join(rootDir, "docs"), { recursive: true });
  fs.writeFileSync(path.join(rootDir, "docs", "guide.md"), "# Title\n\n正文 v1。");
  fs.writeFileSync(path.join(rootDir, "docs", "logo.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  fs.writeFileSync(path.join(rootDir, "docs", "big.md"), "a".repeat(1024 * 1024 + 1));
  fs.writeFileSync(path.join(rootDir, "README.md"), "# readme");

  const ctx = await startElectronApp({ extraEnv: { OPC_AGENT_FAUX: "1" } });
  electronApp = ctx.electronApp;
  page = ctx.firstWindow;
  apiBaseUrl = ctx.apiBaseUrl;
  userDataDir = ctx.userDataDir;

  await fetch(`${apiBaseUrl}/api/settings/agent`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider: "deepseek", apiKey: "sk-e2e-faux-placeholder", identity: "" }),
  });
  const proj = await apiPost("/api/projects", { name: "fp-e2e-fixture", localPath: rootDir });
  projectId = proj.body.id ?? proj.body.project?.id;
  const sess = await apiPost("/api/agent/sessions", { spaceKind: "project", projectId });
  spaceKey = sess.body.spaceKey;
  await page.reload();
  await expect(page.locator("[data-testid='screen-assistant']")).toBeVisible();
  await page.click(`[data-session-item='${spaceKey}']`);
});

test.afterEach(async () => {
  if (electronApp) await stopElectronApp(electronApp, userDataDir);
  fs.rmSync(rootDir, { recursive: true, force: true });
});

// 发送消息并等 FAUX 回声出现在 agent 消息区
async function seedChatWithText(text) {
  await page.fill("[data-testid='composer-input']", text);
  await page.click("[data-testid='send-button']");
}

test.describe("文件预览面板 E2E", () => {
  test("流A：聊天行内 code 路径点击 → 面板打开并渲染 Markdown（REQ-006 AC1 + REQ-002 AC1 + REQ-001 AC1）", async () => {
    // EXPECTED-TRACE: prd.md §6.1 流A 步骤1-2（路径可点击 → 面板滑出、头部显示路径、渲染视图）
    await seedChatWithText("文档在 `docs/guide.md` 里");
    const link = page.locator("[data-message-role='agent'] [data-file-path='docs/guide.md']");
    await expect(link).toBeVisible({ timeout: 120000 });
    await link.click();
    await expect(page.locator(PANEL)).toBeVisible();
    await expect(page.locator(PV_PATH)).toHaveText(/docs\/guide\.md/);
    // EXPECTED-TRACE: prd.md §6.3 块1 row1（渲染视图含 <h1>Title</h1>，非字面量 # Title）
    await expect(page.locator(`${PANEL} h1`, { hasText: "Title" })).toBeVisible();
  });

  test("REQ-006 AC3：代码围栏内的路径形态文本不转为可点击链接", async () => {
    // EXPECTED-TRACE: prd.md §6.2 围栏行（ADR-042 决策4：仅行内 code 参与识别）
    await seedChatWithText("行内 `docs/guide.md` 可点\n\n```\ndocs/guide.md\n```");
    const agentMsg = page.locator("[data-message-role='agent']").last();
    await expect(agentMsg.locator("[data-file-path='docs/guide.md']")).toHaveCount(1, { timeout: 120000 });
    await expect(agentMsg.locator("pre [data-file-path]")).toHaveCount(0);
  });

  test("REQ-006 AC4 边界：点击 `../outside.txt` → E1 错误页（不读磁盘）", async () => {
    // EXPECTED-TRACE: prd.md §6.3 块2 row2 / §8 E1（面板显示「仅支持预览项目内文件」）
    await seedChatWithText("试试 `../outside.txt`");
    const link = page.locator("[data-message-role='agent'] [data-file-path='../outside.txt']");
    await expect(link).toBeVisible({ timeout: 120000 });
    await link.click();
    await expect(page.locator(PV_ERROR)).toBeVisible();
    await expect(page.locator(PV_ERROR)).toContainText("仅支持预览项目内文件");
    await expect(page.locator(PV_ERROR_CODE)).toHaveText(/E-PREVIEW-OUTSIDE-ROOT/);
  });

  test("REQ-002 AC2：渲染/源码分段切换——源码视图显示字面量 # Title", async () => {
    // EXPECTED-TRACE: prd.md §6.3 块1 row1（切源码视图显示字面量 `# Title`）
    await page.locator(BTN_FILES).click();
    await page.locator("[data-testid='tree-entry-docs']").click();
    await page.locator("[data-testid='tree-entry-docs/guide.md']").click();
    await expect(page.locator(`${PANEL} h1`, { hasText: "Title" })).toBeVisible();
    await page.locator(PV_SOURCE).click();
    await expect(page.locator(PANEL)).toContainText("# Title");
    await page.locator(PV_RENDER).click();
    await expect(page.locator(`${PANEL} h1`, { hasText: "Title" })).toBeVisible();
  });

  test("REQ-003 AC1：代码文件 → hljs 高亮 token 存在（const 被包裹）", async () => {
    // EXPECTED-TRACE: prd.md §6.3 块1 row2（高亮视图中 const 被高亮 token 包裹）
    await page.locator(BTN_FILES).click();
    await page.locator("[data-testid='tree-entry-src']").click();
    await page.locator("[data-testid='tree-entry-src/auth.js']").click();
    await expect(page.locator(PANEL)).toBeVisible();
    await expect(page.locator(`${PANEL} .hljs-keyword`, { hasText: "const" })).toBeVisible();
    // 不进入 Markdown 渲染：不产生 h1 等排版元素
    await expect(page.locator(`${PANEL} h1`)).toHaveCount(0);
  });

  test("REQ-004 AC1：图片文件 → 面板 img 直渲（既有 image 端点 blob）", async () => {
    // EXPECTED-TRACE: prd.md §10.4 接口4（面板经 image 端点取 blob URL 直渲）
    await page.locator(BTN_FILES).click();
    await page.locator("[data-testid='tree-entry-docs']").click();
    await page.locator("[data-testid='tree-entry-docs/logo.png']").click();
    const img = page.locator(`${PANEL} img`);
    await expect(img).toBeVisible();
    await expect(img).toHaveAttribute("src", /^blob:/);
  });

  test("REQ-005：E2 不存在 / E3 过大（含系统打开逃生按钮）", async () => {
    // EXPECTED-TRACE: prd.md §8 E2 行（「文件不存在」）
    await seedChatWithText("看 `docs/ghost.md`");
    const link = page.locator("[data-message-role='agent'] [data-file-path='docs/ghost.md']");
    await expect(link).toBeVisible({ timeout: 120000 });
    await link.click();
    await expect(page.locator(PV_ERROR)).toContainText("文件不存在");
    await expect(page.locator(PV_ERROR_CODE)).toHaveText(/E-PREVIEW-NOT-FOUND/);

    // EXPECTED-TRACE: prd.md §8 E3 行（「文件过大」+「在系统默认应用打开」按钮）
    await page.locator(BTN_FILES).click();
    await page.locator("[data-testid='tree-entry-docs']").click();
    await page.locator("[data-testid='tree-entry-docs/big.md']").click();
    await expect(page.locator(PV_ERROR)).toContainText("文件过大");
    await expect(page.locator(PV_ERROR_CODE)).toHaveText(/E-PREVIEW-TOO-LARGE/);
    await expect(page.locator(PV_OPEN_EXTERNAL)).toBeVisible();
  });

  test("REQ-001 AC2：槽位互斥——预览开 → 浏览器收起；浏览器开 → 预览收起", async () => {
    // EXPECTED-TRACE: ADR-042 决策2（右侧槽位互斥，同一时刻至多一个面板）
    await page.locator(BTN_FILES).click();
    await page.locator("[data-testid='tree-entry-src']").click();
    await page.locator("[data-testid='tree-entry-src/auth.js']").click();
    await expect(page.locator(PANEL)).toBeVisible();

    await page.locator(BTN_BROWSER).click();
    await expect(page.locator(BROWSER_PANEL)).toBeVisible();
    await expect(page.locator(PANEL)).toBeHidden();

    await page.locator("[data-testid='tree-entry-src/auth.js']").click();
    await expect(page.locator(PANEL)).toBeVisible();
    await expect(page.locator(BROWSER_PANEL)).toBeHidden();
  });

  test("REQ-001 AC3：✕ 收起面板", async () => {
    // EXPECTED-TRACE: prd.md §6.1 流A 步骤4（面板不可见）
    await page.locator(BTN_FILES).click();
    await page.locator("[data-testid='tree-entry-docs']").click();
    await page.locator("[data-testid='tree-entry-docs/guide.md']").click();
    await expect(page.locator(PANEL)).toBeVisible();
    await page.locator(PV_CLOSE).click();
    await expect(page.locator(PANEL)).toBeHidden();
  });

  test("流C：外部修改 → 自动刷新 + toast；外部删除 → E2 页（REQ-009 AC1/AC2）", async () => {
    // EXPECTED-TRACE: prd.md §6.3 块4（v1→v2：v2 出现、v1 消失）+ §10.4 接口5（toast 提示）
    await page.locator(BTN_FILES).click();
    await page.locator("[data-testid='tree-entry-docs']").click();
    await page.locator("[data-testid='tree-entry-docs/guide.md']").click();
    await expect(page.locator(PANEL)).toContainText("正文 v1");

    fs.writeFileSync(path.join(rootDir, "docs", "guide.md"), "# Title\n\n正文 v2。");
    await expect(page.locator(PANEL)).toContainText("正文 v2", { timeout: 10000 });
    await expect(page.locator(PANEL)).not.toContainText("正文 v1");
    await expect(page.locator(PV_TOAST)).toContainText("文件已被外部修改，已自动刷新");

    // EXPECTED-TRACE: prd.md §6.2（预览中的文件被外部删除 → 「文件不存在」态）
    fs.rmSync(path.join(rootDir, "docs", "guide.md"));
    await expect(page.locator(PV_ERROR)).toContainText("文件不存在", { timeout: 10000 });
  });
});
