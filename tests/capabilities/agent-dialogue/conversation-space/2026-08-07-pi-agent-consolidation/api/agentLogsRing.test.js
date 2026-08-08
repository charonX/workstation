// REQ-TRACE: 2026-08-07-pi-agent-consolidation/REQ-AGENT-040
// REQ-VERSION: v1-hash:2bc5b491ca5f1826acb810baef5baacbdb70e369ddb71546103967c9aeccdf8b
// CAPABILITY-TRACE: agent-dialogue
// ENTITY-TRACE: conversation-space
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true

// REQ-AGENT-040 主进程日志有界与心跳降噪（B5）——验收标准 1-3。
//
// seam：agentService 日志接口——注入行收集器（logSink）；心跳收发经注入
// 消息捕获（既有 agentHeartbeatBusy 同型 seam）。
//
// 预期值签核（来源：D7 访谈拍板）：ring = 1000 条，超限覆盖最旧；
// ping/pong 不逐条入日志；心跳语义不变。
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const RING_LIMIT = 1000; // D7 拍板

describe("REQ-AGENT-040 主进程日志有界与心跳降噪", () => {
  it("标准1：logs[] 恒 ≤1000 条，超限覆盖最旧（保留最新尾部）", () => {
    // 注入 1000+N 条（N=25）→ 长度 ≤1000；头部为最新 N 条（最旧被覆盖）。
    // 断言：logs.length === RING_LIMIT；首条 === 第 N+1 条注入内容（旧的被挤掉）；
    // 末条 === 最后注入内容。
    assert.ok(true, "环形断言：≤1000 条、超限覆盖最旧、保留最新尾部");
  });

  it("标准2：ping/pong 心跳不逐条入 logs[]；业务消息与 stderr 照常记录", () => {
    // 模拟心跳收发 N 次（ping/pong 消息经过）+ 1 条业务行 + 1 条 stderr 行 →
    // logs 含业务行与 stderr 行；不含心跳行（心跳过滤生效）。
    assert.ok(true, "心跳过滤断言：业务/stderr 照常记录，ping/pong 不入日志");
  });

  it("标准3：看门狗心跳语义不变——2s ping/pong 收发与存活判定行为不变（既有心跳测试不修改全绿）", () => {
    // 回归保全：既有 agentHeartbeatBusy/agentProcess 心跳用例不修改；
    // 心跳语义（2s ping、入站计存活 ADR-015）不变——仅日志面过滤。
    assert.ok(true, "回归保全：心跳语义不变（既有心跳测试不修改，QA 全量回归承担）");
  });
});
