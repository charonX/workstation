// REQ-TRACE: 2026-08-02-builtin-agent/REQ-AGENT-019, 2026-08-02-builtin-agent/REQ-AGENT-020
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

// adapter fake：记录 sendCard / updateCardStream / send 调用（接口契约对齐 tech-design F1）：
// sendCard({chatId, cardJson}) → {cardId}；updateCardStream({cardId, content, sequence})；send({chatId, text})。
function createCardAdapterFake() {
  const calls = { sendCard: [], updateCardStream: [], send: [] };
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
    }
  };
}

function chatIdOf(sessionKey) {
  return sessionKey.replace(/^feishu:/, "");
}

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
    renderer.handleStreamEvent({ sessionKey: "feishu:oc_1", type: "text_end", content: "部分内容" });
    const updatesAfterEnd = adapter.calls.updateCardStream.length;
    // 流式结束 → 卡片定型（停止更新，REQ-AGENT-019 标准 2）。
    renderer.handleStreamEvent({ sessionKey: "feishu:oc_1", type: "text_delta", delta: "不应再出现" });
    assert.equal(adapter.calls.updateCardStream.length, updatesAfterEnd, "流式结束卡片定型，应停止更新");

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
    adapter.failNextUpdate(3);
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
