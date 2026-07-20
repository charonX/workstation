// REQ-TRACE: 2026-07-19-media-production-line/REQ-NOTIFY-002
// REQ-VERSION: v1-hash:de43bc8607a89efe5512712a188a5f24f259d8109cb31a7a476827dd0883fab9
// CAPABILITY-TRACE: information-aggregation
// ENTITY-TRACE: notification
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true

/**
 * 通知中心 UI（E2E，UX 原型映射 ux/notifications.html）。
 * 提取的可验证项：
 *  - 侧边栏底部「通知」入口 + 未读徽标（nav-badge，0 时隐藏）。
 *  - 列表页：按时间倒序；过滤 tab（全部/产物产出/执行失败/通道状态，各带计数）；
 *    未读条目带「未读」pill 与「标为已读」按钮；空态「该分类下暂无通知」。
 *  - 「全部标为已读」按钮（无未读时 disabled）。
 *  - 「产物产出」类通知可点击 → 跳转执行详情；其余类型仅展示（不可点击跳转）。
 * 不断言像素/颜色（类型配色仅做结构级 type 标识断言）。
 *
 * 播种（签核决策）：不开放 POST 写入面，经 tests/e2e/helpers/notifications.cjs
 * 在主进程内以 better-sqlite3 直写 notifications 表。
 * 通知 API 面（签核）：GET /api/notifications → { items, unreadCount }。
 */

const { test, expect } = require("@playwright/test");
const { startElectronApp, stopElectronApp } = require("../../../../../e2e/fixtures/electronApp.cjs");
const { seedNotifications } = require("../../../../../e2e/helpers/notifications.cjs");

async function getUnreadCount(apiBaseUrl) {
  const res = await fetch(`${apiBaseUrl}/api/notifications`);
  const data = await res.json();
  return data.unreadCount;
}

async function openNotificationsPage(firstWindow) {
  // 签核侧边栏入口文案「通知」（UX 原型 sidebar-bottom nav-link）。
  await firstWindow.getByRole("link", { name: "通知" }).click();
  await expect(firstWindow.getByRole("heading", { name: "通知" })).toBeVisible();
}

test.describe("REQ-NOTIFY-002 通知中心 UI（E2E，UX 原型映射）", () => {
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

  test("侧边栏入口显示未读徽标，计数与 API 一致", async () => {
    await seedNotifications(electronApp, userDataDir, [
      { id: "ntf-e2e-1", type: "artifact", title: "日报已生成 A", body: "outputs/daily/a.md", createdAt: "2026-07-19T10:00:00.000Z" },
      { id: "ntf-e2e-2", type: "execution-failed", title: "执行失败 B", body: "E-AGENT-FAILED", createdAt: "2026-07-19T10:01:00.000Z" },
      { id: "ntf-e2e-3", type: "channel-status", title: "飞书通道掉线", body: "E-CHANNEL-DOWN", createdAt: "2026-07-19T10:02:00.000Z" },
    ]);

    const expected = await getUnreadCount(apiBaseUrl);
    // UX: sidebar-bottom 通知入口的 nav-badge。
    const badge = firstWindow.locator("[data-testid='nav-notifications-badge'], .nav-badge").first();
    await expect(badge).toBeVisible();
    await expect(badge).toHaveText(String(expected));
  });

  test("列表按时间倒序，过滤 tab 结构正确（全部/产物产出/执行失败/通道状态）", async () => {
    await seedNotifications(electronApp, userDataDir, [
      { id: "ntf-e2e-4", type: "artifact", title: "第一条产物", body: "b1", createdAt: "2026-07-19T10:00:00.000Z" },
      { id: "ntf-e2e-5", type: "execution-failed", title: "第二条失败", body: "b2", createdAt: "2026-07-19T10:01:00.000Z" },
    ]);

    await openNotificationsPage(firstWindow);

    // 签核 tab 文案（UX FILTERS）：全部 / 产物产出 / 执行失败 / 通道状态。
    for (const tab of ["全部", "产物产出", "执行失败", "通道状态"]) {
      await expect(firstWindow.getByRole("tab", { name: new RegExp(tab) })).toBeVisible();
    }

    // 倒序：最新（第二条失败）在前。
    const titles = firstWindow.locator(".ntf-title, [data-testid='notification-title']");
    await expect(titles.first()).toHaveText("第二条失败");

    // 过滤：执行失败 → 只剩 1 条。
    await firstWindow.getByRole("tab", { name: /执行失败/ }).click();
    await expect(firstWindow.getByText("第二条失败")).toBeVisible();
    await expect(firstWindow.getByText("第一条产物")).toHaveCount(0);

    // 空态：切到无数据的分类。
    await firstWindow.getByRole("tab", { name: /通道状态/ }).click();
    // 签核空态文案「该分类下暂无通知」（UX list-empty）。
    await expect(firstWindow.getByText(/该分类下暂无通知/)).toBeVisible();
  });

  test("单条与全部已读后徽标清零", async () => {
    await seedNotifications(electronApp, userDataDir, [
      { id: "ntf-e2e-6", type: "artifact", title: "未读一", body: "b", createdAt: "2026-07-19T10:00:00.000Z" },
      { id: "ntf-e2e-7", type: "artifact", title: "未读二", body: "b", createdAt: "2026-07-19T10:01:00.000Z" },
    ]);

    await openNotificationsPage(firstWindow);

    // 单条已读（UX: 未读条目带「标为已读」按钮；文案签核）。
    const firstUnread = firstWindow.locator(".ntf-item.unread, [data-testid='notification-item'][data-read='false']").first();
    await firstUnread.getByRole("button", { name: "标为已读" }).click();
    let badge = firstWindow.locator("[data-testid='nav-notifications-badge'], .nav-badge").first();
    await expect(badge).toHaveText("1");

    // 全部已读 → 徽标隐藏（UX: count=0 时 nav-badge 加 hidden；按钮文案「全部标为已读」签核）。
    await firstWindow.getByRole("button", { name: "全部标为已读" }).click();
    await expect(badge).toBeHidden();
    await expect(firstWindow.getByRole("button", { name: "全部标为已读" })).toBeDisabled();

    // 与 API 一致。
    expect(await getUnreadCount(apiBaseUrl)).toBe(0);
  });

  test("「产物产出」通知点击跳转执行详情；其余类型仅展示", async () => {
    await seedNotifications(electronApp, userDataDir, [
      { id: "ntf-e2e-8", type: "artifact", title: "日报已生成", body: "outputs/daily/x.md", executionId: "exec-jump-1", createdAt: "2026-07-19T10:00:00.000Z" },
      { id: "ntf-e2e-9", type: "execution-failed", title: "速存失败", body: "E-FETCH-FAILED", executionId: "exec-stay-1", createdAt: "2026-07-19T10:01:00.000Z" },
    ]);

    await openNotificationsPage(firstWindow);

    // UX: artifact 条目 clickable（role=button + 「查看执行与产物 →」），点击跳转执行详情。
    const artifactItem = firstWindow.locator(".ntf-item.clickable, [data-testid='notification-item'][data-clickable='true']").first();
    await artifactItem.click();
    await expect(firstWindow).toHaveURL(/executions?/);

    // 其余类型仅展示：无 clickable 标识，点击不跳转。
    await openNotificationsPage(firstWindow);
    const failedItem = firstWindow.getByText("速存失败").locator("..").locator("..");
    const isClickable = await failedItem.evaluate((el) =>
      el.classList.contains("clickable") || el.getAttribute("data-clickable") === "true" || el.getAttribute("role") === "button"
    );
    expect(isClickable).toBe(false);
  });
});
