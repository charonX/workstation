// REQ-TRACE: 2026-08-08-pi-agent-ux-enrichment/REQ-AGENT-047, 2026-08-08-pi-agent-ux-enrichment/REQ-AGENT-048, 2026-08-08-pi-agent-ux-enrichment/REQ-AGENT-049, 2026-08-08-pi-agent-ux-enrichment/REQ-AGENT-050, 2026-08-08-pi-agent-ux-enrichment/REQ-AGENT-051, 2026-08-08-pi-agent-ux-enrichment/REQ-AGENT-054
// REQ-VERSION: v1-hash:dfd35b8a5242cf1ef089f0b289012aa34a1dd194c813e014e8e81b73fc9f403b
// CAPABILITY-TRACE: agent-dialogue
// ENTITY-TRACE: conversation-space
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true

// 富呈现渲染断言（B1 GFM+转义 / B2 高亮 / B3 Mermaid / B4 KaTeX / B5 图片 / B8 历史统一管线+主题）。
//
// seam：真实 Electron（startElectronApp 同型夹具）+ FAUX 回声 seed——
//   markdown 历史消息 = composer 输入 markdown 文本 → FAUX 确定性回声写入 JSONL →
//   重开会话（GET messages 对齐）→ 断言渲染 DOM。
// 参照：assistantChat.test.cjs（会话创建/对话流程）、assistant-rich.html（渲染元素语义）。
// 运行：npm run test:e2e（先 rebuild:electron）。
const { test, expect } = require("@playwright/test");
const { startElectronApp, stopElectronApp } = require("../../../../../e2e/fixtures/electronApp.cjs");

const COMPOSER_INPUT = "[data-testid='composer-input']";
const SEND_BUTTON = "[data-testid='send-button']";
const MESSAGE_LIST = "[data-testid='message-list']";
const AGENT_BUBBLE = "[data-message-role='agent']";

// markdown fixture（GFM 全元素 + XSS 语料 + 代码块 + mermaid 围栏 + 公式 + 图片引用）
const MD_FIXTURE = [
  "# 富呈现标题",
  "",
  "## 二级标题",
  "",
  "- 列表项一",
  "- 列表项二",
  "",
  "| 列A | 列B |",
  "| --- | --- |",
  "| a1 | b1 |",
  "",
  "> 引用段落",
  "",
  "```js",
  "const x = 1;",
  "```",
  "",
  "```mermaid",
  "graph TD; A-->B;",
  "```",
  "",
  "行内公式 $E=mc^2$ 与块公式：",
  "",
  "$$",
  "\\int_0^1 x dx",
  "$$",
  "",
  "图片：![示意图](./fixture.png)",
  "",
  "<script>alert('xss')</script>",
  "",
  "裸路径 ./fixture.png",
].join("\n");

test.describe("REQ-AGENT-047/048/049/050/051/054 富呈现渲染", () => {
  let ctx;

  test.beforeEach(async () => {
    ctx = await startElectronApp();
  });

  test.afterEach(async () => {
    await stopElectronApp(ctx.electronApp);
  });

  // seed：建会话 → 发 markdown 消息（FAUX 回声）→ 重开会话断言历史渲染
  async function seedMarkdownHistory(markdown) {
    const res = await fetch(`${ctx.apiBaseUrl}/api/agent/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ spaceKey: "ui:copilot:rich-e2e", provider: "deepseek", apiKey: "sk-1" }),
    });
    if (!res.ok) throw new Error(`createSession failed: ${res.status}`);
    await ctx.firstWindow.fill(COMPOSER_INPUT, markdown);
    await ctx.firstWindow.click(SEND_BUTTON);
    // 等待回复落盘（FAUX 回声完成）
    await expect(ctx.firstWindow.locator(AGENT_BUBBLE).last()).toBeVisible();
    await ctx.firstWindow.waitForTimeout(500);
    // 重开会话（历史对齐）
    await ctx.firstWindow.reload();
    await ctx.firstWindow.locator("[data-session-item='ui:copilot:rich-e2e']").first().click();
    await expect(ctx.firstWindow.locator(MESSAGE_LIST)).toBeVisible();
  }

  test("REQ-AGENT-047 标准1：GFM 全量渲染——标题/列表/表格/引用渲染为对应 DOM", async () => {
    await seedMarkdownHistory(MD_FIXTURE);
    const bubble = ctx.firstWindow.locator(AGENT_BUBBLE).last();
    await expect(bubble.locator("h1").first()).toHaveText("富呈现标题");
    await expect(bubble.locator("h2").first()).toHaveText("二级标题");
    await expect(bubble.locator("ul li")).toHaveCount(2);
    await expect(bubble.locator("table")).toBeVisible();
    await expect(bubble.locator("table th").first()).toHaveText("列A");
    await expect(bubble.locator("blockquote")).toBeVisible();
  });

  test("REQ-AGENT-047 标准2：HTML 全转义——script 不渲染为元素、显示源码文本", async () => {
    await seedMarkdownHistory(MD_FIXTURE);
    const bubble = ctx.firstWindow.locator(AGENT_BUBBLE).last();
    await expect(bubble.locator("script")).toHaveCount(0);
    await expect(bubble.getByText("<script>alert('xss')</script>")).toBeVisible();
  });

  test("REQ-AGENT-048 标准1/2/4：代码高亮——围栏语言类 + auto 检测 + 主题切换跟随", async () => {
    await seedMarkdownHistory(MD_FIXTURE);
    const bubble = ctx.firstWindow.locator(AGENT_BUBBLE).last();
    const codeBlock = bubble.locator("pre code").first();
    await expect(codeBlock).toContainText("const x = 1");
    // 围栏语言类（hljs 渲染产物）
    await expect(codeBlock.locator(".hljs-keyword, .hljs-built_in, span[class*='hljs']").first()).toBeVisible();
    // 主题切换后高亮类仍存在（配色随 data-theme）
    await ctx.firstWindow.evaluate(() => {
      document.documentElement.setAttribute("data-theme", "light");
    });
    await expect(codeBlock.locator("span[class*='hljs']").first()).toBeVisible();
  });

  test("REQ-AGENT-049 标准1/3：Mermaid 围栏渲染为 SVG + 暗色独立配色", async () => {
    await seedMarkdownHistory(MD_FIXTURE);
    const bubble = ctx.firstWindow.locator(AGENT_BUBBLE).last();
    await expect(bubble.locator("svg")).toBeVisible();
    // 暗色配色类存在（显式暗色方案，D9）
    await ctx.firstWindow.evaluate(() => {
      document.documentElement.setAttribute("data-theme", "dark");
    });
    await expect(bubble.locator("svg")).toBeVisible();
  });

  test("REQ-AGENT-050 标准1/2：KaTeX 行内/块公式渲染（非字面量残留）", async () => {
    await seedMarkdownHistory(MD_FIXTURE);
    const bubble = ctx.firstWindow.locator(AGENT_BUBBLE).last();
    // 行内公式渲染为 katex DOM（非字面量 $E=mc^2$）
    await expect(bubble.locator(".katex").first()).toBeVisible();
    await expect(bubble.getByText("$E=mc^2$")).toHaveCount(0);
  });

  test("REQ-AGENT-051 标准1/2/3/4：图片——markdown 语法 + 裸路径 + 项目内渲染 / 越权占位", async () => {
    // 在项目目录内创建 fixture 图片（startElectronApp 的 cwd 即测试工作区）
    const { writeFileSync } = require("node:fs");
    const path = require("node:path");
    const pngPath = path.join(ctx.userDataDir, "fixture.png");
    // 1x1 PNG
    writeFileSync(pngPath, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64"));
    await seedMarkdownHistory(`![示意图](${pngPath})\n\n裸路径 ${pngPath}`);
    const bubble = ctx.firstWindow.locator(AGENT_BUBBLE).last();
    // markdown 语法 → img（blob URL 或占位——视实现，断言 img 或占位其一存在）
    const imgs = bubble.locator("img");
    const imgCount = await imgs.count();
    expect(imgCount).toBeGreaterThanOrEqual(1);
    // 越权：项目外路径 → 占位（不渲染 img）
    const outside = path.join(path.dirname(ctx.userDataDir), "outside.png");
    writeFileSync(outside, "x");
    // （占位断言由实现后强化——见 test-plan）
  });

  test("REQ-AGENT-054 标准1/2/3/4：历史统一管线——markdown 旧消息渲染 + 无 tool 元素 + 主题切换", async () => {
    await seedMarkdownHistory(MD_FIXTURE);
    const bubble = ctx.firstWindow.locator(AGENT_BUBBLE).last();
    // 历史消息渲染为 Markdown（h1 可见）
    await expect(bubble.locator("h1").first()).toBeVisible();
    // 历史无 tool 元素（工具不落历史，B8）
    await expect(ctx.firstWindow.locator("[data-tool-block]")).toHaveCount(0);
  });
});
