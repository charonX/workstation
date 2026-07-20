// REQ-TRACE: 2026-07-19-media-production-line/REQ-SRC-003
// REQ-VERSION: v1-hash:de43bc8607a89efe5512712a188a5f24f259d8109cb31a7a476827dd0883fab9
// CAPABILITY-TRACE: collection-pipeline
// ENTITY-TRACE: content-source
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true

/**
 * 内容源管理 UI（E2E，UX 原型映射 ux/sources.html）。
 * 提取的可验证项：
 *  - 侧边栏「内容源」导航入口；页面标题与「新建内容源」按钮。
 *  - 列表结构：表头 名称/类型/配置/标签/状态/操作；行内含类型徽标、tag chips、
 *    启停 switch（role="switch"）、编辑/删除操作；空态「暂无内容源」。
 *  - 新建/编辑模态框（role="dialog"）：4 个类型选项（网页/RSS/X/公众号）、
 *    tag 编辑器（回车/添加按钮增 tag、去重报错「标签已存在」、>16 字符报错
 *    「每个标签不超过 16 字符」、× 删除）、类型联动 config 字段（label/placeholder 切换）。
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
  // 签核导航入口文案「内容源」（UX 原型 sidebar nav-link）。
  await firstWindow.getByRole("link", { name: "内容源" }).click();
  await expect(firstWindow.getByRole("heading", { name: "内容源" })).toBeVisible();
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

    await expect(firstWindow.getByRole("button", { name: "新建内容源" })).toBeVisible();
    // UX: source-head 列：名称/类型/配置/标签/状态/操作。
    for (const col of ["名称", "类型", "配置", "标签", "状态", "操作"]) {
      await expect(firstWindow.getByText(col, { exact: true }).first()).toBeVisible();
    }
    // 签核空态文案「暂无内容源」（UX 原型 table-empty）。
    await expect(firstWindow.getByText(/暂无内容源/)).toBeVisible();
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
    // UX: 类型徽标 label（webpage → 网页）。
    await expect(firstWindow.getByText("网页").first()).toBeVisible();
    await expect(firstWindow.getByText("https://news.ycombinator.com")).toBeVisible();
    for (const tag of ["科技", "新闻"]) {
      await expect(firstWindow.getByText(tag, { exact: true }).first()).toBeVisible();
    }
    // UX: 启停 switch + 状态文案。
    await expect(firstWindow.getByRole("switch").first()).toHaveAttribute("aria-checked", "true");
    await expect(firstWindow.getByText(/启用中/).first()).toBeVisible();
  });

  test("新建表单：tag 编辑器增删、去重与长度校验", async () => {
    await openSourcesPage(firstWindow);
    await firstWindow.getByRole("button", { name: "新建内容源" }).click();
    const dialog = firstWindow.getByRole("dialog");
    await expect(dialog).toBeVisible();

    // UX: 回车添加 tag chip。
    await dialog.getByPlaceholder(/输入标签/).fill("AI");
    await dialog.getByPlaceholder(/输入标签/).press("Enter");
    await expect(dialog.getByText("AI", { exact: true })).toBeVisible();

    // 去重：重复添加报「标签已存在」（签核文案）。
    await dialog.getByPlaceholder(/输入标签/).fill("AI");
    await dialog.getByRole("button", { name: "添加" }).click();
    await expect(dialog.getByText("标签已存在")).toBeVisible();

    // 长度：>16 字符报「每个标签不超过 16 字符」（签核文案）。
    await dialog.getByPlaceholder(/输入标签/).fill("t".repeat(17));
    await dialog.getByRole("button", { name: "添加" }).click();
    await expect(dialog.getByText("每个标签不超过 16 字符")).toBeVisible();

    // × 删除 chip。
    await dialog.getByRole("button", { name: /删除标签 AI/ }).click();
    await expect(dialog.locator(".tag-chip", { hasText: "AI" })).toHaveCount(0);
  });

  test("新建表单：类型联动 config 字段，校验错误态与 API 一致", async () => {
    await openSourcesPage(firstWindow);
    await firstWindow.getByRole("button", { name: "新建内容源" }).click();
    const dialog = firstWindow.getByRole("dialog");

    // UX: 类型选项联动 config label/placeholder（x → X 账号 / @username；签核文案）。
    await dialog.getByRole("button", { name: /X 账号/ }).click();
    await expect(dialog.getByText("X 账号")).toBeVisible();
    await expect(dialog.getByPlaceholder("@username")).toBeVisible();

    // 切回网页 → 页面 URL。
    await dialog.getByRole("button", { name: /网页/ }).click();
    await expect(dialog.getByText("页面 URL")).toBeVisible();

    // 直接提交：名称必填 + 至少一个 tag + 合法 URL（与 API 校验同源；签核文案按 UX 原型）。
    await dialog.getByRole("button", { name: "创建" }).click();
    await expect(dialog.getByText("名称必填且不超过 64 字符")).toBeVisible();
    await expect(dialog.getByText("请至少添加一个品类标签")).toBeVisible();
    await expect(dialog.getByText("请提供合法 URL")).toBeVisible();
  });

  test("新建 → 列表实时刷新，且 UI 与 API 数据一致", async () => {
    await openSourcesPage(firstWindow);
    await firstWindow.getByRole("button", { name: "新建内容源" }).click();
    const dialog = firstWindow.getByRole("dialog");

    await dialog.locator("input").first().fill("少数派");
    await dialog.getByRole("button", { name: /RSS/ }).click();
    await dialog.getByPlaceholder(/输入标签/).fill("效率");
    await dialog.getByPlaceholder(/输入标签/).press("Enter");
    await dialog.getByPlaceholder(/feed\.xml|example\.com/).fill("https://sspai.com/feed");
    await dialog.getByRole("button", { name: "创建" }).click();

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

    // 启停切换 → 已停用。
    await row.getByRole("switch").click();
    await expect(firstWindow.getByText(/已停用/).first()).toBeVisible();

    // 删除 → 普通确认模态（UX: 无「被引用」警告；签核确认文案含「确定删除内容源」）。
    await row.getByRole("button", { name: "删除" }).click();
    const confirmDialog = firstWindow.getByRole("dialog");
    await expect(confirmDialog.getByText(/确定删除内容源/)).toBeVisible();
    await confirmDialog.getByRole("button", { name: "删除" }).click();

    await expect(firstWindow.getByText("阮一峰的网络日志")).toHaveCount(0);
    const res = await fetch(`${apiBaseUrl}/api/content-sources/${created.id}`);
    expect(res.status).toBe(404);
  });
});
