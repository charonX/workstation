// REQ-TRACE: 2026-09-07-mcp-sse-transport/REQ-MCP-SSE-004
// REQ-VERSION: v1-hash:9f20ee0db8e336cc1980dc6d6570aef6dcfb5e8fc0c592387ce1c6f12723465f
// CAPABILITY-TRACE: plugin-management
// ENTITY-TRACE: mcp-server
// EXPECTED-TRACE: prd.md §6.3 块 4（row 1-2）、§6.1 步骤 1-2、§8 回归面
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true (2026-09-07 assertion signoff, 见 signoff.md)

// REQ-MCP-SSE-004：管理页 transport 三选与 sse 展示。
//
// UX 参照：无新增原型——复用现有 mcp-page 表单 seg 模式（PRD §6.1，人确认跳过 DESIGN）。
// 结构契约锚点（新增）：
//   [data-testid='mcp-type-seg'] [data-type='sse']   seg 第三选项
//
// 环境：startElectronApp（既有 fixture）；导航走 hash 路由直访（navigation.cjs 先例）。
// 断言语义：元素存在/可见性/提交体形状（经 API 回读观察），不验像素。

const { test, expect } = require("@playwright/test");
const { startElectronApp, stopElectronApp } = require("../../../../../e2e/fixtures/electronApp.cjs");
const { goToAdminRoute } = require("../../../../../e2e/helpers/navigation.cjs");

const MCP_ROUTE = "#/mcp";

async function seedViaApi(apiBaseUrl, fn) {
  const res = await fetch(`${apiBaseUrl}${fn.path}`, {
    method: fn.method ?? "POST",
    headers: { "Content-Type": "application/json" },
    body: fn.body ? JSON.stringify(fn.body) : undefined,
  });
  if (!res.ok) throw new Error(`seed ${fn.path} failed: ${res.status}`);
}

test.describe("REQ-MCP-SSE-004 管理页 transport 三选与 sse 展示", () => {
  let electronApp;
  let firstWindow;
  let apiBaseUrl;

  test.beforeEach(async () => {
    ({ electronApp, firstWindow, apiBaseUrl } = await startElectronApp());
    await goToAdminRoute(firstWindow, MCP_ROUTE);
  });

  test.afterEach(async () => {
    await stopElectronApp(electronApp);
  });

  test("seg 含三选项：stdio（本地命令）/ http / sse", async () => {
    // EXPECTED-TRACE: prd.md §6.3 块 4 row 1, §6.1 步骤 1
    await firstWindow.locator("[data-testid='mcp-add-button']").click();
    await expect(firstWindow.locator("[data-testid='mcp-form-modal']")).toBeVisible();
    const seg = firstWindow.locator("[data-testid='mcp-type-seg']");
    await expect(seg.locator("[data-type='stdio']")).toBeVisible();
    await expect(seg.locator("[data-type='http']")).toBeVisible();
    await expect(seg.locator("[data-type='sse']")).toBeVisible();
  });

  test("选 sse → command/args/env 隐藏，url/auth 可见；切回 stdio 恢复", async () => {
    // EXPECTED-TRACE: prd.md §6.3 块 4 row 1
    await firstWindow.locator("[data-testid='mcp-add-button']").click();
    await firstWindow.locator("[data-testid='mcp-type-seg'] [data-type='sse']").click();
    await expect(firstWindow.locator("[data-testid='mcp-command-input']")).toBeHidden();
    await expect(firstWindow.locator("[data-testid='mcp-args-input']")).toBeHidden();
    await expect(firstWindow.locator("[data-testid='mcp-env-input']")).toBeHidden();
    await expect(firstWindow.locator("[data-testid='mcp-url-input']")).toBeVisible();
    await expect(firstWindow.locator("[data-testid='mcp-auth-seg']")).toBeVisible();
    // review test-F3 补强：AC2 要求 url/auth/token/headers 可见——headers 输入框补断言
    //（token 框按先例为选 Bearer 后条件显示，不在此断言）
    await expect(firstWindow.locator("[data-testid='mcp-headers-input']")).toBeVisible();

    // 回归：切回 stdio 恢复本地命令字段（§8 回归面）
    await firstWindow.locator("[data-testid='mcp-type-seg'] [data-type='stdio']").click();
    await expect(firstWindow.locator("[data-testid='mcp-command-input']")).toBeVisible();
    await expect(firstWindow.locator("[data-testid='mcp-url-input']")).toBeHidden();
  });

  test("选 sse 填表提交 → 列表出现该 server，badge 为 sse，API 回读 type=sse", async () => {
    // EXPECTED-TRACE: prd.md §6.3 块 4 row 1-2, §6.1 步骤 2
    // review test-F1 修复（2026-09-07 人裁决）：POST 请求体形状必须有直接断言落点——
    // 拦截 POST /api/mcp，断言 body.type==="sse" 且不含 command/args/env 键（REQ-004 AC3）。
    let postBody = null;
    firstWindow.on("request", (req) => {
      if (req.method() === "POST" && req.url().includes("/api/mcp")) {
        try {
          postBody = JSON.parse(req.postData() ?? "null");
        } catch {
          postBody = null;
        }
      }
    });

    await firstWindow.locator("[data-testid='mcp-add-button']").click();
    await firstWindow.locator("[data-testid='mcp-type-seg'] [data-type='sse']").click();
    await firstWindow.locator("[data-testid='mcp-name-input']").fill("e2e-crawl4ai");
    await firstWindow.locator("[data-testid='mcp-url-input']").fill("http://10.0.0.5:11235/mcp/sse");
    await firstWindow.locator("[data-testid='mcp-auth-seg'] button", { hasText: "Bearer Token" }).click();
    await firstWindow.locator("[data-testid='mcp-token-input']").fill("e2e-sse-token");
    await firstWindow.locator("[data-testid='mcp-form-submit']").click();

    // REQ-004 AC3 显式锚点：POST 请求体含 type:"sse" 且不含 command/args/env 键
    expect(postBody, "提交触发 POST /api/mcp").toBeTruthy();
    expect(postBody.type).toBe("sse");
    expect("command" in postBody).toBe(false);
    expect("args" in postBody).toBe(false);
    expect("env" in postBody).toBe(false);

    const row = firstWindow.locator("[data-testid='mcp-row-e2e-crawl4ai']");
    await expect(row).toBeVisible();
    await expect(row.locator(".badge")).toHaveText("sse");
    // 页面任何位置不回显明文 token（脱敏契约同构）
    await expect(firstWindow.locator("text=e2e-sse-token")).toHaveCount(0);

    // 提交体形状经 API 回读观察：type=sse，且无 command/args/env 语义混入
    const res = await fetch(`${apiBaseUrl}/api/mcp`);
    const list = await res.json();
    const entries = Array.isArray(list) ? list : list?.servers ?? list?.items ?? [];
    const entry = entries.find((s) => s.name === "e2e-crawl4ai");
    expect(entry, "API 回读含 e2e-crawl4ai").toBeTruthy();
    expect(entry.type).toBe("sse");
    expect(entry.url).toBe("http://10.0.0.5:11235/mcp/sse");
    expect(entry.auth).toBe("bearer");
    expect(JSON.stringify(entry)).not.toContain("e2e-sse-token");
  });

  test("编辑既有 sse 条目 → seg 激活 sse 且 url 回填", async () => {
    // EXPECTED-TRACE: prd.md §6.3 块 4 row 2
    await seedViaApi(apiBaseUrl, {
      path: "/api/mcp",
      body: { name: "e2e-edit-sse", type: "sse", url: "http://10.0.0.7:11235/mcp/sse" },
    });
    await goToAdminRoute(firstWindow, MCP_ROUTE);
    const row = firstWindow.locator("[data-testid='mcp-row-e2e-edit-sse']");
    await expect(row).toBeVisible();
    await row.locator("[data-testid='mcp-edit-button']").click();
    await expect(firstWindow.locator("[data-testid='mcp-form-modal']")).toBeVisible();
    await expect(
      firstWindow.locator("[data-testid='mcp-type-seg'] [data-type='sse'].active")
    ).toBeVisible();
    await expect(firstWindow.locator("[data-testid='mcp-url-input']")).toHaveValue(
      "http://10.0.0.7:11235/mcp/sse"
    );
  });
});
