// REQ-TRACE: 2026-08-12-pi-mcp-plugin/REQ-AGENT-083, 2026-08-12-pi-mcp-plugin/REQ-AGENT-084
// REQ-VERSION: v1-hash:742cddf72b44df8cb71bb4b0cf6a8dae7a21d22df2b4c3788bdf3065208b848d
// CAPABILITY-TRACE: plugin-management
// ENTITY-TRACE: mcp-server
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: false (BUG-013 req-gap 补全：IA 拆页 + AC7 工具探测；迁移用例语义不变)

// BUG-013（req-gap 就地补全，人确认 2026-08-16）：MCP 服务管理从「插件」页拆出——
// 管理区独立导航项「MCP」（位于「技能」之下）+ 独立路由 #/mcp；
// 并新增「配置后直连 server 拉取工具」能力（REQ-084 AC7）：行内「工具」按钮开
// 工具清单弹窗（名称+描述），保存后自动连接拉取，连接失败弹窗内呈「连接失败」。
//
// UX 参照：ux/mcp-page.html（BUG-013 定稿）。结构契约锚点：
//   [data-testid='nav-mcp']               侧边栏导航项（位于 nav-skills 与 nav-plugins 之间）
//   [data-testid='mcp-page']              页面容器
//   [data-testid='mcp-add-button'] / [data-testid='mcp-form-modal']  / [data-testid='mcp-form-submit']
//   [data-testid='mcp-row-<name>']        MCP server 行
//   [data-testid='mcp-tools-button']      行内「工具」按钮
//   [data-testid='mcp-tools-modal']       工具清单弹窗（mcp-tools-table 名称+描述）
//   [data-testid='mcp-tools-error-text']  连接失败态文案
//
// 环境：startElectronApp（既有 fixture）；导航走 hash 路由直访（navigation.cjs 先例）。
// 断言语义：元素存在/可见性/状态持久，不验像素。
//
// 本文件承接自 pluginsPage.test.cjs 迁出的 MCP 用例（路由 #/plugins → #/mcp，语义不变）。

const { test, expect } = require("@playwright/test");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");
const { startElectronApp, stopElectronApp } = require("../../../../../e2e/fixtures/electronApp.cjs");
const { goToAdminRoute } = require("../../../../../e2e/helpers/navigation.cjs");

const MCP_ROUTE = "#/mcp";
const STDIO_FIXTURE_ABS = path.resolve(__dirname, "../../../../../fixtures/mcp-stdio-server/server.mjs");

async function seedViaApi(apiBaseUrl, fn) {
  const res = await fetch(`${apiBaseUrl}${fn.path}`, {
    method: fn.method ?? "POST",
    headers: { "Content-Type": "application/json" },
    body: fn.body ? JSON.stringify(fn.body) : undefined,
  });
  if (!res.ok) throw new Error(`seed ${fn.path} failed: ${res.status}`);
}
async function seedMcp(apiBaseUrl, body) {
  await seedViaApi(apiBaseUrl, { path: "/api/mcp", body });
}
async function seedDemoProject(apiBaseUrl) {
  const projDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-e2e-demo-"));
  await seedViaApi(apiBaseUrl, {
    path: "/api/projects",
    body: { name: "demo", sourceType: "local", localPath: projDir },
  });
  return projDir;
}

test.describe("REQ-AGENT-084 MCP 服务管理页（E2E，BUG-013 独立页）", () => {
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

  test("导航：侧边栏「MCP」位于「技能」之下、「插件」之上，点击进 #/mcp", async () => {
    const skills = firstWindow.locator("[data-testid='nav-skills']");
    const mcp = firstWindow.locator("[data-testid='nav-mcp']");
    const plugins = firstWindow.locator("[data-testid='nav-plugins']");
    await expect(mcp).toBeVisible();
    // 视觉顺序：技能 → MCP → 插件（y 坐标递增）
    const ySkills = (await skills.boundingBox()).y;
    const yMcp = (await mcp.boundingBox()).y;
    const yPlugins = (await plugins.boundingBox()).y;
    expect(yMcp).toBeGreaterThan(ySkills);
    expect(yMcp).toBeLessThan(yPlugins);

    await mcp.click();
    await expect(firstWindow.locator("[data-testid='mcp-page']")).toBeVisible();
    expect(firstWindow.url()).toContain("#/mcp");
  });

  test("添加 MCP 服务——stdio 表单保存后列表出现该 server", async () => {
    await firstWindow.locator("[data-testid='mcp-add-button']").click();
    await expect(firstWindow.locator("[data-testid='mcp-form-modal']")).toBeVisible();
    await firstWindow.locator("[data-testid='mcp-name-input']").fill("e2e-stdio");
    await firstWindow.locator("[data-testid='mcp-command-input']").fill("node");
    await firstWindow.locator("[data-testid='mcp-args-input']").fill("tests/fixtures/mcp-stdio-server/server.mjs");
    await firstWindow.locator("[data-testid='mcp-form-submit']").click();
    await expect(firstWindow.locator("[data-testid='mcp-row-e2e-stdio']")).toBeVisible();
  });

  test("类型切换 http → 显示 URL/认证字段；非法 URL 表单报错", async () => {
    await firstWindow.locator("[data-testid='mcp-add-button']").click();
    await firstWindow.locator("[data-testid='mcp-type-seg'] [data-type='http']").click();
    await expect(firstWindow.locator("[data-testid='mcp-url-input']")).toBeVisible();
    await expect(firstWindow.locator("[data-testid='mcp-auth-seg']")).toBeVisible();
    await firstWindow.locator("[data-testid='mcp-name-input']").fill("e2e-bad");
    await firstWindow.locator("[data-testid='mcp-url-input']").fill("ftp://bad");
    await firstWindow.locator("[data-testid='mcp-form-submit']").click();
    // 字段级错误呈现，弹窗不关
    await expect(firstWindow.locator("[data-testid='mcp-form-modal'] .err:visible")).toBeVisible();
  });

  // BUG-006（REQ-AGENT-084 标准 6，req-gap 就地补全）：bearer token 录入入口。
  // UX 参照 ux/mcp-page.html：认证选 Bearer Token 时显示 mcp-token-input（password 型）。
  test("认证选 Bearer Token → 显示 token 输入框；带 token 保存后列表出现该 server", async () => {
    await firstWindow.locator("[data-testid='mcp-add-button']").click();
    await firstWindow.locator("[data-testid='mcp-type-seg'] [data-type='http']").click();
    const tokenInput = firstWindow.locator("[data-testid='mcp-token-input']");
    await expect(tokenInput).toBeHidden();
    await firstWindow.locator("[data-testid='mcp-auth-seg'] button", { hasText: "Bearer Token" }).click();
    await expect(tokenInput).toBeVisible();
    // 切回「无」→ 隐藏
    await firstWindow.locator("[data-testid='mcp-auth-seg'] button", { hasText: "无", exact: true }).click();
    await expect(tokenInput).toBeHidden();
    // bearer + token 保存成功
    await firstWindow.locator("[data-testid='mcp-auth-seg'] button", { hasText: "Bearer Token" }).click();
    await firstWindow.locator("[data-testid='mcp-name-input']").fill("e2e-bearer");
    await firstWindow.locator("[data-testid='mcp-url-input']").fill("https://mcp.example.com/v2/mcp");
    await tokenInput.fill("e2e-secret-token");
    await firstWindow.locator("[data-testid='mcp-form-submit']").click();
    await expect(firstWindow.locator("[data-testid='mcp-row-e2e-bearer']")).toBeVisible();
    // 页面任何位置不回显明文 token
    await expect(firstWindow.locator("text=e2e-secret-token")).toHaveCount(0);
  });

  // BUG-008 回归（REQ-AGENT-084 CRUD-U + UX 参照行内「编辑」按钮，mcp-page.html）：
  // 行内「编辑」打开同一弹窗（编辑模式）：名称为主键只读，字段回填；token 不回填
  // （已签：API 永不回显明文），留空 = 保持不变。
  test("行内「编辑」按钮打开回填弹窗，改 URL 保存后行更新", async () => {
    await seedMcp(apiBaseUrl, { name: "e2e-edit", type: "http", url: "https://old.example.com/mcp", auth: "bearer", token: "keep-me" });
    await goToAdminRoute(firstWindow, MCP_ROUTE);
    const row = firstWindow.locator("[data-testid='mcp-row-e2e-edit']");
    await expect(row).toBeVisible();

    await row.locator("[data-testid='mcp-edit-button']").click();
    const modal = firstWindow.locator("[data-testid='mcp-form-modal']");
    await expect(modal).toBeVisible();
    // 回填：url 回填旧值；name 主键只读；token 不回填（留空 = 保留）
    await expect(modal.locator("[data-testid='mcp-url-input']")).toHaveValue("https://old.example.com/mcp");
    await expect(modal.locator("[data-testid='mcp-name-input']")).toBeDisabled();
    await expect(modal.locator("[data-testid='mcp-token-input']")).toHaveValue("");

    await modal.locator("[data-testid='mcp-url-input']").fill("https://new.example.com/mcp");
    await modal.locator("[data-testid='mcp-form-submit']").click();
    await expect(modal).toBeHidden();
    await expect(row.locator(".mono")).toContainText("https://new.example.com/mcp");
    // 页面任何位置不回显明文 token（含编辑后）
    await expect(firstWindow.locator("text=keep-me")).toHaveCount(0);
  });

  // BUG-009 回归（req-gap 就地补全，UX 参照 mcp-page.html 弹层 fixed 视口定位）：
  // 单行 MCP 表点「项目启用」pill → 弹层须真实可见。原 absolute 贴单元格向下展开，
  // 单行/末行时整体超出 .section(overflow:hidden) 边界被裁剪（用户实证「点了没反应」）。
  // toBeVisible 不查祖先裁剪，故用命中测试锚定「真实可见」：
  // 弹层内项目行中心点 elementFromPoint 必须落在弹层内部（被裁剪时命中卡片外背景）。
  test("BUG-009：单行 MCP 表点「项目启用」→ 弹层可见且不被卡片裁剪", async () => {
    await seedMcp(apiBaseUrl, { name: "e2e-pop", type: "http", url: "https://pop.example.com/mcp" });
    await seedDemoProject(apiBaseUrl);
    await goToAdminRoute(firstWindow, MCP_ROUTE);
    const row = firstWindow.locator("[data-testid='mcp-row-e2e-pop']");
    await expect(row).toBeVisible();

    await row.locator("[data-testid='mcp-project-toggle']").click();
    const pop = row.locator("[data-testid='mcp-project-pop']");
    await expect(pop).toBeVisible();

    const popRow = pop.locator(".pop-row", { hasText: "demo" });
    await expect(popRow).toHaveCount(1);
    const hit = await popRow.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const hitEl = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return hitEl != null && (hitEl === el || el.contains(hitEl));
    });
    expect(hit).toBe(true);
  });

  // BUG-012 回归（code-defect，人确认 2026-08-15）：MCP「项目启用」弹层必须显示
  // 真实启用态——buildProjectMaps 曾调无参 listMcpServers()，拿全局开关冒充项目
  // 启用态（全局开 → 每个项目都显示 on），真实启用行永不落库 → 桥 0 server。
  // 对齐插件侧标准 3 的往返语义：初始 off → 点击启用 → 刷新持久化。
  test("BUG-012：弹层初始 off（不被全局开关冒充）→ 点击启用 on → 刷新后保持", async () => {
    await seedMcp(apiBaseUrl, { name: "e2e-proj", type: "http", url: "https://proj.example.com/mcp" });
    await seedDemoProject(apiBaseUrl);
    await goToAdminRoute(firstWindow, MCP_ROUTE);
    const row = firstWindow.locator("[data-testid='mcp-row-e2e-proj']");
    await expect(row).toBeVisible();

    // 未启用时 pill 显示「未启用」，弹层 demo 行 switch 为 off
    await expect(row.locator("[data-testid='mcp-project-toggle']")).toContainText("未启用");
    await row.locator("[data-testid='mcp-project-toggle']").click();
    const pop = row.locator("[data-testid='mcp-project-pop']");
    const demoRow = pop.locator(".pop-row", { hasText: "demo" });
    await expect(demoRow).toHaveCount(1);
    await expect(demoRow.locator(".switch")).not.toHaveClass(/on/);

    // 点击启用 → on；pill 变「1 个项目」
    await demoRow.click();
    await expect(demoRow.locator(".switch")).toHaveClass(/on/);
    await expect(row.locator("[data-testid='mcp-project-toggle']")).toContainText("1 个项目");

    // 刷新重进 → 持久化保持（真实启用行落库）
    await goToAdminRoute(firstWindow, MCP_ROUTE);
    await expect(row.locator("[data-testid='mcp-project-toggle']")).toContainText("1 个项目");
  });

  // BUG-008 回归（req-gap 就地补全后的 UX 结构契约）：
  // 全局开关 switch 须为可见尺寸（UX 定稿 32×18），非 inline 塌缩；
  // 项目启用 pill on 态文字为 accent 色（可读），非白字不可见。
  test("渲染结构：全局开关可见尺寸 + 项目启用 pill on 态文字可读", async () => {
    await seedMcp(apiBaseUrl, { name: "e2e-visual", type: "http", url: "https://visual.example.com/mcp" });
    const projDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-e2e-vis-"));
    const projRes = await fetch(`${apiBaseUrl}/api/projects`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "vis-demo", sourceType: "local", localPath: projDir }),
    });
    const proj = await projRes.json();
    await seedViaApi(apiBaseUrl, {
      path: "/api/mcp/e2e-visual/project-enable",
      body: { projectId: proj.id, enabled: true },
    });
    await goToAdminRoute(firstWindow, MCP_ROUTE);
    const row = firstWindow.locator("[data-testid='mcp-row-e2e-visual']");
    await expect(row).toBeVisible();

    // 开关可见尺寸（塌缩时 boundingBox 宽度 ≈ 0）
    const toggleBox = await row.locator("[data-testid='mcp-global-toggle']").boundingBox();
    expect(toggleBox.width).toBeGreaterThanOrEqual(30);
    expect(toggleBox.height).toBeGreaterThanOrEqual(16);

    // pill on 态文字色 = accent（rgb(13,148,136) 浅主题），白字 = rgb(255,255,255) 为缺陷态
    const pillColor = await row.locator("[data-testid='mcp-project-toggle']").evaluate(
      (el) => getComputedStyle(el).color
    );
    expect(pillColor).not.toBe("rgb(255, 255, 255)");
  });

  // ---------- BUG-013 新增（REQ-AGENT-084 AC7：工具探测 UI） ----------

  test("AC7：行内「工具」→ 弹窗列出 server 工具（名称+描述）", async () => {
    await seedMcp(apiBaseUrl, {
      name: "e2e-tools",
      type: "stdio",
      command: process.execPath,
      args: [STDIO_FIXTURE_ABS],
    });
    await goToAdminRoute(firstWindow, MCP_ROUTE);
    const row = firstWindow.locator("[data-testid='mcp-row-e2e-tools']");
    await expect(row).toBeVisible();

    await row.locator("[data-testid='mcp-tools-button']").click();
    const modal = firstWindow.locator("[data-testid='mcp-tools-modal']");
    await expect(modal).toBeVisible();
    // 直连 stdio fixture 拉取 tools/list（连接需 spawn 握手，放宽超时）
    await expect(modal.locator("[data-testid='mcp-tools-table']")).toContainText("fixture_ping", { timeout: 15000 });
    await expect(modal.locator("[data-testid='mcp-tools-table']")).toContainText("echo back the input");
  });

  test("AC7：连接失败 → 弹窗内呈「连接失败」+ 详情", async () => {
    await seedMcp(apiBaseUrl, { name: "e2e-broken", type: "stdio", command: "run-missing-command-xyz" });
    await goToAdminRoute(firstWindow, MCP_ROUTE);
    const row = firstWindow.locator("[data-testid='mcp-row-e2e-broken']");
    await expect(row).toBeVisible();

    await row.locator("[data-testid='mcp-tools-button']").click();
    const modal = firstWindow.locator("[data-testid='mcp-tools-modal']");
    await expect(modal).toBeVisible();
    await expect(modal.locator("[data-testid='mcp-tools-error-text']")).toContainText("连接失败", { timeout: 15000 });
  });

  test("AC7：保存后自动连接拉取——添加 stdio server → 工具弹窗自动出现", async () => {
    await firstWindow.locator("[data-testid='mcp-add-button']").click();
    await firstWindow.locator("[data-testid='mcp-name-input']").fill("e2e-auto");
    await firstWindow.locator("[data-testid='mcp-command-input']").fill(process.execPath);
    await firstWindow.locator("[data-testid='mcp-args-input']").fill(STDIO_FIXTURE_ABS);
    await firstWindow.locator("[data-testid='mcp-form-submit']").click();

    // 保存成功 → 自动连接并弹出工具清单
    const modal = firstWindow.locator("[data-testid='mcp-tools-modal']");
    await expect(modal).toBeVisible({ timeout: 15000 });
    await expect(modal.locator("[data-testid='mcp-tools-table']")).toContainText("fixture_ping", { timeout: 15000 });
  });
});
