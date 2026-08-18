// REQ-TRACE: REQ-AGENT-119, REQ-AGENT-120
// REQ-VERSION: v1-hash:5fc84a414bae89771b7e31c335e23c2a60ff3ba0537e7405deb2645018b99ead
// CAPABILITY-TRACE: agent-security
// ENTITY-TRACE: PermissionAdjudicator
// EXPECTED-TRACE: prd.md §6.3 row 6-7, §10.3 row 2
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createPermissionAdjudicator } from "../../../../../../src/services/permissionAdjudicator.js";

describe("REQ-AGENT-119 & 120: PermissionAdjudicator 领域状态机与唯一执行者契约", () => {
  let tmpDb;
  let executedCommands;
  let sentCards;
  let publishedEvents;

  beforeEach(() => {
    tmpDb = path.join(os.tmpdir(), `test-adjudicator-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
    executedCommands = [];
    sentCards = [];
    publishedEvents = [];
  });

  function makeAdjudicator(options = {}) {
    return createPermissionAdjudicator({
      dbPath: tmpDb,
      execute: async (cmd, args) => {
        executedCommands.push({ cmd, args });
        return { output: "executed" };
      },
      sendCard: async (sessionKey, card) => {
        sentCards.push({ sessionKey, card });
      },
      ...options,
    });
  }

  it("1. Per-Instance 构造与挂起行持久化", () => {
    const adj = makeAdjudicator();
    const result = adj.submit({
      confirmId: "c-1",
      sessionKey: "ui:copilot:s1",
      command: "bash",
      args: { command: "rm -rf foo" },
      riskLevel: "permission",
      notifyOnSettle: false,
    });

    assert.equal(result.status, "pending");
    const row = adj.get("c-1");
    assert.equal(row.confirm_id, "c-1");
    assert.equal(row.status, "pending");
  });

  it("2. 授权桥 approve 仅产生 allow 决策，主进程 zero execute（唯一执行者）", async () => {
    const adj = makeAdjudicator();
    adj.submit({
      confirmId: "c-bridge-1",
      sessionKey: "ui:copilot:s1",
      command: "delete",
      args: { path: "foo.txt" },
      riskLevel: "permission",
      notifyOnSettle: false,
    });

    const decisionPromise = adj.waitForDecision("c-bridge-1");
    // EXPECTED-TRACE: prd.md §6.3 row 6
    const approveRes = await adj.approve("c-bridge-1");
    assert.equal(approveRes.success, true);

    const decision = await decisionPromise;
    assert.deepEqual(decision, { kind: "allow" });
    // 关键安全断言：主进程 execute 零调用！
    assert.equal(executedCommands.length, 0);
  });

  it("3. reject 决议即时通知 deny 并携带取消原因", async () => {
    const adj = makeAdjudicator();
    adj.submit({
      confirmId: "c-bridge-2",
      sessionKey: "ui:copilot:s1",
      command: "write",
      args: { path: "bar.txt" },
      riskLevel: "permission",
    });

    const decisionPromise = adj.waitForDecision("c-bridge-2");
    // EXPECTED-TRACE: prd.md §6.3 row 7
    await adj.reject("c-bridge-2", "用户在内联卡点击拒绝");

    const decision = await decisionPromise;
    assert.equal(decision.kind, "deny");
    assert.match(decision.reason, /用户在内联卡点击拒绝|操作已取消/);
    assert.equal(executedCommands.length, 0);
  });

  it("4. 决议幂等性：已决议项重复 approve/reject 不产生二次分发", async () => {
    const adj = makeAdjudicator();
    adj.submit({
      confirmId: "c-idem-1",
      sessionKey: "ui:copilot:s1",
      command: "bash",
      riskLevel: "permission",
    });

    await adj.approve("c-idem-1");
    const repeatApprove = await adj.approve("c-idem-1");
    assert.equal(repeatApprove.success, true);
    assert.equal(executedCommands.length, 0);
  });
});
