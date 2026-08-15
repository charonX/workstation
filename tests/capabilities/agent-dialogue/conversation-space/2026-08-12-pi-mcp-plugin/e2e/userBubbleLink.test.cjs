// REQ-TRACE: 2026-08-08-pi-agent-ux-enrichment/REQ-AGENT-047
// REQ-VERSION: v2-hash:8636a9744f9f1bf33cc0c1163dd1d7f53852e22445f0e8dc55c84f4059bb4266
// CAPABILITY-TRACE: agent-dialogue
// ENTITY-TRACE: conversation-space
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: false (BUG-010 回归：断言 = 链接计算色 ≠ 气泡底色 ∧ = 气泡文字色，人拍板方向 A 2026-08-15)

// BUG-010 回归（code-defect，人确认；归属裁决：留在 2026-08-12-pi-mcp-plugin 处理，
// REQ 属主为 ux-enrichment）：
//   用户消息走 MarkdownRenderer（MessageList 渲染分流），全局 .assistant-zone .md a
//   链接色 = var(--ch-accent)，与用户气泡底色 var(--ch-accent)（assistant.html 参照）
//   同色 → 链接在实色用户气泡中隐身（用户实证截图：链接与背景同色显示不出来）。
//   两份已批准参照均未覆盖「实色用户气泡内链接」组合场景（assistant-rich.html 用户
//   气泡为 accent-soft 浅底且无链接示例）。修复方向 A（人拍板）：用户气泡内链接
//   color: inherit（继承气泡文字色 accent-text），保留下划线。
//
// seam：真实 Electron + FAUX（richRender.test.cjs 同型）——API 投递含 markdown 链接的
//   用户消息 → 重开会话 → 断言用户气泡内 <a> 计算色。
// 断言语义：计算样式对比（链接色 vs 气泡底色/文字色），不验像素、不锁具体色值（主题无关）。

const { test, expect } = require("@playwright/test");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { startElectronApp, stopElectronApp } = require("../../../../../e2e/fixtures/electronApp.cjs");
const { createProject } = require("../../../../../e2e/helpers/seed.cjs");

const SCREEN_ASSISTANT = "[data-testid='screen-assistant']";
const MESSAGE_LIST = "[data-testid='message-list']";
// data-message-role 在 .bubble 元素本身（MessageList.jsx），非祖先容器。
const USER_BUBBLE = ".bubble[data-message-role='user']";
const sessionItem = (spaceKey) => `[data-session-item='${spaceKey}']`;
const projectRow = (projectId) => `[data-project-row='${projectId}']`;
const projectSessions = (projectId) => `[data-project-sessions='${projectId}']`;

const PERSIST_POLL_TIMEOUT = 30000;

test.describe("BUG-010 用户气泡内链接可见性（E2E）", () => {
  test.describe.configure({ timeout: 120000 });
  let ctx;
  let projectDir;

  test.beforeEach(async () => {
    ctx = await startElectronApp({ extraEnv: { OPC_AGENT_FAUX: "1", OPC_AGENT_FAUX_TPS: "200" } });
    // agent 配置播种（缺失时发送 409 E-AGENT-CONFIG，richRender 接线修正 6 先例）
    const res = await fetch(`${ctx.apiBaseUrl}/api/settings/agent`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "deepseek", apiKey: "sk-e2e-faux-placeholder", identity: "" }),
    });
    expect(res.ok).toBe(true);
  });

  test.afterEach(async () => {
    await stopElectronApp(ctx.electronApp, ctx.userDataDir);
    if (projectDir) {
      await fsp.rm(projectDir, { recursive: true, force: true });
      projectDir = null;
    }
  });

  test("用户消息含 markdown 链接 → 链接色 ≠ 气泡底色（不隐身）且 = 气泡文字色（方向 A）", async () => {
    // 项目空间会话 seed（richRender 同型接线）
    projectDir = await fsp.mkdtemp(path.join(os.tmpdir(), "opc-bug010-"));
    const project = await createProject(ctx.apiBaseUrl, { name: "Bug010Project", localPath: projectDir });
    const sessRes = await fetch(`${ctx.apiBaseUrl}/api/agent/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ spaceKind: "project", projectId: project.id }),
    });
    if (!sessRes.ok) throw new Error(`createSession failed: ${sessRes.status}`);
    const spaceKey = (await sessRes.json()).spaceKey;

    // 投递含 markdown 链接的用户消息；轮询到用户消息落盘即可（不等 agent 回声）
    const postRes = await fetch(`${ctx.apiBaseUrl}/api/agent/sessions/${spaceKey}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "帮我把这个网页 [示例页面](https://example.com/page) 转成markdown" }),
    });
    if (!postRes.ok) throw new Error(`postMessage failed: ${postRes.status}`);
    const deadline = Date.now() + PERSIST_POLL_TIMEOUT;
    for (;;) {
      const list = await fetch(`${ctx.apiBaseUrl}/api/agent/sessions/${spaceKey}/messages`);
      if (!list.ok) throw new Error(`poll GET messages failed: ${list.status}`);
      const { messages } = await list.json();
      if ((messages ?? []).some((m) => m.role === "user")) break;
      if (Date.now() > deadline) throw new Error("user message not persisted within timeout");
      await new Promise((r) => setTimeout(r, 250));
    }

    // 重开会话（历史对齐渲染管线，richRender openHistory 同型）
    await ctx.firstWindow.reload();
    await expect(ctx.firstWindow.locator(SCREEN_ASSISTANT)).toBeVisible();
    await ctx.firstWindow.locator(projectRow(project.id)).first().click();
    await ctx.firstWindow.locator(projectSessions(project.id)).first().click();
    await ctx.firstWindow.locator(sessionItem(spaceKey)).first().click();
    await expect(ctx.firstWindow.locator(MESSAGE_LIST)).toBeVisible();

    const bubble = ctx.firstWindow.locator(USER_BUBBLE).last();
    const link = bubble.locator(".md a").first();
    await expect(link).toBeVisible();

    const colors = await link.evaluate((el) => {
      const bubbleEl = el.closest(".bubble");
      const linkCs = getComputedStyle(el);
      const bubbleCs = getComputedStyle(bubbleEl);
      return {
        link: linkCs.color,
        bubbleBg: bubbleCs.backgroundColor,
        bubbleText: bubbleCs.color,
      };
    });
    // 缺陷态：链接色 = accent = 气泡底色（同色隐身）
    expect(colors.link).not.toBe(colors.bubbleBg);
    // 修复方向 A：链接继承气泡文字色（accent-text）
    expect(colors.link).toBe(colors.bubbleText);
  });
});
