// REQ-TRACE: REQ-AGENT-122
// REQ-VERSION: v1-hash:5fc84a414bae89771b7e31c335e23c2a60ff3ba0537e7405deb2645018b99ead
// CAPABILITY-TRACE: agent-security
// ENTITY-TRACE: PermissionAdjudicator
// EXPECTED-TRACE: prd.md §6.3 row 9, §10.3 row 2
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { createConfirmationService } from "../../../../../../src/services/confirmationService.js";
import { createPermissionAdjudicator } from "../../../../../../src/services/permissionAdjudicator.js";
import { createPermissionBridge } from "../../../../../../src/services/permissionBridge.js";
import { createPolicyEvaluator } from "../../../../../../src/services/permissionPolicy.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe("REQ-AGENT-122: 主进程装配与路由胶水清理契约（strict 统一内聚）", () => {
  it("1. confirmationService.js 保持兼容包装器接口", () => {
    assert.equal(typeof createConfirmationService, "function");
    const svc = createConfirmationService({ dbPath: ":memory:" });
    assert.equal(typeof svc.submit, "function");
    assert.equal(typeof svc.approve, "function");
    assert.equal(typeof svc.reject, "function");
    assert.equal(typeof svc.get, "function");
    assert.equal(typeof svc.listPending, "function");
  });

  it("2. 静态断言：server.js 的 onPermissionAsk 不再包含 getModeService().getMode(...) === 'strict' 手写 if-else", () => {
    const serverJsPath = path.resolve(__dirname, "../../../../../../src/http/server.js");
    const content = fs.readFileSync(serverJsPath, "utf-8");
    // 确保 server.js 不再手写 strict 判定分支
    assert.doesNotMatch(content, /getMode\([^)]*\)\s*===\s*['"]strict['"]/);
  });

  it("3. 行为断言：permissionPolicy 在 mode='strict' 下对只读工具和安全命令全量判定为 ask", () => {
    const evaluator = createPolicyEvaluator({ mode: "strict", cwd: "/tmp" });
    assert.equal(evaluator.evaluate({ tool: "read", input: { path: "/tmp/a.txt" } }), "ask");
    assert.equal(evaluator.evaluate({ tool: "bash", input: { command: "echo safe" } }), "ask");
  });

  it("4. 行为断言：permissionBridge.handlePermissionAsk 统一承载 user_bash 与 strict 判定", async () => {
    const tmpDb = path.join(os.tmpdir(), `test-bridge-strict-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
    const adjudicator = createPermissionAdjudicator({ dbPath: tmpDb });
    const mockModeService = {
      getMode: (key) => (key === "ui:strict-session" ? "strict" : "auto"),
    };
    const bridge = createPermissionBridge({ adjudicator, modeService: mockModeService });

    // 在普通模式下，安全的 echo 命令直接 allow，无需挂起
    const autoDecision = await bridge.handlePermissionAsk({
      sessionKey: "ui:auto-session",
      tool: "user_bash",
      input: { command: "echo hello" },
      confirmId: "c-auto-1",
    });
    assert.deepEqual(autoDecision, { kind: "allow" });
    assert.equal(adjudicator.get("c-auto-1"), undefined);

    // 在 strict 模式下，安全的 echo 命令也必须生成挂起单，并等待 approve
    const strictDecisionPromise = bridge.handlePermissionAsk({
      sessionKey: "ui:strict-session",
      tool: "user_bash",
      input: { command: "echo hello" },
      confirmId: "c-strict-1",
    });

    const row = adjudicator.get("c-strict-1");
    assert.ok(row, "strict 模式下应在 adjudicator 中生成挂起记录");
    assert.equal(row.status, "pending");

    await adjudicator.approve("c-strict-1");
    const strictDecision = await strictDecisionPromise;
    assert.deepEqual(strictDecision, { kind: "allow" });
  });
});
