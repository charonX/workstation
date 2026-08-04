// REQ-TRACE: 2026-08-02-builtin-agent/REQ-AGENT-017, 2026-08-02-builtin-agent/REQ-AGENT-018
// REQ-VERSION: v1-hash:4ed3c67befef393165738dafca1a9a153b278661403fc6cc06025a430d1bab87
// CAPABILITY-TRACE: agent-dialogue
// ENTITY-TRACE: channel
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { startServer, stopServer } from "../../../../../../src/http/server.js";
import { createMockChannelAdapter } from "../../../../../fixtures/media-production-line/mockChannelAdapter.js";

// seam：imRouter/agentRouter（注入 fake 飞书消息）+ 复用 mockChannelAdapter 模式（REQ-CHANNEL）。
// 契约修订：REQ-CHANNEL-002 接替——绑定不再直接 createTask（agent 优先路由）。

// seam：agentRouter（tech-design「agentRouter（三纯函数）」）。
// 建议落点 src/services/agentRouter.js，导出 createAgentRouter({ now? }) →
// route({message, chatId, senderId, channelType}) → {action: "reject"|"command"|"dialogue", payload}；
// payload.spaceKey = "feishu:<chatId>"；首次对话 payload.sessionConfig = {provider, apiKey, systemPrompt}；
// buildToolContext({chatId}) → {defaultTarget: {flowId, projectId} | null}。
async function loadAgentRouter() {
  const mod = await import("../../../../../../src/services/agentRouter.js").catch(() => null);
  assert.ok(mod, "seam 未就绪：src/services/agentRouter.js 尚未实现（REQ-AGENT-017/018）");
  assert.equal(typeof mod.createAgentRouter, "function", "agentRouter 应导出 createAgentRouter()");
  return mod.createAgentRouter;
}

// seam：imRouter（已存在，REQ-CHANNEL-002）。本 story 改造为 agent 优先：去重沿用 channel_messages，
// 消息转发 agentRouter（agentRouter 选项），不再直接 createTask。
async function loadImRouter() {
  const mod = await import("../../../../../../src/services/channels/imRouter.js").catch(() => null);
  assert.ok(mod, "seam 未就绪：src/services/channels/imRouter.js");
  return mod.createImRouter;
}

// seam：通道绑定（已存在，REQ-CHANNEL-004）。
async function loadBindingService() {
  const mod = await import("../../../../../../src/services/channelBindingService.js").catch(() => null);
  assert.ok(mod, "seam 未就绪：src/services/channelBindingService.js");
  return mod;
}

async function createProjectFlow(baseUrl, { publish = true } = {}) {
  const project = await (await fetch(`${baseUrl}/api/projects`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Agent Route Project", localPath: "/tmp/agent-route-project" })
  })).json();
  const flow = await (await fetch(`${baseUrl}/api/flows`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Agent Route Flow",
      projectId: project.id,
      nodes: [
        {
          id: "n1",
          type: "feishuMessage",
          config: {
            outputVariables: [
              { name: "text", type: "string", defaultValue: "" },
              { name: "sender", type: "string", defaultValue: "" },
              { name: "messageId", type: "string", defaultValue: "" }
            ]
          }
        }
      ]
    })
  })).json();
  if (publish) {
    await fetch(`${baseUrl}/api/flows/${flow.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "published" })
    });
  }
  return { project, flow };
}

// 前置：把 senderId 绑定为操作者（走真实 arming 流程）。
function bindUser(router, senderId) {
  router.beginBinding();
  const res = router.route({ message: "绑定", chatId: "oc_0", senderId, channelType: "p2p" });
  assert.ok(JSON.stringify(res.payload).includes("绑定成功"), "前置：绑定用户");
}

describe("REQ-AGENT-017 agent 优先路由（REQ-CHANNEL-002 接替）", () => {
  let serverCtx;
  let workdir;

  beforeEach(async () => {
    workdir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-route-"));
    process.env.OPC_WORKSTATION_CONFIG_DIR = workdir;
    serverCtx = await startServer({ port: 0 });
  });

  afterEach(async () => {
    await stopServer(serverCtx);
    fs.rmSync(workdir, { recursive: true, force: true });
  });

  it("消息去重后进 agentRouter（绑定检查 → 命令识别 → 会话分发）", async () => {
    const createImRouter = await loadImRouter();
    const calls = [];
    const agentRouter = {
      route: (input) => { calls.push(input); return { action: "dialogue", payload: {} }; }
    };
    const adapter = createMockChannelAdapter();
    createImRouter({ channelAdapter: adapter, baseUrl: serverCtx.baseUrl, agentRouter });
    adapter.emitMessage({ messageId: "om_agent_1", chatId: "oc_1", senderId: "ou_1", text: "你好" });
    await new Promise((resolve) => setTimeout(resolve, 300));
    adapter.emitMessage({ messageId: "om_agent_1", chatId: "oc_1", senderId: "ou_1", text: "你好" }); // 重投
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.equal(calls.length, 1, "重复消息应被去重（沿用 channel_messages），只进一次 agentRouter（REQ-AGENT-017 标准 1）");
    assert.equal(calls[0].chatId, "oc_1");
    assert.equal(calls[0].senderId, "ou_1");
    assert.equal(calls[0].text, "你好");
  });

  it("命中绑定不再直接 createTask（旧语义接替）", async () => {
    const createImRouter = await loadImRouter();
    const { project, flow } = await createProjectFlow(serverCtx.baseUrl);
    const binding = await loadBindingService();
    binding.createBinding({ channelType: "feishu", flowId: flow.id, projectId: project.id });
    const received = [];
    const agentRouter = {
      route: (input) => { received.push(input); return { action: "dialogue", payload: {} }; }
    };
    const adapter = createMockChannelAdapter();
    createImRouter({ channelAdapter: adapter, baseUrl: serverCtx.baseUrl, agentRouter });
    adapter.emitMessage({ messageId: "om_bound_1", chatId: "oc_1", senderId: "ou_1", text: "跑一下日报" });
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.equal(received.length, 1, "命中绑定消息应进 agent 对话（agent 优先路由，2026-08-03 拍板）");
    const executions = await (await fetch(`${serverCtx.baseUrl}/api/executions`)).json();
    const created = executions.filter((e) => e.flowId === flow.id && e.trigger === "channel");
    assert.equal(created.length, 0, "绑定不应再直接触发 createTask（REQ-CHANNEL-002 旧语义接替）");
  });

  it("绑定作为 agent 下发任务的默认目标候选", async () => {
    const createAgentRouter = await loadAgentRouter();
    const { project, flow } = await createProjectFlow(serverCtx.baseUrl);
    const binding = await loadBindingService();
    binding.createBinding({ channelType: "feishu", flowId: flow.id, projectId: project.id });
    const router = createAgentRouter({});
    const context = router.buildToolContext({ chatId: "oc_1" });
    assert.ok(context, "应提供工具上下文");
    assert.equal(context.defaultTarget?.flowId, flow.id, "绑定 flow 应为 agent 下发任务的默认目标候选（REQ-AGENT-017 标准 2）");
    assert.equal(context.defaultTarget?.projectId, project.id);
  });

  it("手动/定时/调试触发路径不受影响（回归）", async () => {
    const { flow } = await createProjectFlow(serverCtx.baseUrl);
    // 手动触发（POST /api/executions，trigger=manual）仍创建执行（REQ-AGENT-017 标准 4）。
    const manualRes = await fetch(`${serverCtx.baseUrl}/api/executions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: flow.projectId, flowId: flow.id })
    });
    assert.equal(manualRes.status, 201, "手动触发应仍可用（回归）");
    const created = await manualRes.json();
    // 签核契约（tech-design「taskService.createTask」）：POST 返回 {executionId, queuePosition}，
    // trigger 经 GET /api/executions/:id 核验（对齐 executionQueue.test.js 同款断言写法）。
    assert.ok(created.executionId, "手动触发应返回 executionId");
    const detail = await (await fetch(`${serverCtx.baseUrl}/api/executions/${created.executionId}`)).json();
    assert.equal(detail.trigger, "manual", "手动触发应为 manual");
    // 调试触发（POST /api/flows/:id/debug）仍可用。
    const debugRes = await fetch(`${serverCtx.baseUrl}/api/flows/${flow.id}/debug`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({})
    });
    assert.equal(debugRes.status, 200, "调试触发应仍可用（回归）");
    // 定时触发路径由既有 scheduler 回归测试覆盖（schedule:triggered → createTask），此处不重复。
  });
});

describe("REQ-AGENT-018 会话分发与群聊语义", () => {
  let serverCtx;
  let workdir;

  beforeEach(async () => {
    workdir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-route-"));
    process.env.OPC_WORKSTATION_CONFIG_DIR = workdir;
    serverCtx = await startServer({ port: 0 });
  });

  afterEach(async () => {
    await stopServer(serverCtx);
    fs.rmSync(workdir, { recursive: true, force: true });
  });

  it("空间 key = feishu:<chatId>：单聊与群聊各自独立", async () => {
    const createAgentRouter = await loadAgentRouter();
    const router = createAgentRouter({});
    bindUser(router, "ou_1");
    const r1 = router.route({ message: "你好", chatId: "oc_111", senderId: "ou_1", channelType: "p2p" });
    const r2 = router.route({ message: "大家好", chatId: "oc_222", senderId: "ou_1", channelType: "group" });
    assert.equal(r1.action, "dialogue", "单聊应进对话");
    assert.equal(r2.action, "dialogue", "群聊应进对话");
    assert.equal(r1.payload.spaceKey, "feishu:oc_111", "单聊空间 key = feishu:<chatId>（签核决策 11）");
    assert.equal(r2.payload.spaceKey, "feishu:oc_222", "群聊空间 key = feishu:<chatId>");
    assert.notEqual(r1.payload.spaceKey, r2.payload.spaceKey, "单聊与每个群聊各自独立空间");
  });

  it("绑定用户在群聊发言 → 群空间对话；同群他人 → 拒绝", async () => {
    const createAgentRouter = await loadAgentRouter();
    const router = createAgentRouter({});
    bindUser(router, "ou_owner");
    const byOwner = router.route({ message: "群聊消息", chatId: "oc_group_1", senderId: "ou_owner", channelType: "group" });
    assert.equal(byOwner.action, "dialogue", "绑定用户在群聊发言应进入该群空间对话");
    assert.equal(byOwner.payload.spaceKey, "feishu:oc_group_1");
    // 同群其他用户（未绑定）→ E-AUTH-NOT-BOUND 拒绝（不影响群空间，REQ-AGENT-018 标准 2）。
    const byOther = router.route({ message: "你好", chatId: "oc_group_1", senderId: "ou_other", channelType: "group" });
    assert.equal(byOther.action, "reject", "同群未绑定用户应被拒绝");
    assert.ok(JSON.stringify(byOther.payload).includes("E-AUTH-NOT-BOUND"), "拒绝应含 E-AUTH-NOT-BOUND");
    assert.equal(byOther.payload.spaceKey ?? null, null, "拒绝不应产生空间/会话分发改动");
  });

  it("空间不存在自动创建 + 下发 session-config", async () => {
    const createAgentRouter = await loadAgentRouter();
    const router = createAgentRouter({});
    bindUser(router, "ou_1");
    const res = router.route({ message: "首次对话", chatId: "oc_new", senderId: "ou_1", channelType: "p2p" });
    assert.equal(res.action, "dialogue", "首次对话应进入会话分发");
    assert.equal(res.payload.spaceKey, "feishu:oc_new");
    // 空间不存在自动创建；创建时下发 session-config（供应商/key/身份，REQ-AGENT-018 标准 3）。
    const cfg = res.payload.sessionConfig;
    assert.ok(cfg, "首次对话应附带 session-config");
    assert.ok(cfg.provider, "session-config 应含供应商");
    assert.ok(cfg.apiKey, "session-config 应含 key（一次性注入，签核决策 5）");
    assert.ok(cfg.systemPrompt, "session-config 应含内置身份 systemPrompt");
  });
});
