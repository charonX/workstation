// REQ-TRACE: 2026-08-02-builtin-agent/REQ-AGENT-016
// REQ-VERSION: v1-hash:4ed3c67befef393165738dafca1a9a153b278661403fc6cc06025a430d1bab87
// CAPABILITY-TRACE: agent-dialogue
// ENTITY-TRACE: confirmation
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { startServer, stopServer } from "../../../../../../src/http/server.js";

// seam：确认服务状态机（agent_confirmations 表，临时 SQLite）+ 真 IPC 集成（notify-result 回投，W-2）。

// seam：确认服务（tech-design「确认服务（b 解耦）」）。
// 建议落点 src/services/confirmationService.js，导出 createConfirmationService({ dbPath, execute, notifyResult, sendCard }) →
// { submit(req) → {status, replyText}, approve(confirmId), reject(confirmId), get(confirmId), listPending() }。
// req = { confirmId, sessionKey, command, args, riskLevel }；agent_confirmations 状态 pending|approved|rejected。
// 确认后由确认服务直接驱动同一命令模块执行（execute 注入，C2 路径），结果经 notifyResult 注入会话（W-2）。
async function loadConfirmationService() {
  const mod = await import("../../../../../../src/services/confirmationService.js").catch(() => null);
  assert.ok(mod, "seam 未就绪：src/services/confirmationService.js 尚未实现（REQ-AGENT-016）");
  assert.equal(typeof mod.createConfirmationService, "function", "confirmationService 应导出 createConfirmationService()");
  return mod.createConfirmationService;
}

describe("REQ-AGENT-016 高危确认挂起与解耦执行", () => {
  let workdir;

  beforeEach(() => {
    workdir = fs.mkdtempSync(path.join(os.tmpdir(), "confirmation-"));
  });

  afterEach(() => {
    fs.rmSync(workdir, { recursive: true, force: true });
  });

  it("confirm 级命令拦截 → 挂起队列 + 确认卡片 + agent 回复待确认", async () => {
    const createConfirmationService = await loadConfirmationService();
    const cards = [];
    const executed = [];
    const svc = createConfirmationService({
      dbPath: path.join(workdir, "confirm.db"),
      sendCard: async (card) => { cards.push(card); return { cardId: `card_${cards.length}` }; },
      execute: async (command, args) => { executed.push({ command, args }); return { output: "已删除" }; }
    });
    const req = { confirmId: crypto.randomUUID(), sessionKey: "feishu:oc_1", command: "source delete", args: { id: "src_1" }, riskLevel: "confirm" };
    const result = svc.submit(req);
    // 挂起队列（agent_confirmations pending，REQ-AGENT-016 标准 1）。
    const row = svc.get(req.confirmId);
    assert.equal(row.status, "pending", "确认请求应挂起为 pending");
    assert.equal(row.command, "source delete", "队列应记录命令");
    assert.deepEqual(row.args, { id: "src_1" }, "队列应记录参数");
    assert.equal(row.sessionKey, "feishu:oc_1", "队列应记录会话");
    assert.equal(row.riskLevel, "confirm", "队列应记录风险等级");
    // 确认卡片含命令摘要。
    assert.equal(cards.length, 1, "应发确认卡片");
    assert.ok(
      JSON.stringify(cards[0]).includes("source delete") || JSON.stringify(cards[0]).includes("src_1"),
      "确认卡片应含命令摘要"
    );
    // agent 该轮结束并回复「操作待确认」。
    assert.ok(result.replyText.includes("待确认"), `agent 回复应含「待确认」，实际: ${result.replyText}`);
    assert.equal(executed.length, 0, "挂起期间不应执行");
  });

  it("确认回调驱动执行（不经过 agent turn）+ notify-result 回投自然语言", async () => {
    const createConfirmationService = await loadConfirmationService();
    const executed = [];
    const notified = [];
    const svc = createConfirmationService({
      dbPath: path.join(workdir, "confirm.db"),
      execute: async (command, args) => { executed.push({ command, args }); return { output: "内容源已删除" }; },
      notifyResult: async (msg) => { notified.push(msg); }
    });
    const req = { confirmId: crypto.randomUUID(), sessionKey: "feishu:oc_1", command: "source delete", args: { id: "src_1" }, riskLevel: "confirm" };
    svc.submit(req);
    await svc.approve(req.confirmId);
    // 确认服务直接驱动同一命令模块执行（不经过 agent turn，REQ-AGENT-016 标准 2）。
    assert.deepEqual(executed, [{ command: "source delete", args: { id: "src_1" } }], "确认后应由确认服务驱动同一命令模块执行");
    // 结果经 notify-result 注入会话 → agent 生成自然语言回投（断言回投文本基于执行结果）。
    assert.equal(notified.length, 1, "应经 notify-result 回投会话");
    assert.equal(notified[0].sessionKey, "feishu:oc_1");
    assert.ok(JSON.stringify(notified[0].result).includes("内容源已删除"), "回投应基于执行结果");
  });

  it("拒绝 → 不执行 + 回投已取消", async () => {
    const createConfirmationService = await loadConfirmationService();
    const executed = [];
    const notified = [];
    const svc = createConfirmationService({
      dbPath: path.join(workdir, "confirm.db"),
      execute: async (command, args) => { executed.push({ command, args }); return {}; },
      notifyResult: async (msg) => { notified.push(msg); }
    });
    const req = { confirmId: crypto.randomUUID(), sessionKey: "feishu:oc_1", command: "source delete", args: { id: "src_1" }, riskLevel: "confirm" };
    svc.submit(req);
    await svc.reject(req.confirmId);
    assert.equal(executed.length, 0, "拒绝后不应执行（REQ-AGENT-016 标准 3）");
    assert.equal(svc.get(req.confirmId).status, "rejected", "状态应为 rejected");
    assert.ok(
      JSON.stringify(notified[0]).includes("已取消") || notified[0].cancelled === true,
      "应回投「已取消」"
    );
  });

  it("confirmId 幂等：重复回调只执行一次", async () => {
    const createConfirmationService = await loadConfirmationService();
    const executed = [];
    const svc = createConfirmationService({
      dbPath: path.join(workdir, "confirm.db"),
      execute: async (command, args) => { executed.push({ command, args }); return {}; }
    });
    const req = { confirmId: crypto.randomUUID(), sessionKey: "feishu:oc_1", command: "settings set", args: { key: "x", value: "1" }, riskLevel: "confirm" };
    svc.submit(req);
    await svc.approve(req.confirmId);
    await svc.approve(req.confirmId); // 重复回调
    assert.equal(executed.length, 1, "同一 confirmId 应只执行一次（签核决策 18 / REQ-AGENT-016 标准 4）");
  });

  it("挂起队列持久化：重启后 pending 项仍可确认", async () => {
    const createConfirmationService = await loadConfirmationService();
    const dbPath = path.join(workdir, "confirm.db");
    const executed = [];
    const svc1 = createConfirmationService({ dbPath, execute: async () => {} });
    const req = { confirmId: crypto.randomUUID(), sessionKey: "feishu:oc_1", command: "channel bind", args: { flowId: "f1" }, riskLevel: "confirm" };
    svc1.submit(req);
    // 重启（新实例，同一 SQLite 文件——SQLite 为真相，REQ-AGENT-016 标准 5）。
    const svc2 = createConfirmationService({
      dbPath,
      execute: async (command, args) => { executed.push({ command, args }); return { output: "绑定成功" }; }
    });
    const pending = svc2.listPending();
    assert.ok(pending.some((p) => p.confirmId === req.confirmId), "重启后 pending 项应仍在队列（挂起可稍后处理）");
    await svc2.approve(req.confirmId);
    assert.equal(executed.length, 1, "重启后 pending 项仍可确认");
  });
});

describe("REQ-AGENT-016 HTTP 端点路由（文档化契约：/api/agent/confirmations[...]）", () => {
  let workdir;
  let serverCtx;
  let svc;
  const executed = [];

  beforeEach(async () => {
    workdir = fs.mkdtempSync(path.join(os.tmpdir(), "confirmation-http-"));
    serverCtx = await startServer();
    // 用 mock 背书确认服务替换 server 惰性工厂（ADR-009 惰性创建）：
    // 文档化端点路径解析走真实 handleRequest → 路由层，执行层与现有服务级用例同模式。
    const createConfirmationService = await loadConfirmationService();
    executed.length = 0;
    svc = createConfirmationService({
      dbPath: path.join(workdir, "confirm.db"),
      execute: async (command, args) => { executed.push({ command, args }); return { output: "内容源已删除" }; },
      notifyResult: async () => {}
    });
    serverCtx.server._opcConfirmationServiceFactory = () => svc;
  });

  afterEach(async () => {
    await stopServer(serverCtx);
    fs.rmSync(workdir, { recursive: true, force: true });
  });

  it("GET /api/agent/confirmations 返回挂起队列（文档化端点可达）", async () => {
    const req = { confirmId: crypto.randomUUID(), sessionKey: "feishu:oc_1", command: "source delete", args: { id: "src_1" }, riskLevel: "confirm" };
    svc.submit(req);
    const res = await fetch(`${serverCtx.baseUrl}/api/agent/confirmations`);
    assert.equal(res.status, 200, "GET /api/agent/confirmations 应 200（文档化端点可达，挂起队列可见）");
    const body = await res.json();
    assert.ok(Array.isArray(body.pending), "响应应含 pending 数组");
    const hit = body.pending.find((p) => p.confirmId === req.confirmId);
    assert.ok(hit, "挂起队列应含刚 submit 的 confirmId");
    assert.equal(hit.status, "pending", "队列项状态应为 pending");
  });

  it("POST /api/agent/confirmations/:confirmId/approve 驱动执行（文档化端点可达）", async () => {
    const req = { confirmId: crypto.randomUUID(), sessionKey: "feishu:oc_1", command: "source delete", args: { id: "src_1" }, riskLevel: "confirm" };
    svc.submit(req);
    const res = await fetch(`${serverCtx.baseUrl}/api/agent/confirmations/${req.confirmId}/approve`, { method: "POST" });
    assert.equal(res.status, 200, "POST /api/agent/confirmations/:confirmId/approve 应 200（文档化端点可达）");
    assert.deepEqual(executed, [{ command: "source delete", args: { id: "src_1" } }], "确认回调应驱动同一命令模块执行（不经过 agent turn）");
    assert.equal(svc.get(req.confirmId).status, "approved", "状态应转 approved");
  });
});
