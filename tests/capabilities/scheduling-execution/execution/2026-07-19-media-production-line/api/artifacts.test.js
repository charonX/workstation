// REQ-TRACE: 2026-07-19-media-production-line/REQ-SCHEDULE-008, 2026-07-19-media-production-line/REQ-SCHEDULE-009
// REQ-VERSION: v1-hash:de43bc8607a89efe5512712a188a5f24f259d8109cb31a7a476827dd0883fab9
// CAPABILITY-TRACE: scheduling-execution
// ENTITY-TRACE: execution
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { startServer, stopServer } from "../../../../../../src/http/server.js";
import { makeTmpProjectDir, readFileIfExists } from "../../../../../fixtures/media-production-line/tmpProjectDir.js";
import { createFileWritingAgentExecutor, createFailingAgentExecutor } from "../../../../../fixtures/media-production-line/mockAgent.js";
import { createMockChannelAdapter } from "../../../../../fixtures/media-production-line/mockChannelAdapter.js";

const CLI = "node src/cli/opc-workstation.js";

async function createProjectFlow(baseUrl, projectDir) {
  const project = await (await fetch(`${baseUrl}/api/projects`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Artifact Project", localPath: projectDir })
  })).json();
  // trigger → agent 单链路（draft 快照，manual 触发）。
  const flow = await (await fetch(`${baseUrl}/api/flows`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Artifact Flow",
      projectId: project.id,
      nodeList: [
        { id: "n1", type: "trigger", config: { outputVariables: [] } },
        // 无 provider → 内置 mock agent 路径（离线、毫秒级），与 REQ-FLOW-017 旧契约一致；
        // 真实 agent 行为由 setAgentExecutorForTests 注入的用例覆盖。
        { id: "n2", type: "agent", config: { outputVariable: "out", prompt: "collect" } }
      ],
      edges: [{ sourceNodeId: "n1", targetNodeId: "n2" }]
    })
  })).json();
  return { project, flow };
}

async function waitForTerminalStatus(baseUrl, executionId, { timeoutMs = 8000 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const detail = await (await fetch(`${baseUrl}/api/executions/${executionId}`)).json();
    if (detail.status === "success" || detail.status === "error") return detail;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  assert.fail(`execution ${executionId} 未在 ${timeoutMs}ms 内到达终态`);
}

// seam：runner 提供 agent 执行器注入点（REQ-FLOW-053）（建议 setAgentExecutorForTests(executor|null)），
// 使集成测试可用 mock agent 替代真实 Claude（tech-design 测试 seams：agent mock）。
async function requireAgentInjection() {
  const runner = await import("../../../../../../src/services/executionRunner.js");
  assert.equal(
    typeof runner.setAgentExecutorForTests,
    "function",
    "seam 未就绪：executionRunner.setAgentExecutorForTests 未就绪（REQ-FLOW-053）（REQ-SCHEDULE-008/009 集成测试依赖）"
  );
  return runner;
}

// seam：runner 终态投递钩子可注入 channelAdapter（REQ-FLOW-053）（建议 setChannelAdapterForTests(adapter|null)）。
async function requireChannelInjection() {
  const runner = await import("../../../../../../src/services/executionRunner.js");
  assert.equal(
    typeof runner.setChannelAdapterForTests,
    "function",
    "seam 未就绪：executionRunner.setChannelAdapterForTests 未就绪（REQ-FLOW-053）（REQ-SCHEDULE-009 依赖）"
  );
  return runner;
}

describe("REQ-SCHEDULE-008/009: 产物登记与终态投递钩子", () => {
  let serverCtx;
  let tmp;
  let runner;

  beforeEach(async () => {
    serverCtx = await startServer();
    tmp = makeTmpProjectDir();
  });

  afterEach(async () => {
    if (runner) {
      try { runner.setAgentExecutorForTests?.(null); } catch { /* ignore */ }
      try { runner.setChannelAdapterForTests?.(null); } catch { /* ignore */ }
      runner = undefined;
    }
    tmp.cleanup();
    await stopServer(serverCtx);
  });

  it("REQ-SCHEDULE-008 AC1: 执行成功且产出文件时，artifacts 登记产物路径（真实 I/O）", async () => {
    runner = await requireAgentInjection();
    const relative = "outputs/daily/2026-07-19-ai-daily.md";
    runner.setAgentExecutorForTests(createFileWritingAgentExecutor(tmp.dir, [
      { relativePath: relative, content: "---\ntopic: AI\n---\n# daily\n" }
    ]));
    const { project, flow } = await createProjectFlow(serverCtx.baseUrl, tmp.dir);

    const created = await (await fetch(`${serverCtx.baseUrl}/api/executions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: project.id, flowId: flow.id, trigger: "manual" })
    })).json();

    const detail = await waitForTerminalStatus(serverCtx.baseUrl, created.id || created.executionId);
    assert.equal(detail.status, "success");
    // 真实文件断言（STANDARDS 红线：文件副作用用真实 I/O）。
    assert.ok(readFileIfExists(path.join(tmp.dir, relative)) !== null, `产物文件应真实存在: ${relative}`);

    const artifacts = typeof detail.artifacts === "string" ? JSON.parse(detail.artifacts) : detail.artifacts;
    assert.ok(Array.isArray(artifacts), "执行详情应返回 artifacts 数组");
    assert.ok(
      artifacts.some((a) => (typeof a === "string" ? a : a?.path)?.includes(relative)),
      `artifacts 应登记产物路径 ${relative}，实际: ${JSON.stringify(artifacts)}`
    );
  });

  it("REQ-SCHEDULE-008 AC2: 执行失败不登记半成品文件", async () => {
    runner = await requireAgentInjection();
    runner.setAgentExecutorForTests(createFailingAgentExecutor());
    const { project, flow } = await createProjectFlow(serverCtx.baseUrl, tmp.dir);

    const created = await (await fetch(`${serverCtx.baseUrl}/api/executions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: project.id, flowId: flow.id, trigger: "manual" })
    })).json();

    const detail = await waitForTerminalStatus(serverCtx.baseUrl, created.id || created.executionId);
    assert.equal(detail.status, "error");
    const artifacts = typeof detail.artifacts === "string" ? JSON.parse(detail.artifacts) : detail.artifacts;
    assert.ok(Array.isArray(artifacts), "失败执行也应返回 artifacts 数组（空）");
    assert.equal(artifacts.length, 0, "失败执行不登记半成品文件");
  });

  it("REQ-SCHEDULE-008 AC3: 执行详情 API 返回 artifacts 字段", async () => {
    const { project, flow } = await createProjectFlow(serverCtx.baseUrl, tmp.dir);
    const created = await (await fetch(`${serverCtx.baseUrl}/api/executions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: project.id, flowId: flow.id, trigger: "manual" })
    })).json();
    const detail = await waitForTerminalStatus(serverCtx.baseUrl, created.id || created.executionId);
    assert.ok("artifacts" in detail, "执行详情 API 应包含 artifacts 字段");
  });

  it("REQ-SCHEDULE-008 AC3: CLI 执行详情返回 artifacts（task get --id）", async () => {
    const { project, flow } = await createProjectFlow(serverCtx.baseUrl, tmp.dir);
    // 签核 CLI 命令：`opc-workstation task get --id <id>`（对齐既有 task 实体命名）。
    const created = await (await fetch(`${serverCtx.baseUrl}/api/executions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: project.id, flowId: flow.id, trigger: "manual" })
    })).json();
    const out = execSync(`${CLI} task get --id ${created.id || created.executionId}`, { encoding: "utf-8" });
    const data = JSON.parse(out);
    assert.ok("artifacts" in data, "CLI 执行详情应包含 artifacts 字段");
  });

  it("REQ-SCHEDULE-009 AC1 / REQ-FLOW-032: channel 触发不再自动回复；由 feishuSend 节点控制", async () => {
    // v1.1 契约修订（REQ-FLOW-032）：channel 触发的 execution 终态**不**自动回复 IM 消息；
    // 最终回复由 flow 中的 feishuSend 显式节点负责。仅保留 imRouter 入队回执"收到，排队中"。
    runner = await requireAgentInjection();
    await requireChannelInjection();
    const adapter = createMockChannelAdapter();
    await adapter.start({ credentials: { appId: "fake", appSecret: "fake" } });
    runner.setChannelAdapterForTests(adapter);

    const relative = "materials/2026-07-19-demo.md";
    runner.setAgentExecutorForTests(createFileWritingAgentExecutor(tmp.dir, [
      { relativePath: relative, content: "# saved\n" }
    ]));
    const { project, flow } = await createProjectFlow(serverCtx.baseUrl, tmp.dir);

    const channelReply = { channelType: "feishu", chatId: "oc_fake_chat", messageId: "om_fake_msg" };
    const created = await (await fetch(`${serverCtx.baseUrl}/api/executions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: project.id, flowId: flow.id, trigger: "channel", variables: { url: "https://example.com/a", channelReply } })
    })).json();
    const detail = await waitForTerminalStatus(serverCtx.baseUrl, created.id || created.executionId);
    assert.equal(detail.status, "success");

    // 终态钩子对 channel 触发不再自动投递（imRouter 的回执在入队时发送，不计入终态钩子）。
    assert.equal(adapter.sent.length + adapter.replies.length, 0,
      "channel 触发的终态钩子不应自动回复（最终回复由 feishuSend 节点负责）");
  });

  it("REQ-SCHEDULE-009 AC2: 无 channelReply 时不投递", async () => {
    runner = await requireAgentInjection();
    await requireChannelInjection();
    const adapter = createMockChannelAdapter();
    await adapter.start({ credentials: {} });
    runner.setChannelAdapterForTests(adapter);
    runner.setAgentExecutorForTests(createFileWritingAgentExecutor(tmp.dir, [
      { relativePath: "outputs/x.md", content: "x" }
    ]));
    const { project, flow } = await createProjectFlow(serverCtx.baseUrl, tmp.dir);

    const created = await (await fetch(`${serverCtx.baseUrl}/api/executions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: project.id, flowId: flow.id, trigger: "manual" })
    })).json();
    await waitForTerminalStatus(serverCtx.baseUrl, created.id || created.executionId);
    assert.equal(adapter.sent.length, 0, "无 channelReply 不应投递");
    assert.equal(adapter.replies.length, 0, "无 channelReply 不应投递");
  });

  it("REQ-SCHEDULE-009 AC3: 投递失败不反转 execution 终态", async () => {
    runner = await requireAgentInjection();
    await requireChannelInjection();
    const adapter = createMockChannelAdapter();
    await adapter.start({ credentials: {} });
    adapter.failNextSend(5);
    runner.setChannelAdapterForTests(adapter);
    runner.setAgentExecutorForTests(createFileWritingAgentExecutor(tmp.dir, [
      { relativePath: "outputs/y.md", content: "y" }
    ]));
    const { project, flow } = await createProjectFlow(serverCtx.baseUrl, tmp.dir);

    const created = await (await fetch(`${serverCtx.baseUrl}/api/executions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId: project.id,
        flowId: flow.id,
        trigger: "channel",
        variables: { channelReply: { channelType: "feishu", chatId: "oc_fake", messageId: "om_fake" } }
      })
    })).json();
    const detail = await waitForTerminalStatus(serverCtx.baseUrl, created.id || created.executionId);
    assert.equal(detail.status, "success", "投递失败不应反转 execution 终态");
    // TODO(BUILD)：告警日志断言（结构化日志捕获 seam 就绪后补）。
  });

  it("REQ-SCHEDULE-009 AC1 / REQ-FLOW-032: channel 触发失败执行也不再自动回复", async () => {
    // v1.1 契约修订：channel 触发不自动回复（成功/失败皆然）；失败通知走通知中心。
    runner = await requireAgentInjection();
    await requireChannelInjection();
    const adapter = createMockChannelAdapter();
    await adapter.start({ credentials: {} });
    runner.setChannelAdapterForTests(adapter);
    runner.setAgentExecutorForTests(createFailingAgentExecutor());
    const { project, flow } = await createProjectFlow(serverCtx.baseUrl, tmp.dir);

    const created = await (await fetch(`${serverCtx.baseUrl}/api/executions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId: project.id,
        flowId: flow.id,
        trigger: "channel",
        variables: { channelReply: { channelType: "feishu", chatId: "oc_fake", messageId: "om_fake" } }
      })
    })).json();
    const detail = await waitForTerminalStatus(serverCtx.baseUrl, created.id || created.executionId);
    assert.equal(detail.status, "error");

    assert.equal(adapter.sent.length + adapter.replies.length, 0,
      "channel 触发失败也不自动回复（错误通知由通知中心承载）");
  });

  it("REQ-SCHEDULE-009 AC4: agent 节点实现不参与消息发送（代码结构断言）", async () => {
    // 结构约束：通道发送只发生在 runner 终态钩子，agent 执行器不得引用通道层。
    const files = [
      "src/flowEngine/executors/agentExecutor.js",
      "src/flowEngine/agentAdapter.js",
      "src/flowEngine/claudeAgentAdapter.js"
    ];
    for (const file of files) {
      const source = fs.readFileSync(file, "utf8");
      assert.ok(
        !/channelAdapter|feishu|larksuite/i.test(source),
        `${file} 不应引用通道层（channelAdapter/feishu），消息发送是 runner 终态钩子的职责`
      );
    }
  });
});
