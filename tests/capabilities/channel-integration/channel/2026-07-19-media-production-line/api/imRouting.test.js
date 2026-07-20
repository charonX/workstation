// REQ-TRACE: 2026-07-19-media-production-line/REQ-CHANNEL-002, 2026-07-19-media-production-line/REQ-CHANNEL-004
// REQ-VERSION: v1-hash:de43bc8607a89efe5512712a188a5f24f259d8109cb31a7a476827dd0883fab9
// CAPABILITY-TRACE: channel-integration
// ENTITY-TRACE: channel
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { startServer, stopServer } from "../../../../../../src/http/server.js";
import { createMockChannelAdapter } from "../../../../../fixtures/media-production-line/mockChannelAdapter.js";

// seam：IM 路由（tech-design「通道绑定与 IM 路由」）。建议落点
// src/services/channels/imRouter.js，导出 createImRouter({ channelAdapter, ... })，
// 接线后 adapter.onMessage 进入路由：去重 → 解析 URL → 查绑定 → 回执 + createTask 入队。
async function loadImRouter() {
  const mod = await import("../../../../../../src/services/channels/imRouter.js").catch(() => null);
  assert.ok(mod, "seam 未就绪：src/services/channels/imRouter.js 尚未实现（REQ-CHANNEL-002）");
  const create = mod.createImRouter || mod.createRouter;
  assert.equal(typeof create, "function", "imRouter 应导出 createImRouter({channelAdapter, ...})");
  return create;
}

// seam：通道绑定（REQ-CHANNEL-004）。建议落点 src/services/channelBindingService.js，
// 导出 createBinding({channelType, flowId, projectId, force?}) / getBinding(channelType)。
async function loadBindingService() {
  const mod = await import("../../../../../../src/services/channelBindingService.js").catch(() => null);
  assert.ok(mod, "seam 未就绪：src/services/channelBindingService.js 尚未实现（REQ-CHANNEL-004）");
  assert.equal(typeof mod.createBinding, "function", "channelBindingService 应导出 createBinding()");
  assert.equal(typeof mod.getBinding, "function", "channelBindingService 应导出 getBinding()");
  return mod;
}

async function createProjectFlow(baseUrl, { publish = true } = {}) {
  const project = await (await fetch(`${baseUrl}/api/projects`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "IM Project", localPath: "/tmp/im-project" })
  })).json();
  const flow = await (await fetch(`${baseUrl}/api/flows`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Link Capture", projectId: project.id })
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

describe("REQ-CHANNEL-002: IM 接收、去重与路由", () => {
  let serverCtx;
  let adapter;
  let createRouter;
  let router;

  beforeEach(async () => {
    serverCtx = await startServer();
    adapter = createMockChannelAdapter();
    await adapter.start({ credentials: {} });
    createRouter = await loadImRouter();
    router = createRouter({ channelAdapter: adapter, baseUrl: serverCtx.baseUrl });
  });

  afterEach(async () => {
    try { router?.stop?.(); } catch { /* ignore */ }
    await stopServer(serverCtx);
  });

  it("AC1: 同一 message_id 重复到达时丢弃且不再处理", async () => {
    const binding = await loadBindingService();
    const { project, flow } = await createProjectFlow(serverCtx.baseUrl);
    binding.createBinding({ channelType: "feishu", flowId: flow.id, projectId: project.id });

    const msg = { messageId: "om_dup_1", chatId: "oc_1", senderId: "ou_1", text: "看看 https://example.com/a" };
    adapter.emitMessage(msg);
    adapter.emitMessage({ ...msg }); // 重投
    await new Promise((resolve) => setTimeout(resolve, 300));

    const replies = adapter.replies.filter((r) => r.messageId === "om_dup_1");
    assert.equal(replies.length, 1, "重复消息应被去重（只回执一次）");
  });

  it("AC2: 含 URL 消息命中唯一绑定 → 入队并立即回执排队位置", async () => {
    const binding = await loadBindingService();
    const { project, flow } = await createProjectFlow(serverCtx.baseUrl);
    binding.createBinding({ channelType: "feishu", flowId: flow.id, projectId: project.id });

    adapter.emitMessage({ messageId: "om_route_1", chatId: "oc_1", senderId: "ou_1", text: "收藏 https://example.com/b 谢谢" });
    await new Promise((resolve) => setTimeout(resolve, 300));

    assert.equal(adapter.replies.length, 1, "应立即回执");
    // 签核回执模板：「收到，排队中（第 N 位）」。
    assert.match(adapter.replies[0].text, /收到，排队中（第 \d+ 位）/, `回执应含排队位置，实际: ${adapter.replies[0].text}`);

    const executions = await (await fetch(`${serverCtx.baseUrl}/api/executions`)).json();
    const created = executions.find((e) => e.flowId === flow.id && e.trigger === "channel");
    assert.ok(created, "命中绑定应创建 trigger=channel 的执行");
  });

  it("AC3: 无 URL → 回复使用提示，不建执行", async () => {
    adapter.emitMessage({ messageId: "om_nourl_1", chatId: "oc_1", senderId: "ou_1", text: "在吗" });
    await new Promise((resolve) => setTimeout(resolve, 300));

    assert.equal(adapter.replies.length, 1, "无 URL 也应回复使用提示");
    // 签核使用提示文案。
    assert.equal(adapter.replies[0].text, "发送 http(s) 链接即可速存到素材库");

    const executions = await (await fetch(`${serverCtx.baseUrl}/api/executions`)).json();
    assert.equal(executions.length, 0, "无 URL 不应建执行");
  });

  it("AC4: 无绑定 → 回复「未绑定链接速存 flow，请先从模板创建」，不建执行", async () => {
    adapter.emitMessage({ messageId: "om_nobind_1", chatId: "oc_1", senderId: "ou_1", text: "https://example.com/c" });
    await new Promise((resolve) => setTimeout(resolve, 300));

    assert.equal(adapter.replies.length, 1);
    // 文案出自 REQ-CHANNEL-002 AC4（需求给定，可直接断言包含关系）。
    assert.ok(adapter.replies[0].text.includes("未绑定链接速存 flow"), `实际回执: ${adapter.replies[0].text}`);

    const executions = await (await fetch(`${serverCtx.baseUrl}/api/executions`)).json();
    assert.equal(executions.length, 0);
  });

  it("AC4: 绑定指向 flow 已删/draft → 回复配置异常并写「通道状态」通知", async () => {
    const binding = await loadBindingService();
    const { project, flow } = await createProjectFlow(serverCtx.baseUrl, { publish: false });
    binding.createBinding({ channelType: "feishu", flowId: flow.id, projectId: project.id });

    adapter.emitMessage({ messageId: "om_draft_1", chatId: "oc_1", senderId: "ou_1", text: "https://example.com/d" });
    await new Promise((resolve) => setTimeout(resolve, 300));

    assert.equal(adapter.replies.length, 1, "绑定异常应回复配置异常提示");
    // 签核配置异常文案。
    assert.equal(adapter.replies[0].text, "链接速存 flow 配置异常（flow 不存在或未发布），请检查模板实例");

    // 「通道状态」通知（type=channel-status）；通知 API 面（签核）：{ items, unreadCount }。
    const res = await fetch(`${serverCtx.baseUrl}/api/notifications`);
    assert.equal(res.status, 200, "通知列表端点应可用（REQ-NOTIFY-001）");
    const { items } = await res.json();
    assert.ok(items.some((n) => n.type === "channel-status"), "绑定异常应写「通道状态」通知");
  });

  it("AC5: 事件回调在下游耗时场景下 3 秒内返回（回调内只做解析+入队）", async () => {
    const binding = await loadBindingService();
    const { project, flow } = await createProjectFlow(serverCtx.baseUrl);
    binding.createBinding({ channelType: "feishu", flowId: flow.id, projectId: project.id });

    const start = Date.now();
    adapter.emitMessage({ messageId: "om_fast_1", chatId: "oc_1", senderId: "ou_1", text: "https://example.com/e" });
    const elapsed = Date.now() - start;
    assert.ok(elapsed < 3000, `事件回调应 3 秒内返回，实际: ${elapsed}ms`);
  });
});

describe("REQ-CHANNEL-004: 通道绑定管理", () => {
  let serverCtx;
  let binding;

  beforeEach(async () => {
    serverCtx = await startServer();
    binding = await loadBindingService();
  });

  afterEach(async () => {
    await stopServer(serverCtx);
  });

  it("AC1/AC2: channelType 单绑定唯一约束，重复绑定默认报 E-BINDING-EXISTS", async () => {
    const { project, flow } = await createProjectFlow(serverCtx.baseUrl);
    binding.createBinding({ channelType: "feishu", flowId: flow.id, projectId: project.id });

    assert.throws(
      () => binding.createBinding({ channelType: "feishu", flowId: "flow-other", projectId: project.id }),
      /E-BINDING-EXISTS/,
      "同 channelType 重复绑定应报 E-BINDING-EXISTS"
    );
  });

  it("AC2: force 参数同事务删旧写新", async () => {
    const { project, flow } = await createProjectFlow(serverCtx.baseUrl);
    binding.createBinding({ channelType: "feishu", flowId: flow.id, projectId: project.id });

    const replacement = binding.createBinding({ channelType: "feishu", flowId: "flow-new", projectId: project.id, force: true });
    assert.ok(replacement, "force 应替换成功");
    const current = binding.getBinding("feishu");
    assert.equal(current.flowId, "flow-new", "force 后查询应返回新绑定");
  });

  it("AC3: 绑定关系 API 可查（当前绑定 → flow/项目）", async () => {
    const { project, flow } = await createProjectFlow(serverCtx.baseUrl);
    binding.createBinding({ channelType: "feishu", flowId: flow.id, projectId: project.id });

    // 签核路由：GET /api/channel/binding。
    const res = await fetch(`${serverCtx.baseUrl}/api/channel/binding`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.flowId, flow.id);
    assert.equal(data.projectId, project.id);
  });

  it("AC3: 绑定关系 CLI 可查（channel binding）", async () => {
    const { execSync } = await import("node:child_process");
    const { project, flow } = await createProjectFlow(serverCtx.baseUrl);
    binding.createBinding({ channelType: "feishu", flowId: flow.id, projectId: project.id });

    // 签核 CLI：`opc-workstation channel binding`。
    const out = execSync(`node src/cli/opc-workstation.js channel binding`, { encoding: "utf-8" });
    const data = JSON.parse(out);
    assert.equal(data.flowId, flow.id);
    assert.equal(data.projectId, project.id);
  });
});
