// REQ-TRACE: 2026-09-06-cli-service-connection/REQ-CLI-SERVICE-006
// REQ-VERSION: v1-hash:1f616dc91b7e8d80569503c5ce12f190ddf066f699394496ea8a815e61593119
// CAPABILITY-TRACE: plugin-management
// ENTITY-TRACE: cli-service
// EXPECTED-TRACE: prd.md §6.1 流 A/B, §6.3 块 4, §7.1, §8 E1
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true (2026-09-06 assertion signoff, 见 signoff.md)

const { test, expect } = require("@playwright/test");

const STANDARD_SERVICES = [
  {
    id: "claude",
    displayName: "Claude Code",
    command: "claude",
    installed: true,
    version: "1.0.80",
    latestVersion: "1.0.95",
    updateAvailable: true,
    enabled: true,
    envKeys: ["ANTHROPIC_API_KEY"],
    timeoutSec: 120,
    installHint: "npm i -g @anthropic-ai/claude-code",
  },
  {
    id: "codex",
    displayName: "OpenAI Codex CLI",
    command: "codex",
    installed: false,
    version: null,
    latestVersion: "unknown",
    updateAvailable: false,
    enabled: false,
    envKeys: [],
    timeoutSec: 120,
    installHint: "npm i -g @openai/codex",
  },
];

test.describe("REQ-CLI-SERVICE-006 CLI 服务管理页面渲染与交互行为（E2E）", () => {
  test.beforeEach(async ({ page }) => {
    // 默认全局 mock 后端接口，消除对 mock 数据退化的依赖
    await page.route("**/api/cli-services/project-enablements", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ enablements: { claude: ["proj-1"] } }),
      });
    });

    // 精确匹配 JSON API，不带尾通配：避免命中 Vite 服务的前端模块 /api/projects.js
    await page.route(/\/api\/projects(\?.*)?$/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([{ id: "proj-1", name: "Test Project" }]),
      });
    });

    await page.route("**/api/cli-services*", async (route) => {
      const url = route.request().url();
      // refresh=1 重新探测同样返回 fixture（不 continue 到不存在的后端）
      if (url.includes("refresh=1")) {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ services: STANDARD_SERVICES }),
        });
      }
      // project-enablements 聚合端点（LIFO 下先注册的具体路由通常已拦截，此处兜底也显式 fulfill）
      if (url.includes("project-enablements")) {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ enablements: { claude: ["proj-1"] } }),
        });
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ services: STANDARD_SERVICES }),
      });
    });
  });

  test("导航至 /cli-services 页面并展示 2 个内置清单服务行", async ({ page }) => {
    await page.goto("/cli-services");

    // EXPECTED-TRACE: prd.md §6.1 流 A
    const items = page.locator("[data-testid^='cli-service-row-']");
    await expect(items).toHaveCount(2);
    await expect(page.locator("[data-testid='cli-service-row-claude']")).toBeVisible();
    await expect(page.locator("[data-testid='cli-service-row-codex']")).toBeVisible();
  });

  test("从左侧导航栏点击「CLI 服务」进入页面（AC1）", async ({ page }) => {
    await page.goto("/");
    const navLink = page.locator("[data-testid='nav-cli-services']");
    await expect(navLink).toBeVisible();
    await navLink.click();
    await expect(page).toHaveURL(/.*\/cli-services/);
    await expect(page.locator("[data-testid='cli-services-page']")).toBeVisible();
  });

  test("未安装的条目显示安装指引，且全局启用开关处于禁用（disabled）状态", async ({ page }) => {
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

    // claude updateAvailable: true
    const claudeRow = page.locator("[data-testid='cli-service-row-claude']");
    await expect(claudeRow.locator("[data-testid='update-badge']")).toBeVisible();
    await expect(claudeRow.locator("[data-testid='update-badge']")).toContainText("可更新至 1.0.95");
  });

  test("未全局启用的 CLI 服务，项目启用按钮处于禁用态（AC6）", async ({ page }) => {
    await page.goto("/cli-services");

    // codex 未安装且未全局启用
    const codexProjectToggle = page.locator("[data-testid='cli-service-row-codex'] [data-testid='cli-service-project-toggle']");
    await expect(codexProjectToggle).toBeDisabled();
  });

  test("打开环境变量与超时配置弹窗（AC7）", async ({ page }) => {
    await page.goto("/cli-services");

    const configBtn = page.locator("[data-testid='cli-service-row-claude'] [data-testid='cli-service-config-button']");
    await configBtn.click();

    const modal = page.locator("[data-testid='cli-service-config-modal']");
    await expect(modal).toBeVisible();

    const timeoutInput = modal.locator("[data-testid='cli-service-timeout-input']");
    await expect(timeoutInput).toHaveValue("120");

    // 显示已配置加密的 key 名称
    await expect(modal.getByText("ANTHROPIC_API_KEY")).toBeVisible();
  });

  test("点击顶部刷新按钮触发带 ?refresh=1 的重新探测", async ({ page }) => {
    let refreshed = false;
    await page.route("**/api/cli-services?refresh=1", async (route) => {
      refreshed = true;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ services: STANDARD_SERVICES }),
      });
    });

    await page.goto("/cli-services");
    await page.locator("[data-testid='refresh-probe-button']").click();

    expect(refreshed).toBe(true);
  });
});
