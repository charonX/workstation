// REQ-TRACE: 2026-09-06-cli-service-connection/REQ-CLI-SERVICE-006
// REQ-VERSION: v1-hash:7a08fa0c5ef0d0de30c2e6ac387f5cfc7b3534a2baebed30b2dc11edbe6563a9
// CAPABILITY-TRACE: plugin-management
// ENTITY-TRACE: cli-service
// EXPECTED-TRACE: prd.md §6.1 流 A/B, §6.3 块 4, §7.1, §8 E1
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true (2026-09-06 assertion signoff, 见 signoff.md)

const { test, expect } = require("@playwright/test");

test.describe("REQ-CLI-SERVICE-006 CLI 服务管理页面渲染与交互行为（E2E）", () => {
  test("导航至 /cli-services 页面并展示 3 个内置清单服务行", async ({ page }) => {
    await page.goto("/cli-services");

    // EXPECTED-TRACE: prd.md §6.1 流 A
    const items = page.locator("[data-testid^='cli-service-row-']");
    await expect(items).toHaveCount(3);
    await expect(page.locator("[data-testid='cli-service-row-claude']")).toBeVisible();
    await expect(page.locator("[data-testid='cli-service-row-codex']")).toBeVisible();
    await expect(page.locator("[data-testid='cli-service-row-crawl4ai']")).toBeVisible();
  });

  test("未安装的条目显示安装指引，且全局启用开关处于禁用（disabled）状态", async ({ page }) => {
    // 拦截 API 响应：模拟 codex 为未安装
    await page.route("**/api/cli-services*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          services: [
            {
              id: "claude",
              displayName: "Claude Code",
              installed: true,
              version: "1.0.80",
              latestVersion: "1.0.80",
              updateAvailable: false,
              enabled: true,
              envKeys: [],
              timeoutSec: 120,
              installHint: "npm i -g @anthropic-ai/claude-code",
            },
            {
              id: "codex",
              displayName: "OpenAI Codex CLI",
              installed: false,
              version: null,
              latestVersion: "unknown",
              updateAvailable: false,
              enabled: false,
              envKeys: [],
              timeoutSec: 120,
              installHint: "npm i -g @openai/codex",
            },
            {
              id: "crawl4ai",
              displayName: "Crawl4AI CLI",
              installed: true,
              version: "0.4.0",
              latestVersion: "0.4.5",
              updateAvailable: true,
              enabled: false,
              envKeys: [],
              timeoutSec: 120,
              installHint: "pip install crawl4ai",
            },
          ],
        }),
      });
    });

    await page.goto("/cli-services");

    // EXPECTED-TRACE: prd.md §6.3 块 4, §8 E1
    const codexRow = page.locator("[data-testid='cli-service-row-codex']");
    await expect(codexRow).toBeVisible();
    await expect(codexRow).toHaveAttribute("data-installed", "false");
    await expect(codexRow.locator("[data-testid='install-hint']")).toContainText("npm i -g @openai/codex");

    const codexToggle = codexRow.locator("[data-testid='global-enable-switch']");
    await expect(codexToggle).toBeDisabled();
  });

  test("检测到新版本可用时展示更新提示徽标", async ({ page }) => {
    await page.goto("/cli-services");

    // crawl4ai updateAvailable: true
    const crawlRow = page.locator("[data-testid='cli-service-row-crawl4ai']");
    await expect(crawlRow.locator("[data-testid='update-badge']")).toBeVisible();
  });

  test("点击顶部刷新按钮触发带 ?refresh=1 的重新探测", async ({ page }) => {
    let refreshed = false;
    await page.route("**/api/cli-services?refresh=1", async (route) => {
      refreshed = true;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ services: [] }),
      });
    });

    await page.goto("/cli-services");
    await page.locator("[data-testid='refresh-probe-button']").click();

    expect(refreshed).toBe(true);
  });
});
