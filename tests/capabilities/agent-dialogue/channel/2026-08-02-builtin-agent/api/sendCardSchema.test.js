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
//
// BUG-004（code-defect，2026-08-02-ui-copilot 计数）层 1 回归：finalizeCard 请求体
// 必须符合 CardKit 更新配置接口 schema——PUT /cardkit/v1/cards/:card_id/settings，
// settings 为 JSON 字符串（{ config: { streaming_mode: false, summary: { content } } }），
// 带 sequence/uuid。修复前红（adapter 无 finalizeCard 方法）。
//
// BUG-011（code-defect）回归：同一张卡片的流式更新（PUT elements/content）与定型
// （PATCH settings）必须按调用顺序落地飞书。修复前两者是 fire-and-forget 独立 HTTP
// 调用，finalize 抢在在途尾部更新之前到达 → streaming_mode 关闭 → 尾部更新被拒 →
// 卡片冻结在半途（生产实锤：226 次更新全派发、finalize 成功、卡片仅显示前缀）。
//
// BUG-012（code-defect）回归：串行化（BUG-011）引入排队追账——每个 delta 更新都
// 支付一次 HTTP 往返，后台早已跑完而卡片还在逐条落地。H4 契约 content 是全量累计
// 文本：排队中的旧更新已被后来者完整覆盖，出队时应跳过（零信息丢失），仅最新更新
// 与 finalize 实际落地；finalize 永不合并、顺序保证不弱化。
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

// —— 层 1：feishuChannelAdapter.sendCard 的 HTTP 请求体（mock global.fetch）——
// mock 飞书开放平台：token + cardkit 创建 + 消息发送。记录发往 /cardkit/v1/cards 的请求体。
function mockFeishuOpenPlatform() {
  const originalFetch = global.fetch;
  const cardCreateBodies = [];
  const messageBodies = [];
  const settingsBodies = [];
  global.fetch = async (url, init) => {
    const urlStr = String(url);
    if (urlStr.includes("open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal")) {
      return new Response(JSON.stringify({ code: 0, tenant_access_token: "fake-tenant-token", expire: 7200 }), { status: 200 });
    }
    // BUG-004：settings 端点先于通用 cardkit 匹配（URL 同含 /cardkit/v1/cards）。
    if (urlStr.includes("open.feishu.cn/open-apis/cardkit/v1/cards") && urlStr.endsWith("/settings")) {
      const body = init?.body ? JSON.parse(init.body) : {};
      settingsBodies.push({ url: urlStr, body, method: init?.method ?? "GET" });
      return new Response(JSON.stringify({ code: 0, msg: "success", data: {} }), { status: 200 });
    }
    if (urlStr.includes("open.feishu.cn/open-apis/cardkit/v1/cards")) {
      const body = init?.body ? JSON.parse(init.body) : {};
      cardCreateBodies.push({ url: urlStr, body, headers: init?.headers ?? {} });
      return new Response(JSON.stringify({ code: 0, msg: "success", data: { card_id: "card_fake_1" } }), { status: 200 });
    }
    if (urlStr.includes("open.feishu.cn/open-apis/im/v1/messages")) {
      const body = init?.body ? JSON.parse(init.body) : {};
      messageBodies.push({ url: urlStr, body });
      return new Response(JSON.stringify({ code: 0, msg: "success", data: { message_id: "om_fake_1" } }), { status: 200 });
    }
    return originalFetch(url, init);
  };
  return {
    cardCreateBodies,
    messageBodies,
    settingsBodies,
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

  it("发送交互消息的 content 为 { type: card, data: { card_id } }（修复前红：裸 {card_id} → 200621 parse card json err）", async () => {
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

    assert.equal(mock.messageBodies.length, 1, "应调用一次 im/v1/messages 发送卡片实体");
    const msg = mock.messageBodies[0].body;
    assert.equal(msg.msg_type, "interactive", "发送卡片应为 interactive 消息");
    const content = JSON.parse(msg.content);
    // 官方 schema：content 为 { type: "card", data: { card_id } }。
    assert.equal(content.type, "card", "content.type 应为 card（官方 schema，裸 {card_id} 会 200621）");
    assert.equal(typeof content.data?.card_id, "string", "content.data.card_id 应为卡片实体 ID");
  });
});

describe("BUG-004 层 1：finalizeCard 请求体符合 CardKit 更新配置接口（REQ-AGENT-019 标准 2）", () => {
  let mock;

  beforeEach(() => {
    mock = mockFeishuOpenPlatform();
  });

  afterEach(() => {
    mock.restore();
  });

  it("PATCH /cards/:id/settings：settings JSON 字符串含 streaming_mode=false + summary.content（修复前红：误用 PUT → 404）", async () => {
    const create = await loadAdapter();
    const adapter = create({
      domain: "https://open.feishu.cn",
      credentials: { appId: "cli_test00000000000001", appSecret: "secret" },
    });
    await adapter.start();

    assert.equal(typeof adapter.finalizeCard, "function", "adapter 应提供 finalizeCard 定型 seam（修复前缺失）");
    await adapter.finalizeCard({ cardId: "card_fake_1", summary: "执行列表", sequence: 3 });

    assert.equal(mock.settingsBodies.length, 1, "应调用一次 settings 接口（PATCH cards/:id/settings）");
    const rec = mock.settingsBodies[0];
    assert.ok(rec.url.includes("/open-apis/cardkit/v1/cards/card_fake_1/settings"), "URL 应为 settings 端点");
    // BUG-005 实测实证：settings 接口官方方法为 PATCH——PUT 获网关级 404（无 code 字段）。
    assert.equal(rec.method, "PATCH", "settings 接口方法应为 PATCH（PUT 被飞书网关 404，BUG-005 实测）");
    // 官方 schema：settings 为 JSON 字符串（非 object），内含 config 层字段。
    assert.equal(typeof rec.body.settings, "string", "settings 应为 JSON 字符串（官方 schema）");
    const settings = JSON.parse(rec.body.settings);
    assert.equal(settings.config?.streaming_mode, false, "定型应关闭 streaming_mode（列表不再卡「生成中...」）");
    assert.equal(settings.config?.summary?.content, "执行列表", "summary 应换为正文摘要");
    assert.equal(rec.body.sequence, 3, "应携带流式序号（H4 严格递增）");
    assert.equal(typeof rec.body.uuid, "string", "应携带幂等 uuid");
  });
});

// —— BUG-011 层 1：同卡更新/定型的落地顺序（mock global.fetch，PUT 挂起可控）——
describe("BUG-011 回归：同卡更新/定型按序落地，finalize 不抢跑在途更新（REQ-AGENT-019 标准 1/2）", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("在途 updateCardStream 未落地前，finalizeCard 不得发出 PATCH settings（修复前红：finalize 立即派发）", async () => {
    const wireOrder = [];
    let releaseUpdate;
    const updateGate = new Promise((resolve) => {
      releaseUpdate = resolve;
    });
    global.fetch = async (url, init) => {
      const urlStr = String(url);
      if (urlStr.includes("open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal")) {
        return new Response(JSON.stringify({ code: 0, tenant_access_token: "fake-tenant-token", expire: 7200 }), { status: 200 });
      }
      if (urlStr.includes("open.feishu.cn/open-apis/cardkit/v1/cards") && urlStr.endsWith("/settings")) {
        wireOrder.push("finalize");
        return new Response(JSON.stringify({ code: 0, msg: "success", data: {} }), { status: 200 });
      }
      if (urlStr.includes("open.feishu.cn/open-apis/cardkit/v1/cards") && urlStr.includes("/elements/")) {
        wireOrder.push("update");
        await updateGate; // 模拟 HTTP 在途：更新未落地
        return new Response(JSON.stringify({ code: 0, msg: "success", data: {} }), { status: 200 });
      }
      throw new Error(`unexpected fetch: ${urlStr}`);
    };

    const create = await loadAdapter();
    const adapter = create({
      domain: "https://open.feishu.cn",
      credentials: { appId: "cli_test00000000000001", appSecret: "secret" },
    });
    await adapter.start();

    const updatePromise = adapter.updateCardStream({ cardId: "card_x", content: "累计文本", sequence: 1 });
    const finalizePromise = adapter.finalizeCard({ cardId: "card_x", summary: "摘要", sequence: 2 });

    // 让两个调用的首个 fetch 都有机会发出（修复前 finalize 立即发出 PATCH → 红）。
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    assert.deepEqual(wireOrder, ["update"], "在途更新未落地前 finalize 不得发出（否则 streaming_mode 先关、尾部更新被拒）");

    releaseUpdate();
    await updatePromise;
    await finalizePromise;
    assert.deepEqual(wireOrder, ["update", "finalize"], "定型须在末尾内容更新落地后发出");
  });
});

// —— BUG-012 层 1：同卡排队更新合并（mock global.fetch，PUT 挂起可控）——
describe("BUG-012 回归：同卡排队更新合并，不为每个 delta 支付一次往返（REQ-AGENT-019 标准 1）", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("在途更新未落地时新更新入队 → 被覆盖的旧更新跳过 HTTP，仅最新更新与 finalize 落地（修复前红：逐条落地）", async () => {
    const wireOrder = [];
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    global.fetch = async (url, init) => {
      const urlStr = String(url);
      if (urlStr.includes("open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal")) {
        return new Response(JSON.stringify({ code: 0, tenant_access_token: "fake-tenant-token", expire: 7200 }), { status: 200 });
      }
      if (urlStr.includes("open.feishu.cn/open-apis/cardkit/v1/cards") && urlStr.endsWith("/settings")) {
        wireOrder.push("finalize");
        return new Response(JSON.stringify({ code: 0, msg: "success", data: {} }), { status: 200 });
      }
      if (urlStr.includes("open.feishu.cn/open-apis/cardkit/v1/cards") && urlStr.includes("/elements/")) {
        const body = init?.body ? JSON.parse(init.body) : {};
        wireOrder.push(`update:${body.sequence}`);
        await gate; // 模拟 HTTP 在途：所有更新挂起，队列确定性积压
        return new Response(JSON.stringify({ code: 0, msg: "success", data: {} }), { status: 200 });
      }
      throw new Error(`unexpected fetch: ${urlStr}`);
    };

    const create = await loadAdapter();
    const adapter = create({
      domain: "https://open.feishu.cn",
      credentials: { appId: "cli_test00000000000001", appSecret: "secret" },
    });
    await adapter.start();

    const p1 = adapter.updateCardStream({ cardId: "card_x", content: "第一段", sequence: 1 });
    const p2 = adapter.updateCardStream({ cardId: "card_x", content: "第一段第二段", sequence: 2 });
    const p3 = adapter.updateCardStream({ cardId: "card_x", content: "第一段第二段第三段", sequence: 3 });
    const p4 = adapter.finalizeCard({ cardId: "card_x", summary: "摘要", sequence: 4 });

    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    assert.deepEqual(wireOrder, ["update:1"], "仅首个更新在途，其余排队");

    release();
    await Promise.all([p1, p2, p3, p4]);
    // 签核（BUG-012 人拍板）：seq2 的 content 已被 seq3 全量覆盖 → 跳过 HTTP；
    // 最终卡片内容 = seq3 全量文本，零信息丢失；finalize 永不合并、仍在最后。
    assert.deepEqual(wireOrder, ["update:1", "update:3", "finalize"], "被覆盖的 seq2 应跳过 HTTP（content 全量累计，零信息丢失），finalize 在最后");
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
    // BUG-012 重签（人拍板 2026-08-17）：print_step 1→10——70ms/1 字符 ≈ 14 字符/秒，
    // 长回复内容到齐后仍打字机几十秒；提速后约 143 字符/秒（500 字 ~3.5s）。
    assert.equal(sc.print_step.default, 10, "print_step.default = 10（BUG-012 重签：打字机提速）");
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

  it("summary 在 config 层为 {content} 对象（修复前红：误放 streaming_config 且为字符串 → parse card json err）", async () => {
    const createCardRenderer = await loadCardRenderer();
    const adapter = createCardAdapterFake();
    const renderer = createCardRenderer({ adapter });
    renderer.handleStreamEvent({ sessionKey: "feishu:oc_1", type: "text_delta", delta: "你好" });
    const card = adapter.calls.sendCard[0];
    assert.ok(card?.cardJson, "流式开始应发卡");
    // 官方 schema：summary 是 config 层字段，值为 { content: string }；
    // streaming_config 层不含 summary（误放会 200621 parse card json err）。
    const config = card.cardJson.config ?? {};
    assert.equal(
      typeof config.summary,
      "object",
      `summary 应在 config 层且为 {content} 对象，实际: ${JSON.stringify(config.summary)}`
    );
    assert.equal(typeof config.summary?.content, "string", "config.summary.content 应为字符串");
    // streaming_config 层不得残留 summary（官方该层无此字段）。
    const sc = config.streaming_config ?? {};
    assert.ok(
      !Object.prototype.hasOwnProperty.call(sc, "summary"),
      `streaming_config 层不应含 summary（官方 schema 无此字段），实际: ${JSON.stringify(Object.keys(sc))}`
    );
  });
});
