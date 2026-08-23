// REQ-TRACE: 2026-08-22-tool-call-review/REQ-AGENT-129, 2026-08-22-tool-call-review/REQ-AGENT-130, 2026-08-22-tool-call-review/REQ-AGENT-131, 2026-08-22-tool-call-review/REQ-AGENT-132, 2026-08-22-tool-call-review/REQ-AGENT-133, 2026-08-22-tool-call-review/REQ-AGENT-135
// REQ-VERSION: v1-hash:cd8088309c498ee02824a8f9ff74c5d454bcfe3496be20777990ce134a267fa6
// CAPABILITY-TRACE: agent-dialogue
// ENTITY-TRACE: trajectory
// EXPECTED-TRACE: prd.md §6.3 V1, L1, L2, I1, TL1, TL2, VS1, VS2, J1, ux/trajectory.html
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true

const { test, expect } = require("@playwright/test");
const fs = require("node:fs");
const path = require("node:path");
const { startElectronApp, stopElectronApp } = require("../../../../../e2e/fixtures/electronApp.cjs");

// UX 参照 locator（与 ux/trajectory.html 及 prd.md §6.3 对齐）
const TAB_TRAJECTORY = "[data-testid='trajectory-tab']";
const TAB_CONVERSATION = "[data-testid='conversation-tab']";
const VIEW_TRAJECTORY = "[data-testid='trajectory-view']";
const VIEW_MESSAGE_LIST = "[data-testid='message-list']";
const TRAJ_EMPTY_STATE = "[data-testid='traj-empty-state']";
const TRAJ_LEDGER = "[data-testid='trajectory-ledger']";
const INSPECTOR_PANEL = "[data-testid='inspector-panel']";
const TIMELINE_OVERVIEW = "[data-testid='timeline-overview']";
const TIMELINE_SEG_TTFT = "[data-timeline-segment='ttft']";
const TIMELINE_SEG_DECODE = "[data-timeline-segment='decode']";
const SUBEXEC_LINK = "[data-testid='subexec-link']";
const TRUNCATED_BADGE = "[data-testid='truncated-badge']";
const BRUSH_BANNER = "[data-testid='timeline-brush-banner']";

test.describe("会话轨迹账本 E2E 视图与交互验证（Trajectory Ledger）", () => {
  let electronApp;
  let page;
  let apiBaseUrl;
  let userDataDir;

  test.beforeEach(async () => {
    const ctx = await startElectronApp({
      extraEnv: {
        OPC_AGENT_FAUX: "1",
      },
    });
    electronApp = ctx.electronApp;
    page = ctx.firstWindow;
    apiBaseUrl = ctx.apiBaseUrl;
    userDataDir = ctx.userDataDir;
  });

  test.afterEach(async () => {
    if (electronApp) {
      await stopElectronApp(electronApp, userDataDir);
    }
  });

  async function createSession() {
    const res = await fetch(`${apiBaseUrl}/api/agent/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ spaceKind: "general" }),
    });
    expect(res.ok).toBe(true);
    const json = await res.json();
    return json.spaceKey;
  }

  async function seedSessionWithTrajectory(records = []) {
    const spaceKey = await createSession();
    const safeKey = spaceKey.replace(/[^a-zA-Z0-9_-]/g, "_");
    const sessionDir = path.join(userDataDir, "agent-sessions");
    fs.mkdirSync(sessionDir, { recursive: true });

    // 写入主会话 JSONL（提供 message-list 元素）
    const mainJsonlPath = path.join(sessionDir, `${safeKey}.jsonl`);
    const mainContent = [
      JSON.stringify({ type: "message", id: "m1", timestamp: "2026-08-23T08:00:00.000Z", message: { role: "user", content: "hello" } }),
      JSON.stringify({ type: "message", id: "m2", timestamp: "2026-08-23T08:00:02.000Z", message: { role: "assistant", content: "hi there" } }),
    ].join("\n") + "\n";
    fs.writeFileSync(mainJsonlPath, mainContent, "utf8");

    // 写入侧车轨迹文件
    const trajPath = path.join(sessionDir, `${safeKey}.traj.jsonl`);
    const content = records.map((r) => (typeof r === "string" ? r : JSON.stringify(r))).join("\n") + "\n";
    fs.writeFileSync(trajPath, content, "utf8");
    return spaceKey;
  }

  test("REQ-AGENT-129: Tab 切换与视图显隐（锚点 §6.3 V1）", async () => {
    const spaceKey = await seedSessionWithTrajectory([
      { v: 1, seq: 1, ts: "2026-08-23T08:00:01.000Z", type: "turn_boundary", turn: 1 },
      { v: 1, seq: 2, ts: "2026-08-23T08:00:02.000Z", type: "user_message", text: "hello" },
    ]);

    await page.reload();

    // 点击会话项并进入
    const sessionLocator = page.locator(`[data-session-item='${spaceKey}']`);
    await expect(sessionLocator).toBeVisible();
    await sessionLocator.click();

    // 默认展示对话消息列表
    await expect(page.locator(VIEW_MESSAGE_LIST)).toBeVisible();

    // 点击「轨迹」Tab
    await page.locator(TAB_TRAJECTORY).click();

    // 预期：轨迹视图可见，对话列表隐藏（V1 锚点）
    await expect(page.locator(VIEW_TRAJECTORY)).toBeVisible();
    await expect(page.locator(VIEW_MESSAGE_LIST)).toBeHidden();

    // 再点「对话」Tab 切回
    await page.locator(TAB_CONVERSATION).click();
    await expect(page.locator(VIEW_MESSAGE_LIST)).toBeVisible();
    await expect(page.locator(VIEW_TRAJECTORY)).toBeHidden();
  });

  test("REQ-AGENT-129: 空态卡片呈现（PRD §6.2 异常 E-TRAJ-EMPTY）", async () => {
    // 种子会话但 sidecar 为空
    const spaceKey = await seedSessionWithTrajectory([]);

    await page.reload();
    const sessionLocator = page.locator(`[data-session-item='${spaceKey}']`);
    await expect(sessionLocator).toBeVisible();
    await sessionLocator.click();

    await page.locator(TAB_TRAJECTORY).click();

    // 预期展示空态卡片
    await expect(page.locator(TRAJ_EMPTY_STATE)).toBeVisible();
    await expect(page.locator(TRAJ_EMPTY_STATE)).toContainText("没有轨迹记录");
  });

  test("REQ-AGENT-130 & REQ-AGENT-131: Ledger 行渲染、Inspector 展开与截断徽章（锚点 §6.3 L1, I1）", async () => {
    const records = [
      { v: 1, seq: 1, ts: "2026-08-23T08:00:01.000Z", type: "turn_boundary", turn: 1 },
      { v: 1, seq: 2, ts: "2026-08-23T08:00:02.000Z", type: "user_message", text: "查看项目" },
      {
        v: 1,
        seq: 3,
        ts: "2026-08-23T08:00:03.000Z",
        type: "tool_call",
        toolCallId: "tc_proj_1",
        name: "project_list",
        status: "completed",
        durationMs: 42300,
        isError: false,
        input: { limit: 10 },
        output: { projects: ["demo"] },
      },
      {
        v: 1,
        seq: 4,
        ts: "2026-08-23T08:00:45.000Z",
        type: "tool_call",
        toolCallId: "tc_trunc_1",
        name: "file_read",
        status: "completed",
        durationMs: 120,
        isError: false,
        truncated: true,
        input: { path: "huge.txt" },
        output: { content: "huge payload preview..." },
      },
      {
        v: 1,
        seq: 5,
        ts: "2026-08-23T08:00:50.000Z",
        type: "assistant_span",
        ttftMs: 800,
        decodeMs: 2000,
        usage: { input: 100, output: 50 },
      },
    ];
    const spaceKey = await seedSessionWithTrajectory(records);

    await page.reload();
    const sessionLocator = page.locator(`[data-session-item='${spaceKey}']`);
    await expect(sessionLocator).toBeVisible();
    await sessionLocator.click();

    await page.locator(TAB_TRAJECTORY).click();

    // 账本渲染各记录行
    const ledger = page.locator(TRAJ_LEDGER);
    await expect(ledger).toBeVisible();
    await expect(ledger).toContainText("project_list");

    // 点击工具记录行展开 Inspector
    const toolRow = ledger.locator("[data-record-type='tool_call']").first();
    await toolRow.click();

    // Inspector 面板可见并包含各节（I1 锚点）
    const inspector = page.locator(INSPECTOR_PANEL);
    await expect(inspector).toBeVisible();
    await expect(inspector).toContainText("project_list");
    await expect(inspector).toContainText("输入");
    await expect(inspector).toContainText("输出");
    await expect(inspector).toContainText("耗时");

    // 点击截断工具行验证截断徽章
    const truncRow = ledger.locator("[data-record-type='tool_call']").nth(1);
    await truncRow.click();
    await expect(inspector.locator(TRUNCATED_BADGE).first()).toBeVisible();

    // 再次点击同行收起 Inspector
    await truncRow.click();
    await expect(inspector).toBeHidden();
  });

  test("REQ-AGENT-132: Timeline Overview 分段渲染与选区过滤（锚点 §6.3 TL1, TL2）", async () => {
    const records = [
      { v: 1, seq: 1, ts: "2026-08-23T08:00:01.000Z", type: "turn_boundary", turn: 1 },
      { v: 1, seq: 2, ts: "2026-08-23T08:00:02.000Z", type: "user_message", text: "hi" },
      {
        v: 1,
        seq: 3,
        ts: "2026-08-23T08:00:03.000Z",
        type: "tool_call",
        toolCallId: "tc_time_1",
        name: "tool_alpha",
        status: "completed",
        durationMs: 3000,
      },
      {
        v: 1,
        seq: 4,
        ts: "2026-08-23T08:00:10.000Z",
        type: "assistant_span",
        ttftMs: 500,
        decodeMs: 1500,
        usage: { input: 20, output: 30 },
      },
    ];
    const spaceKey = await seedSessionWithTrajectory(records);

    await page.reload();
    const sessionLocator = page.locator(`[data-session-item='${spaceKey}']`);
    await expect(sessionLocator).toBeVisible();
    await sessionLocator.click();

    await page.locator(TAB_TRAJECTORY).click();

    // Timeline 条带存在，且 assistant 片段分为 ttft 与 decode 两段（TL1 锚点）
    await expect(page.locator(TIMELINE_OVERVIEW)).toBeVisible();
    await expect(page.locator(TIMELINE_SEG_TTFT)).toBeVisible();
    await expect(page.locator(TIMELINE_SEG_DECODE)).toBeVisible();

    const ledger = page.locator(TRAJ_LEDGER);
    await expect(ledger).toContainText("tool_alpha");

    // 点击 Timeline 色块触发选区过滤（TL2 锚点）
    const segment = page.locator(TIMELINE_SEG_TTFT).first();
    await segment.click();

    // 选区提示条出现
    await expect(page.locator(BRUSH_BANNER)).toBeVisible();

    // 右键空白区域清除选区
    await page.locator(TIMELINE_OVERVIEW).click({ button: "right" });
    await expect(page.locator(BRUSH_BANNER)).toBeHidden();
  });

  test("REQ-AGENT-133: 虚拟滚动长列表挂载上界约束（锚点 §6.3 VS1）", async () => {
    // 注入 500 条轨迹记录
    const records = [];
    for (let i = 1; i <= 500; i++) {
      records.push({
        v: 1,
        seq: i,
        ts: new Date(1787472000000 + i * 1000).toISOString(),
        type: "user_message",
        text: `Message index ${i}`,
      });
    }
    const spaceKey = await seedSessionWithTrajectory(records);

    await page.reload();
    const sessionLocator = page.locator(`[data-session-item='${spaceKey}']`);
    await expect(sessionLocator).toBeVisible();
    await sessionLocator.click();

    await page.locator(TAB_TRAJECTORY).click();

    // 检查实际挂载的行节点数量不超过 50 个（VS1 锚点：只挂载可见窗 + overscan）
    const mountedRowsCount = await page.locator(`${TRAJ_LEDGER} [data-record-seq]`).count();
    expect(mountedRowsCount).toBeLessThanOrEqual(50);
  });

  test("REQ-AGENT-135: 子执行跳转入口与导航（锚点 §6.3 J1）", async () => {
    const records = [
      { v: 1, seq: 1, ts: "2026-08-23T08:00:01.000Z", type: "turn_boundary", turn: 1 },
      {
        v: 1,
        seq: 2,
        ts: "2026-08-23T08:00:02.000Z",
        type: "tool_call",
        toolCallId: "tc_task_01",
        name: "task run",
        status: "completed",
        durationMs: 1500,
        output: { executionId: "ex_2041", status: "success" },
      },
    ];
    const spaceKey = await seedSessionWithTrajectory(records);

    await page.reload();
    const sessionLocator = page.locator(`[data-session-item='${spaceKey}']`);
    await expect(sessionLocator).toBeVisible();
    await sessionLocator.click();

    await page.locator(TAB_TRAJECTORY).click();

    // 展开 inspector 或在行内查看跳转链接
    const toolRow = page.locator(TRAJ_LEDGER).locator("[data-record-type='tool_call']").first();
    await toolRow.click();

    const subexecLink = page.locator(SUBEXEC_LINK);
    await expect(subexecLink).toBeVisible();
    await expect(subexecLink).toContainText("ex_2041");

    // 点击跳转
    await subexecLink.click();
    await expect(page).toHaveURL(/.*\/executions\?highlight=ex_2041/);
  });
});

