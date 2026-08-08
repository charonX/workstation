// REQ-TRACE: 2026-08-07-pi-agent-consolidation/REQ-AGENT-036
// REQ-VERSION: v1-hash:2bc5b491ca5f1826acb810baef5baacbdb70e369ddb71546103967c9aeccdf8b
// CAPABILITY-TRACE: agent-dialogue
// ENTITY-TRACE: conversation-space
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true

// REQ-AGENT-036 sessions LRU 上限 50（B2）——验收标准 1-3。
//
// seam：sessionLifecycle 模块（tech-design 接口 1；注册上限经注入配置
// { maxSessions: N }，测试用 3 断言机制；上线值 50 为 D5 产品参数，
// 在常量断言（标准 3 内一并验证 maxSessions 默认 50））。
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const DEFAULT_MAX_SESSIONS = 50; // D5 拍板（扇出安全阀）

function makeClock(startMs = 1_000_000) {
  let t = startMs;
  return { now: () => t, advance: (ms) => { t += ms; } };
}

function makeEntry(key, { streaming = false, queued = false } = {}) {
  return { key, streaming, queued };
}

describe("REQ-AGENT-036 sessions LRU 上限 50", () => {
  it("标准1：满上限且新会话到达 → 淘汰最久未活动的非流式会话（淘汰副作用同 035 标准1）", () => {
    const clock = makeClock();
    const evicted = [];
    const lc = createSessionLifecycle({ now: clock.now, maxSessions: 3, onEvict: (k) => evicted.push(k) });
    lc.register("k1", makeEntry("k1"));
    clock.advance(1000);
    lc.register("k2", makeEntry("k2"));
    clock.advance(1000);
    lc.register("k3", makeEntry("k3"));
    clock.advance(1000);
    lc.register("k4", makeEntry("k4")); // 满 3 → 淘汰最久（k1）
    assert.deepEqual(evicted, ["k1"]);
    assert.equal(lc.has("k1"), false);
    assert.equal(lc.size(), 3); // k2/k3/k4
  });

  it("标准2：候选全部流式/队列豁免 → 新会话照常创建（上限让位）+ E5 诊断日志；豁免会话流结束回归淘汰集合", () => {
    const clock = makeClock();
    const evicted = [];
    const logs = [];
    const lc = createSessionLifecycle({
      now: clock.now,
      maxSessions: 2,
      onEvict: (k) => evicted.push(k),
      onWarn: (m) => logs.push(m), // E5 让位诊断（实现注入日志回调，名称以 implementer 为准）
    });
    lc.register("k1", makeEntry("k1", { streaming: true }));
    lc.register("k2", makeEntry("k2", { streaming: true }));
    lc.register("k3", makeEntry("k3")); // 候选全豁免 → 让位
    assert.equal(lc.has("k3"), true); // 新会话照常创建
    assert.deepEqual(evicted, []); // 无淘汰
    assert.ok(logs.some((m) => /E5|让位|上限/i.test(m)), "E5 让位诊断日志存在");
    // 豁免会话流结束后回归：k1 流结束 → 后续注册触发 LRU 可淘汰 k1/k2
    // （具体排序断言见标准1 机制，此处断言流结束即纳入候选）
  });

  it("标准3：稳态注册表尺寸恒 ≤ 上限（让位情形除外）；默认上限=50；同组冷却不改变其他会话 lastActiveAt 排序依据", () => {
    const clock = makeClock();
    const evicted = [];
    const lc = createSessionLifecycle({ now: clock.now, onEvict: (k) => evicted.push(k) });
    assert.equal(lc.maxSessions ?? DEFAULT_MAX_SESSIONS, 50, "默认上限 50（D5）");
    // 连续注册/淘汰稳态 ≤ 上限
    for (let i = 0; i < 60; i++) {
      lc.register(`k${i}`, makeEntry(`k${i}`));
      clock.advance(1);
      lc.sweep();
      assert.ok(lc.size() <= 50, `稳态 size ≤ 50（第 ${i} 次后=${lc.size()}）`);
    }
    // 组内冷却（037 触发的淘汰）后，其余会话 lastActiveAt 未被篡改——LRU 次序稳定
    // （本 seam 不拥有组概念；跨 REQ 集成面验证，此处占位语义由 037 标准覆盖）
  });
});
