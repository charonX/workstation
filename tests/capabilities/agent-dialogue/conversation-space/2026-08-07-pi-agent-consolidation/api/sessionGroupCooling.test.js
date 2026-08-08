// REQ-TRACE: 2026-08-07-pi-agent-consolidation/REQ-AGENT-037
// REQ-VERSION: v1-hash:b8623e43fa224a212bb884effd47066c81d246467aa97a9ff2be12e5c10c3c09
// CAPABILITY-TRACE: agent-dialogue
// ENTITY-TRACE: conversation-space
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true

// REQ-AGENT-037 同组单活（B3）——验收标准 1-5。
//
// seam 1：groupOf(spaceKey) 纯函数（tech-design 数据流 2；spaceKey 文档化语法 ADR-016）。
// seam 2：sessionLifecycle.evictGroupPeers(key)（tech-design 接口 1）——
//   key K 活动到达（session-config/prompt → touch/register）时调用，冷却同组其他。
//
// 预期值签核（来源：同组单活人裁决 + ADR-016 spaceKey 语法）：
//   feishu:chat123 → 自身组；ui:copilot:abc/def → 同组 "ui:copilot"；
//   ui:project:p1:s1 → "ui:project:p1"；畸形 key → 自身组不抛错。
import { describe, it } from "node:test";
import assert from "node:assert/strict";

function makeEntry(key, { streaming = false, queued = false } = {}) {
  return { key, streaming, queued };
}

function makeClock(startMs = 1_000_000) {
  let t = startMs;
  return { now: () => t, advance: (ms) => { t += ms; } };
}

describe("REQ-AGENT-037 同组单活", () => {
  it("标准1：groupOf 语料——feishu:chat→自身组；ui:copilot:*→copilot 组；ui:project:<pid>:*→pid 组；畸形 key→自身组不抛错", () => {
    // 语料断言（ADR-016 语法 + 同组单活裁决）：
    assert.equal(groupOf("feishu:chat123"), "feishu:chat123", "飞书 chat 组=自身（天然单会话）");
    assert.equal(groupOf("ui:copilot:abc"), "ui:copilot", "copilot 组");
    assert.equal(groupOf("ui:copilot:def"), "ui:copilot", "同组 copilot");
    assert.equal(groupOf("ui:project:p1:s1"), "ui:project:p1", "项目组 pid");
    assert.equal(groupOf("ui:project:p2:s1"), "ui:project:p2", "不同项目不同组");
    assert.equal(groupOf("garbage"), "garbage", "畸形 key 组=自身（无-op 兜底，不抛错）");
  });

  it("标准2：同组活动冷却组内其他非流式会话（通用 copilot 组与项目组同一规则，无特殊逻辑）", () => {
    const evicted = [];
    const lc = createSessionLifecycle({ onEvict: (k) => evicted.push(k) });
    lc.register("ui:project:p1:s1", makeEntry("ui:project:p1:s1"));
    lc.register("ui:project:p1:s2", makeEntry("ui:project:p1:s2"));
    lc.evictGroupPeers("ui:project:p1:s2"); // s2 活动 → 冷却同组 s1
    assert.deepEqual(evicted, ["ui:project:p1:s1"]);
    // copilot 组同规则：无特殊逻辑（2026-08-08 人裁决：都是单热）
    lc.register("ui:copilot:a", makeEntry("ui:copilot:a"));
    lc.register("ui:copilot:b", makeEntry("ui:copilot:b"));
    lc.evictGroupPeers("ui:copilot:b");
    assert.deepEqual(evicted, ["ui:project:p1:s1", "ui:copilot:a"], "copilot 组与项目组同一规则");
  });

  it("标准3：组内其他 key 流式中 → 标记延迟淘汰，流结束立即执行（不等 TTL）", () => {
    const evicted = [];
    const clock = makeClock();
    const lc = createSessionLifecycle({ now: clock.now, onEvict: (k) => evicted.push(k) });
    const a = makeEntry("ui:project:p1:s1", { streaming: true });
    lc.register("ui:project:p1:s1", a);
    lc.register("ui:project:p1:s2", makeEntry("ui:project:p1:s2"));
    lc.evictGroupPeers("ui:project:p1:s2"); // s2 活动 → s1 流式中
    assert.deepEqual(evicted, [], "流式中不立即淘汰（标记延迟）");
    a.streaming = false; // 流结束
    lc.sweep();
    assert.deepEqual(evicted, ["ui:project:p1:s1"], "流结束立即淘汰，不等 TTL（clock 未推进）");
  });

  it("标准3（PRD 对齐修复 M1）：pending 窗口内流式 touch 后流结束仍应淘汰（会话自身事件不清 pending）", () => {
    const evicted = [];
    const clock = makeClock();
    const lc = createSessionLifecycle({ now: clock.now, onEvict: (k) => evicted.push(k) });
    const a = makeEntry("ui:project:p1:s1", { streaming: true });
    lc.register("ui:project:p1:s1", a);
    lc.register("ui:project:p1:s2", makeEntry("ui:project:p1:s2"));
    lc.evictGroupPeers("ui:project:p1:s2"); // s2 活动 → s1 流式中标记延迟淘汰
    assert.deepEqual(evicted, [], "流式中不立即淘汰（标记延迟）");
    // s1 流式事件继续 touch（clearPending:false，会话自身活动）——延迟淘汰标记保留
    lc.touch("ui:project:p1:s1", { clearPending: false });
    a.streaming = false; // 流结束
    lc.sweep();
    assert.deepEqual(evicted, ["ui:project:p1:s1"], "流式 touch 不清 pending → 流结束仍淘汰，组内回 ≤1");
    // 对照：用户新活动 touch（默认 clearPending=true）→ 清延迟标记，流结束不被追偿
    const b = makeEntry("ui:project:p1:s3", { streaming: true });
    lc.register("ui:project:p1:s3", b);
    lc.register("ui:project:p1:s4", makeEntry("ui:project:p1:s4"));
    lc.evictGroupPeers("ui:project:p1:s4"); // s4 活动 → s3 流式中标记延迟（s2 非流式被冷却）
    lc.touch("ui:project:p1:s3"); // 用户新活动（默认 clearPending=true）→ 清延迟标记
    b.streaming = false;
    lc.sweep();
    assert.deepEqual(evicted, ["ui:project:p1:s1", "ui:project:p1:s2"], "用户 touch 清 pending → s3 流结束不被淘汰");
    assert.equal(lc.has("ui:project:p1:s3"), true, "s3 保留（用户回来了）");
  });

  it("标准4：跨组不互汰——项目A会话活动不影响 项目B/copilot/飞书 会话热度", () => {
    const evicted = [];
    const lc = createSessionLifecycle({ onEvict: (k) => evicted.push(k) });
    lc.register("ui:project:p1:s1", makeEntry("ui:project:p1:s1"));
    lc.register("ui:project:p2:s1", makeEntry("ui:project:p2:s1"));
    lc.register("ui:copilot:g", makeEntry("ui:copilot:g"));
    lc.register("feishu:chat9", makeEntry("feishu:chat9"));
    lc.evictGroupPeers("ui:project:p1:s1"); // p1 活动
    assert.deepEqual(evicted, [], "跨组不互汰（p2/copilot/飞书 均不受影响）");
    lc.evictGroupPeers("feishu:chat9"); // 飞书活动（自身组）
    assert.deepEqual(evicted, [], "飞书自身组无其他会话可汰");
  });

  it("标准5：被淘汰会话切回发消息 → 透明懒恢复，同时反向冷却组内另一会话", () => {
    const evicted = [];
    const lc = createSessionLifecycle({ onEvict: (k) => evicted.push(k) });
    lc.register("ui:project:p1:s1", makeEntry("ui:project:p1:s1"));
    lc.register("ui:project:p1:s2", makeEntry("ui:project:p1:s2"));
    lc.evictGroupPeers("ui:project:p1:s2"); // s1 被冷却
    assert.deepEqual(evicted, ["ui:project:p1:s1"]);
    // s1 切回发消息（register 触达 = 恢复路径，035 标准5 懒恢复集成面验证）→ 反向冷却 s2
    lc.register("ui:project:p1:s1", makeEntry("ui:project:p1:s1"));
    lc.evictGroupPeers("ui:project:p1:s1");
    assert.deepEqual(evicted, ["ui:project:p1:s1", "ui:project:p1:s2"], "反向冷却；组内恒 ≤1 热会话");
  });
});
