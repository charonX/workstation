// REQ-TRACE: 2026-08-16-deepen-turn-event-pipeline/REQ-AGENT-106, REQ-AGENT-107, REQ-AGENT-108, REQ-AGENT-109
// REQ-VERSION: v3-hash:ca25405beeb7fa4d05153f0ace4169ca21d3d09dbaa7bc601c000d36c2eea11b
// CAPABILITY-TRACE: agent-dialogue
// ENTITY-TRACE: conversation-space
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: false

// 回合事件管线模块（ADR-029）：turnEventPipeline 工厂直测。
//
// seam：直接 import createTurnEventPipeline（src/agent/turnEventPipeline.js，新增）——
//   注入 { send, log, setTimeout, clearTimeout, now }；本文件用 spy send/log + 假时钟
//   （fake clock 推进触发 5s 兜底定时器、断言 meta.durationMs 精确差）。
//   sessionIdleEviction.test.js（sessionLifecycle 直测）为同构先例。
//
// 覆盖：REQ-AGENT-106（工厂/接口集/无副作用 import）、REQ-AGENT-107（转发/延迟
//   text_end/计数与清时机）、REQ-AGENT-108（abort 合成）、REQ-AGENT-109（注册表
//   单元面：AC1-3；AC4 reset 黑盒在 resetDropQueue.test.js）。
//
// 事件形态（PI SDK → onSessionEvent 输入，worker.js forwardEvent 现状）：
//   message_update{ assistantMessageEvent: {type:"text_delta"|"text_end"|"text_start"} }
//   message_end{ message: { stopReason, content, usage } }
//   tool_execution_*（PI 原生 toolName 字段 → mapToContractEvent 映射分支）
import { describe, it } from "node:test";
import assert from "node:assert/strict";

// EXPECTED-TRACE: prd.md §10.4 接口 1-6 契约 + §6.3 锚点 1-5
const pipelineMod = await import("../../../../../../src/agent/turnEventPipeline.js").catch(() => null);

// —— 假时钟：注入 setTimeout/clearTimeout/now，advance 推进并触发到期定时器 ——
function makeFakeClock(startMs = 1_000_000) {
  let t = startMs;
  let seq = 0;
  const timers = new Map();
  return {
    now: () => t,
    setTimeout(fn, ms) {
      const id = ++seq;
      timers.set(id, { fn, due: t + ms });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    advance(ms) {
      t += ms;
      for (const [id, timer] of [...timers]) {
        if (timer.due <= t) {
          timers.delete(id);
          timer.fn();
        }
      }
    },
    pendingCount() {
      return timers.size;
    },
  };
}

// —— PI 形态事件构造（与 worker forwardEvent 输入同构） ——
const evTextStart = () => ({ type: "message_update", assistantMessageEvent: { type: "text_start", index: 0 } });
const evDelta = (delta) => ({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta } });
const evTextEnd = (content) => ({ type: "message_update", assistantMessageEvent: { type: "text_end", content } });
const evMessageEnd = ({ usage, stopReason = "end_turn", content = [] } = {}) => ({
  type: "message_end",
  message: { stopReason, content, ...(usage ? { usage } : {}) },
});
const evToolStart = () => ({ type: "tool_execution_start", toolName: "task_list", toolCallId: "call_1", args: {} });

function makeHarness() {
  const clock = makeFakeClock();
  const sends = [];
  const logs = [];
  const touches = [];
  const pipe = pipelineMod.createTurnEventPipeline({
    send: (m) => sends.push(m),
    log: (m) => logs.push(m),
    // touch 注入钩子（review B2）：仅当事件实际映射出站时调用；恒 clearPending:false
    // 语义由注入方（worker lifecycle.touch）承担——本文件断言「调用时机」，no-op
    // 语义属注入方（sessionLifecycle 直测覆盖）。
    touch: (key) => touches.push(key),
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    now: clock.now,
  });
  return { pipe, clock, sends, logs, touches };
}

const outbound = (sends, key) => sends.filter((m) => m.type === "session-event" && m.sessionKey === key);

describe("REQ-AGENT-106 turnEventPipeline 工厂模块——可 import 无副作用 + 接口集", () => {
  it("AC1+AC3：模块可 import、工厂存在、MAX_IPC_BYTES = 262144", () => {
    assert.ok(pipelineMod, "seam 未就绪：src/agent/turnEventPipeline.js 尚未实现（REQ-AGENT-106，ADR-029）");
    assert.equal(typeof pipelineMod.createTurnEventPipeline, "function", "应导出 createTurnEventPipeline 工厂");
    // EXPECTED-TRACE: prd.md §10.4 接口 7（MAX_IPC_BYTES = 256*1024 = 262144）
    assert.equal(pipelineMod.MAX_IPC_BYTES, 262144, "MAX_IPC_BYTES 应导出且等于 262144");
    assert.equal(typeof pipelineMod.limitSize, "function", "应导出 limitSize");
  });

  it("AC2：工厂返回完整接口集（7 实例成员均为函数）+ import 无副作用直接断言（零定时器/零出站）", () => {
    const { pipe, clock, sends } = makeHarness();
    for (const name of [
      "onSessionEvent",
      "beginTurn",
      "takeLastReply",
      "takeTurnDiagnostics",
      "registerSessionScopedMap",
      "registerSessionCleanup",
      "clearSessionState",
    ]) {
      assert.equal(typeof pipe[name], "function", `实例应提供 ${name}()（§10.4 接口 1-6）`);
    }
    // AC1 无副作用子句显式化（review 修订）：工厂构造后无激活定时器、无出站。
    assert.equal(clock.pendingCount(), 0, "工厂构造不应 arm 任何定时器");
    assert.equal(sends.length, 0, "工厂构造不应有任何出站");
  });

  it("AC4：注入 send 可用——转发事件经 send 出站 {type:'session-event', sessionKey, event}", () => {
    const { pipe, sends } = makeHarness();
    pipe.onSessionEvent("k1", evDelta("你好"));
    const out = outbound(sends, "k1");
    assert.equal(out.length, 1, "应出站 1 条 session-event");
    assert.deepEqual(out[0].event, { type: "text_delta", delta: "你好" }, "事件形状 {type, delta}");
  });
});

describe("REQ-AGENT-107 事件转发与延迟 text_end（含计数与清时机）", () => {
  it("AC1：text_delta 即时出站、顺序保持；text_end 未到 message_end 前不出站", () => {
    const { pipe, sends } = makeHarness();
    const key = "k1";
    pipe.onSessionEvent(key, evDelta("执行"));
    pipe.onSessionEvent(key, evDelta("列表："));
    pipe.onSessionEvent(key, evTextEnd("执行列表：共 3 条"));
    const out = outbound(sends, key);
    // EXPECTED-TRACE: prd.md §10.4 接口 1 样例（text_delta 即时、text_end 延迟）
    assert.deepEqual(out.map((m) => m.event), [
      { type: "text_delta", delta: "执行" },
      { type: "text_delta", delta: "列表：" },
    ], "两条 text_delta 应即时按序出站，text_end 尚未出站");
  });

  it("AC2：text_end 延迟到 message_end 后转发，meta 三字段齐全（durationMs 精确差）", () => {
    const { pipe, clock, sends } = makeHarness();
    const key = "k1";
    pipe.onSessionEvent(key, evTextStart()); // t=1_000_000 记回合起点
    clock.advance(123);
    pipe.onSessionEvent(key, evDelta("执行"));
    pipe.onSessionEvent(key, evTextEnd("执行列表：共 3 条"));
    // 此时仍无 text_end 出站
    assert.equal(outbound(sends, key).length, 1, "message_end 前仅 1 条 text_delta");
    pipe.onSessionEvent(key, evMessageEnd({ usage: { input: 1000, output: 2000 } }));
    const out = outbound(sends, key);
    const end = out.find((m) => m.event.type === "text_end");
    // EXPECTED-TRACE: prd.md §6.3-1（meta = {durationMs≥0, tokensIn:1000, tokensOut:2000}）
    assert.ok(end, "message_end 后应出站 text_end");
    assert.equal(end.event.content, "执行列表：共 3 条");
    assert.equal(end.event.meta.durationMs, 123, "durationMs = 冲刷时刻 − 回合起点（注入 now 精确断言）");
    assert.equal(end.event.meta.tokensIn, 1000);
    assert.equal(end.event.meta.tokensOut, 2000);
  });

  it("AC3：5s 兜底——无 message_end 时假时钟推进 5000ms → text_end 照发（meta 仅 durationMs）", () => {
    const { pipe, clock, sends } = makeHarness();
    const key = "k1";
    pipe.onSessionEvent(key, evDelta("a"));
    pipe.onSessionEvent(key, evTextEnd("兜底文本"));
    assert.equal(outbound(sends, key).length, 1, "兜底触发前仅 text_delta 出站");
    assert.equal(clock.pendingCount(), 1, "text_end 应 armed 一个 5s 兜底定时器");
    // EXPECTED-TRACE: prd.md §6.3-2（PENDING_TEXT_END_FALLBACK_MS = 5000）
    clock.advance(5000);
    const out = outbound(sends, key);
    const end = out.find((m) => m.event.type === "text_end");
    assert.ok(end, "5s 后应出站 text_end（兜底路径）");
    assert.equal(end.event.content, "兜底文本");
    assert.ok(Number.isInteger(end.event.meta.durationMs), "兜底 meta 应含 durationMs");
    assert.equal("tokensIn" in end.event.meta, false, "usage 缺失 → meta 不应含 tokensIn");
    assert.equal("tokensOut" in end.event.meta, false, "usage 缺失 → meta 不应含 tokensOut");
  });

  it("AC4：诊断计数更新——2×delta + 1×end + 1×tool → {delta:2, end:1, tool:1}", () => {
    const { pipe, sends } = makeHarness();
    const key = "k1";
    pipe.onSessionEvent(key, evDelta("a"));
    pipe.onSessionEvent(key, evDelta("b"));
    pipe.onSessionEvent(key, evTextEnd("ab"));
    pipe.onSessionEvent(key, evToolStart());
    // 冲刷使 text_end 出站（计数在入口处已累加，与出站时机无关）
    pipe.onSessionEvent(key, evMessageEnd({ usage: {} }));
    // EXPECTED-TRACE: prd.md §6.3-4（turnEventCounts = {delta:2, end:1, tool:1}）
    const diag = pipe.takeTurnDiagnostics(key);
    assert.deepEqual(diag.turnStats, { delta: 2, end: 1, tool: 1 }, "计数应为 {delta:2, end:1, tool:1}");
    assert.deepEqual(diag.sdkStats, {}, "未注入 sdk 事件 → sdkStats 空对象");
    assert.equal(sends.length, 4, "2 delta + 1 end + 1 tool 共 4 条出站");
  });

  it("AC5：beginTurn 幂等清 + 取出即删——失败残留不混轮（人拍板 B）", () => {
    const { pipe } = makeHarness();
    const key = "k1";
    // 第一轮：2 个 delta（模拟失败轮残留——失败路径不消费计数）
    pipe.onSessionEvent(key, evDelta("a"));
    pipe.onSessionEvent(key, evDelta("b"));
    // 第二轮开始：beginTurn 清计数（prompt 开始前调用，幂等）
    pipe.beginTurn(key);
    let diag = pipe.takeTurnDiagnostics(key);
    // EXPECTED-TRACE: prd.md §10.4 接口 2（beginTurn 幂等清）
    assert.deepEqual(diag.turnStats, { delta: 0, end: 0, tool: 0 }, "beginTurn 后计数应为零（首轮残留不混入第二轮）");
    pipe.onSessionEvent(key, evDelta("c"));
    diag = pipe.takeTurnDiagnostics(key);
    assert.deepEqual(diag.turnStats, { delta: 1, end: 0, tool: 0 }, "第二轮计数仅含本轮事件");
    const again = pipe.takeTurnDiagnostics(key);
    assert.deepEqual(again.turnStats, { delta: 0, end: 0, tool: 0 }, "取出即删——再取应为空");
    pipe.beginTurn(key); // 幂等：已空时再清不抛
  });

  it("AC6：未知 sessionKey → 事件照常转发出站、touch 被调用（仅注入方内部 no-op，review B3）", () => {
    const { pipe, sends, touches } = makeHarness();
    assert.doesNotThrow(() => pipe.onSessionEvent("ghost-key", evDelta("x")));
    const out = outbound(sends, "ghost-key");
    assert.equal(out.length, 1, "未知 key 的事件应照常出站（消息乱序容忍 = 事件不丢失）");
    assert.deepEqual(out[0].event, { type: "text_delta", delta: "x" }, "事件形状不变");
    assert.deepEqual(touches, ["ghost-key"], "touch 应被调用（no-op 由注入方承担）");
  });

  it("B2：touch 调用时机——事件实际映射出站时调；延迟 text_end 分支/message_end 不调", () => {
    const { pipe, touches } = makeHarness();
    const key = "k1";
    // 出站事件（text_delta）→ touch
    pipe.onSessionEvent(key, evDelta("a"));
    assert.deepEqual(touches, [key], "text_delta 出站应触发 touch");
    // text_end 到达（延迟分支，不入出站）→ 不 touch
    pipe.onSessionEvent(key, evTextEnd("内容"));
    assert.deepEqual(touches, [key], "text_end 延迟分支不应触发 touch");
    // message_end（映射为 null）→ 不 touch
    pipe.onSessionEvent(key, evMessageEnd({ usage: {} }));
    assert.deepEqual(touches, [key], "message_end 不应触发 touch");
  });
});

describe("REQ-AGENT-108 abort 合成收尾", () => {
  it("AC1：message_end stopReason=aborted 且无 pending → 合成 text_end（content=文本段拼接）后冲刷出站", () => {
    const { pipe, sends, logs } = makeHarness();
    const key = "k1";
    pipe.onSessionEvent(key, evDelta("已生成"));
    pipe.onSessionEvent(
      key,
      evMessageEnd({
        stopReason: "aborted",
        content: [{ type: "text", text: "已生成" }, { type: "text", text: "文本" }],
      })
    );
    const out = outbound(sends, key);
    const end = out.find((m) => m.event.type === "text_end");
    // EXPECTED-TRACE: prd.md §6.3-3 + §10.4 接口 1 abort 样例（content = text 段拼接 "已生成文本"）
    assert.ok(end, "abort 后应出站合成 text_end");
    assert.equal(end.event.content, "已生成文本", "合成 content = msg.content 中 text 段拼接");
    assert.equal(pipe.takeLastReply(key), "已生成文本", "合成后 lastReplies 有值（reply 不丢，BUG-010 语义）");
    assert.ok(logs.some((l) => String(l).includes("abort 收尾")), "abort 合成应有诊断日志（可观测保留）");
  });

  it("AC2：aborted 且已有 pending text_end → 不合成（仅 1 条 text_end，content = 原 pending）", () => {
    const { pipe, sends } = makeHarness();
    const key = "k1";
    pipe.onSessionEvent(key, evTextEnd("正常文本"));
    pipe.onSessionEvent(
      key,
      evMessageEnd({ stopReason: "aborted", content: [{ type: "text", text: "不应合成" }] })
    );
    const out = outbound(sends, key);
    const ends = out.filter((m) => m.event.type === "text_end");
    assert.equal(ends.length, 1, "有 pending 时不应合成第二条 text_end");
    assert.equal(ends[0].event.content, "正常文本", "content 应为原 pending 内容");
  });

  it("AC3：abort 合成后 takeLastReply = 合成 content（reply 不丢）", () => {
    const { pipe } = makeHarness();
    const key = "k1";
    pipe.onSessionEvent(key, evMessageEnd({ stopReason: "aborted", content: [{ type: "text", text: "仅文本" }] }));
    assert.equal(pipe.takeLastReply(key), "仅文本");
  });
});

describe("REQ-AGENT-109 会话状态注册表统一清理（单元面 AC1-3；AC4 见 resetDropQueue.test.js）", () => {
  it("AC1：登记 Map×N（含外部装配态 Map）→ clearSessionState 后全部 delete", () => {
    const { pipe } = makeHarness();
    const key = "k1";
    const m1 = new Map(); // 模拟装配态（如 toolContexts）
    const m2 = new Map(); // 模拟装配态（如 sessionQueues）
    pipe.registerSessionScopedMap(m1);
    pipe.registerSessionScopedMap(m2);
    m1.set(key, { x: 1 });
    m2.set(key, "q");
    pipe.clearSessionState(key);
    // EXPECTED-TRACE: prd.md §6.3-5（clearSessionState 清全部登记 Map）
    assert.equal(m1.has(key), false, "登记 Map 1 应被清");
    assert.equal(m2.has(key), false, "登记 Map 2 应被清");
  });

  it("AC2：cleanup 钩子被调用 + pendingTextEnds 定时器被 clear（不悬挂）", () => {
    const { pipe, clock, sends } = makeHarness();
    const key = "k1";
    const cleaned = [];
    pipe.registerSessionCleanup((k) => cleaned.push(k));
    // 制造 pending text_end：armed 5s 兜底定时器
    pipe.onSessionEvent(key, evTextEnd("待清文本"));
    assert.equal(clock.pendingCount(), 1, "前置：pending 定时器已 armed");
    pipe.clearSessionState(key);
    assert.deepEqual(cleaned, [key], "cleanup 钩子应收到该 key");
    assert.equal(clock.pendingCount(), 0, "清理后定时器应被 clear（不悬挂）");
    const before = sends.length;
    clock.advance(5000); // 兜底定时器若未清会在此触发补发
    assert.equal(sends.length, before, "清理后推进 5s 不应有任何补发事件（无幽灵 text_end）");
  });

  it("AC3：管线内部回合态随 clearSessionState 清（lastReplies/计数/turnStartedAt/pending）", () => {
    const { pipe, clock, sends } = makeHarness();
    const key = "k1";
    pipe.onSessionEvent(key, evDelta("a"));
    pipe.onSessionEvent(key, evTextEnd("内容"));
    pipe.onSessionEvent(key, evMessageEnd({ usage: {} }));
    assert.equal(pipe.takeLastReply(key), "内容", "前置：lastReplies 有值");
    pipe.clearSessionState(key);
    assert.equal(pipe.takeLastReply(key), undefined, "clear 后 takeLastReply 应 undefined");
    const diag = pipe.takeTurnDiagnostics(key);
    assert.deepEqual(diag.turnStats, { delta: 0, end: 0, tool: 0 }, "clear 后计数应为空");
    clock.advance(5000);
    // test-gap 修正（2026-08-17，人确认分类）：出站计数 3→2——delta 即时 1 条 +
    // message_end 冲刷 1 条（text_end 延迟语义，AC1/AC2/AC4 自证），clear 后推进
    // 5s 无幽灵事件（若定时器未清会补发 → 计数变 3）。
    assert.equal(sends.filter((m) => m.type === "session-event").length, 2, "clear 后无补发事件（无幽灵 text_end）");
  });
});
