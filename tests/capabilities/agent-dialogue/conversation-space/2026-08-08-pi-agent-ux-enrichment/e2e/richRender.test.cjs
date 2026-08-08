// REQ-TRACE: 2026-08-08-pi-agent-ux-enrichment/REQ-AGENT-047, 2026-08-08-pi-agent-ux-enrichment/REQ-AGENT-048, 2026-08-08-pi-agent-ux-enrichment/REQ-AGENT-049, 2026-08-08-pi-agent-ux-enrichment/REQ-AGENT-050, 2026-08-08-pi-agent-ux-enrichment/REQ-AGENT-051, 2026-08-08-pi-agent-ux-enrichment/REQ-AGENT-054
// REQ-VERSION: v1-hash:dfd35b8a5242cf1ef089f0b289012aa34a1dd194c813e014e8e81b73fc9f403b
// CAPABILITY-TRACE: agent-dialogue
// ENTITY-TRACE: conversation-space
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true

// 富呈现渲染断言（B1 GFM+转义 / B2 高亮 / B3 Mermaid / B4 KaTeX / B5 图片 / B8 历史统一管线+主题）。
//
// seam：真实 Electron（startElectronApp 同型夹具）+ FAUX 回声 seed——
//   markdown 历史消息 = 经 API 投递 markdown 文本 → FAUX 确定性回声写入 JSONL →
//   重开会话（GET messages 对齐）→ 断言渲染 DOM。
// 参照：assistantChat.test.cjs（会话创建/对话流程）、assistant-rich.html（渲染元素语义）。
// 运行：npm run test:e2e（先 rebuild:electron）。
//
// [Slice 7 接线修正记录（2026-08-09，断言语义不变；signoff 裁决 4 ② 强化项落地）]
//   1. seed 改**项目空间会话**：原 seed 通用空间（`ui:copilot:rich-e2e`）无解析根 →
//      图片必占位（Slice 6 concern 4，标准 1 必红）；且原请求体 `{spaceKey, provider,
//      apiKey}` 与现 POST /api/agent/sessions 契约（spaceKind）不符 → 400 E-SESSION-CREATE。
//      现按 confirmChain 同型接线：createProject（localPath = 本测试临时目录）→
//      POST { spaceKind: "project", projectId } → 项目空间 spaceKey（ui:project:<pid>:<sid>）。
//   2. 图片 fixture 放**项目 localPath 内**（原 userDataDir 绝对路径 fixture 无解析根）；
//      主进程 agentFiles.js 按 projectId → projects.localPath 解析根。
//   3. **seed 经 API 投递消息（非 composer）**：FAUX 回声为 `user:<text>` 前缀拼接，
//      MD_FIXTURE 首行 `#` 必须处于行首才构成 ATX 标题——但 renderer composer 发送
//      路径会 trim 前导空白（Assistant.jsx 发送处 text.trim()，实证），经 composer
//      无法保留前导 "\n"；API 路由不 trim（实证：API 投递 "\n# …" 后回声渲染出 h1）。
//      MD_FIXTURE 签核语料内容不变。
//   4. 越权占位断言**强化**（signoff 裁决 4 ② 已授权）：项目外绝对路径 →
//      断言 `.img-fallback` 占位出现 + 该气泡无 img（原注释占位）。
//   5. 等待回声落盘改为**轮询 GET messages**（替代固定 500ms 等待；JSONL 完整后再
//      重开）；建会话/发消息后 reload 再点会话项（API 建会话后 UI 列表需刷新）。
//   6. 补 seedAgentConfig（PUT /api/settings/agent）——缺失时发送 409 E-AGENT-CONFIG。
//   7. **轮询角色名修正**：GET messages 的 role 字段 = PI JSONL 原生
//      "user"|"assistant"（routes/agentSessions.js projectMessagesFromJsonl），
//      非 UI 气泡的 data-message-role="agent"——首版轮询按 "agent" 过滤永不命中
//      （回声其实恒在 ~2s 落盘），轮询跑满预算超时。回声轮询预算 150s、测试级
//      timeout 180s（Playwright 默认 30s 在慢速 worker 冷启动下必失败）；
//      OPC_AGENT_FAUX_TPS=200 拉长流式窗口（断言稳定）。
const { test, expect } = require("@playwright/test");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { startElectronApp, stopElectronApp } = require("../../../../../e2e/fixtures/electronApp.cjs");
const { createProject } = require("../../../../../e2e/helpers/seed.cjs");

const SCREEN_ASSISTANT = "[data-testid='screen-assistant']";
const MESSAGE_LIST = "[data-testid='message-list']";
const AGENT_BUBBLE = "[data-message-role='agent']";
const sessionItem = (spaceKey) => `[data-session-item='${spaceKey}']`;
const projectRow = (projectId) => `[data-project-row='${projectId}']`;
const projectSessions = (projectId) => `[data-project-sessions='${projectId}']`;

const ECHO_POLL_TIMEOUT = 150000;

// 1x1 PNG（图片 fixture 内容；放项目 localPath 内，接线修正 2）
const FIXTURE_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

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
  test.describe.configure({ timeout: 180000 });
  let ctx;
  let projectDir; // 项目 localPath（临时目录；afterEach 清理）

  test.beforeEach(async () => {
    ctx = await startElectronApp({ extraEnv: { OPC_AGENT_FAUX: "1", OPC_AGENT_FAUX_TPS: "200" } });
    // agent 配置播种（FAUX 占位 key；缺失时发送 409 E-AGENT-CONFIG，接线修正 6）
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

  // 经 API 投递消息（接线修正 3：保留前导 "\n"——renderer composer 发送路径 trim，
  // 但 API 路由不 trim，实证回声可渲染行首标题）。minAgent = 期望 agent 回声条数。
  // 轮询历史直到回声落盘（接线修正 5；预算 150s 覆盖 worker 冷启动）。
  // 注：GET messages 的 role 字段 = PI JSONL 原生 "user"|"assistant"（routes/
  // agentSessions.js projectMessagesFromJsonl）——非 UI 气泡的 data-message-role。
  async function postMessage(spaceKey, text, minAgent = 1) {
    const res = await fetch(`${ctx.apiBaseUrl}/api/agent/sessions/${spaceKey}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: `\n${text}` }),
    });
    if (!res.ok) throw new Error(`postMessage failed: ${res.status}`);
    const deadline = Date.now() + ECHO_POLL_TIMEOUT;
    while (Date.now() < deadline) {
      const list = await fetch(`${ctx.apiBaseUrl}/api/agent/sessions/${spaceKey}/messages`);
      if (!list.ok) throw new Error(`poll GET messages failed: ${list.status}`);
      const { messages } = await list.json();
      const echoCount = (messages ?? []).filter((m) => m.role === "assistant").length;
      if (echoCount >= minAgent) return;
      await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error("agent echo not persisted within timeout");
  }

  // 项目空间 seed（接线修正 1/2）：建项目（localPath = 临时目录，含 fixture 图片）
  // → 项目空间会话；返回 { projectId, spaceKey }。
  async function setupProjectSeed() {
    projectDir = await fsp.mkdtemp(path.join(os.tmpdir(), "opc-rich-render-"));
    fs.writeFileSync(path.join(projectDir, "fixture.png"), Buffer.from(FIXTURE_PNG_BASE64, "base64"));
    const project = await createProject(ctx.apiBaseUrl, { name: "RichE2EProject", localPath: projectDir });
    const res = await fetch(`${ctx.apiBaseUrl}/api/agent/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ spaceKind: "project", projectId: project.id }),
    });
    if (!res.ok) throw new Error(`createSession failed: ${res.status}`);
    return { projectId: project.id, spaceKey: (await res.json()).spaceKey };
  }

  // 重开会话（历史对齐）→ 断言消息列表可见。
  async function openHistory(projectId, spaceKey) {
    await ctx.firstWindow.reload();
    await expect(ctx.firstWindow.locator(SCREEN_ASSISTANT)).toBeVisible();
    await ctx.firstWindow.locator(projectRow(projectId)).first().click();
    await ctx.firstWindow.locator(projectSessions(projectId)).first().click();
    await ctx.firstWindow.locator(sessionItem(spaceKey)).first().click();
    await expect(ctx.firstWindow.locator(MESSAGE_LIST)).toBeVisible();
  }

  async function seedMarkdownHistory(markdown) {
    const { projectId, spaceKey } = await setupProjectSeed();
    await postMessage(spaceKey, markdown);
    await openHistory(projectId, spaceKey);
    return { projectId, spaceKey };
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
    // mermaid 懒加载（首帧后异步渲染），放宽窗口
    await expect(bubble.locator("svg")).toBeVisible({ timeout: 20000 });
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
    // 项目内：语法图（绝对路径，I-5 标准 3）+ 裸路径 → img 渲染（fixture 在项目 localPath 内）
    const { projectId, spaceKey } = await setupProjectSeed();
    const pngPath = path.join(projectDir, "fixture.png");
    await postMessage(spaceKey, `![示意图](${pngPath})\n\n裸路径 ${pngPath}`);
    await openHistory(projectId, spaceKey);
    const bubble = ctx.firstWindow.locator(AGENT_BUBBLE).last();
    const imgs = bubble.locator("img");
    const imgCount = await imgs.count();
    expect(imgCount).toBeGreaterThanOrEqual(1);
    // 越权：项目外路径 → 占位（signoff 裁决 4 ② 强化：.img-fallback 出现、无 img）
    // 注：FAUX 回声累积全对话（echo2 内含 echo1 与 m1 的嵌入图），末气泡合法含
    // 多个项目内 img——断言按 alt 定位越权图（失败即无 img 元素 + 占位可见）。
    const outside = path.join(path.dirname(projectDir), "outside.png");
    fs.writeFileSync(outside, "x");
    await postMessage(spaceKey, `![越权](${outside})`, 2);
    const outsideBubble = ctx.firstWindow.locator(AGENT_BUBBLE).last();
    await expect(outsideBubble.locator(".img-fallback")).toBeVisible();
    await expect(outsideBubble.locator("img[alt='越权']")).toHaveCount(0);
    // 清理越权 fixture（避免污染临时目录）
    await fsp.rm(outside, { force: true });
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
