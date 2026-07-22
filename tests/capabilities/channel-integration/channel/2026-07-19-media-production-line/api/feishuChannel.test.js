// REQ-TRACE: 2026-07-19-media-production-line/REQ-CHANNEL-001, 2026-07-19-media-production-line/REQ-CHANNEL-003
// REQ-VERSION: v1-hash:de43bc8607a89efe5512712a188a5f24f259d8109cb31a7a476827dd0883fab9
// CAPABILITY-TRACE: channel-integration
// ENTITY-TRACE: channel
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { startFakeFeishuServer } from "../../../../../fixtures/media-production-line/fakeFeishuServer.js";
import { makeTmpDir } from "../../../../../fixtures/media-production-line/tmpProjectDir.js";

/**
 * 将飞书开放平台域名请求 mock 为快速成功/失败，避免测试依赖真实网络。
 * 返回恢复函数，必须在 finally 中调用。
 */
function mockFeishuOpenPlatform({ tokenValid = true } = {}) {
  const originalFetch = global.fetch;
  global.fetch = async (url, init) => {
    const urlStr = String(url);
    if (urlStr.includes("open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal")) {
      if (tokenValid) {
        return new Response(JSON.stringify({ code: 0, tenant_access_token: "fake-tenant-token", expire: 7200 }), { status: 200 });
      }
      return new Response(JSON.stringify({ code: 99991663, msg: "app access token invalid" }), { status: 200 });
    }
    if (urlStr.includes("open.feishu.cn/open-apis/im/v1/messages")) {
      return new Response(JSON.stringify({ code: 0, msg: "success", data: { message_id: "om_fake_1" } }), { status: 200 });
    }
    return originalFetch(url, init);
  };
  return () => {
    global.fetch = originalFetch;
  };
}

// seam：飞书通道 adapter（tech-design「channelAdapter 接口」）。
// 建议落点 src/services/channels/feishuChannelAdapter.js，导出 createFeishuChannelAdapter({
//   domain, credentials, settings, notificationService, logger })，
// 实例实现 start/send/reply/getStatus/onMessage。domain 可配置指向 fake 飞书 server
// （WSClient domain spike 失败时降级为 adapter 接口 mock，REST 侧仍经 fake server 断言）。
async function loadAdapterFactory() {
  const mod = await import("../../../../../../src/services/channels/feishuChannelAdapter.js").catch(() => null);
  assert.ok(mod, "seam 未就绪：src/services/channels/feishuChannelAdapter.js 尚未实现（REQ-CHANNEL-001/003）");
  const create = mod.createFeishuChannelAdapter || mod.createAdapter;
  assert.equal(typeof create, "function", "feishuChannelAdapter 应导出 createFeishuChannelAdapter()");
  return create;
}

describe("REQ-CHANNEL-001: 飞书通道生命周期", () => {
  let fake;
  let tmp;

  beforeEach(async () => {
    fake = await startFakeFeishuServer();
    tmp = makeTmpDir("opc-channel-001-");
  });

  afterEach(async () => {
    await fake.stop();
    tmp.cleanup();
  });

  it("AC1: 凭据存 settings.json 且文件权限为 600", async () => {
    process.env.OPC_WORKSTATION_CONFIG_DIR = tmp.dir;
    try {
      // seam：凭据落盘入口（建议 settingsService.saveChannelCredentials({appId, appSecret})，
      // 或 /api/settings/channel 路由的 service 侧等价函数）。
      const settings = await import("../../../../../../src/services/settingsService.js");
      const save = settings.saveChannelCredentials;
      assert.equal(typeof save, "function", "seam 未就绪：凭据保存入口尚未实现（REQ-CHANNEL-001 AC1）");
      save({ appId: "cli_fake_app_id", appSecret: "fake-secret-0001" });

      const settingsFile = path.join(tmp.dir, "settings.json");
      assert.ok(fs.existsSync(settingsFile), "凭据应落盘 settings.json");
      const mode = fs.statSync(settingsFile).mode & 0o777;
      assert.equal(mode, 0o600, `settings.json 权限应为 600，实际: ${mode.toString(8)}`);
    } finally {
      delete process.env.OPC_WORKSTATION_CONFIG_DIR;
    }
  });

  it("AC1: 凭据不明文入日志", async () => {
    const create = await loadAdapterFactory();
    const secret = "fake-secret-should-not-leak";
    const logged = [];
    const origLog = console.log;
    const origError = console.error;
    console.log = (...args) => logged.push(args.join(" "));
    console.error = (...args) => logged.push(args.join(" "));
    try {
      const adapter = create({ domain: fake.baseUrl, credentials: { appId: "cli_fake", appSecret: secret } });
      await adapter.start().catch(() => {});
      await adapter.send({ chatId: "oc_fake", text: "hello" }).catch(() => {});
    } finally {
      console.log = origLog;
      console.error = origError;
    }
    assert.ok(!logged.join("\n").includes(secret), "日志不应出现 App Secret 明文");
  });

  it("AC2: start 建立连接，getStatus 三态正确迁移（connecting→online）", async () => {
    const create = await loadAdapterFactory();
    const adapter = create({ domain: fake.baseUrl, credentials: { appId: "cli_fake", appSecret: "fake" } });
    assert.equal(adapter.getStatus(), "offline", "未启动时应为 offline");

    const startPromise = adapter.start();
    // 签核三态 connecting/online/offline：start 进行中的中间态必须为 connecting。
    assert.equal(adapter.getStatus(), "connecting", "start 进行中应为 connecting");
    await startPromise;
    assert.equal(adapter.getStatus(), "online", "连接建立后应为 online");
  });

  it("AC3: 断线重连失败置 offline 并写「通道掉线」通知；恢复置 online 并写恢复通知", async () => {
    const { startServer, stopServer } = await import("../../../../../../src/http/server.js");
    const serverCtx = await startServer();
    try {
      const create = await loadAdapterFactory();
      const notificationService = await import("../../../../../../src/services/notificationService.js");
      const adapter = create({
        domain: fake.baseUrl,
        credentials: { appId: "cli_fake", appSecret: "fake" },
        notificationService
      });
      await adapter.start();
      assert.equal(adapter.getStatus(), "online");

      assert.equal(typeof adapter.simulateDisconnectForTests, "function",
        "seam 未就绪：adapter 需提供断线模拟入口（REQ-CHANNEL-001 AC3）");
      await adapter.simulateDisconnectForTests({ reconnectWillFail: true });
      await new Promise((resolve) => setTimeout(resolve, 50));
      assert.equal(adapter.getStatus(), "offline", "重连失败应置 offline");

      const offlineNotifications = notificationService.list().filter((n) =>
        n.type === "channel-status" && n.title.includes("通道掉线")
      );
      assert.ok(offlineNotifications.length > 0, "断线应写入 type='channel-status' 的「通道掉线」通知");

      await adapter.simulateReconnectForTests?.();
      await new Promise((resolve) => setTimeout(resolve, 50));
      assert.equal(adapter.getStatus(), "online", "恢复后应置 online");

      const onlineNotifications = notificationService.list().filter((n) =>
        n.type === "channel-status" && n.title.includes("通道已恢复")
      );
      assert.ok(onlineNotifications.length > 0, "恢复应写入 type='channel-status' 的「通道已恢复」通知");
    } finally {
      await stopServer(serverCtx);
    }
  });

  it("AC4: 凭据无效 → E-CHANNEL-CRED，状态 offline", async () => {
    fake.setCredentialsValid(false);
    const create = await loadAdapterFactory();
    const adapter = create({ domain: fake.baseUrl, credentials: { appId: "bad", appSecret: "bad" } });
    // 签核：凭据无效 reject 带 E-CHANNEL-CRED。
    await assert.rejects(() => adapter.start(), /E-CHANNEL-CRED/, "凭据无效应报 E-CHANNEL-CRED");
    assert.equal(adapter.getStatus(), "offline");
  });
});

describe("REQ-CHANNEL-003: 通道发送", () => {
  let fake;

  beforeEach(async () => {
    fake = await startFakeFeishuServer();
  });

  afterEach(async () => {
    await fake.stop();
  });

  it("AC1: send({chatId, text}) 请求结构正确（receive_id_type=chat_id + text 消息）", async () => {
    const create = await loadAdapterFactory();
    const adapter = create({ domain: fake.baseUrl, credentials: { appId: "cli_fake", appSecret: "fake" } });
    await adapter.start();

    await adapter.send({ chatId: "oc_chat_1", text: "日报摘要：14 条" });
    assert.equal(fake.received.sends.length, 1, "fake 飞书应收到一次 send");
    const call = fake.received.sends[0];
    // 签核请求体形状（飞书 API）：{receive_id, msg_type:"text", content:"{\"text\":\"...\"}"}（content 为 JSON 字符串）。
    assert.ok(call.query.includes("receive_id_type=chat_id"), `send 应带 receive_id_type=chat_id，实际: ${call.query}`);
    assert.equal(call.body.receive_id, "oc_chat_1");
    assert.equal(call.body.msg_type, "text");
    const content = typeof call.body.content === "string" ? JSON.parse(call.body.content) : call.body.content;
    assert.ok(content.text.includes("日报摘要：14 条"));
  });

  it("AC1: reply({messageId, text}) 调通且命中 reply 端点", async () => {
    const create = await loadAdapterFactory();
    const adapter = create({ domain: fake.baseUrl, credentials: { appId: "cli_fake", appSecret: "fake" } });
    await adapter.start();

    await adapter.reply({ messageId: "om_origin_1", text: "收到，排队中（第 1 位）" });
    assert.equal(fake.received.replies.length, 1, "fake 飞书应收到一次 reply");
    assert.equal(fake.received.replies[0].messageId, "om_origin_1");
    const content = typeof fake.received.replies[0].body.content === "string"
      ? JSON.parse(fake.received.replies[0].body.content)
      : fake.received.replies[0].body.content;
    assert.ok(content.text.includes("排队中"));
  });

  it("AC2: 发送失败按次重试（≤3），仍失败记 E-CHANNEL-SEND，不阻断调用方", async () => {
    const create = await loadAdapterFactory();
    const adapter = create({ domain: fake.baseUrl, credentials: { appId: "cli_fake", appSecret: "fake" } });
    await adapter.start();

    // 前 2 次失败 → 第 3 次成功。
    fake.failNext("/open-apis/im/v1/messages", 2);
    await adapter.send({ chatId: "oc_chat_2", text: "retry-me" });
    assert.ok(fake.received.sends.length >= 2 && fake.received.sends.length <= 3,
      `应在 ≤3 次尝试内成功，实际尝试: ${fake.received.sends.length}`);

    // 持续失败 → 报 E-CHANNEL-SEND，且总尝试次数 ≤3（签核上限，含首次；不无限重试）。
    fake.failNext("/open-apis/im/v1/messages", 10);
    const before = fake.received.sends.length;
    await assert.rejects(() => adapter.send({ chatId: "oc_chat_3", text: "always-fail" }), /E-CHANNEL-SEND/);
    assert.ok(fake.received.sends.length - before <= 3,
      `重试应有上限（≤3 次），实际新增尝试: ${fake.received.sends.length - before}`);
  });
});

describe("REQ-CHANNEL-003: 入站消息解析（WS v2 schema 事件）", () => {
  let fake;

  beforeEach(async () => {
    fake = await startFakeFeishuServer();
  });

  afterEach(async () => {
    await fake.stop();
  });

  it("AC: 真实 v2 schema WS 事件经 mapInboundMessage 正确解析为 {messageId, chatId, senderId, text}", async () => {
    // BUG-006 回归测试：SDK EventDispatcher.parse() 会把 v2 schema 事件的
    // .event 子对象展开到顶层（见 node-sdk EventDispatcher.parse line 93585:
    //   return { [CEventType]: header.event_type, ...rest, ...header, ...event }
    // ），所以 message/sender 在顶层而非 .event 下。
    // mapInboundMessage 必须兼容该输出格式，否则所有入站消息返回 null 被静默丢弃。
    const create = await loadAdapterFactory();
    const adapter = create({ domain: fake.baseUrl, credentials: { appId: "cli_fake", appSecret: "fake" } });
    await adapter.start();

    const received = [];
    adapter.onMessage((msg) => received.push(msg));

    // v2 schema 事件经 EventDispatcher.parse 后的真实形态：message/sender 在顶层。
    const v2WsEvent = {
      event_type: "im.message.receive_v1",
      event_id: "evt_test_001",
      create_time: "1721000000000",
      token: "verification-token",
      app_id: "cli_fake",
      tenant_key: "tenant_test",
      message: {
        message_id: "om_test_abc123",
        chat_id: "oc_test_chat_001",
        chat_type: "p2p",
        content: JSON.stringify({ text: "收藏 https://example.com/test" }),
        message_type: "text",
        create_time: "1721000000000"
      },
      sender: {
        sender_id: {
          union_id: "on_test_union",
          user_id: "ou_test_user",
          open_id: "ou_test_open"
        }
      }
    };

    assert.equal(typeof adapter.simulateWsEventForTests, "function",
      "seam 未就绪：adapter 需提供 simulateWsEventForTests 注入原始 WS 事件");
    adapter.simulateWsEventForTests(v2WsEvent);

    assert.equal(received.length, 1, `应收到一条消息，实际收到 ${received.length} 条（mapInboundMessage 返回 null 导致消息被丢弃）`);
    const msg = received[0];
    assert.equal(msg.messageId, "om_test_abc123", "messageId 应取自 message.message_id");
    assert.equal(msg.chatId, "oc_test_chat_001", "chatId 应取自 message.chat_id");
    assert.equal(msg.text, "收藏 https://example.com/test", "text 应取自 content.text");
    assert.ok(msg.senderId, "senderId 应有值");
  });
});

describe("REQ-CHANNEL-001 HTTP 集成：credentials / status / reconnect", () => {
  let fake;
  let serverCtx;
  let restoreFetch;

  beforeEach(async () => {
    fake = await startFakeFeishuServer();
    restoreFetch = mockFeishuOpenPlatform();
    const { startServer } = await import("../../../../../../src/http/server.js");
    serverCtx = await startServer();
  });

  afterEach(async () => {
    const { stopServer } = await import("../../../../../../src/http/server.js");
    await stopServer(serverCtx);
    restoreFetch();
    await fake.stop();
  });

  it("POST /api/channel/credentials 返回 {appId, status, error?}", async () => {
    const res = await fetch(`${serverCtx.baseUrl}/api/channel/credentials`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ appId: "cli_fake_http", appSecret: "fake-secret-http" })
    });
    assert.equal(res.status, 201, "保存凭据应返回 201");
    const data = await res.json();
    assert.equal(data.appId, "cli_fake_http", "响应应回显 appId");
    assert.ok(["connecting", "online", "offline"].includes(data.status), `status 应为三态之一，实际: ${data.status}`);
    assert.ok(data.error === undefined || data.error === null || typeof data.error === "string", "error 字段应为字符串、null 或不存在");
  });

  it("GET /api/channel/status 返回 {channelType, status, error?}", async () => {
    await fetch(`${serverCtx.baseUrl}/api/channel/credentials`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ appId: "cli_fake_http", appSecret: "fake-secret-http" })
    });

    const res = await fetch(`${serverCtx.baseUrl}/api/channel/status`);
    assert.equal(res.status, 200, "查询状态应返回 200");
    const data = await res.json();
    assert.equal(data.channelType, "feishu", "响应应标识 channelType=feishu");
    assert.ok(["connecting", "online", "offline"].includes(data.status), `status 应为三态之一，实际: ${data.status}`);
    assert.ok(data.error === undefined || data.error === null || typeof data.error === "string", "error 字段应为字符串、null 或不存在");
  });

  it("POST /api/channel/reconnect 返回 {channelType, status, error?}", async () => {
    await fetch(`${serverCtx.baseUrl}/api/channel/credentials`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ appId: "cli_fake_http", appSecret: "fake-secret-http" })
    });

    const res = await fetch(`${serverCtx.baseUrl}/api/channel/reconnect`, {
      method: "POST",
      headers: { "Content-Type": "application/json" }
    });
    assert.equal(res.status, 200, "重新连接应返回 200");
    const data = await res.json();
    assert.equal(data.channelType, "feishu", "响应应标识 channelType=feishu");
    assert.ok(["connecting", "online", "offline"].includes(data.status), `status 应为三态之一，实际: ${data.status}`);
    assert.ok(data.error === undefined || data.error === null || typeof data.error === "string", "error 字段应为字符串、null 或不存在");
  });
});
