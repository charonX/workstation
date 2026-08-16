// REQ-TRACE: 2026-08-12-pi-mcp-plugin/REQ-AGENT-087
// REQ-VERSION: v1-hash:7051b638e8a78c81a06fdaa5c64aaf5a48f422c35401c11113f11a033386cc06
// CAPABILITY-TRACE: plugin-management
// ENTITY-TRACE: mcp-server
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: false (2026-08-13 assertion signoff 覆盖 2a-2c 原形态；BUG-014 req-gap
//   补全：录入改选择器契约适配 + 新增 AC10c 默认层覆盖对照——见下)

// 权限配置页 mcp 规则族分组（REQ-087 UI 部分）。
//
// UX 参照：ux/permission-mcp-group.html（已定稿 2026-08-13；BUG-014 就地补全 2026-08-16）。
// 结构契约锚点：
//   [data-testid='perm-family-mcp']      mcp 族分组（与 bash/read 族同构）
//   [data-testid='perm-rule-row']        规则行（pattern = server:tool glob）
//   [data-testid='perm-rule-verdict']    allow/ask/deny 三态切换（button[data-v]）
//   [data-testid='perm-rule-add'] / [data-testid='perm-rule-add-submit']
//   项目覆盖高亮（.override-tag「项目已改」）
//
// 已签（门 1，2026-08-13）：权限配置入口沿用既有 story 路由 #/workspace
//   （项目页权限区，对齐 2026-08-10-pi-permission-config-ui）；
//   出厂零预置规则（D4）——分组可见但无规则行，仅有「+ 添加规则」。
//
// BUG-014（req-gap 就地补全，人确认 2026-08-16，人拍板「默认层存 workstation DB、下拉
// 选择为主」）：项目页 mcp 族语义 = 项目覆盖（默认层在「MCP」页编辑）：
//   - 添加区契约适配：手填 perm-rule-input 降为高级入口（默认隐藏，经
//     [data-testid='perm-rule-freeform-toggle'] 展开）；默认录入 = server 下拉
//     [data-testid='perm-rule-server-select'] → 探测拉工具下拉
//     [data-testid='perm-rule-tool-select']（含「* 全部工具」）。
//   - 新增 AC10c：默认层 pattern 出现在项目页规则行（global=默认层值，无覆盖标记）；
//     切换裁决即写项目覆盖（「项目已改」高亮）且刷新持久。
//   - 语义收紧：原 2b「无 seed 项目 → local-only → hash 重导航不卸载组件」使「刷新
//     持久」形同虚设；本文件统一 seed demo 项目走真实持久化路径（绑定首项目）。
//
// 环境：startElectronApp + hash 路由直访。断言语义：元素存在/状态持久，不验像素。

const { test, expect } = require("@playwright/test");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");
const { startElectronApp, stopElectronApp } = require("../../../../../e2e/fixtures/electronApp.cjs");
const { goToAdminRoute } = require("../../../../../e2e/helpers/navigation.cjs");

const FAMILY = "[data-testid='perm-family-mcp']";
const PERMISSION_ROUTE = "#/workspace";
const STDIO_FIXTURE_ABS = path.resolve(__dirname, "../../../../../fixtures/mcp-stdio-server/server.mjs");

async function seedViaApi(apiBaseUrl, fn) {
  const res = await fetch(`${apiBaseUrl}${fn.path}`, {
    method: fn.method ?? "POST",
    headers: { "Content-Type": "application/json" },
    body: fn.body ? JSON.stringify(fn.body) : undefined,
  });
  if (!res.ok) throw new Error(`seed ${fn.path} failed: ${res.status}`);
}

async function gotoBoundWorkspace(firstWindow) {
  await goToAdminRoute(firstWindow, PERMISSION_ROUTE);
  await expect(firstWindow.locator(".workspace-permission-desc")).toContainText("绑定项目：demo");
}

test.describe("REQ-AGENT-087 权限配置页 mcp 分组（E2E）", () => {
  let electronApp;
  let firstWindow;
  let apiBaseUrl;

  test.beforeEach(async () => {
    ({ electronApp, firstWindow, apiBaseUrl } = await startElectronApp());
    // BUG-014：统一真实持久化前提——stdio fixture server（picker 数据源）+ demo 项目
    await seedViaApi(apiBaseUrl, {
      path: "/api/mcp",
      body: { name: "e2e-perm-srv", type: "stdio", command: process.execPath, args: [STDIO_FIXTURE_ABS] },
    });
    const projDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-e2e-perm-"));
    await seedViaApi(apiBaseUrl, {
      path: "/api/projects",
      body: { name: "demo", sourceType: "local", localPath: projDir },
    });
    await gotoBoundWorkspace(firstWindow);
  });

  test.afterEach(async () => {
    await stopElectronApp(electronApp);
  });

  test("标准 2a：权限配置页出现 mcp 分组（出厂零规则，D4）", async () => {
    await expect(firstWindow.locator(FAMILY)).toBeVisible();
    await expect(firstWindow.locator(`${FAMILY} [data-testid='perm-rule-row']`)).toHaveCount(0);
    await expect(firstWindow.locator(`${FAMILY} [data-testid='perm-rule-add']`)).toBeVisible();
  });

  test("标准 2b：规则行 allow/ask/deny 切换且持久（刷新后保持；手填 glob 高级入口）", async () => {
    // BUG-014 契约适配：手填 input 默认隐藏，先点 freeform-toggle 展开
    await firstWindow.locator(`${FAMILY} [data-testid='perm-rule-add']`).click();
    await firstWindow.locator(`${FAMILY} [data-testid='perm-rule-freeform-toggle']`).click();
    await firstWindow.locator(`${FAMILY} [data-testid='perm-rule-input']`).fill("local-db:*");
    await firstWindow.locator(`${FAMILY} [data-testid='perm-rule-add-submit']`).click();
    const row = firstWindow.locator(`${FAMILY} [data-testid='perm-rule-row']`, { hasText: "local-db:*" });
    await expect(row).toBeVisible();
    await row.locator("[data-v='deny']").click();
    await expect(row.locator("[data-v='deny']")).toHaveClass(/active/);
    // 真实刷新（整页 reload）重进，裁决持久
    await firstWindow.reload();
    await gotoBoundWorkspace(firstWindow);
    await expect(
      firstWindow.locator(`${FAMILY} [data-testid='perm-rule-row']`, { hasText: "local-db:*" }).locator("[data-v='deny']")
    ).toHaveClass(/active/);
  });

  test("标准 2c：选择器录入新增规则（server:tool）出现在列表", async () => {
    // BUG-014 契约适配：默认录入 = server 下拉 → 探测拉工具下拉
    await firstWindow.locator(`${FAMILY} [data-testid='perm-rule-add']`).click();
    await firstWindow
      .locator(`${FAMILY} [data-testid='perm-rule-server-select']`)
      .selectOption("e2e-perm-srv");
    const toolSelect = firstWindow.locator(`${FAMILY} [data-testid='perm-rule-tool-select']`);
    await expect(toolSelect.locator("option", { hasText: "fixture_ping" })).toHaveCount(1, { timeout: 15000 });
    await expect(toolSelect.locator("option", { hasText: "全部工具" })).toHaveCount(1);
    await toolSelect.selectOption("fixture_ping");
    await firstWindow.locator(`${FAMILY} [data-testid='perm-rule-add-submit']`).click();
    await expect(
      firstWindow.locator(`${FAMILY} [data-testid='perm-rule-row']`, { hasText: "e2e-perm-srv:fixture_ping" })
    ).toBeVisible();
  });

  test("AC10c：默认层规则呈现在项目页（无覆盖标记）；切换裁决 = 项目覆盖且刷新持久", async () => {
    // 默认层（MCP 页编辑的用户级默认）：local-db:* = allow
    await seedViaApi(apiBaseUrl, {
      path: "/api/mcp/permission-defaults",
      method: "PUT",
      body: { rules: { "local-db:*": "allow" } },
    });
    await firstWindow.reload();
    await gotoBoundWorkspace(firstWindow);

    const row = firstWindow.locator(`${FAMILY} [data-testid='perm-rule-row']`, { hasText: "local-db:*" });
    await expect(row).toBeVisible();
    await expect(row.locator("[data-v='allow']")).toHaveClass(/active/, "默认层值生效");
    await expect(row.locator(".override-tag")).toHaveCount(0, "未覆盖无「项目已改」");

    // 切 deny → 项目覆盖：高亮出现
    await row.locator("[data-v='deny']").click();
    await expect(row.locator("[data-v='deny']")).toHaveClass(/active/);
    await expect(row.locator(".override-tag")).toBeVisible();

    // 真实刷新后覆盖持久
    await firstWindow.reload();
    await gotoBoundWorkspace(firstWindow);
    const row2 = firstWindow.locator(`${FAMILY} [data-testid='perm-rule-row']`, { hasText: "local-db:*" });
    await expect(row2.locator("[data-v='deny']")).toHaveClass(/active/);
    await expect(row2.locator(".override-tag")).toBeVisible();
  });
});
