// REQ-TRACE: REQ-AGENT-121
// REQ-VERSION: v1-hash:5fc84a414bae89771b7e31c335e23c2a60ff3ba0537e7405deb2645018b99ead
// CAPABILITY-TRACE: agent-security
// ENTITY-TRACE: AuthorizerBridge
// EXPECTED-TRACE: prd.md §6.3 row 8, §10.3 row 3
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { createPermissionAdjudicator } from "../../../../../../src/services/permissionAdjudicator.js";
import { createPermissionBridge } from "../../../../../../src/services/permissionBridge.js";

describe("REQ-AGENT-121: 双端授权桥与 pre-gate 统一接入", () => {
  function makeBridge() {
    const tmpDb = path.join(os.tmpdir(), `test-bridge-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
    const adjudicator = createPermissionAdjudicator({ dbPath: tmpDb });
    const bridge = createPermissionBridge({ adjudicator });
    return { adjudicator, bridge };
  }

  it("1. bridge.authorize 提交并等待决议", async () => {
    const { adjudicator, bridge } = makeBridge();
    // EXPECTED-TRACE: prd.md §6.3 row 8
    const authResult = await bridge.authorize({
      spaceKey: "ui:copilot:s1",
      tool: "edit",
      input: { path: "main.js" },
      description: "edit main.js",
      confirmId: "bridge-c-1",
    });

    assert.equal(authResult.confirmId, "bridge-c-1");
    // 主进程决议
    await adjudicator.approve("bridge-c-1");

    const decision = await authResult.decision;
    assert.deepEqual(decision, { kind: "allow" });
  });

  it("2. bridge.evaluateBashToolCall 对重定向运算符产生 ask 并在 approve 后放行", async () => {
    const { adjudicator, bridge } = makeBridge();
    const result = await bridge.evaluateBashToolCall({
      spaceKey: "ui:copilot:s1",
      command: "echo test > file.txt",
      cwd: "/tmp",
      confirmId: "bridge-c-2",
    });

    assert.equal(result.verdict, "ask");
    assert.equal(result.confirmId, "bridge-c-2");

    await adjudicator.approve("bridge-c-2");
    const decision = await result.decision;
    assert.deepEqual(decision, { kind: "allow" });
  });

  it("3. bridge.evaluateBashToolCall 对无重定向安全命令返回 allow", async () => {
    const { bridge } = makeBridge();
    const result = await bridge.evaluateBashToolCall({
      spaceKey: "ui:copilot:s1",
      command: "git status",
      cwd: "/tmp",
    });

    assert.equal(result.verdict, "allow");
    assert.equal(result.confirmId, undefined);
  });
});
