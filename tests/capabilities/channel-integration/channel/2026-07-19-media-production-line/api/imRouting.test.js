// REQ-TRACE: 2026-07-19-media-production-line/REQ-CHANNEL-002, 2026-07-19-media-production-line/REQ-CHANNEL-004
// REQ-VERSION: v1-hash:aeebbee331c0863144ca7b891e8faf8da12fde2bfbceb0ad525049febf3f1d48
// CAPABILITY-TRACE: channel-integration
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

/**
 * 将飞书开放平台域名请求 mock 为快速成功/失败，避免测试依赖真实网络。
 * 返回 { sentReplies, restore }：sentReplies 记录发往开放平台的出站消息体
 * （AC6 接替断言用），restore 必须在 finally 中调用。
 */
function mockFeishuOpenPlatform({ tokenValid = true } = {}) {
  const originalFetch = global.fetch;
  const sentReplies = [];
  global.fetch = async (url, init) => {
    const urlStr = String(url);
    if (urlStr.includes("open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal")) {
      if (tokenValid) {
        return new Response(JSON.stringify({ code: 0, tenant_access_token: "fake-tenant-token", expire: 7200 }), { status: 200 });
      }
      return new Response(JSON.stringify({ code: 99991663, msg: "app access token invalid" }), { status: 200 });
    }
    if (urlStr.includes("open.feishu.cn/open-apis/im/v1/messages")) {
      // 记录出站消息体（reply 走 /im/v1/messages/:id/reply），再返回成功。
      try {
        sentReplies.push(JSON.parse(init.body));
      } catch {
        // 忽略非 JSON 请求体（不应出现）。
      }
      return new Response(JSON.stringify({ code: 0, msg: "success", data: { message_id: "om_fake_1" } }), { status: 200 });
    }
    return originalFetch(url, init);
  };
  return {
    sentReplies,
    restore: () => {
      global.fetch = originalFetch;
    }
  };
}

// seam：IM 路由（tech-design「通道绑定与 IM 路由」）。建议落点
// src/services/channels/imRouter.js，导出 createImRouter({ channelAdapter, ... })，
// 接线后 adapter.onMessage 进入路由：去重 → 查绑定 → 回执 + createTask 入队。
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

async function createProjectFlow(baseUrl, { publish = true, includeFeishuMessageNode = true } = {}) {
  const project = await (await fetch(`${baseUrl}/api/projects`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "IM Project", localPath: "/tmp/im-project" })
  })).json();
  const nodeList = includeFeishuMessageNode
    ? [
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
        },
        { id: "n2", type: "agent", config: { provider: "anthropic", outputVariable: "out", prompt: "text={{n1.text}}" } }
      ]
    : [];
  const flow = await (await fetch(`${baseUrl}/api/flows`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Link Capture", projectId: project.id, nodes: nodeList })
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

  it("AC2: 命中唯一绑定 → 入队并立即回执排队位置", async () => {
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

  it("AC3: 任意文本消息（无 URL）也入队并回执排队位置", async () => {
    const binding = await loadBindingService();
    const { project, flow } = await createProjectFlow(serverCtx.baseUrl);
    binding.createBinding({ channelType: "feishu", flowId: flow.id, projectId: project.id });

    adapter.emitMessage({ messageId: "om_nourl_1", chatId: "oc_1", senderId: "ou_1", text: "在吗" });
    await new Promise((resolve) => setTimeout(resolve, 300));

    assert.equal(adapter.replies.length, 1, "应立即回执");
    assert.match(adapter.replies[0].text, /收到，排队中（第 \d+ 位）/, `回执应含排队位置，实际: ${adapter.replies[0].text}`);

    const executions = await (await fetch(`${serverCtx.baseUrl}/api/executions`)).json();
    const created = executions.find((e) => e.flowId === flow.id && e.trigger === "channel");
    assert.ok(created, "任意文本消息命中绑定应创建 trigger=channel 的执行");
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

  it("AC4: 绑定指向 flow 无 feishuMessage 触发节点 → 回复配置异常并写「通道状态」通知（E-CHANNEL-FLOW-NO-TRIGGER）", async () => {
    const binding = await loadBindingService();
    const { project, flow } = await createProjectFlow(serverCtx.baseUrl, { includeFeishuMessageNode: false });
    binding.createBinding({ channelType: "feishu", flowId: flow.id, projectId: project.id });

    adapter.emitMessage({ messageId: "om_no_trigger_1", chatId: "oc_1", senderId: "ou_1", text: "https://example.com/no-trigger" });
    await new Promise((resolve) => setTimeout(resolve, 300));

    assert.equal(adapter.replies.length, 1, "缺少 feishuMessage 节点应回复配置异常提示");
    assert.ok(adapter.replies[0].text.includes("配置异常"), `实际回执: ${adapter.replies[0].text}`);

    const res = await fetch(`${serverCtx.baseUrl}/api/notifications`);
    assert.equal(res.status, 200);
    const { items } = await res.json();
    assert.ok(items.some((n) => n.type === "channel-status"), "缺少 feishuMessage 节点应写「通道状态」通知");

    const executions = await (await fetch(`${serverCtx.baseUrl}/api/executions`)).json();
    assert.equal(executions.length, 0, "缺少触发节点时不应创建执行");
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

  it("AC6: production path — channelManager 将 adapter onMessage 桥接到 eventBus，imRouter 全量进 agent 对话（REQ-CHANNEL-002 接替）", async () => {
    // REQ-CHANNEL-002 接替（2026-08-02-builtin-agent REQ-AGENT-017，2026-08-04）：
    // 本测试走完整生产路径：startServer 已通过 createImRouter({ channelManager }) 订阅
    // channel:message-received；保存凭据并重启 channelManager 后，adapter 的 onMessage 回调
    // 由 channelManager 桥接到 eventBus。接替语义：消息全量进 agentRouter（绑定检查 →
    // 命令识别 → 会话分发），绑定不再直接 createTask——无绑定态未绑定用户一切消息被
    // E-AUTH-NOT-BOUND 拒绝（REQ-AGENT-015 全量拒绝，绑定检查先于 key 检查，Slice 8
    // 裁决；此前未配 key 的 E-AGENT-NO-KEY 拒绝路径由本语义接替），不创建任何执行。
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "opc-imrouting-"));
    process.env.OPC_WORKSTATION_CONFIG_DIR = tmpDir;
    const feishuMock = mockFeishuOpenPlatform();
    try {
      const settings = await import("../../../../../../src/services/settingsService.js");
      const channelManager = await import("../../../../../../src/services/channelManager.js");
      settings.saveChannelCredentials({ appId: "cli_fake_app_id", appSecret: "fake-secret-bridge" });
      await channelManager.restart("feishu");
      const productionAdapter = channelManager.getAdapter("feishu");
      assert.ok(productionAdapter, "保存凭据后 channelManager 应创建 feishu adapter");
      assert.equal(productionAdapter.getStatus(), "online", "mock 飞书 token 应验证通过并 online");

      const binding = await loadBindingService();
      const { project, flow } = await createProjectFlow(serverCtx.baseUrl);
      binding.createBinding({ channelType: "feishu", flowId: flow.id, projectId: project.id });

      productionAdapter.simulateReceiveForTests({
        messageId: "om_bridge_1",
        chatId: "oc_bridge_1",
        senderId: "ou_bridge_1",
        text: "收藏 https://example.com/bridge"
      });
      await new Promise((resolve) => setTimeout(resolve, 300));

      // 接替语义：消息应经 eventBus 桥接进 agent 对话路由；无绑定态未绑定用户 →
      // E-AUTH-NOT-BOUND 拒绝（REQ-AGENT-014/015 全量拒绝，绑定检查先于 key 检查，
      // Slice 8 裁决）→ 出站回复引导文案「请先在设置中绑定操作者」（agentRouter
      // 签核文案；此前 E-AGENT-NO-KEY 拒绝路径由本语义接替）。
      const replyTexts = feishuMock.sentReplies
        .filter((r) => r.msg_type === "text")
        .map((r) => {
          try { return JSON.parse(r.content).text; } catch { return ""; }
        });
      assert.ok(
        replyTexts.some((t) => t.includes("绑定操作者")),
        `应回复 E-AUTH-NOT-BOUND 引导文案（未绑定拒绝路径），实际出站消息: ${JSON.stringify(feishuMock.sentReplies)}`
      );

      // 接替语义：命中绑定不再直接 createTask（REQ-AGENT-017），无 channel 触发执行。
      const executions = await (await fetch(`${serverCtx.baseUrl}/api/executions`)).json();
      const created = executions.find((e) => e.flowId === flow.id && e.trigger === "channel");
      assert.equal(created ?? null, null, "接替语义：绑定不应再直接触发 createTask（REQ-AGENT-017）");
    } finally {
      feishuMock.restore();
      delete process.env.OPC_WORKSTATION_CONFIG_DIR;
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
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
