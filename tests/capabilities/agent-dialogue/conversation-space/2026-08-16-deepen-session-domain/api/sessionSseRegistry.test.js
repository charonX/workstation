// REQ-TRACE: 2026-08-16-deepen-session-domain/REQ-AGENT-115
// REQ-VERSION: v2-hash:77f0f186fe65139c162d3db19364b93827432d5424fd502d067f24df71cbb28c
// CAPABILITY-TRACE: agent-dialogue
// ENTITY-TRACE: conversation-space
// EXPECTED-TRACE: prd.md §10.4 注册表三方法契约（实例隔离/幂等 no-op 矩阵/订阅生命周期/detach 自清理）；§6.3 块4 SSE 锚点
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: false

// REQ-AGENT-115：SSE 订阅注册表 per-instance 收编（ADR-030）。
// createSseSubscriptionRegistry() → {createSubscription, registerPending, attachPending}，
// 实例私有挂起 Map（模块级全局消亡）：
//   createSubscription(res, spaceKey) → sub {pushFrame, attach, detach}
//     —— session-event 原样转发 data: <json>\n\n；轮次首个 text_delta/text_end 前
//        补发 text_start、text_end 后重置；15s 心跳 ": keep-alive" 注释帧；
//        confirmation-pending 按 spaceKey 过滤转发且帧不含 sessionKey 字段；
//   registerPending(spaceKey, sub)：Set 去重，detach 自移除；
//   attachPending(spaceKey, svc)：有挂起且 svc.getSession 返回既有句柄 → 逐个
//     attach 并清该 key 挂起集；否则 no-op（幂等，无条件调用安全）。
//
// 三处驱动点接线与挂起→挂接全链路由既有 sessionEvents/assistantConfirm 测试承载
// （REQ-115 AC5/AC6，HTTP 面零改动）。
//
// seam：src/services/sessionSseRegistry.js 的 createSseSubscriptionRegistry。

import { describe, it, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";

async function loadRegistryFactory() {
  const mod = await import("../../../../../../src/services/sessionSseRegistry.js").catch(() => null);
  assert.ok(mod, "seam 未就绪：src/services/sessionSseRegistry.js 尚未实现（REQ-AGENT-115，ADR-030）");
  assert.equal(
    typeof mod.createSseSubscriptionRegistry,
    "function",
    "sessionSseRegistry.js 应导出 createSseSubscriptionRegistry()"
  );
  return mod.createSseSubscriptionRegistry;
}

// SSE 响应流 stub：收集 write 帧，可触发 close/error，可置 write 抛错。
function createResStub() {
  const handlers = {};
  return {
    writes: [],
    ended: false,
    failWrites: false,
    write(s) {
      if (this.failWrites) throw new Error("connection dead");
      this.writes.push(s);
      return true;
    },
    on(ev, fn) { handlers[ev] = fn; },
    emit(ev) { handlers[ev]?.(); },
    end() { this.ended = true; },
  };
}

async function loadEventBus() {
  return import("../../../../../../src/services/eventBus.js");
}

describe("REQ-AGENT-115 注册表实例隔离与 attachPending 契约", () => {
  let createRegistry;

  beforeEach(async () => {
    createRegistry = await loadRegistryFactory();
  });

  it("AC1 实例隔离：两个实例的挂起状态互不可见", async () => {
    const regA = createRegistry();
    const regB = createRegistry();
    const resA = createResStub();
    const subA = regA.createSubscription(resA, "ui:copilot:k1");
    regA.registerPending("ui:copilot:k1", subA);

    const session = new EventEmitter();
    const svc = { getSession: () => session };

    // EXPECTED-TRACE: prd.md §10.4——实例私有挂起 Map；B 消费不到 A 的挂起
    regB.attachPending("ui:copilot:k1", svc);
    assert.equal(session.listenerCount("session-event"), 0, "实例 B 不得消费实例 A 的挂起订阅");

    regA.attachPending("ui:copilot:k1", svc);
    assert.equal(session.listenerCount("session-event"), 1, "实例 A 自己消费挂起订阅");

    subA.detach();
  });

  it("AC2 attachPending 幂等 no-op 矩阵：无挂起 / 有句柄无挂起 / 有挂起无句柄", async () => {
    const reg = createRegistry();
    const session = new EventEmitter();

    // 无挂起 → no-op（常态路径，现状「无条件调用安全」语义保持）
    assert.doesNotThrow(() => reg.attachPending("ui:copilot:none", { getSession: () => session }));

    // 有挂起但句柄未创建 → no-op 且挂起集保留（稍后补挂接）
    const res = createResStub();
    const sub = reg.createSubscription(res, "ui:copilot:k2");
    reg.registerPending("ui:copilot:k2", sub);
    reg.attachPending("ui:copilot:k2", { getSession: () => null });
    assert.equal(session.listenerCount("session-event"), 0, "无句柄不挂接");

    // 句柄出现后补挂接成功（证明挂起集被保留而非丢弃）
    reg.attachPending("ui:copilot:k2", { getSession: () => session });
    assert.equal(session.listenerCount("session-event"), 1, "挂起订阅补挂接");

    // 挂起集已清：再次 attachPending 不重复挂接（幂等）
    reg.attachPending("ui:copilot:k2", { getSession: () => session });
    assert.equal(session.listenerCount("session-event"), 1, "重复 attachPending 不重复挂接");

    sub.detach();
  });

  it("AC2 svc 未接线（undefined）安全 no-op", async () => {
    const reg = createRegistry();
    const res = createResStub();
    const sub = reg.createSubscription(res, "ui:copilot:k3");
    reg.registerPending("ui:copilot:k3", sub);
    assert.doesNotThrow(() => reg.attachPending("ui:copilot:k3", undefined));
    sub.detach();
  });
});

describe("REQ-AGENT-115 createSubscription 生命周期", () => {
  let createRegistry;
  let eventBus;

  beforeEach(async () => {
    createRegistry = await loadRegistryFactory();
    eventBus = await loadEventBus();
  });

  afterEach(() => {
    eventBus.clearSubscribers();
  });

  it("AC3 事件原样转发 + 轮次边界 text_start 宣告与重置", async () => {
    const reg = createRegistry();
    const res = createResStub();
    const sub = reg.createSubscription(res, "ui:copilot:k4");
    const session = new EventEmitter();
    sub.attach(session);

    session.emit("session-event", { type: "text_delta", delta: "你" });
    session.emit("session-event", { type: "text_delta", delta: "好" });
    session.emit("session-event", { type: "text_end" });
    // 新一轮：text_end 后重置，下一轮首个文本事件重新宣告
    session.emit("session-event", { type: "text_delta", delta: "!" });

    // EXPECTED-TRACE: prd.md §10.4 createSubscription golden——data: <json>\n\n 帧序列
    assert.deepEqual(res.writes, [
      `data: {"type":"text_start"}\n\n`,
      `data: {"type":"text_delta","delta":"你"}\n\n`,
      `data: {"type":"text_delta","delta":"好"}\n\n`,
      `data: {"type":"text_end"}\n\n`,
      `data: {"type":"text_start"}\n\n`,
      `data: {"type":"text_delta","delta":"!"}\n\n`,
    ]);

    sub.detach();
  });

  it("AC3 confirmation-pending 按 spaceKey 过滤转发，帧不含 sessionKey", async () => {
    const reg = createRegistry();
    const res = createResStub();
    const sub = reg.createSubscription(res, "ui:copilot:k5");

    // EXPECTED-TRACE: prd.md §10.4——裁决 11 字段（confirmId/operation/description），sessionKey 不出帧
    eventBus.publish("confirmation-pending", {
      sessionKey: "ui:copilot:other",
      confirmId: "c-other",
      operation: "bash",
      description: "别人的",
    });
    eventBus.publish("confirmation-pending", {
      sessionKey: "ui:copilot:k5",
      confirmId: "c1",
      operation: "bash",
      description: "ls -la",
    });

    assert.deepEqual(res.writes, [
      `data: {"type":"confirmation-pending","confirmId":"c1","operation":"bash","description":"ls -la"}\n\n`,
    ]);

    sub.detach();
  });

  it("AC3 15s 心跳注释帧", async (t) => {
    t.mock.timers.enable({ apis: ["setInterval"] });
    const reg = createRegistry();
    const res = createResStub();
    const sub = reg.createSubscription(res, "ui:copilot:k6");

    // EXPECTED-TRACE: prd.md §10.4——15s ": keep-alive" 注释帧
    t.mock.timers.tick(15 * 1000);
    assert.deepEqual(res.writes, [": keep-alive\n\n"]);
    t.mock.timers.tick(15 * 1000);
    assert.equal(res.writes.length, 2);

    sub.detach();
    t.mock.timers.reset();
  });

  it("AC4 detach 自清理：close/error/写失败三触发 + 重复 detach 安全 + 挂起集自移除", async () => {
    const reg = createRegistry();

    // 写失败 → 自 detach
    const resDead = createResStub();
    const subDead = reg.createSubscription(resDead, "ui:copilot:k7");
    resDead.failWrites = true;
    subDead.pushFrame({ type: "session-git", state: "none" });
    assert.equal(resDead.ended, true, "写失败后 detach 收尾 res.end()");

    // res close → detach（且 detach 幂等）
    const resClose = createResStub();
    const subClose = reg.createSubscription(resClose, "ui:copilot:k8");
    resClose.emit("close");
    assert.equal(resClose.ended, true);
    assert.doesNotThrow(() => subClose.detach(), "重复 detach 安全");

    // res error → detach（close 与 error 是两个独立注册点，
    // 现状 agentSessions.js:860-861 分别注册，缺一即泄漏）
    const resErr = createResStub();
    reg.createSubscription(resErr, "ui:copilot:k8e");
    resErr.emit("error");
    assert.equal(resErr.ended, true, "res error 事件同样触发 detach");

    // 挂起中的 sub detach → 挂起集自移除（后续 attachPending 不再捞到它）
    const resPend = createResStub();
    const subPend = reg.createSubscription(resPend, "ui:copilot:k9");
    reg.registerPending("ui:copilot:k9", subPend);
    subPend.detach();
    const session = new EventEmitter();
    reg.attachPending("ui:copilot:k9", { getSession: () => session });
    assert.equal(session.listenerCount("session-event"), 0, "已 detach 的挂起订阅不再挂接");

    // detach 后既有挂接的事件监听摘除
    const resAtt = createResStub();
    const subAtt = reg.createSubscription(resAtt, "ui:copilot:k10");
    subAtt.attach(session);
    assert.equal(session.listenerCount("session-event"), 1);
    subAtt.detach();
    assert.equal(session.listenerCount("session-event"), 0, "detach 摘除 session-event 监听");
  });
});
