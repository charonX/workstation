// REQ-TRACE: 2026-08-02-builtin-agent/REQ-AGENT-014, 2026-08-02-builtin-agent/REQ-AGENT-015
// REQ-VERSION: v1-hash:16f30c7bbd781fb9f86f573f3c92dc0c96a1aa38aecf3bd08c54caa0cdb712f4
// CAPABILITY-TRACE: agent-dialogue
// ENTITY-TRACE: user-binding
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { startServer, stopServer } from "../../../../../../src/http/server.js";
import { getDb } from "../../../../../../src/db.js";

// seam：agentRouter 绑定检查纯函数 + settings 绑定状态（pendingBind 状态机，E3 + arming，W-1）。

// seam：agentRouter（tech-design「agentRouter（三纯函数）」）。
// 建议落点 src/services/agentRouter.js，导出 createAgentRouter({ now? }) →
// { route({message, chatId, senderId, channelType}) → {action: "reject"|"command"|"dialogue", payload},
//   beginBinding(), cancelBinding(), unbind(), getBindingStatus() → {bound, openId?, pendingBind?} }。
// pendingBind 存储于 settings JSON：{ pendingBind: { createdAt, expiresAt } }（一次性 + 10 分钟有效期）。
async function loadAgentRouter() {
  const mod = await import("../../../../../../src/services/agentRouter.js").catch(() => null);
  assert.ok(mod, "seam 未就绪：src/services/agentRouter.js 尚未实现（REQ-AGENT-014/015）");
  assert.equal(typeof mod.createAgentRouter, "function", "agentRouter 应导出 createAgentRouter()");
  return mod.createAgentRouter;
}

describe("REQ-AGENT-014 用户绑定（E3 + arming）", () => {
  let server;
  let baseUrl;
  let workdir;
  let router;

  beforeEach(async () => {
    workdir = fs.mkdtempSync(path.join(os.tmpdir(), "user-binding-"));
    process.env.OPC_WORKSTATION_CONFIG_DIR = workdir;
    ({ server, baseUrl } = await startServer({ port: 0 }));
    const createAgentRouter = await loadAgentRouter();
    router = createAgentRouter({});
  });

  afterEach(async () => {
    await stopServer({ server });
    fs.rmSync(workdir, { recursive: true, force: true });
  });

  it("状态机：未绑定 → arming(pendingBind) → 下一条消息绑定 → 解绑 → 重绑", async () => {
    assert.equal(router.getBindingStatus().bound, false, "初始未绑定");
    router.beginBinding();
    assert.ok(router.getBindingStatus().pendingBind, "arming 后应置 pendingBind（REQ-AGENT-014 标准 1）");
    const bound = router.route({ message: "你好", chatId: "oc_1", senderId: "ou_alice", channelType: "p2p" });
    assert.ok(JSON.stringify(bound.payload).includes("绑定成功"), "下一条未绑定消息应绑定并回复「绑定成功」");
    const st = router.getBindingStatus();
    assert.equal(st.bound, true, "绑定后状态应为已绑定");
    assert.equal(st.openId, "ou_alice", "应记录发送者 open_id（E3）");
    assert.ok(!st.pendingBind, "绑定后应清除 pendingBind");
    // 解绑后可重走引导（签核决策 10）。
    router.unbind();
    assert.equal(router.getBindingStatus().bound, false, "解绑后回到未绑定");
    router.beginBinding();
    const rebound = router.route({ message: "再绑一次", chatId: "oc_2", senderId: "ou_bob", channelType: "p2p" });
    assert.ok(JSON.stringify(rebound.payload).includes("绑定成功"), "解绑后可重新绑定");
    assert.equal(router.getBindingStatus().openId, "ou_bob", "重绑应记录新 open_id");
  });

  it("pendingBind 一次性：仅下一条未绑定消息生效", async () => {
    router.beginBinding();
    const first = router.route({ message: "第一条", chatId: "oc_1", senderId: "ou_1", channelType: "p2p" });
    assert.ok(JSON.stringify(first.payload).includes("绑定成功"), "第一条消息应完成绑定");
    const second = router.route({ message: "第二条", chatId: "oc_1", senderId: "ou_2", channelType: "p2p" });
    assert.equal(second.action, "reject", "第二条（未绑定者）应拒绝（REQ-AGENT-014 标准 2）");
    assert.ok(JSON.stringify(second.payload).includes("E-AUTH-NOT-BOUND"), "拒绝应含 E-AUTH-NOT-BOUND");
  });

  it("未 arming 时未绑定消息 → 拒绝 + 引导卡片（不执行绑定）", async () => {
    const res = router.route({ message: "查询", chatId: "oc_1", senderId: "ou_x", channelType: "p2p" });
    assert.equal(res.action, "reject", "未 arming 时未绑定消息应拒绝（REQ-AGENT-014 标准 3）");
    assert.ok(JSON.stringify(res.payload).includes("E-AUTH-NOT-BOUND"), "应含 E-AUTH-NOT-BOUND");
    assert.ok(/设置|绑定/.test(JSON.stringify(res.payload)), "应含引导（提示去 Settings 发起绑定）");
    const st = router.getBindingStatus();
    assert.equal(st.bound, false, "绑定状态不应变化");
    assert.ok(!st.pendingBind, "不应产生 pendingBind");
  });

  it("pendingBind 有效期 10 分钟 / 取消", async () => {
    // 时钟注入：now() 由测试控制。
    let clock = Date.parse("2026-08-03T00:00:00Z");
    const createAgentRouter = await loadAgentRouter();
    const clocked = createAgentRouter({ now: () => clock });
    clocked.beginBinding();
    const status = clocked.getBindingStatus();
    assert.ok(status.pendingBind, "置位后应有 pendingBind");
    const ttl = status.pendingBind.expiresAt - status.pendingBind.createdAt;
    assert.equal(ttl, 10 * 60 * 1000, "pendingBind 有效期应为 10 分钟（签核修订②）");
    // 过期后不生效。
    clock += 10 * 60 * 1000 + 1;
    const expired = clocked.route({ message: "绑定我", chatId: "oc_1", senderId: "ou_late", channelType: "p2p" });
    assert.equal(expired.action, "reject", "过期 pendingBind 不应生效（REQ-AGENT-014 标准 5）");
    assert.ok(JSON.stringify(expired.payload).includes("E-AUTH-NOT-BOUND"), "过期后应拒绝");
    // 取消后不生效。
    const cancelledRouter = createAgentRouter({ now: () => clock });
    cancelledRouter.beginBinding();
    cancelledRouter.cancelBinding();
    assert.ok(!cancelledRouter.getBindingStatus().pendingBind, "取消后 pendingBind 应清除");
    const cancelled = cancelledRouter.route({ message: "绑定我", chatId: "oc_1", senderId: "ou_late2", channelType: "p2p" });
    assert.equal(cancelled.action, "reject", "取消后绑定不生效");
  });
});

describe("REQ-AGENT-015 未绑定用户拒绝", () => {
  let server;
  let baseUrl;
  let workdir;
  let router;

  beforeEach(async () => {
    workdir = fs.mkdtempSync(path.join(os.tmpdir(), "user-binding-"));
    process.env.OPC_WORKSTATION_CONFIG_DIR = workdir;
    ({ server, baseUrl } = await startServer({ port: 0 }));
    const createAgentRouter = await loadAgentRouter();
    router = createAgentRouter({});
  });

  afterEach(async () => {
    await stopServer({ server });
    fs.rmSync(workdir, { recursive: true, force: true });
  });

  it("未绑定用户一切消息（含查询）→ E-AUTH-NOT-BOUND，不启动会话不执行命令", async () => {
    const textRes = router.route({ message: "看下执行情况", chatId: "oc_1", senderId: "ou_unbound", channelType: "p2p" });
    assert.equal(textRes.action, "reject", "未绑定用户普通消息应拒绝（读也拒，签核决策 8）");
    assert.ok(JSON.stringify(textRes.payload).includes("E-AUTH-NOT-BOUND"));
    assert.ok(JSON.stringify(textRes.payload).includes("设置"), "拒绝回复应提示先在设置中绑定操作者");
    const cmdRes = router.route({ message: `/status ${crypto.randomUUID()}`, chatId: "oc_1", senderId: "ou_unbound", channelType: "p2p" });
    assert.equal(cmdRes.action, "reject", "命令消息也应被拒绝");
    assert.ok(JSON.stringify(cmdRes.payload).includes("E-AUTH-NOT-BOUND"), "命令消息拒绝应含 E-AUTH-NOT-BOUND");
    // 不启动 agent 会话（REQ-AGENT-015 标准 1）。
    const { c } = getDb().prepare("SELECT COUNT(*) AS c FROM agent_sessions").get();
    assert.equal(c, 0, "未绑定拒绝不应创建会话行");
  });

  it("拒绝先于命令识别与会话分发", async () => {
    const commands = { called: 0 };
    const createAgentRouter = await loadAgentRouter();
    const strictRouter = createAgentRouter({ commands });
    const cmdRes = strictRouter.route({ message: `/status ${crypto.randomUUID()}`, chatId: "oc_1", senderId: "ou_unbound", channelType: "p2p" });
    assert.equal(cmdRes.action, "reject", "未绑定应先于命令识别被拒绝（REQ-AGENT-015 标准 2）");
    assert.equal(commands.called, 0, "命令模块不应被调用（拒绝先于命令识别）");
    const dialogueRes = strictRouter.route({ message: "查询意图消息", chatId: "oc_1", senderId: "ou_unbound", channelType: "p2p" });
    assert.equal(dialogueRes.action, "reject", "未绑定应先于会话分发被拒绝");
    assert.ok(JSON.stringify(dialogueRes.payload).includes("E-AUTH-NOT-BOUND"), "会话分发前拒绝应含 E-AUTH-NOT-BOUND");
  });
});
