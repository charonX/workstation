// REQ-TRACE: 2026-07-19-media-production-line/REQ-SRC-003
// REQ-VERSION: v1-hash:de43bc8607a89efe5512712a188a5f24f259d8109cb31a7a476827dd0883fab9
// CAPABILITY-TRACE: collection-pipeline
// ENTITY-TRACE: content-source
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true

/**
 * 内容源管理 UI（E2E，UX 原型映射 ux/sources.html）。
 * 提取的可验证项：
 *  - 侧边栏 "Sources" 导航入口；页面标题与 "New Source" 按钮。
 *  - 列表结构：表头 Name/Type/Config/Tags/Status/Actions；行内含类型徽标、tag chips、
 *    启停 switch（role="switch"）、编辑/删除操作；空态 "No content sources yet"。
 *  - 新建/编辑模态框（role="dialog"）：4 个类型选项（Webpage/RSS/X/WeChat）、
 *    tag 编辑器（回车/添加按钮增 tag、去重报错 "Tag already exists"、>16 字符报错
 *    "Each tag must not exceed 16 characters"、× 删除）、类型联动 config 字段（label/placeholder 切换）。
 *  - 校验错误态与 API 错误一致；删除为普通确认（无引用警告）。
 *  - 操作后列表实时刷新；UI 与 API 数据一致。
 * 不断言像素/颜色/尺寸。文案均按签核（UX 原型文案）。
 */

const { test, expect } = require("@playwright/test");
const { startElectronApp, stopElectronApp } = require("../../../../../e2e/fixtures/electronApp.cjs");

async function createSourceViaApi(apiBaseUrl, body) {
  const res = await fetch(`${apiBaseUrl}/api/content-sources`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`createSource failed: ${res.status}`);
  return res.json();
}

async function openSourcesPage(firstWindow) {
  // 签核导航入口文案 "Sources"（UX 原型 sidebar nav-link）。
  await firstWindow.getByRole("link", { name: "Sources" }).click();
  await expect(firstWindow.getByRole("heading", { name: "Sources" })).toBeVisible();
}

test.describe("REQ-SRC-003 内容源管理 UI（E2E，UX 原型映射）", () => {
  let electronApp;
  let firstWindow;
  let apiBaseUrl;
  let userDataDir;

  test.beforeEach(async () => {
    const ctx = await startElectronApp();
    electronApp = ctx.electronApp;
    firstWindow = ctx.firstWindow;
    apiBaseUrl = ctx.apiBaseUrl;
    userDataDir = ctx.userDataDir;
  });

  test.afterEach(async () => {
    await stopElectronApp(electronApp, userDataDir);
  });

  test("Sources 页展示列表结构与空态", async () => {
    await openSourcesPage(firstWindow);

    await expect(firstWindow.getByRole("button", { name: "New Source" })).toBeVisible();
    // UX: source-head 列：Name/Type/Config/Tags/Status/Actions。
    for (const col of ["Name", "Type", "Config", "Tags", "Status", "Actions"]) {
      await expect(firstWindow.getByText(col, { exact: true }).first()).toBeVisible();
    }
    // 签核空态文案 "No content sources yet"（UX 原型 table-empty）。
    await expect(firstWindow.getByText(/No content sources yet/)).toBeVisible();
  });

  test("列表行展示名称/类型徽标/配置摘要/tags/启停状态（API 播种）", async () => {
    await createSourceViaApi(apiBaseUrl, {
      name: "Hacker News",
      type: "webpage",
      tags: ["科技", "新闻"],
      config: "https://news.ycombinator.com",
    });

    await openSourcesPage(firstWindow);
    const row = firstWindow.getByText("Hacker News").locator("..").locator("..");
    await expect(row).toBeVisible();
    // UX: 类型徽标 label（webpage → Webpage）。
    await expect(firstWindow.getByText("Webpage").first()).toBeVisible();
    await expect(firstWindow.getByText("https://news.ycombinator.com")).toBeVisible();
    for (const tag of ["科技", "新闻"]) {
      await expect(firstWindow.getByText(tag, { exact: true }).first()).toBeVisible();
    }
    // UX: 启停 switch + 状态文案。
    await expect(firstWindow.getByRole("switch").first()).toHaveAttribute("aria-checked", "true");
    await expect(firstWindow.getByText(/Enabled/).first()).toBeVisible();
  });

  test("新建表单：tag 编辑器增删、去重与长度校验", async () => {
    await openSourcesPage(firstWindow);
    await firstWindow.getByRole("button", { name: "New Source" }).click();
    const dialog = firstWindow.getByRole("dialog");
    await expect(dialog).toBeVisible();

    // UX: 回车添加 tag chip。
    await dialog.getByPlaceholder(/Enter tag/).fill("AI");
    await dialog.getByPlaceholder(/Enter tag/).press("Enter");
    await expect(dialog.getByText("AI", { exact: true })).toBeVisible();

    // 去重：重复添加报 "Tag already exists"（签核文案）。
    await dialog.getByPlaceholder(/Enter tag/).fill("AI");
    await dialog.getByRole("button", { name: "Add" }).click();
    await expect(dialog.getByText("Tag already exists")).toBeVisible();

    // 长度：>16 字符报 "Each tag must not exceed 16 characters"（签核文案）。
    await dialog.getByPlaceholder(/Enter tag/).fill("t".repeat(17));
    await dialog.getByRole("button", { name: "Add" }).click();
    await expect(dialog.getByText("Each tag must not exceed 16 characters")).toBeVisible();

    // × 删除 chip。
    await dialog.getByRole("button", { name: /Remove tag AI/ }).click();
    await expect(dialog.locator(".tag-chip", { hasText: "AI" })).toHaveCount(0);
  });

  test("新建表单：类型联动 config 字段，校验错误态与 API 一致", async () => {
    await openSourcesPage(firstWindow);
    await firstWindow.getByRole("button", { name: "New Source" }).click();
    const dialog = firstWindow.getByRole("dialog");

    // UX: 类型选项联动 config label/placeholder（x → X Account / @username；签核文案）。
    await dialog.getByRole("button", { name: /X Account/ }).click();
    await expect(dialog.locator("label[for='source-config']")).toHaveText("X Account");
    await expect(dialog.getByPlaceholder("@username")).toBeVisible();

    // 切回网页 → Page URL。
    await dialog.getByRole("button", { name: /Webpage/ }).click();
    await expect(dialog.getByText("Page URL")).toBeVisible();

    // 直接提交：名称必填 + 至少一个 tag + 合法 URL（与 API 校验同源；签核文案按 UX 原型）。
    await dialog.getByRole("button", { name: "Create" }).click();
    await expect(dialog.getByText("Name is required and must not exceed 64 characters")).toBeVisible();
    await expect(dialog.getByText("Please add at least one category tag")).toBeVisible();
    await expect(dialog.getByText("Please provide a valid URL")).toBeVisible();
  });

  test("新建 → 列表实时刷新，且 UI 与 API 数据一致", async () => {
    await openSourcesPage(firstWindow);
    await firstWindow.getByRole("button", { name: "New Source" }).click();
    const dialog = firstWindow.getByRole("dialog");

    await dialog.locator("input").first().fill("少数派");
    await dialog.getByRole("button", { name: /RSS/ }).click();
    await dialog.getByPlaceholder(/Enter tag/).fill("效率");
    await dialog.getByPlaceholder(/Enter tag/).press("Enter");
    await dialog.getByPlaceholder(/feed\.xml|example\.com/).fill("https://sspai.com/feed");
    await dialog.getByRole("button", { name: "Create" }).click();

    // 列表实时刷新。
    await expect(firstWindow.getByText("少数派")).toBeVisible();

    // UI 与 API 数据一致（E2E 创建 → API 查询可见）。
    const res = await fetch(`${apiBaseUrl}/api/content-sources`);
    const list = await res.json();
    const items = Array.isArray(list) ? list : list.items;
    const hit = items.find((s) => s.name === "少数派");
    expect(hit).toBeTruthy();
    expect(hit.type).toBe("rss");
    expect(hit.tags).toContain("效率");
  });

  test("启停切换与删除（普通确认，无引用警告）", async () => {
    const created = await createSourceViaApi(apiBaseUrl, {
      name: "阮一峰的网络日志",
      type: "rss",
      tags: ["技术"],
      config: "https://www.ruanyifeng.com/blog/atom.xml",
    });

    await openSourcesPage(firstWindow);
    const row = firstWindow.locator("[data-id], .source-row", { hasText: "阮一峰的网络日志" }).first();

    // 启停切换 → Disabled。
    await row.getByRole("switch").click();
    await expect(firstWindow.getByText(/Disabled/).first()).toBeVisible();

    // 删除 → 普通确认模态（UX: 无「被引用」警告；签核确认文案含 "Are you sure you want to delete content source"）。
    await row.getByRole("button", { name: "Delete" }).click();
    const confirmDialog = firstWindow.getByRole("dialog");
    await expect(confirmDialog.getByText(/Are you sure you want to delete content source/)).toBeVisible();
    await confirmDialog.getByRole("button", { name: "Delete" }).click();

    await expect(firstWindow.getByText("阮一峰的网络日志")).toHaveCount(0);
    const res = await fetch(`${apiBaseUrl}/api/content-sources/${created.id}`);
    expect(res.status).toBe(404);
  });
});
