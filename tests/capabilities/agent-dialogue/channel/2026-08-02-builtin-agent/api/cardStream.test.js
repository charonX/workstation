// REQ-TRACE: 2026-08-02-builtin-agent/REQ-AGENT-019, 2026-08-02-builtin-agent/REQ-AGENT-020
// REQ-VERSION: v1-hash:16f30c7bbd781fb9f86f573f3c92dc0c96a1aa38aecf3bd08c54caa0cdb712f4
// CAPABILITY-TRACE: agent-dialogue
// ENTITY-TRACE: channel
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true
// BUG-TRACE: Slice 7 code-defect（待 /bug 编号）——缺陷 1：cardRenderer 流式结束（text_end/error）
// 只置 final=true 不删 streams 条目，下一轮首个事件被丢弃（第二轮零产出）；缺陷 2：imRouter 对
// 同一会话句柄每条消息重复 session.on（监听器累积 → 每轮事件触发 N 次）。两例回归 Prove-It，修复前应红。
// BUG-TRACE: BUG-004（2026-08-02-ui-copilot 计数，code-defect）——流式结束/错误/任务终态只做元素
// 内容终更（PUT elements/content），从未调更新配置接口（PUT cards/:id/settings）关闭 streaming_mode +
// 更新 summary → 飞书会话列表永远卡初始 summary「[生成中...]」（REQ-AGENT-019 标准 2「卡片定型」
// 飞书侧未落地；H4 spike：建议手动 card.settings 关 streaming_mode）。回归 Prove-It，修复前应红。
// BUG-TRACE: BUG-009（2026-08-02-builtin-agent 计数，code-defect）——worker 的 text_end 是
// 每 LLM 回合一次（PI assistantMessageEvent 逐回合映射），cardRenderer 却把 text_end 当「整条
// 回复结束」：首个 text_end 即定型并置 final，工具调用后第二段（回合 2）的 text_delta/text_end
// 撞 final 守卫全部丢弃 → 飞书只收到第一段（2026-08-16 生产实锤）。回归 Prove-It，修复前应红。

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createMockChannelAdapter } from "../../../../../fixtures/media-production-line/mockChannelAdapter.js";
import { getDb } from "../../../../../../src/db.js";

// seam：会话卡片渲染器 + feishuChannelAdapter 卡片接口（adapter fake 断言结构与 sequence）。
// 依赖 H4 假设（CardKit 卡片流式最小调用，spike 已证）。

// seam：会话卡片渲染器（tech-design「会话卡片渲染器（主进程）」+ F1）。
// 建议落点 src/services/cardRenderer.js，导出 createCardRenderer({ adapter, streamWindowMs = 10min, retries = 3, sessions }) →
// { handleStreamEvent({sessionKey, type, delta|content|code}), handleExecutionEvent({sessionKey, type: started|progress|completed, executionId, status, ...}) }。
// 事件驱动（eventBus 执行事件接线由实现定，测试直接驱动 handleExecutionEvent）。
async function loadCardRenderer() {
  const mod = await import("../../../../../../src/services/cardRenderer.js").catch(() => null);
  assert.ok(mod, "seam 未就绪：src/services/cardRenderer.js 尚未实现（REQ-AGENT-019/020）");
  assert.equal(typeof mod.createCardRenderer, "function", "cardRenderer 应导出 createCardRenderer()");
  return mod.createCardRenderer;
}

// adapter fake：记录 sendCard / updateCardStream / send / finalizeCard 调用（接口契约对齐 tech-design F1）：
// sendCard({chatId, cardJson}) → {cardId}；updateCardStream({cardId, content, sequence})；send({chatId, text})；
// finalizeCard({cardId, summary, sequence})（BUG-004：定型 = 关 streaming_mode + summary 换正文摘要）。
function createCardAdapterFake() {
  const calls = { sendCard: [], updateCardStream: [], send: [], finalizeCard: [] };
  let seq = 0;
  let failUpdatesRemaining = 0;
  return {
    calls,
    failNextUpdate(times = 1) { failUpdatesRemaining += times; },
    async sendCard({ chatId, cardJson } = {}) {
      calls.sendCard.push({ chatId, cardJson });
      seq += 1;
      return { cardId: `card_${seq}` };
    },
    async updateCardStream({ cardId, content, sequence } = {}) {
      if (failUpdatesRemaining > 0) {
        failUpdatesRemaining -= 1;
        throw new Error("E-CHANNEL-SEND: mock adapter update failure");
      }
      calls.updateCardStream.push({ cardId, content, sequence });
      return { ok: true };
    },
    async send({ chatId, text } = {}) {
      calls.send.push({ chatId, text });
      seq += 1;
      return { messageId: `om_${seq}` };
    },
    async finalizeCard({ cardId, summary, sequence } = {}) {
      calls.finalizeCard.push({ cardId, summary, sequence });
      return { ok: true };
    }
  };
}

function chatIdOf(sessionKey) {
  return sessionKey.replace(/^feishu:/, "");
}

// seam：imRouter（REQ-AGENT-019 会话事件接线；code-defect 2 监听器累积回归）。
async function loadImRouter() {
  const mod = await import("../../../../../../src/services/channels/imRouter.js").catch(() => null);
  assert.ok(mod, "seam 未就绪：src/services/channels/imRouter.js");
  return mod.createImRouter;
}

// session 句柄 fake：on() 记录挂载次数（监听器累积判定），emit() 触发已挂监听器。
function createSessionMock() {
  const listeners = {};
  const calls = { on: 0 };
  return {
    calls,
    on(event, cb) {
      calls.on += 1;
      (listeners[event] ??= []).push(cb);
      return () => {};
    },
    emit(event, payload) {
      for (const cb of listeners[event] ?? []) cb(payload);
    },
  };
}

// 冲刷微任务：sendCard 异步回填 cardId（Promise.resolve(...).then）完成后继续观测。
const flushMicrotasks = () => new Promise((resolve) => setImmediate(resolve));
// 路由链 settle：agentRouter → agentService → session.on → prompt（微任务链）。
const settle = () => new Promise((resolve) => setTimeout(resolve, 30));

describe("REQ-AGENT-019 回复卡片流式", () => {
  let workdir;

  beforeEach(() => {
    workdir = fs.mkdtempSync(path.join(os.tmpdir(), "card-stream-"));
  });

  afterEach(() => {
    fs.rmSync(workdir, { recursive: true, force: true });
  });

  it("流式输出 → sendCard + updateCardStream 按序更新（sequence 递增）", async () => {
    const createCardRenderer = await loadCardRenderer();
    const adapter = createCardAdapterFake();
    const renderer = createCardRenderer({ adapter });
    renderer.handleStreamEvent({ sessionKey: "feishu:oc_1", type: "text_delta", delta: "执行" });
    renderer.handleStreamEvent({ sessionKey: "feishu:oc_1", type: "text_delta", delta: "列表" });
    renderer.handleStreamEvent({ sessionKey: "feishu:oc_1", type: "text_end", content: "执行列表" });
    assert.equal(adapter.calls.sendCard.length, 1, "流式开始应 sendCard 一次（回复卡片）");
    const card = adapter.calls.sendCard[0];
    assert.equal(card.chatId, "oc_1", "卡片应发给正确 chatId");
    assert.ok(card.cardJson, "卡片应有内容");
    const updates = adapter.calls.updateCardStream;
    assert.ok(updates.length >= 2, `应有增量更新，实际 ${updates.length} 条`);
    // sequence 严格递增（签核决策 19 / REQ-AGENT-019 标准 1）。
    for (let i = 1; i < updates.length; i += 1) {
      assert.ok(updates[i].sequence > updates[i - 1].sequence, `sequence 应严格递增，第 ${i} 条违例`);
    }
    assert.ok(updates.every((u) => u.cardId === card.cardId), "增量更新应指向同一卡片");
    assert.ok(JSON.stringify(updates.at(-1).content).includes("执行列表"), "最终内容应为完整回复");
  });

  it("流式结束卡片定型；错误标注失败状态", async () => {
    const createCardRenderer = await loadCardRenderer();
    const adapter = createCardAdapterFake();
    const renderer = createCardRenderer({ adapter });
    renderer.handleStreamEvent({ sessionKey: "feishu:oc_1", type: "text_delta", delta: "部分" });
    await flushMicrotasks(); // cardId 回填（后续更新指向 card_1 可辨别）
    renderer.handleStreamEvent({ sessionKey: "feishu:oc_1", type: "text_end", content: "部分内容" });
    const updatesOnCard1 = () =>
      adapter.calls.updateCardStream.filter((u) => u.cardId === "card_1").length;
    const beforeExtra = updatesOnCard1();
    // 流式结束 → 卡片定型：旧卡停止更新（REQ-AGENT-019 标准 2）。
    // BUG-009 重签（人拍板 2026-08-16）：text_end 是回合边界而非消息边界——定型后再来
    // 文本事件 = 新回合开新卡，旧卡不再收更新（原断言「后续 delta 零更新」即 BUG-009
    // 的缺陷场景本身，已随修复裁决改写）。
    renderer.handleStreamEvent({ sessionKey: "feishu:oc_1", type: "text_delta", delta: "后续回合增量" });
    assert.equal(updatesOnCard1(), beforeExtra, "卡片定型后旧卡应停止更新");
    assert.equal(adapter.calls.sendCard.length, 2, "后续文本段应开新卡（BUG-009：回合边界 ≠ 消息边界）");

    // 流式错误 → 卡片标注失败状态。
    const adapter2 = createCardAdapterFake();
    const renderer2 = createCardRenderer({ adapter: adapter2 });
    renderer2.handleStreamEvent({ sessionKey: "feishu:oc_1", type: "text_delta", delta: "开头" });
    renderer2.handleStreamEvent({ sessionKey: "feishu:oc_1", type: "error", code: "E-AGENT-LLM-FAIL", userMessage: "供应商失败" });
    const last2 = adapter2.calls.updateCardStream.at(-1);
    assert.ok(last2, "错误后应有更新动作");
    assert.ok(
      JSON.stringify(last2.content).includes("失败") || last2.failed === true,
      "错误后卡片应标注失败状态"
    );
  });

  it("流式窗口 10 分钟关闭 → 降级普通消息 + /status 提示", async () => {
    const createCardRenderer = await loadCardRenderer();
    const adapter = createCardAdapterFake();
    // 窗口长度可注入（签核决策 19：10 分钟窗口，测试压缩模拟关闭）。
    const renderer = createCardRenderer({ adapter, streamWindowMs: 50 });
    renderer.handleStreamEvent({ sessionKey: "feishu:oc_1", type: "text_delta", delta: "开头" });
    assert.equal(adapter.calls.sendCard.length, 1, "窗口内应使用卡片流式");
    await new Promise((resolve) => setTimeout(resolve, 80)); // 窗口自动关闭
    renderer.handleStreamEvent({ sessionKey: "feishu:oc_1", type: "text_delta", delta: "窗口后增量" });
    const plain = adapter.calls.send.find((s) => s.chatId === "oc_1");
    assert.ok(plain, "窗口关闭后应降级普通文本消息（E-CARD-STREAM-CLOSED，签核决策 19）");
    assert.ok(JSON.stringify(plain.text).includes("/status"), "降级消息应提示可用 /status 查询");
  });

  it("多轮对话：每轮各一张回复卡片，更新指向各自卡片（code-defect 1：第二轮零产出回归）", async () => {
    const createCardRenderer = await loadCardRenderer();
    const adapter = createCardAdapterFake();
    const renderer = createCardRenderer({ adapter });
    // 同一渲染器实例（不重建）模拟两轮流式事件序列（签核决策 19：每轮对话流式更新）。
    renderer.handleStreamEvent({ sessionKey: "feishu:oc_1", type: "stream_start" });
    await flushMicrotasks(); // sendCard 异步回填 cardId（后续更新携带真实 card_id）
    renderer.handleStreamEvent({ sessionKey: "feishu:oc_1", type: "text_delta", delta: "第一轮增量" });
    renderer.handleStreamEvent({ sessionKey: "feishu:oc_1", type: "text_end", content: "第一轮完整回复" });
    renderer.handleStreamEvent({ sessionKey: "feishu:oc_1", type: "stream_start" });
    await flushMicrotasks();
    renderer.handleStreamEvent({ sessionKey: "feishu:oc_1", type: "text_delta", delta: "第二轮增量" });
    renderer.handleStreamEvent({ sessionKey: "feishu:oc_1", type: "text_end", content: "第二轮完整回复" });

    assert.equal(adapter.calls.sendCard.length, 2, "每轮对话应各发一张回复卡片（修复前第二轮零产出：仅 1 张）");
    const updates = adapter.calls.updateCardStream;
    // 两轮增量之和：每轮 text_delta + text_end 各一次更新（缺陷复现：turn1 updates=2、turn2 updates=2）。
    assert.equal(updates.length, 4, `第二轮事件不应被丢弃（updates = 两轮增量之和 4，实际 ${updates.length}）`);
    assert.ok(updates.slice(0, 2).every((u) => u.cardId === "card_1"), "第一轮更新应指向第一张卡片（不串卡）");
    assert.ok(updates.slice(2).every((u) => u.cardId === "card_2"), "第二轮更新应指向第二张卡片（不串卡）");
    assert.ok(JSON.stringify(updates.at(-1).content).includes("第二轮完整回复"), "第二轮最终内容应为第二轮完整回复");
  });
});

describe("REQ-AGENT-020 任务卡片流式与降级", () => {
  let workdir;

  beforeEach(() => {
    workdir = fs.mkdtempSync(path.join(os.tmpdir(), "card-stream-"));
  });

  afterEach(() => {
    fs.rmSync(workdir, { recursive: true, force: true });
  });

  it("执行启动 → 任务卡片；进度增量更新；终态含执行 id", async () => {
    const createCardRenderer = await loadCardRenderer();
    const adapter = createCardAdapterFake();
    const renderer = createCardRenderer({ adapter });
    const execId = crypto.randomUUID();
    renderer.handleExecutionEvent({ sessionKey: "feishu:oc_1", type: "started", executionId: execId, flowId: "flow_1" });
    renderer.handleExecutionEvent({ sessionKey: "feishu:oc_1", type: "progress", executionId: execId, status: "running", log: "正在执行" });
    renderer.handleExecutionEvent({ sessionKey: "feishu:oc_1", type: "completed", executionId: execId, status: "success" });
    assert.equal(adapter.calls.sendCard.length, 1, "执行启动应发送任务卡片（签核决策 20）");
    assert.ok(JSON.stringify(adapter.calls.sendCard[0].cardJson).includes(execId), "任务卡片应含执行 id");
    assert.ok(adapter.calls.updateCardStream.length >= 2, "进度应增量更新卡片（REQ-AGENT-020 标准 1）");
    const last = adapter.calls.updateCardStream.at(-1);
    const lastJson = JSON.stringify(last.content);
    assert.ok(lastJson.includes(execId) || lastJson.includes("success"), "终态卡片应含执行 id（可 /status 复核）");
  });

  it("执行结果经对话回投（会话活跃时）", async () => {
    const createCardRenderer = await loadCardRenderer();
    const adapter = createCardAdapterFake();
    const replies = [];
    const sessions = {
      "feishu:oc_1": { onExecutionResult: async (result) => { replies.push(result); } }
    };
    const renderer = createCardRenderer({ adapter, sessions });
    const execId = crypto.randomUUID();
    renderer.handleExecutionEvent({ sessionKey: "feishu:oc_1", type: "completed", executionId: execId, status: "success", output: "任务完成" });
    assert.equal(replies.length, 1, "会话活跃时执行结果应经对话回投（REQ-AGENT-020 标准 3）");
    assert.ok(JSON.stringify(replies[0]).includes(execId), "回投应含执行结果（agent 生成摘要）");
  });

  it("卡片更新失败（重试耗尽）→ 告警不阻断执行", async () => {
    const createCardRenderer = await loadCardRenderer();
    const adapter = createCardAdapterFake();
    // 该例 fake 的 updateCardStream 去掉 async（失败同步抛出）：渲染器同步重试路径
    // 同步记录告警，下方同步断言诚实成立（async fake 的 failure 是 rejected promise，
    // 仅微任务可见——同步观测不可能，属 sync/async seam 契约冲突，就地补全）。
    let failUpdatesRemaining = 3;
    adapter.updateCardStream = function updateCardStreamSync({ cardId, content, sequence } = {}) {
      if (failUpdatesRemaining > 0) {
        failUpdatesRemaining -= 1;
        throw new Error("E-CHANNEL-SEND: mock adapter update failure");
      }
      adapter.calls.updateCardStream.push({ cardId, content, sequence });
      return { ok: true };
    };
    const renderer = createCardRenderer({ adapter, retries: 1 });
    const execId = crypto.randomUUID();
    const started = renderer.handleExecutionEvent({ sessionKey: "feishu:oc_1", type: "started", executionId: execId });
    assert.ok(started, "任务卡片发送应已发起");
    // 更新失败重试耗尽 → E-CHANNEL-SEND 告警（不阻断执行，回归 REQ-CHANNEL-003 语义，REQ-AGENT-020 标准 4）。
    const terminal = renderer.handleExecutionEvent({ sessionKey: "feishu:oc_1", type: "completed", executionId: execId, status: "success" });
    assert.ok(terminal?.terminal === true, "卡片失败不应阻断执行（终态仍应达成）");
    assert.ok(
      renderer.warnings?.some((w) => JSON.stringify(w).includes("E-CHANNEL-SEND")),
      "更新失败重试耗尽应产生 E-CHANNEL-SEND 告警"
    );
  });
});

describe("code-defect 回归：imRouter 对同一会话只挂一次监听器（缺陷 2：监听器累积）", () => {
  let workdir;
  let prevDbPath;

  beforeEach(() => {
    workdir = fs.mkdtempSync(path.join(os.tmpdir(), "im-router-"));
    prevDbPath = process.env.DB_PATH;
    // 消息去重（channel_messages）走真实 DB（REQ-CHANNEL-002 语义），指向临时库。
    process.env.DB_PATH = path.join(workdir, "data.db");
    getDb();
  });

  afterEach(() => {
    if (prevDbPath === undefined) delete process.env.DB_PATH;
    else process.env.DB_PATH = prevDbPath;
    fs.rmSync(workdir, { recursive: true, force: true });
  });

  it("imRouter 对同一会话只挂一次监听器：事件不随消息数累积", async () => {
    const createImRouter = await loadImRouter();
    const adapter = createMockChannelAdapter();
    // 同一会话句柄（生产：createSession 按 spaceKey 缓存）——两条消息命中同一句柄，
    // session.on 只应挂一次（当前实现每条消息无条件挂载 → 累积）。
    const session = createSessionMock();
    const routed = [];
    const onSessionEventCalls = [];
    const agentService = async () => ({
      createSession: () => session,
      prompt: async () => {},
    });
    createImRouter({
      channelAdapter: adapter,
      baseUrl: "http://localhost",
      agentRouter: {
        route: (input) => {
          routed.push(input);
          return { action: "dialogue", payload: {} };
        },
      },
      agentService,
      onSessionEvent: (spaceKey, ev) => onSessionEventCalls.push({ spaceKey, ev }),
    });
    adapter.emitMessage({ messageId: "om_turn_1", chatId: "oc_1", senderId: "ou_1", text: "第一轮" });
    await settle();
    adapter.emitMessage({ messageId: "om_turn_2", chatId: "oc_1", senderId: "ou_1", text: "第二轮" });
    await settle();
    assert.equal(routed.length, 2, "两条消息应都进入 agent 对话（去重不误伤）");
    assert.equal(session.calls.on, 1, "同一会话句柄应只挂一次 session-event 监听器（修复前每条消息都挂 → 累积）");
    // 行为级：一条 session-event 应恰好触发一次 onSessionEvent（修复前 2 个累积监听器 → 2 次，最终每轮 sendCard 触发 N 次）。
    onSessionEventCalls.length = 0;
    session.emit("session-event", { type: "text_delta", delta: "第二轮增量" });
    assert.equal(onSessionEventCalls.length, 1, "一条 session-event 应恰好触发一次 onSessionEvent（监听器不累积）");
  });
});

describe("BUG-004 回归（code-defect）：卡片定型关闭 streaming_mode，列表不卡「生成中...」", () => {
  // 根因：text_end/error/completed 只做元素内容终更（PUT elements/content），从未调
  // 更新配置接口（PUT cards/:id/settings）关 streaming_mode + 更新 summary——飞书在
  // streaming_mode 开启期间，会话列表固定显示初始 summary「[生成中...]」（H4 spike：
  // 建议手动 card.settings 关 streaming_mode；REQ-AGENT-019 标准 2「卡片定型」飞书侧
  // 未落地）。修复前应红（finalizeCard 零调用）。
  let workdir;

  beforeEach(() => {
    workdir = fs.mkdtempSync(path.join(os.tmpdir(), "card-finalize-"));
  });

  afterEach(() => {
    fs.rmSync(workdir, { recursive: true, force: true });
  });

  it("text_end → finalizeCard 一次：summary 换正文摘要、sequence 接续递增", async () => {
    const createCardRenderer = await loadCardRenderer();
    const adapter = createCardAdapterFake();
    const renderer = createCardRenderer({ adapter });
    renderer.handleStreamEvent({ sessionKey: "feishu:oc_1", type: "text_delta", delta: "执行" });
    await flushMicrotasks(); // sendCard 异步回填 cardId
    renderer.handleStreamEvent({ sessionKey: "feishu:oc_1", type: "text_end", content: "执行列表" });
    assert.equal(adapter.calls.finalizeCard.length, 1, "流式结束应定型一次（关闭 streaming_mode，修复前零调用）");
    const fin = adapter.calls.finalizeCard[0];
    assert.equal(fin.cardId, "card_1", "定型应指向本轮回复卡片");
    assert.ok(JSON.stringify(fin.summary).includes("执行列表"), "summary 应换为正文摘要（列表预览不再「生成中...」）");
    assert.ok(!JSON.stringify(fin.summary).includes("生成中"), "summary 不应残留「生成中」");
    const lastUpdateSeq = adapter.calls.updateCardStream.at(-1).sequence;
    assert.ok(fin.sequence > lastUpdateSeq, `定型 sequence（${fin.sequence}）应接续递增（末次更新 ${lastUpdateSeq}，H4 严格递增）`);
  });

  it("error → finalizeCard 同样触发（失败卡片也定型）", async () => {
    const createCardRenderer = await loadCardRenderer();
    const adapter = createCardAdapterFake();
    const renderer = createCardRenderer({ adapter });
    renderer.handleStreamEvent({ sessionKey: "feishu:oc_1", type: "text_delta", delta: "开头" });
    await flushMicrotasks();
    renderer.handleStreamEvent({ sessionKey: "feishu:oc_1", type: "error", code: "E-AGENT-LLM-FAIL", userMessage: "供应商失败" });
    assert.equal(adapter.calls.finalizeCard.length, 1, "流式错误也应定型（修复前零调用）");
    assert.ok(JSON.stringify(adapter.calls.finalizeCard[0].summary).includes("开头"), "summary 应为已产正文摘要");
    assert.ok(!JSON.stringify(adapter.calls.finalizeCard[0].summary).includes("生成中"), "summary 不应残留「生成中」");
  });

  it("任务卡片 completed → finalizeCard（「[任务执行中...]」同根缺陷）", async () => {
    const createCardRenderer = await loadCardRenderer();
    const adapter = createCardAdapterFake();
    const renderer = createCardRenderer({ adapter });
    const execId = crypto.randomUUID();
    renderer.handleExecutionEvent({ sessionKey: "feishu:oc_1", type: "started", executionId: execId });
    await flushMicrotasks(); // 任务卡片 cardId 回填
    renderer.handleExecutionEvent({ sessionKey: "feishu:oc_1", type: "completed", executionId: execId, status: "success" });
    assert.equal(adapter.calls.finalizeCard.length, 1, "任务终态应定型（修复前零调用）");
    assert.equal(adapter.calls.finalizeCard[0].cardId, "card_1", "定型应指向任务卡片");
  });

  it("竞态：text_end 早于 sendCard 回填 → 回填后补发 finalizeCard", async () => {
    const createCardRenderer = await loadCardRenderer();
    const adapter = createCardAdapterFake();
    const renderer = createCardRenderer({ adapter });
    // 不 flush：sendCard 微任务未结算，text_end 时 cardId 仍 undefined（生产竞态窗口）。
    renderer.handleStreamEvent({ sessionKey: "feishu:oc_1", type: "text_delta", delta: "增量" });
    renderer.handleStreamEvent({ sessionKey: "feishu:oc_1", type: "text_end", content: "完整回复" });
    await flushMicrotasks(); // sendCard 回填 → 应补发定型
    assert.equal(adapter.calls.finalizeCard.length, 1, "cardId 回填后应补发定型（竞态窗口不失定型）");
    assert.equal(adapter.calls.finalizeCard[0].cardId, "card_1", "补发定型应携带真实 cardId");
  });
});

describe("BUG-009 回归：一条消息多个文本段（工具调用分段）逐段开卡", () => {
  // 根因：stream_start 由 imRouter 每条用户消息宣告一次，而 worker 的 text_end 每 LLM
  // 回合一次——带工具调用的运行有 2+ 回合。cardRenderer 在首个 text_end 即定型置 final，
  // 回合 2 的文本事件全部被 final 守卫丢弃（生产实锤：飞书只收到第一段
  // 「我来帮你查询一下当前的项目列表。」）。桌面端同型先例：routes/agentSessions.js
  // 每回合首个文本事件前补发 text_start（裁决 11，每回合开新气泡）。契约对齐：
  // 已定型后再来文本事件 → 开新卡（每回合一张回复卡）。修复前应红（sendCard 仅 1 次）。
  it("回合 2 文本段到达已定型会话 → 开新卡、内容不丢、两卡各自定型", async () => {
    const createCardRenderer = await loadCardRenderer();
    const adapter = createCardAdapterFake();
    const renderer = createCardRenderer({ adapter });
    const sk = "feishu:oc_1";
    // 一条用户消息（imRouter 只宣告一次 stream_start）→ 回合 1 文本段
    renderer.handleStreamEvent({ sessionKey: sk, type: "stream_start" });
    renderer.handleStreamEvent({ sessionKey: sk, type: "text_delta", delta: "我来帮你查询一下当前的项目列表。" });
    await flushMicrotasks(); // card_1 回填
    renderer.handleStreamEvent({ sessionKey: sk, type: "text_end", content: "我来帮你查询一下当前的项目列表。" });
    await flushMicrotasks(); // card_1 定型
    // 工具调用（tool_execution_* 不经 handleStreamEvent）→ 回合 2 文本段
    renderer.handleStreamEvent({ sessionKey: sk, type: "text_delta", delta: "查询结果：当前项目列表为空。" });
    await flushMicrotasks(); // 应开 card_2 并回填
    renderer.handleStreamEvent({ sessionKey: sk, type: "text_end", content: "查询结果：当前项目列表为空。" });
    await flushMicrotasks(); // card_2 定型

    assert.equal(adapter.calls.sendCard.length, 2, "回合 2 文本段应开新卡（修复前被 final 守卫丢弃，sendCard 仅 1 次）");
    const card2Updates = adapter.calls.updateCardStream.filter((u) => u.cardId === "card_2");
    assert.ok(
      card2Updates.some((u) => String(u.content).includes("查询结果")),
      "回合 2 内容应更新到第二张卡（H4：content 全量累计）"
    );
    assert.equal(adapter.calls.finalizeCard.length, 2, "两张卡应各自定型");
    assert.equal(adapter.calls.finalizeCard[1].cardId, "card_2", "第二次定型应指向回合 2 卡片");
    assert.ok(
      JSON.stringify(adapter.calls.finalizeCard[1].summary).includes("查询结果"),
      "第二卡 summary 应为回合 2 正文摘要"
    );
    const card1Updates = adapter.calls.updateCardStream.filter((u) => u.cardId === "card_1");
    assert.ok(
      !card1Updates.some((u) => String(u.content).includes("查询结果")),
      "第一卡定型后不应被回合 2 内容污染"
    );
  });
});
