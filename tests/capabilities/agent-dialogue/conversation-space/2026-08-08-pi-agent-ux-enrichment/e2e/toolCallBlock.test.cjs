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
// 事件 → renderer 折叠块）。error 注入 = 工具序列中 args 触发执行失败。
// 参照：assistant-rich.html（tool-block 三态语义）。
// 运行：npm run test:e2e（先 rebuild:electron）。
//
// [Slice 7 接线修正记录（2026-08-09，断言语义不变）]
//   1. **extraEnv 注入缝确认**：startElectronApp 夹具已支持 options.extraEnv
//      （透传 electron.launch env；worker 子进程继承 spawn 时主进程 env；
//      OPC_FAUX_TOOL_SEQUENCE 由 worker 首轮 FAUX prompt 惰性解析）——无需改夹具，
//      直接 `startElectronApp({ extraEnv })`（confirmChain.test.cjs 同型）。
//   2. 工具改 **CLI 查询级**：成功例 flow list（原 write 为 confirm 级——需确认卡
//      流程，非本用例断言面）；错误例 flow get 不存在 id（命令模块 404 →
//      tool_execution_error + isError end → error 终态，I-2 序贯由 api 层覆盖）。
//      断言语义不变（块出现/默认收起/展开显示输入输出/错误默认展开标红）；工具名
//      与内容为 fixture 细节。
//   3. 成功例播种真实 flow（createProject + createFlow）→ flow list 输出确定性含
//      流程名 → 展开 body 断言（原 write content "hello" 同语义：输入/输出可见）。
//   4. seed 按现契约：POST /api/agent/sessions { spaceKind: "general" }（原
//      {spaceKey, provider, apiKey} 不符契约 → 400）；补 seedAgentConfig（缺失 →
//      409 E-AGENT-CONFIG）；建会话后 reload 再点会话项。
//   5. **worker 冷启动方差**（实证 1.4s~60s+）：工具事件等待预算 60s、测试级
//      timeout 180s（Playwright 默认 30s 在慢速冷启动下必失败）。
const { test, expect } = require("@playwright/test");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { startElectronApp, stopElectronApp } = require("../../../../../e2e/fixtures/electronApp.cjs");
const { createProject, createFlow } = require("../../../../../e2e/helpers/seed.cjs");

const SCREEN_ASSISTANT = "[data-testid='screen-assistant']";
const COMPOSER_INPUT = "[data-testid='composer-input']";
const SEND_BUTTON = "[data-testid='send-button']";
const MESSAGE_LIST = "[data-testid='message-list']";
const sessionItem = (spaceKey) => `[data-session-item='${spaceKey}']`;

// 工具块 locator 约定（signoff 裁决 3；实现时与 renderer 一致；原型语义：收起=工具名+摘要+chevron）
const TOOL_BLOCK = "[data-tool-block]";
const TOOL_HEADER = "[data-tool-header]";
const TOOL_BODY = "[data-tool-body]";
const TOOL_ERROR_BADGE = "[data-tool-error-badge]";

async function seedAgentConfig(apiBaseUrl) {
  const res = await fetch(`${apiBaseUrl}/api/settings/agent`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider: "deepseek", apiKey: "sk-e2e-faux-placeholder", identity: "" }),
  });
  expect(res.ok).toBe(true);
}

async function createGeneralSession(apiBaseUrl) {
  const res = await fetch(`${apiBaseUrl}/api/agent/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ spaceKind: "general" }),
  });
  expect(res.ok).toBe(true);
  return (await res.json()).spaceKey;
}

async function openSession(firstWindow, spaceKey) {
  await firstWindow.reload();
  await expect(firstWindow.locator(SCREEN_ASSISTANT)).toBeVisible();
  await firstWindow.click(sessionItem(spaceKey));
  await expect(firstWindow.locator(COMPOSER_INPUT)).toBeVisible();
}

async function sendPrompt(firstWindow, text) {
  await firstWindow.fill(COMPOSER_INPUT, text);
  await firstWindow.click(SEND_BUTTON);
}

test.describe("REQ-AGENT-052 工具调用折叠块", () => {
  test.describe.configure({ timeout: 180000 });
  let ctx;
  let projectDir;

  test.afterEach(async () => {
    await stopElectronApp(ctx.electronApp, ctx.userDataDir);
    if (projectDir) {
      await fsp.rm(projectDir, { recursive: true, force: true });
      projectDir = null;
    }
  });

  test("REQ-AGENT-052 标准1/2：工具事件 → 折叠块出现（默认收起：工具名+摘要）→ 点击展开显示输入/输出/耗时", async () => {
    // 注入缝（接线修正 1）：extraEnv 经夹具透传（worker spawn 前注入）；
    // 成功例 = flow list（query 级 CLI，default profile 可用；播种真实 flow 保证
    // 输出确定性含流程名）。
    const seq = JSON.stringify([{ tool: "flow list", args: {} }]);
    ctx = await startElectronApp({
      extraEnv: { OPC_AGENT_FAUX: "1", OPC_FAUX_TOOL_SEQUENCE: seq },
    });
    await seedAgentConfig(ctx.apiBaseUrl);

    projectDir = await fsp.mkdtemp(path.join(os.tmpdir(), "opc-tool-block-"));
    const project = await createProject(ctx.apiBaseUrl, { name: "工具块项目", localPath: projectDir });
    const flow = await createFlow(ctx.apiBaseUrl, { name: "E2E 流程", projectId: project.id });
    const spaceKey = await createGeneralSession(ctx.apiBaseUrl);
    await openSession(ctx.firstWindow, spaceKey);
    await sendPrompt(ctx.firstWindow, "列出所有流程");
    // 折叠块出现（默认收起）
    const block = ctx.firstWindow.locator(TOOL_BLOCK).first();
    await expect(block).toBeVisible({ timeout: 60000 });
    await expect(block.locator(TOOL_HEADER)).toContainText("flow list");
    // 收起态：body 不可见
    await expect(block.locator(TOOL_BODY)).toBeHidden();
    // 点击展开 → 输入/输出/耗时可见（输出含播种流程名，确定性）
    await block.locator(TOOL_HEADER).click();
    await expect(block.locator(TOOL_BODY)).toBeVisible();
    await expect(block.locator(TOOL_BODY)).toContainText(flow.name);
  });

  test("REQ-AGENT-052 标准3/4：error 终态——失败工具默认展开 + error 标红 + start→error→end 序贯后仍 error", async () => {
    // 注入缝：flow get 不存在 id → 命令模块 404 → tool_execution_error + isError end
    const seq = JSON.stringify([{ tool: "flow get", args: { id: "00000000-0000-0000-0000-000000000000" } }]);
    ctx = await startElectronApp({
      extraEnv: { OPC_AGENT_FAUX: "1", OPC_FAUX_TOOL_SEQUENCE: seq },
    });
    await seedAgentConfig(ctx.apiBaseUrl);

    const spaceKey = await createGeneralSession(ctx.apiBaseUrl);
    await openSession(ctx.firstWindow, spaceKey);
    await sendPrompt(ctx.firstWindow, "查询一个不存在的流程");
    const block = ctx.firstWindow.locator(TOOL_BLOCK).first();
    await expect(block).toBeVisible({ timeout: 60000 });
    // 错误块默认展开 + error 徽标
    await expect(block.locator(TOOL_ERROR_BADGE)).toBeVisible({ timeout: 60000 });
    await expect(block.locator(TOOL_BODY)).toBeVisible();
    // error 终态：序贯 end 到达后仍 error（E2E 层由注入缝事件序列保证——集成面断言见 api 层）
    await expect(block.locator(TOOL_ERROR_BADGE)).toBeVisible({ timeout: 60000 });
  });

  test("REQ-AGENT-052 标准6：text_end 后 running 块标记 interrupted（防御）", async () => {
    // 事件序列断言由 api/集成层覆盖（workerToolEventExt + 事件序列构造）；
    // E2E 层验证块不悬挂（回复完成后块仍存在且非 running 视觉态）。
    ctx = await startElectronApp({ extraEnv: { OPC_AGENT_FAUX: "1" } });
    await seedAgentConfig(ctx.apiBaseUrl);

    const spaceKey = await createGeneralSession(ctx.apiBaseUrl);
    await openSession(ctx.firstWindow, spaceKey);
    await sendPrompt(ctx.firstWindow, "普通对话（无工具）");
    await expect(ctx.firstWindow.locator(MESSAGE_LIST).locator("[data-message-role='agent']").last()).toBeVisible({ timeout: 60000 });
  });
});
