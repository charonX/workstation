// REQ-TRACE: 2026-09-07-mcp-sse-transport/REQ-MCP-SSE-004, 2026-09-07-mcp-sse-transport/REQ-MCP-SSE-005
// REQ-VERSION: v2-hash:514369c508988564fe44bcd04f986f44e029c17fd4db91296f6e3e165e4e852d
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
const path = require("node:path");
const { spawn } = require("node:child_process");
const { startElectronApp, stopElectronApp } = require("../../../../../e2e/fixtures/electronApp.cjs");
const { goToAdminRoute } = require("../../../../../e2e/helpers/navigation.cjs");

const MCP_ROUTE = "#/mcp";
const SSE_FIXTURE_ABS = path.resolve(__dirname, "../../../../../fixtures/mcp-sse-server/server.mjs");

/** spawn legacy-SSE fixture，stdout 报 PORT= 后 resolve {proc, port}。 */
async function startSseFixture(env = {}) {
  const proc = spawn(process.execPath, [SSE_FIXTURE_ABS], {
    env: { ...process.env, ...env },
  });
  const port = await new Promise((resolve, reject) => {
    let buf = "";
    const timer = setTimeout(() => {
      proc.kill();
      reject(new Error("sse fixture 未报 PORT="));
    }, 10000);
    proc.stdout.setEncoding("utf8");
    proc.stdout.on("data", (chunk) => {
      buf += chunk;
      const m = /PORT=(\d+)/.exec(buf);
      if (m) {
        clearTimeout(timer);
        resolve(Number(m[1]));
      }
    });
    proc.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`sse fixture 提前退出 code=${code}`));
    });
  });
  return { proc, port };
}

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

  // REQ-MCP-SSE-005 标准 6（req-gap 补全，2026-09-07 人裁决）：弹窗内「测试连接」，
  // 未保存即可探测，返回工具列表即表明 MCP 可用。
  test("弹窗内（未保存）填 sse 表单点「测试连接」→ 结果显示成功态与工具名 echo", async () => {
    // EXPECTED-TRACE: prd.md §6.3 块 6 row 4
    const { proc, port } = await startSseFixture();
    try {
      await firstWindow.locator("[data-testid='mcp-add-button']").click();
      await firstWindow.locator("[data-testid='mcp-type-seg'] [data-type='sse']").click();
      await firstWindow.locator("[data-testid='mcp-name-input']").fill("e2e-adhoc");
      await firstWindow.locator("[data-testid='mcp-url-input']").fill(`http://127.0.0.1:${port}/sse`);

      await firstWindow.locator("[data-testid='mcp-test-conn-button']").click();
      const result = firstWindow.locator("[data-testid='mcp-test-conn-result']");
      await expect(result).toBeVisible();
      await expect(result).toContainText("echo");

      // 未保存：弹窗不关闭，列表不落该行
      await expect(firstWindow.locator("[data-testid='mcp-form-modal']")).toBeVisible();
      await firstWindow.locator("[data-testid='mcp-form-modal'] [aria-label='close']").click();
      await expect(firstWindow.locator("[data-testid='mcp-row-e2e-adhoc']")).toHaveCount(0);
    } finally {
      proc.kill();
    }
  });

  test("测试连接指向不可达端点 → 结果区呈「连接失败：」文案", async () => {
    // EXPECTED-TRACE: prd.md §6.3 块 6 row 2（UI 呈现侧）
    const { proc, port } = await startSseFixture();
    proc.kill();
    await new Promise((resolve) => proc.on("exit", resolve));

    await firstWindow.locator("[data-testid='mcp-add-button']").click();
    await firstWindow.locator("[data-testid='mcp-type-seg'] [data-type='sse']").click();
    await firstWindow.locator("[data-testid='mcp-name-input']").fill("e2e-adhoc-down");
    await firstWindow.locator("[data-testid='mcp-url-input']").fill(`http://127.0.0.1:${port}/sse`);
    await firstWindow.locator("[data-testid='mcp-test-conn-button']").click();

    const result = firstWindow.locator("[data-testid='mcp-test-conn-result']");
    await expect(result).toBeVisible();
    await expect(result).toContainText("连接失败：");
  });

  // BUG-002 回归（code-defect，2026-09-07 人裁决）：crawl4ai 式超长工具描述把结果区
  // 撑爆 modal-footer，保存/取消被推出视口。契约：结果区定界滚动 + footer 按钮恒在视口内。
  test("BUG-002：超长工具描述不撑爆弹窗——结果区定界且保存按钮在视口内", async () => {
    // EXPECTED-TRACE: BUG-002 分类记录（code-defect：结果区缺 max-height/滚动定界）
    const { proc, port } = await startSseFixture({ MCP_FIXTURE_LONG_DESC: "1" });
    try {
      await firstWindow.locator("[data-testid='mcp-add-button']").click();
      await firstWindow.locator("[data-testid='mcp-type-seg'] [data-type='sse']").click();
      await firstWindow.locator("[data-testid='mcp-name-input']").fill("e2e-long-desc");
      await firstWindow.locator("[data-testid='mcp-url-input']").fill(`http://127.0.0.1:${port}/sse`);
      await firstWindow.locator("[data-testid='mcp-test-conn-button']").click();

      const result = firstWindow.locator("[data-testid='mcp-test-conn-result']");
      await expect(result).toContainText("echo");

      // 结果区定界：有滚动约束且高度有界（不随描述长度无界增长）
      const box = await result.boundingBox();
      expect(box, "结果区在文档流中").toBeTruthy();
      expect(box.height, "结果区高度有界（≤240px）").toBeLessThanOrEqual(240);
      const overflowY = await result.evaluate((el) => getComputedStyle(el).overflowY);
      expect(["auto", "scroll"], "结果区可滚动").toContain(overflowY);

      // footer 按钮恒可达：保存按钮完整落在窗口内（Electron 无 viewport 模拟，用 window.innerHeight）
      const submit = firstWindow.locator("[data-testid='mcp-form-submit']");
      await expect(submit).toBeVisible();
      const btnBox = await submit.boundingBox();
      const winHeight = await firstWindow.evaluate(() => window.innerHeight);
      expect(btnBox.y + btnBox.height, "保存按钮下沿在窗口内").toBeLessThanOrEqual(winHeight);
    } finally {
      proc.kill();
    }
  });

  // BUG-003 回归：
  // 1. 未填写名称点击保存 → 错误精准呈现在名称字段并标红名称输入框，不得冒充在 URL 字段
  // 2. 保存成功后表单正常关闭，不自动弹出工具列表弹层
  test("BUG-003：未填名称点击保存 → 错误呈现在名称字段并标红输入框，URL 字段不冒充报错", async () => {
    // EXPECTED-TRACE: BUG-003 症状 1（名称缺失时报错错位至 URL 字段）
    await firstWindow.locator("[data-testid='mcp-add-button']").click();
    await firstWindow.locator("[data-testid='mcp-type-seg'] [data-type='sse']").click();
    await firstWindow.locator("[data-testid='mcp-url-input']").fill("http://192.168.8.132:11235/mcp/sse");
    await firstWindow.locator("[data-testid='mcp-form-submit']").click();

    const nameField = firstWindow.locator(".field", { has: firstWindow.locator("[data-testid='mcp-name-input']") });
    const urlField = firstWindow.locator(".field", { has: firstWindow.locator("[data-testid='mcp-url-input']") });

    // 名称字段必须呈现错误态与报错文本
    await expect(nameField).toHaveClass(/invalid/);
    const nameErr = nameField.locator(".err");
    await expect(nameErr).toBeVisible();
    await expect(nameErr).toContainText("name");

    // URL 字段不得呈现错误态
    await expect(urlField).not.toHaveClass(/invalid/);
    await expect(urlField.locator(".err")).toBeHidden();
  });

  test("BUG-003：保存成功后直接关闭表单回到列表，不自动弹出工具列表弹层", async () => {
    // EXPECTED-TRACE: BUG-003 症状 2（保存成功后自动弹出 mcp-tools-modal 弹层干扰流）
    await firstWindow.locator("[data-testid='mcp-add-button']").click();
    await firstWindow.locator("[data-testid='mcp-type-seg'] [data-type='sse']").click();
    await firstWindow.locator("[data-testid='mcp-name-input']").fill("e2e-no-popup");
    await firstWindow.locator("[data-testid='mcp-url-input']").fill("http://10.0.0.9:11235/mcp/sse");
    await firstWindow.locator("[data-testid='mcp-form-submit']").click();

    // 表单弹窗关闭
    await expect(firstWindow.locator("[data-testid='mcp-form-modal']")).toBeHidden();
    // 列表出现新增行
    await expect(firstWindow.locator("[data-testid='mcp-row-e2e-no-popup']")).toBeVisible();
    // 工具清单弹窗不得自动弹出
    await expect(firstWindow.locator("[data-testid='mcp-tools-modal']")).toBeHidden();
  });
});

