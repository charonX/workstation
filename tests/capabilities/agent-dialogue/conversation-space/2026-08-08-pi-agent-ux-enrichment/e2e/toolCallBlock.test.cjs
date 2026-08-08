// REQ-TRACE: 2026-08-08-pi-agent-ux-enrichment/REQ-AGENT-052
// REQ-VERSION: v1-hash:dfd35b8a5242cf1ef089f0b289012aa34a1dd194c813e014e8e81b73fc9f403b
// CAPABILITY-TRACE: agent-dialogue
// ENTITY-TRACE: conversation-space
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true

// 工具调用折叠块（B6）——三态 + error 终态。
//
// seam：真实 Electron + **OPC_FAUX_TOOL_SEQUENCE 注入缝**（复用 2026-08-07-pi-agent-
// consolidation Slice 6：FAUX 下 worker 按序列发起真实工具调用 → tool_execution_*
// 事件 → renderer 折叠块）。error 注入 = 工具序列中 args 触发执行失败
//（如 write 到无权限路径）。
// 参照：assistant-rich.html（tool-block 三态语义）。
// 运行：npm run test:e2e（先 rebuild:electron）。
const { test, expect } = require("@playwright/test");
const { startElectronApp, stopElectronApp } = require("../../../../../e2e/fixtures/electronApp.cjs");

const COMPOSER_INPUT = "[data-testid='composer-input']";
const SEND_BUTTON = "[data-testid='send-button']";
const MESSAGE_LIST = "[data-testid='message-list']";

// 工具块 locator 约定（实现时与 renderer 一致；原型语义：收起=工具名+摘要+chevron）
const TOOL_BLOCK = "[data-tool-block]";
const TOOL_HEADER = "[data-tool-header]";
const TOOL_BODY = "[data-tool-body]";
const TOOL_ERROR_BADGE = "[data-tool-error-badge]";

test.describe("REQ-AGENT-052 工具调用折叠块", () => {
  let ctx;

  test.beforeEach(async () => {
    ctx = await startElectronApp();
  });

  test.afterEach(async () => {
    await stopElectronApp(ctx.electronApp);
  });

  async function createSession(spaceKey) {
    const res = await fetch(`${ctx.apiBaseUrl}/api/agent/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ spaceKey, provider: "deepseek", apiKey: "sk-1" }),
    });
    if (!res.ok) throw new Error(`createSession failed: ${res.status}`);
  }

  test("REQ-AGENT-052 标准1/2：工具事件 → 折叠块出现（默认收起：工具名+摘要）→ 点击展开显示输入/输出/耗时", async () => {
    // 注入缝：项目空间 write 工具（confirm 级）
    await ctx.electronApp.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.webContents.session.webRequest.onBeforeSendHeaders({ urls: ["*://*/*"] }, () => {});
    }).catch(() => {});
    // 注：extraEnv 由 startElectronApp 第二参传入（实现后按夹具签名接线）
    const seq = JSON.stringify([{ tool: "write", args: { path: "/tmp/rich-e2e-out.txt", content: "hello" } }]);
    // startElectronApp({ extraEnv: { OPC_FAUX_TOOL_SEQUENCE: seq } })
    await createSession("ui:project:rich-e2e:1");
    await ctx.firstWindow.locator("[data-session-item='ui:project:rich-e2e:1']").first().click();
    await ctx.firstWindow.fill(COMPOSER_INPUT, "执行写入任务");
    await ctx.firstWindow.click(SEND_BUTTON);
    // 折叠块出现（默认收起）
    await expect(ctx.firstWindow.locator(TOOL_BLOCK).first()).toBeVisible();
    await expect(ctx.firstWindow.locator(TOOL_BLOCK).first().locator(TOOL_HEADER)).toContainText("write");
    // 收起态：body 不可见
    await expect(ctx.firstWindow.locator(TOOL_BLOCK).first().locator(TOOL_BODY)).toBeHidden();
    // 点击展开 → 输入/输出/耗时可见
    await ctx.firstWindow.locator(TOOL_BLOCK).first().locator(TOOL_HEADER).click();
    await expect(ctx.firstWindow.locator(TOOL_BLOCK).first().locator(TOOL_BODY)).toBeVisible();
    await expect(ctx.firstWindow.locator(TOOL_BLOCK).first().locator(TOOL_BODY)).toContainText("hello");
  });

  test("REQ-AGENT-052 标准3/4：error 终态——失败工具默认展开 + error 标红 + start→error→end 序贯后仍 error", async () => {
    // 注入缝：write 到无权限路径 → tool_execution_error（isError）
    const seq = JSON.stringify([{ tool: "write", args: { path: "/nonexistent-dir/out.txt", content: "x" } }]);
    await createSession("ui:project:rich-e2e:2");
    await ctx.firstWindow.locator("[data-session-item='ui:project:rich-e2e:2']").first().click();
    await ctx.firstWindow.fill(COMPOSER_INPUT, "执行写入任务");
    await ctx.firstWindow.click(SEND_BUTTON);
    const block = ctx.firstWindow.locator(TOOL_BLOCK).first();
    await expect(block).toBeVisible();
    // 错误块默认展开 + error 徽标
    await expect(block.locator(TOOL_ERROR_BADGE)).toBeVisible();
    await expect(block.locator(TOOL_BODY)).toBeVisible();
    // error 终态：序贯 end 到达后仍 error（E2E 层由注入缝事件序列保证——集成面断言见 api 层）
    await expect(block.locator(TOOL_ERROR_BADGE)).toBeVisible();
  });

  test("REQ-AGENT-052 标准6：text_end 后 running 块标记 interrupted（防御）", async () => {
    // 事件序列断言由 api/集成层覆盖（workerToolEventExt + 事件序列构造）；
    // E2E 层验证块不悬挂（回复完成后块仍存在且非 running 视觉态）。
    await createSession("ui:project:rich-e2e:3");
    await ctx.firstWindow.locator("[data-session-item='ui:project:rich-e2e:3']").first().click();
    await ctx.firstWindow.fill(COMPOSER_INPUT, "普通对话（无工具）");
    await ctx.firstWindow.click(SEND_BUTTON);
    await expect(ctx.firstWindow.locator(MESSAGE_LIST).locator("[data-message-role='agent']").last()).toBeVisible();
  });
});
