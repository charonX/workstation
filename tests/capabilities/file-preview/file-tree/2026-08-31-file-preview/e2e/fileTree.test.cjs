// REQ-TRACE: 2026-08-31-file-preview/REQ-PREVIEW-007
// REQ-VERSION: v1-hash:d06296e2ed011b1fc699777634a8b2f4eaa7c17954962e28f76383a725ccefb9
// CAPABILITY-TRACE: file-preview
// ENTITY-TRACE: file-tree
// EXPECTED-TRACE: prd.md §6.1 流B 全步骤, §6.2 非项目空间行, §6.3 块3 rows 1-2, ux/file-preview.html
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: false
//
// 覆盖真实窗口下的文件树行为：入口显隐（E5 前置规避）、顶层条目与噪音过滤、
// 懒加载展开、全部展开/收起、点击文件分发到文件预览面板、边栏收起。
// store 层契约（懒加载请求时机/展开态机）见 component/fileTreeStore.test.js；
// list 服务端契约见 file-preview-panel/.../api/filesApi.test.js。
//
// data-testid 契约：open-file-tree / file-tree / tree-toggle-all /
// tree-entry-<相对路径>（目录与文件条目同构）。

const { test, expect } = require("@playwright/test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { startElectronApp, stopElectronApp } = require("../../../../../e2e/fixtures/electronApp.cjs");

const BTN_FILES = "[data-testid='open-file-tree']";
const TREE = "[data-testid='file-tree']";
const TREE_TOGGLE_ALL = "[data-testid='tree-toggle-all']";
const PANEL = "[data-testid='file-preview-panel']";

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
  // fixture 根（§6.3 块3 row1 锚点超集：.git/node_modules + docs/src + README.md）
  rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "fp-tree-e2e-"));
  fs.mkdirSync(path.join(rootDir, ".git"), { recursive: true });
  fs.mkdirSync(path.join(rootDir, "node_modules"), { recursive: true });
  fs.mkdirSync(path.join(rootDir, "src"), { recursive: true });
  fs.writeFileSync(path.join(rootDir, "src", "auth.js"), "const x = 1;");
  fs.mkdirSync(path.join(rootDir, "docs"), { recursive: true });
  fs.writeFileSync(path.join(rootDir, "docs", "guide.md"), "# Title");
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
  const proj = await apiPost("/api/projects", { name: "fp-tree-fixture", localPath: rootDir });
  projectId = proj.body.id ?? proj.body.project?.id;
  const sess = await apiPost("/api/agent/sessions", { spaceKind: "project", projectId });
  spaceKey = sess.body.spaceKey;
  await page.reload();
  await expect(page.locator("[data-testid='screen-assistant']")).toBeVisible();
});

test.afterEach(async () => {
  if (electronApp) await stopElectronApp(electronApp, userDataDir);
  fs.rmSync(rootDir, { recursive: true, force: true });
});

test.describe("文件树边栏 E2E", () => {
  test("流B 步骤1-2：入口展开 → 顶层条目 dirs-first、噪音目录不出现；点目录就地展开", async () => {
    // EXPECTED-TRACE: prd.md §6.3 块3 row1（只出现 src/、README.md 形态：目录在前、噪音隐藏）
    await page.click(`[data-session-item='${spaceKey}']`);
    await page.locator(BTN_FILES).click();
    await expect(page.locator(TREE)).toBeVisible();
    await expect(page.locator("[data-testid='tree-entry-docs']")).toBeVisible();
    await expect(page.locator("[data-testid='tree-entry-src']")).toBeVisible();
    await expect(page.locator("[data-testid='tree-entry-README.md']")).toBeVisible();
    await expect(page.locator("[data-testid='tree-entry-.git']")).toHaveCount(0);
    await expect(page.locator("[data-testid='tree-entry-node_modules']")).toHaveCount(0);
    // 目录在文件前：第一个条目是目录
    await expect(page.locator(`${TREE} [data-testid^='tree-entry-']`).first()).toHaveAttribute("data-testid", "tree-entry-docs");

    // EXPECTED-TRACE: prd.md §6.1 流B 步骤2（点目录就地展开，子条目出现）
    await page.locator("[data-testid='tree-entry-src']").click();
    await expect(page.locator("[data-testid='tree-entry-src/auth.js']")).toBeVisible();
  });

  test("流B 步骤4：全部收起 → 仅顶层可见、文案变「展开全部」；再点全部展开", async () => {
    // EXPECTED-TRACE: prd.md §6.3 块3 row2（两目录均收起，仅顶层可见；按钮文案翻转）
    await page.click(`[data-session-item='${spaceKey}']`);
    await page.locator(BTN_FILES).click();
    await page.locator("[data-testid='tree-entry-docs']").click();
    await page.locator("[data-testid='tree-entry-src']").click();
    await expect(page.locator("[data-testid='tree-entry-docs/guide.md']")).toBeVisible();
    await expect(page.locator("[data-testid='tree-entry-src/auth.js']")).toBeVisible();

    await page.locator(TREE_TOGGLE_ALL).click();
    await expect(page.locator("[data-testid='tree-entry-docs/guide.md']")).toHaveCount(0);
    await expect(page.locator("[data-testid='tree-entry-src/auth.js']")).toHaveCount(0);
    await expect(page.locator(TREE_TOGGLE_ALL)).toContainText("展开全部");

    await page.locator(TREE_TOGGLE_ALL).click();
    await expect(page.locator("[data-testid='tree-entry-docs/guide.md']")).toBeVisible();
    await expect(page.locator("[data-testid='tree-entry-src/auth.js']")).toBeVisible();
    await expect(page.locator(TREE_TOGGLE_ALL)).toContainText("收起全部");
  });

  test("流B 步骤3/5：点文件 → 预览面板打开且条目选中高亮；再点入口 → 边栏收起", async () => {
    // EXPECTED-TRACE: prd.md §6.1 流B 步骤3（面板打开显示高亮源码）+ REQ-007 AC4（选中高亮）
    await page.click(`[data-session-item='${spaceKey}']`);
    await page.locator(BTN_FILES).click();
    await page.locator("[data-testid='tree-entry-src']").click();
    await page.locator("[data-testid='tree-entry-src/auth.js']").click();
    await expect(page.locator(PANEL)).toBeVisible();
    await expect(page.locator("[data-testid='tree-entry-src/auth.js'][aria-current='true'], [data-testid='tree-entry-src/auth.js'][data-selected='true']")).toHaveCount(1);

    // EXPECTED-TRACE: prd.md §6.1 流B 步骤5（再次点击入口 → 边栏收起）
    await page.locator(BTN_FILES).click();
    await expect(page.locator(TREE)).toBeHidden();
  });

  test("REQ-007 AC5：非项目空间会话不显示「文件」入口（E5 前置规避）", async () => {
    // EXPECTED-TRACE: prd.md §6.2 非项目空间行（不显示文件树入口）
    const sess = await apiPost("/api/agent/sessions", { spaceKind: "general" });
    const generalKey = sess.body.spaceKey;
    await page.reload();
    await expect(page.locator("[data-testid='screen-assistant']")).toBeVisible();
    await page.click(`[data-session-item='${generalKey}']`);
    await expect(page.locator(BTN_FILES)).toHaveCount(0);
  });
});
