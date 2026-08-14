// REQ-TRACE: 2026-08-12-pi-mcp-plugin/REQ-AGENT-087
// REQ-VERSION: v1-hash:6c7fd998525a697ef21587c808800edfb15182b428d588f83c9ae835acf09243
// CAPABILITY-TRACE: plugin-management
// ENTITY-TRACE: mcp-server
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true (2026-08-13 assertion signoff)

// 权限配置页 mcp 规则族分组（REQ-087 UI 部分）。
//
// UX 参照：ux/permission-mcp-group.html（已定稿 2026-08-13）。结构契约锚点：
//   [data-testid='perm-family-mcp']      mcp 族分组（与 bash/read 族同构）
//   [data-testid='perm-rule-row']        规则行（pattern = server:tool glob）
//   [data-testid='perm-rule-verdict']    allow/ask/deny 三态切换（button[data-v]）
//   [data-testid='perm-rule-add'] / [data-testid='perm-rule-input'] / [data-testid='perm-rule-add-submit']
//   项目覆盖高亮（.override-tag「项目已改」）
//
// 已签（门 1，2026-08-13）：权限配置入口沿用既有 story 路由 #/workspace
//   （项目页权限区，对齐 2026-08-10-pi-permission-config-ui）；
//   出厂零预置规则（D4）——分组可见但无规则行，仅有「+ 添加规则」。
//
// 环境：startElectronApp + hash 路由直访。断言语义：元素存在/状态持久，不验像素。

const { test, expect } = require("@playwright/test");
const { startElectronApp, stopElectronApp } = require("../../../../../e2e/fixtures/electronApp.cjs");
const { goToAdminRoute } = require("../../../../../e2e/helpers/navigation.cjs");

const FAMILY = "[data-testid='perm-family-mcp']";
const PERMISSION_ROUTE = "#/workspace";

test.describe("REQ-AGENT-087 权限配置页 mcp 分组（E2E）", () => {
  let electronApp;
  let firstWindow;

  test.beforeEach(async () => {
    ({ electronApp, firstWindow } = await startElectronApp());
    // 前置（实现接线）：seed 一个项目并进入其权限配置区（对齐既有权限 story 种子惯例）
    await goToAdminRoute(firstWindow, PERMISSION_ROUTE);
  });

  test.afterEach(async () => {
    await stopElectronApp(electronApp);
  });

  test("标准 2a：权限配置页出现 mcp 分组（出厂零规则，D4）", async () => {
    await expect(firstWindow.locator(FAMILY)).toBeVisible();
    await expect(firstWindow.locator(`${FAMILY} [data-testid='perm-rule-row']`)).toHaveCount(0);
    await expect(firstWindow.locator(`${FAMILY} [data-testid='perm-rule-add']`)).toBeVisible();
  });

  test("标准 2b：规则行 allow/ask/deny 切换且持久（刷新后保持）", async () => {
    // 先加一条规则
    await firstWindow.locator(`${FAMILY} [data-testid='perm-rule-add']`).click();
    await firstWindow.locator("[data-testid='perm-rule-input']").fill("local-db:*");
    await firstWindow.locator("[data-testid='perm-rule-add-submit']").click();
    const row = firstWindow.locator(`${FAMILY} [data-testid='perm-rule-row']`, { hasText: "local-db:*" });
    await row.locator("[data-v='deny']").click();
    await expect(row.locator("[data-v='deny']")).toHaveClass(/active/);
    // 刷新重进，裁决持久
    await goToAdminRoute(firstWindow, PERMISSION_ROUTE);
    await expect(
      firstWindow.locator(`${FAMILY} [data-testid='perm-rule-row']`, { hasText: "local-db:*" }).locator("[data-v='deny']")
    ).toHaveClass(/active/);
  });

  test("标准 2c：新增规则（server:tool glob）出现在列表", async () => {
    await firstWindow.locator(`${FAMILY} [data-testid='perm-rule-add']`).click();
    await firstWindow.locator("[data-testid='perm-rule-input']").fill("local-db:query_*");
    await firstWindow.locator("[data-testid='perm-rule-add-submit']").click();
    await expect(
      firstWindow.locator(`${FAMILY} [data-testid='perm-rule-row']`, { hasText: "local-db:query_*" })
    ).toBeVisible();
  });
});
