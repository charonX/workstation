// REQ-TRACE: 2026-07-19-media-production-line/REQ-COLL-001
// REQ-VERSION: v1-hash:de43bc8607a89efe5512712a188a5f24f259d8109cb31a7a476827dd0883fab9
// CAPABILITY-TRACE: collection-pipeline
// ENTITY-TRACE: collection
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { startServer, stopServer } from "../../../../../../src/http/server.js";
import { makeTmpProjectDir, readFileIfExists } from "../../../../../fixtures/media-production-line/tmpProjectDir.js";
import { createFileWritingAgentExecutor, createFailingAgentExecutor } from "../../../../../fixtures/media-production-line/mockAgent.js";
import { createMockChannelAdapter } from "../../../../../fixtures/media-production-line/mockChannelAdapter.js";

const EVERY_SECOND = "* * * * * *";
const TOPIC = "AI 科技动态";

// 说明：mock agent 负责「按契约」写日报文件（frontmatter 由 topic-daily-digest skill 在 BUILD 落地，
// 此处 mock 按同一契约写文件，验证 触发→队列→执行→落盘→登记→投递→通知 的端到端接线）。

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

async function loadSeams(t) {
  const scheduler = await import("../../../../../../src/services/schedulerService.js").catch(() => null);
  assert.ok(scheduler?.loadAll, "seam 未就绪：schedulerService（REQ-COLL-001 触发源）");
  const taskService = await import("../../../../../../src/services/taskService.js");
  assert.equal(typeof taskService.setAgentExecutorForTests, "function",
    "seam 未就绪：taskService.setAgentExecutorForTests（agent mock 注入）");
  assert.equal(typeof taskService.setChannelAdapterForTests, "function",
    "seam 未就绪：taskService.setChannelAdapterForTests（fake 飞书注入）");
  return { scheduler, taskService };
}

describe("REQ-COLL-001: 场景 A · 定时日报端到端", () => {
  let serverCtx;
  let tmp;
  let seams;
  let adapter;
  let project;
  let flow;

  beforeEach(async () => {
    tmp = makeTmpProjectDir();
    serverCtx = await startServer();
    seams = await loadSeams();

    adapter = createMockChannelAdapter();
    await adapter.start({ credentials: {} });
    seams.taskService.setChannelAdapterForTests(adapter);

    project = await (await fetch(`${serverCtx.baseUrl}/api/projects`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Daily Project", localPath: tmp.dir })
    })).json();
    flow = await (await fetch(`${serverCtx.baseUrl}/api/flows`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "AI 科技日报",
        projectId: project.id,
        nodeList: [
          { id: "n1", type: "trigger", config: { outputVariables: [{ name: "topic", type: "string", defaultValue: "综合" }] } },
          { id: "n2", type: "agent", config: { provider: "anthropic", model: "claude", outputVariable: "out", prompt: "按 tag 收集并合成日报，主题 {{n1.topic}}" } }
        ],
        edges: [{ sourceNodeId: "n1", targetNodeId: "n2" }]
      })
    })).json();
    await fetch(`${serverCtx.baseUrl}/api/flows/${flow.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "published" })
    });
  });

  afterEach(async () => {
    try { seams.taskService.setAgentExecutorForTests?.(null); } catch { /* ignore */ }
    try { seams.taskService.setChannelAdapterForTests?.(null); } catch { /* ignore */ }
    try { seams.scheduler.removeAll?.(); } catch { /* ignore */ }
    tmp.cleanup();
    await stopServer(serverCtx);
  });

  async function armScheduleAndTick() {
    await fetch(`${serverCtx.baseUrl}/api/schedules`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: project.id, flowId: flow.id, cron: EVERY_SECOND, variables: { topic: TOPIC } })
    });
    const { subscribeToScheduleTriggers } = await import("../../../../../../src/services/taskService.js");
    subscribeToScheduleTriggers();
    await seams.scheduler.loadAll();
  }

  async function waitForExecution(predicate, { timeoutMs = 10000, description = "执行" } = {}) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const list = await (await fetch(`${serverCtx.baseUrl}/api/executions`)).json();
      const hit = list.find(predicate);
      if (hit && (hit.status === "success" || hit.status === "error")) return hit;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    assert.fail(`timed out waiting for: ${description}`);
  }

  it("cron 到点 → 执行 → 日报真实落盘 → 投递 + 登记 + 通知", async () => {
    // 签核日报文件名模式：outputs/daily/<date>-<topic-slug>.md。
    const dailyRel = `outputs/daily/${todayStr()}-ai-daily.md`;
    assert.match(dailyRel, /^outputs\/daily\/\d{4}-\d{2}-\d{2}-.+\.md$/, "日报路径应符合签核命名模式");
    const frontmatter = `---\ntopic: ${TOPIC}\nsources:\n  - https://news.ycombinator.com\ngeneratedAt: ${new Date().toISOString()}\n---\n`;
    seams.taskService.setAgentExecutorForTests(createFileWritingAgentExecutor(tmp.dir, [
      { relativePath: dailyRel, content: `${frontmatter}\n## 头条\n\n- [示例](https://news.ycombinator.com)\n` }
    ]));
    await armScheduleAndTick();

    const execution = await waitForExecution((e) => e.flowId === flow.id && e.trigger === "schedule",
      { description: "schedule 触发的日报执行" });

    // AC1：trigger=schedule，variables 含 topic。
    const detail = await (await fetch(`${serverCtx.baseUrl}/api/executions/${execution.id}`)).json();
    assert.equal(detail.trigger, "schedule");
    const variables = typeof detail.variables === "string" ? JSON.parse(detail.variables) : detail.variables;
    assert.equal(variables?.topic, TOPIC);

    // AC2：日报文件真实存在，frontmatter 含 topic/sources/generatedAt。
    const dailyFile = path.join(tmp.dir, dailyRel);
    const content = readFileIfExists(dailyFile);
    assert.ok(content !== null, `日报文件应真实存在: ${dailyRel}`);
    assert.match(content, /^---\n[\s\S]*topic:/, "frontmatter 应含 topic");
    assert.match(content, /sources:/, "frontmatter 应含 sources");
    assert.match(content, /generatedAt:/, "frontmatter 应含 generatedAt");
    assert.match(content, /https:\/\/news\.ycombinator\.com/, "正文条目应引用登记内容源的 URL");

    // AC3：fake 飞书收到日报摘要；artifacts 登记；通知落「产物产出」。
    assert.ok(adapter.sent.length >= 1, "fake 飞书应收到日报摘要消息");
    // 签核摘要模板（tech-design 系统层投递规则）：含日期/条数/来源数/产物路径。
    const summary = adapter.sent[0].text;
    assert.match(summary, /\d{4}-\d{2}-\d{2}/, `摘要应含日期，实际: ${summary}`);
    assert.match(summary, /\d+/, `摘要应含条数/来源数计数，实际: ${summary}`);
    assert.ok(summary.includes(dailyRel), `摘要应含产物路径，实际: ${summary}`);

    const artifacts = typeof detail.artifacts === "string" ? JSON.parse(detail.artifacts) : detail.artifacts;
    assert.ok(Array.isArray(artifacts) && artifacts.some((a) => String(a?.path ?? a).includes(dailyRel)),
      `executions.artifacts 应含日报路径，实际: ${JSON.stringify(artifacts)}`);

    // 通知 API 面（签核）：{ items, unreadCount }。
    const nres = await fetch(`${serverCtx.baseUrl}/api/notifications`);
    assert.equal(nres.status, 200);
    const { items } = await nres.json();
    assert.ok(items.some((n) => n.type === "artifact"), "通知列表应含「产物产出」");
  });

  it("agent 执行失败（重试耗尽）→ 执行 error + 失败通知 + 无产物登记", async () => {
    seams.taskService.setAgentExecutorForTests(createFailingAgentExecutor());
    await armScheduleAndTick();

    const execution = await waitForExecution((e) => e.flowId === flow.id && e.trigger === "schedule",
      { description: "失败的日报执行" });
    assert.equal(execution.status, "error");

    // 飞书收到失败通知（终态投递钩子）。
    assert.ok(adapter.sent.length >= 1, "fake 飞书应收到失败通知");
    assert.match(adapter.sent[0].text, /E-AGENT-FAILED|失败/,
      `失败通知应含错误摘要，实际: ${adapter.sent[0].text}`);

    // 通知中心落「执行失败」；无产物登记。
    const nres = await fetch(`${serverCtx.baseUrl}/api/notifications`);
    const { items } = await nres.json();
    assert.ok(items.some((n) => n.type === "execution-failed"), "通知列表应含「执行失败」");

    const detail = await (await fetch(`${serverCtx.baseUrl}/api/executions/${execution.id}`)).json();
    const artifacts = typeof detail.artifacts === "string" ? JSON.parse(detail.artifacts) : detail.artifacts;
    assert.ok(!artifacts || artifacts.length === 0, "失败执行不应登记产物");

    // 无日报落盘。
    const dailyDir = path.join(tmp.dir, "outputs", "daily");
    const files = fs.existsSync(dailyDir) ? fs.readdirSync(dailyDir) : [];
    assert.equal(files.length, 0, "失败执行不应有日报落盘");
  });
});
