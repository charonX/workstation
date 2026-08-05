// REQ-TRACE: 2026-08-02-builtin-agent/REQ-AGENT-019
// REQ-VERSION: v1-hash:16f30c7bbd781fb9f86f573f3c92dc0c96a1aa38aecf3bd08c54caa0cdb712f4
// CAPABILITY-TRACE: agent-dialogue
// ENTITY-TRACE: channel
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true

// BUG-006（code-defect）回归：sendCard 请求体必须符合 CardKit 创建接口 schema，
// 否则飞书 API 返回 400 code=99992402 field validation failed → 回复卡片发不出。
//
// 根因（对照官方 schema），跨两层：
// - feishuChannelAdapter.sendCard：创建接口要求外层 { type: "card_json", data: "<转义卡片JSON>" }，
//   实现直接 POST 裸 JSON；card_id 在响应 data.card_id，实现解析路径错。
// - cardRenderer.buildStreamingCard：print_frequency_ms/print_step 应为分端 object
//   （{default: 70}），实现发数字；元素标识应为 element_id（字母开头≤20字符），实现用非官方 id。
//
// 测试分两层：adapter 层 mock global.fetch 断言请求体外层结构；cardRenderer 层用
// adapter fake 捕获 cardJson 断言卡片 JSON 内部结构。修复前红，修复后绿。
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

// —— 层 1：feishuChannelAdapter.sendCard 的 HTTP 请求体（mock global.fetch）——
// mock 飞书开放平台：token + cardkit 创建 + 消息发送。记录发往 /cardkit/v1/cards 的请求体。
function mockFeishuOpenPlatform() {
  const originalFetch = global.fetch;
  const cardCreateBodies = [];
  global.fetch = async (url, init) => {
    const urlStr = String(url);
    if (urlStr.includes("open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal")) {
      return new Response(JSON.stringify({ code: 0, tenant_access_token: "fake-tenant-token", expire: 7200 }), { status: 200 });
    }
    if (urlStr.includes("open.feishu.cn/open-apis/cardkit/v1/cards")) {
      const body = init?.body ? JSON.parse(init.body) : {};
      cardCreateBodies.push({ url: urlStr, body, headers: init?.headers ?? {} });
      return new Response(JSON.stringify({ code: 0, msg: "success", data: { card_id: "card_fake_1" } }), { status: 200 });
    }
    if (urlStr.includes("open.feishu.cn/open-apis/im/v1/messages")) {
      return new Response(JSON.stringify({ code: 0, msg: "success", data: { message_id: "om_fake_1" } }), { status: 200 });
    }
    return originalFetch(url, init);
  };
  return {
    cardCreateBodies,
    restore() {
      global.fetch = originalFetch;
    },
  };
}

async function loadAdapter() {
  const mod = await import("../../../../../../src/services/channels/feishuChannelAdapter.js").catch(() => null);
  assert.ok(mod, "seam 未就绪：src/services/channels/feishuChannelAdapter.js 应可导入");
  assert.equal(typeof mod.createFeishuChannelAdapter, "function", "应导出 createFeishuChannelAdapter()");
  return mod.createFeishuChannelAdapter;
}

describe("BUG-006 层 1：sendCard 请求体符合 CardKit 创建接口（REQ-AGENT-019）", () => {
  let mock;

  beforeEach(() => {
    mock = mockFeishuOpenPlatform();
  });

  afterEach(() => {
    mock.restore();
  });

  it("创建卡片实体请求体含 type=card_json + data 转义卡片 JSON（修复前红：裸 JSON 无包装）", async () => {
    const create = await loadAdapter();
    const adapter = create({
      domain: "https://open.feishu.cn",
      credentials: { appId: "cli_test00000000000001", appSecret: "secret" },
    });
    await adapter.start();

    const cardJson = {
      schema: "2.0",
      config: { streaming_mode: true, streaming_config: { summary: "[生成中...]" } },
      body: { elements: [{ tag: "markdown", element_id: "content", content: "你好" }] },
    };
    await adapter.sendCard({ chatId: "oc_1", cardJson });

    assert.equal(mock.cardCreateBodies.length, 1, "应调用一次 /cardkit/v1/cards 创建卡片实体");
    const body = mock.cardCreateBodies[0].body;
    // 官方 schema：外层 { type: "card_json", data: "<转义卡片JSON字符串>" }。
    assert.equal(body.type, "card_json", "创建卡片实体请求体必须含 type=card_json");
    assert.equal(typeof body.data, "string", "data 应为转义后的卡片 JSON 字符串");
    const parsed = JSON.parse(body.data);
    assert.equal(parsed.schema, "2.0", "data 内卡片 JSON 应声明 schema 2.0");
  });

  it("创建卡片后返回 { cardId } 供 updateCardStream 引用（修复前红：card_id 解析路径错）", async () => {
    const create = await loadAdapter();
    const adapter = create({
      domain: "https://open.feishu.cn",
      credentials: { appId: "cli_test00000000000001", appSecret: "secret" },
    });
    await adapter.start();

    const cardJson = {
      schema: "2.0",
      config: { streaming_mode: true, streaming_config: { summary: "[生成中...]" } },
      body: { elements: [{ tag: "markdown", element_id: "content", content: "你好" }] },
    };
    const result = await adapter.sendCard({ chatId: "oc_1", cardJson });
    assert.equal(result?.cardId, "card_fake_1", "sendCard 应返回 data.card_id 供 updateCardStream 引用");
  });
});

// —— 层 2：cardRenderer.buildStreamingCard 构造的卡片 JSON 内部结构 ——
// adapter fake 捕获 cardJson（对齐 cardStream.test.js 的 createCardAdapterFake 模式）。
function createCardAdapterFake() {
  const calls = { sendCard: [], updateCardStream: [], send: [] };
  let seq = 0;
  return {
    calls,
    async sendCard({ chatId, cardJson } = {}) {
      calls.sendCard.push({ chatId, cardJson });
      seq += 1;
      return { cardId: `card_${seq}` };
    },
    async updateCardStream({ cardId, content, sequence } = {}) {
      calls.updateCardStream.push({ cardId, content, sequence });
      return { ok: true };
    },
    async send({ chatId, text } = {}) {
      calls.send.push({ chatId, text });
      return { messageId: `om_${seq}` };
    },
  };
}

async function loadCardRenderer() {
  const mod = await import("../../../../../../src/services/cardRenderer.js").catch(() => null);
  assert.ok(mod, "seam 未就绪：src/services/cardRenderer.js 应可导入");
  assert.equal(typeof mod.createCardRenderer, "function", "应导出 createCardRenderer()");
  return mod.createCardRenderer;
}

describe("BUG-006 层 2：buildStreamingCard 构造的卡片 JSON 符合官方 schema", () => {
  it("streaming_config 的 print_frequency_ms/print_step 为分端 object（修复前红：数字）", async () => {
    const createCardRenderer = await loadCardRenderer();
    const adapter = createCardAdapterFake();
    const renderer = createCardRenderer({ adapter });
    renderer.handleStreamEvent({ sessionKey: "feishu:oc_1", type: "text_delta", delta: "执行" });
    const card = adapter.calls.sendCard[0];
    assert.ok(card?.cardJson, "流式开始应发卡");
    const sc = card.cardJson.config?.streaming_config ?? {};
    assert.equal(typeof sc.print_frequency_ms, "object", "print_frequency_ms 应为分端 object（官方 schema）");
    assert.equal(sc.print_frequency_ms.default, 70, "print_frequency_ms.default = 70");
    assert.equal(typeof sc.print_step, "object", "print_step 应为分端 object（官方 schema）");
    assert.equal(sc.print_step.default, 1, "print_step.default = 1");
  });

  it("可流式更新的元素用 element_id 标识（修复前红：非官方字段 id）", async () => {
    const createCardRenderer = await loadCardRenderer();
    const adapter = createCardAdapterFake();
    const renderer = createCardRenderer({ adapter });
    renderer.handleStreamEvent({ sessionKey: "feishu:oc_1", type: "text_delta", delta: "你好" });
    const card = adapter.calls.sendCard[0];
    assert.ok(card?.cardJson, "流式开始应发卡");
    const el = card.cardJson.body?.elements?.[0] ?? {};
    assert.equal(
      typeof el.element_id,
      "string",
      `流式更新元素应含 element_id（字母开头≤20字符，供 PUT .../elements/:element_id/content 引用），实际字段: ${JSON.stringify(Object.keys(el))}`
    );
  });
});
