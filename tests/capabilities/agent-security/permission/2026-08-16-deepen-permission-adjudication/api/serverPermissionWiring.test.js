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
import { fileURLToPath } from "node:url";
import { createConfirmationService } from "../../../../../../src/services/confirmationService.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe("REQ-AGENT-122: 主进程装配与路由胶水清理契约", () => {
  it("1. confirmationService.js 保持兼容包装器接口", () => {
    assert.equal(typeof createConfirmationService, "function");
    const svc = createConfirmationService({ dbPath: ":memory:" });
    assert.equal(typeof svc.submit, "function");
    assert.equal(typeof svc.approve, "function");
    assert.equal(typeof svc.reject, "function");
    assert.equal(typeof svc.get, "function");
    assert.equal(typeof svc.listPending, "function");
  });

  it("2. server.js 中不再存在重复的 strict 模式 if-else 实现", () => {
    const serverJsPath = path.resolve(__dirname, "../../../../../../src/http/server.js");
    const content = fs.readFileSync(serverJsPath, "utf-8");
    // 确保 server.js 不再包含历史的手写权限二次门控
    assert.doesNotMatch(content, /if\s*\(mode\s*===\s*['"]strict['"]\)\s*\{\s*return\s*['"]ask['"];?\s*\}/);
  });
});
