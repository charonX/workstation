// REQ-TRACE: 2026-08-22-tool-call-review/REQ-AGENT-129, 2026-08-22-tool-call-review/REQ-AGENT-130, 2026-08-22-tool-call-review/REQ-AGENT-131, 2026-08-22-tool-call-review/REQ-AGENT-132, 2026-08-22-tool-call-review/REQ-AGENT-133, 2026-08-22-tool-call-review/REQ-AGENT-135
// REQ-VERSION: v1-hash:cd8088309c498ee02824a8f9ff74c5d454bcfe3496be20777990ce134a267fa6
// CAPABILITY-TRACE: agent-dialogue
// ENTITY-TRACE: trajectory
// EXPECTED-TRACE: prd.md §6.3 V1, L1, L2, I1, TL1, TL2, VS1, VS2, J1, ux/trajectory.html
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true

const { test, expect } = require("@playwright/test");
const fsp = require("node:fs/promises");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { startElectronApp, stopElectronApp } = require("../../../../../e2e/fixtures/electronApp.cjs");

// UX 参照 locator（与 ux/trajectory.html 及 prd.md §6.3 对齐）
const TAB_TRAJECTORY = "[data-testid='trajectory-tab']";
const VIEW_TRAJECTORY = "[data-testid='trajectory-view']";
const VIEW_MESSAGE_LIST = "[data-testid='message-list']";
const TRAJ_EMPTY_STATE = "[data-testid='traj-empty-state']";
const TRAJ_LEDGER = "[data-testid='trajectory-ledger']";
const INSPECTOR_PANEL = "[data-testid='inspector-panel']";
const TIMELINE_OVERVIEW = "[data-testid='timeline-overview']";
const TIMELINE_SEG_TTFT = "[data-timeline-segment='ttft']";
const TIMELINE_SEG_DECODE = "[data-timeline-segment='decode']";
const SUBEXEC_LINK = "[data-testid='subexec-link']";

test.describe("会话轨迹账本 E2E 视图与交互验证（Trajectory Ledger）", () => {
  let appCtx;
  let workdir;
  let sessionDir;

  test.beforeEach(async () => {
    workdir = fs.mkdtempSync(path.join(os.tmpdir(), "traj-e2e-"));
    sessionDir = path.join(workdir, "agent-sessions");
    fs.mkdirSync(sessionDir, { recursive: true });

    // 启动 Electron App 并传入测试配置目录
    appCtx = await startElectronApp({
      extraEnv: {
        OPC_WORKSTATION_CONFIG_DIR: workdir,
      },
    });
  });

  test.afterEach(async () => {
    if (appCtx) {
      await stopElectronApp(appCtx);
    }
    fs.rmSync(workdir, { recursive: true, force: true });
  });

  async function seedSessionWithTrajectory(safeKey, spaceKey, records = []) {
    const sessionRef = path.join(sessionDir, `${safeKey}.jsonl`);
    fs.writeFileSync(sessionRef, "", "utf8");

    const trajPath = path.join(sessionDir, `${safeKey}.traj.jsonl`);
    const content = records.map((r) => (typeof r === "string" ? r : JSON.stringify(r))).join("\n") + "\n";
    fs.writeFileSync(trajPath, content, "utf8");

    // 播种数据库记录
    const dbPath = path.join(workdir, "agent-sessions.db");
    const Database = require("better-sqlite3");
    const db = new Database(dbPath);
    db.prepare(`
      INSERT OR REPLACE INTO agent_sessions (spaceKey, sessionRef, createdAt, lastActiveAt, title)
      VALUES (?, ?, ?, ?, ?)
    `).run(spaceKey, sessionRef, "2026-08-23T08:00:00.000Z", "2026-08-23T08:30:00.000Z", "E2E 轨迹测试会话");
    db.close();
  }

  test("REQ-AGENT-129: Tab 切换与视图显隐（锚点 §6.3 V1）", async () => {
    const spaceKey = "ui:copilot:e2e_tab_01";
    const safeKey = "ui_copilot_e2e_tab_01";
    seedSessionWithTrajectory(safeKey, spaceKey, [
      { v: 1, seq: 1, ts: "2026-08-23T08:00:01.000Z", type: "turn_boundary", turn: 1 },
      { v: 1, seq: 2, ts: "2026-08-23T08:00:02.000Z", type: "user_message", text: "hello" },
    ]);

    const page = appCtx.page;
    await page.reload();

    // 点击会话项并进入
    const sessionLocator = page.locator(`[data-session-item='${spaceKey}']`);
    if (await sessionLocator.count() > 0) {
      await sessionLocator.click();
    }

    // 默认展示对话消息列表
    await expect(page.locator(VIEW_MESSAGE_LIST)).toBeVisible();

    // 点击「轨迹」Tab
    await page.locator(TAB_TRAJECTORY).click();

    // 预期：轨迹视图可见，对话列表隐藏（V1 锚点）
    await expect(page.locator(VIEW_TRAJECTORY)).toBeVisible();
    await expect(page.locator(VIEW_MESSAGE_LIST)).toBeHidden();
  });

  test("REQ-AGENT-129: 空态卡片呈现（PRD §6.2 异常 E-TRAJ-EMPTY）", async () => {
    const spaceKey = "ui:copilot:e2e_empty_02";
    const safeKey = "ui_copilot_e2e_empty_02";
    // 种子会话但 sidecar 为空
    seedSessionWithTrajectory(safeKey, spaceKey, []);

    const page = appCtx.page;
    await page.reload();
    const sessionLocator = page.locator(`[data-session-item='${spaceKey}']`);
    if (await sessionLocator.count() > 0) {
      await sessionLocator.click();
    }

    await page.locator(TAB_TRAJECTORY).click();

    // 预期展示空态卡片
    await expect(page.locator(TRAJ_EMPTY_STATE)).toBeVisible();
    await expect(page.locator(TRAJ_EMPTY_STATE)).toContainText("没有轨迹记录");
  });

  test("REQ-AGENT-130 & REQ-AGENT-131: Ledger 行渲染与 Inspector 展开（锚点 §6.3 L1, I1）", async () => {
    const spaceKey = "ui:copilot:e2e_ledger_03";
    const safeKey = "ui_copilot_e2e_ledger_03";
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
        type: "assistant_span",
        ttftMs: 800,
        decodeMs: 2000,
        usage: { input: 100, output: 50 },
      },
    ];
    seedSessionWithTrajectory(safeKey, spaceKey, records);

    const page = appCtx.page;
    await page.reload();
    const sessionLocator = page.locator(`[data-session-item='${spaceKey}']`);
    if (await sessionLocator.count() > 0) {
      await sessionLocator.click();
    }

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

    // 再次点击同一行收起 Inspector
    await toolRow.click();
    await expect(inspector).toBeHidden();
  });

  test("REQ-AGENT-132: Timeline Overview 分段渲染与 TTFT/decode 拆分（锚点 §6.3 TL1）", async () => {
    const spaceKey = "ui:copilot:e2e_timeline_04";
    const safeKey = "ui_copilot_e2e_timeline_04";
    const records = [
      { v: 1, seq: 1, ts: "2026-08-23T08:00:01.000Z", type: "turn_boundary", turn: 1 },
      { v: 1, seq: 2, ts: "2026-08-23T08:00:02.000Z", type: "user_message", text: "hi" },
      {
        v: 1,
        seq: 3,
        ts: "2026-08-23T08:00:03.000Z",
        type: "assistant_span",
        ttftMs: 500,
        decodeMs: 1500,
        usage: { input: 20, output: 30 },
      },
    ];
    seedSessionWithTrajectory(safeKey, spaceKey, records);

    const page = appCtx.page;
    await page.reload();
    const sessionLocator = page.locator(`[data-session-item='${spaceKey}']`);
    if (await sessionLocator.count() > 0) {
      await sessionLocator.click();
    }

    await page.locator(TAB_TRAJECTORY).click();

    // Timeline 条带存在，且 assistant 片段分为 ttft 与 decode 两段（TL1 锚点）
    await expect(page.locator(TIMELINE_OVERVIEW)).toBeVisible();
    await expect(page.locator(TIMELINE_SEG_TTFT)).toBeVisible();
    await expect(page.locator(TIMELINE_SEG_DECODE)).toBeVisible();
  });

  test("REQ-AGENT-133: 虚拟滚动长列表挂载上界约束（锚点 §6.3 VS1）", async () => {
    const spaceKey = "ui:copilot:e2e_vscroll_05";
    const safeKey = "ui_copilot_e2e_vscroll_05";

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
    seedSessionWithTrajectory(safeKey, spaceKey, records);

    const page = appCtx.page;
    await page.reload();
    const sessionLocator = page.locator(`[data-session-item='${spaceKey}']`);
    if (await sessionLocator.count() > 0) {
      await sessionLocator.click();
    }

    await page.locator(TAB_TRAJECTORY).click();

    // 检查实际挂载的行节点数量不超过 50 个（VS1 锚点：只挂载可见窗 + overscan）
    const mountedRowsCount = await page.locator(`${TRAJ_LEDGER} [data-record-seq]`).count();
    expect(mountedRowsCount).toBeLessThanOrEqual(50);
  });

  test("REQ-AGENT-135: 子执行跳转入口与导航（锚点 §6.3 J1）", async () => {
    const spaceKey = "ui:copilot:e2e_subexec_06";
    const safeKey = "ui_copilot_e2e_subexec_06";
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
    seedSessionWithTrajectory(safeKey, spaceKey, records);

    const page = appCtx.page;
    await page.reload();
    const sessionLocator = page.locator(`[data-session-item='${spaceKey}']`);
    if (await sessionLocator.count() > 0) {
      await sessionLocator.click();
    }

    await page.locator(TAB_TRAJECTORY).click();

    // 展开 inspector 或在行内查看跳转链接
    const toolRow = page.locator(TRAJ_LEDGER).locator("[data-record-type='tool_call']").first();
    await toolRow.click();

    const subexecLink = page.locator(SUBEXEC_LINK);
    await expect(subexecLink).toBeVisible();
    await expect(subexecLink).toContainText("ex_2041");

    // 点击跳转
    await subexecLink.click();
    await expect(page).toHaveURL(/.*\/executions\/ex_2041/);
  });
});
