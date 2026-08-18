// BUG-TRACE: BUG-002
// REQ-TRACE: 2026-08-16-deepen-session-domain/REQ-AGENT-115
// REQ-VERSION: v2-hash:77f0f186fe65139c162d3db19364b93827432d5424fd502d067f24df71cbb28c
// CAPABILITY-TRACE: agent-dialogue
// ENTITY-TRACE: conversation-space
// EXPECTED-TRACE: prd.md §10.4 attachPending 契约（有挂起 → 逐个 attach 并清该 key；幂等 no-op）
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: false

// BUG-002（2026-08-18，/code-review 发现，人确认 code-defect 后修复）：
// attachPending 循环无 try/finally——单 sub attach 抛错 → 循环中断、pendingSseSubs
// 该 key 永不清理（清理权威被破坏），其余 sub 永久滞留挂起集。此路径是
// attach-or-pend 塌缩后新暴露（旧代码只 attach 新 sub，异常被隔离在单连接）。
// 契约：单 sub 挂接失败不阻断其余 + 挂起集必清理（二次 attachPending 为 no-op）。
//
// seam：src/services/sessionSseRegistry.js 的 createSseSubscriptionRegistry。

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";

async function loadRegistryFactory() {
  const mod = await import("../../../../../../src/services/sessionSseRegistry.js").catch(() => null);
  assert.ok(mod, "seam 未就绪：src/services/sessionSseRegistry.js 尚未实现（REQ-AGENT-115）");
  assert.equal(typeof mod.createSseSubscriptionRegistry, "function", "应导出 createSseSubscriptionRegistry()");
  return mod.createSseSubscriptionRegistry;
}

// SSE 响应流 stub（与 sessionSseRegistry.test.js 同型）：收集 write 帧，可触发 close/error。
function createResStub() {
  const handlers = {};
  return {
    writes: [],
    ended: false,
    write(s) { this.writes.push(s); return true; },
    on(ev, fn) { handlers[ev] = fn; },
    emit(ev) { handlers[ev]?.(); },
    end() { this.ended = true; },
  };
}

describe("BUG-002 attachPending 清理", () => {
  it("单 sub attach 抛错 → 不阻断其余 + 挂起集必清理（二次 attachPending no-op）", async () => {
    const createRegistry = await loadRegistryFactory();
    const reg = createRegistry();
    const spaceKey = "ui:copilot:abc";
    const subA = reg.createSubscription(createResStub(), spaceKey);
    const subB = reg.createSubscription(createResStub(), spaceKey);
    reg.registerPending(spaceKey, subA);
    reg.registerPending(spaceKey, subB);

    let attachCalls = 0;
    const throwingSession = {
      on() { attachCalls++; throw new Error("stale handle"); },
      off() {},
    };

    // 修复前：subA.attach → session.on 抛错 → attachPending 整体抛出 → doesNotThrow 红。
    // 修复后：单 sub 失败被隔离，其余 sub 继续挂接，挂起集在 finally 清理。
    assert.doesNotThrow(
      () => reg.attachPending(spaceKey, { getSession: () => throwingSession }),
      "attachPending 不得因单 sub 挂接失败整体抛出"
    );
    assert.ok(attachCalls >= 2, "两个挂起 sub 都应被尝试挂接（失败不阻断）");

    // 挂起集已清理 → 二次 attachPending（句柄正常）不得再挂接任何残留 sub
    const afterFirst = attachCalls;
    const working = new EventEmitter();
    reg.attachPending(spaceKey, { getSession: () => working });
    assert.equal(attachCalls, afterFirst, "挂起集清理后二次 attachPending 必须为 no-op");

    subA.detach();
    subB.detach();
  });
});
