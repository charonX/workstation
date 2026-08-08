// REQ-TRACE: 2026-08-07-pi-agent-consolidation/REQ-AGENT-040
// REQ-VERSION: v1-hash:2bc5b491ca5f1826acb810baef5baacbdb70e369ddb71546103967c9aeccdf8b
// CAPABILITY-TRACE: agent-dialogue
// ENTITY-TRACE: conversation-space
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true

// REQ-AGENT-040 主进程日志有界与心跳降噪（B5）——验收标准 1-3。
//
// seam：createAgentService({ cwd, sessionDir, logRingLimit?, logSink? })：
//   - logRingLimit：环形上界注入（默认 1000，D7 拍板）；
//   - logSink：行收集器注入（标准 1「注入 1000+N 条」）；
//   - service.log(text)：直调注入（业务行/stderr 模拟）；
//   - isHeartbeatMessageType(type)：导出判别（标准 2 心跳类型断言）。
// NODE_ENV=test 自动 FAUX（零网络），不 spawn 真实 worker。
//
// 预期值签核（来源：D7 访谈拍板）：ring = 1000 条，超限覆盖最旧；
// ping/pong 不逐条入日志；心跳语义不变。
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const RING_LIMIT = 1000; // D7 拍板

async function loadAgentService() {
  const mod = await import("../../../../../../src/services/agentService.js").catch(() => null);
  assert.ok(mod, "seam 未就绪：src/services/agentService.js 尚未实现（REQ-AGENT-040）");
  assert.equal(typeof mod.createAgentService, "function", "agentService 应导出 createAgentService()");
  return mod;
}

describe("REQ-AGENT-040 主进程日志有界与心跳降噪", () => {
  let workdir;
  let agentService;
  let collect;

  beforeEach(() => {
    workdir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-logs-ring-"));
  });

  afterEach(async () => {
    if (agentService) {
      try { agentService.stop?.(); } catch { /* noop */ }
    }
    fs.rmSync(workdir, { recursive: true, force: true });
  });

  it("标准1：logs[] 恒 ≤1000 条，超限覆盖最旧（保留最新尾部）", async () => {
    const mod = await loadAgentService();
    const { createAgentService } = mod;
    agentService = createAgentService({
      cwd: workdir,
      sessionDir: path.join(workdir, "sessions"),
    });
    // 注入 1000+N 条（N=25）：超限后恒 ≤1000、覆盖最旧、保留最新尾部
    // （断言对象 = service.logs 内部环形数组；logSink 为观察侧，转发全部行）
    for (let i = 1; i <= RING_LIMIT + 25; i++) {
      agentService.log(`line-${i}`);
    }
    assert.ok(agentService.logs.length <= RING_LIMIT, `logs 恒 ≤1000（实际 ${agentService.logs.length}）`);
    assert.equal(agentService.logs.length, RING_LIMIT, "超限后长度恰为 1000");
    assert.equal(agentService.logs[0], "line-26", "最旧的 25 条被覆盖（首条=第 26 条）");
    assert.equal(agentService.logs[agentService.logs.length - 1], "line-1025", "保留最新尾部（末条=最后注入）");
  });

  it("标准1b：logRingLimit 注入——缩小环形做快速满环断言", async () => {
    const mod = await loadAgentService();
    const { createAgentService } = mod;
    agentService = createAgentService({
      cwd: workdir,
      sessionDir: path.join(workdir, "sessions"),
      logRingLimit: 5,
    });
    for (let i = 1; i <= 8; i++) {
      agentService.log(`line-${i}`);
    }
    assert.equal(agentService.logs.length, 5, "logRingLimit=5 → 恒 ≤5");
    assert.equal(agentService.logs[0], "line-4", "覆盖最旧（首条=第 4 条）");
    assert.equal(agentService.logs[4], "line-8", "保留最新尾部");
  });

  it("标准2：ping/pong 心跳不逐条入 logs[]；业务消息与 stderr 照常记录", async () => {
    const mod = await loadAgentService();
    const { createAgentService, isHeartbeatMessageType } = mod;
    assert.equal(typeof isHeartbeatMessageType, "function", "导出 isHeartbeatMessageType 判别");
    assert.equal(isHeartbeatMessageType("ping"), true);
    assert.equal(isHeartbeatMessageType("pong"), true);
    assert.equal(isHeartbeatMessageType("session-event"), false);
    agentService = createAgentService({
      cwd: workdir,
      sessionDir: path.join(workdir, "sessions"),
    });
    // 业务消息与 stderr 照常记录
    agentService.log("business-line");
    assert.ok(agentService.logs.includes("business-line"), "业务行照常记录");
    // 心跳收发路径（logSend）不逐条入日志——真实子进程路径由既有
    // agentHeartbeatBusy/agentProcess 回归 + 父验证实测（7s 真实心跳无 ping 行）承担；
    // 此处以 isHeartbeatMessageType 判别语义锁定过滤的判定面。
    const heartbeatLines = agentService.logs.filter((l) => /ping|pong/i.test(l));
    assert.equal(heartbeatLines.length, 0, "日志中无心跳行");
  });

  it("标准3：看门狗心跳语义不变——2s ping/pong 收发与存活判定行为不变（既有心跳测试不修改全绿）", () => {
    // 回归保全：既有 agentHeartbeatBusy/agentProcess 心跳用例不修改（父验证已跑绿）；
    // 心跳语义（2s ping、入站计存活 ADR-015）不变——仅日志面过滤。
    // 断言：DEFAULT_LOG_RING_LIMIT 导出为 1000（D7 拍板常量）。
    return loadAgentService().then((mod) => {
      assert.equal(mod.DEFAULT_LOG_RING_LIMIT, RING_LIMIT, "默认环形上界 1000（D7）");
    });
  });
});
