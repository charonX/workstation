// REQ-TRACE: 2026-08-16-deepen-session-domain/REQ-AGENT-114
// REQ-VERSION: v1-hash:370f51eb4d13d39db48c284dfa2857d2ceaa603138023afb94c94325fbd4c245
// CAPABILITY-TRACE: agent-dialogue
// ENTITY-TRACE: conversation-space
// EXPECTED-TRACE: prd.md §6.3 块3 key 解析锚点（uiGroupPrefixFor 三组映射/projectIdOf/newUiSpaceKeyFor 前缀+UUID/非 ui→undefined）
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: false

// REQ-AGENT-114：空间 key 解析与会话元数据投影搬迁（ADR-016 ui 空间语法）。
// uiGroupPrefixFor / projectIdOf / newUiSpaceKeyFor / gitStateForSpace 从
// sessionDomain.js 直测。gitStateForSpace 的 none 三态（非项目空间/项目已删/
// DB 异常）在此直测；项目空间正分支（branch/detached）由既有 sessionEvents
// 测试的 session-git 首帧断言承载（集成面，REQ-AGENT-058 契约不变）。
//
// seam：src/services/sessionDomain.js 的四个导出函数。

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

async function loadDomain() {
  const mod = await import("../../../../../../src/services/sessionDomain.js").catch(() => null);
  assert.ok(mod, "seam 未就绪：src/services/sessionDomain.js 尚未实现（REQ-AGENT-114，ADR-030）");
  for (const name of ["uiGroupPrefixFor", "projectIdOf", "newUiSpaceKeyFor", "gitStateForSpace"]) {
    assert.equal(typeof mod[name], "function", `sessionDomain.js 应导出 ${name}`);
  }
  return mod;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe("REQ-AGENT-114 空间 key 解析", () => {
  it("AC1 uiGroupPrefixFor 三组映射", async () => {
    const domain = await loadDomain();

    // EXPECTED-TRACE: prd.md §6.3 块3 row 1-3
    assert.equal(domain.uiGroupPrefixFor("ui:project:p1:s1"), "ui:project:p1:");
    assert.equal(domain.uiGroupPrefixFor("ui:copilot:abc"), "ui:copilot:");
    assert.equal(domain.uiGroupPrefixFor("feishu:xxx"), undefined);
  });

  it("AC2 projectIdOf：项目空间取 pid；其余 → undefined；非字符串输入安全", async () => {
    const domain = await loadDomain();

    // EXPECTED-TRACE: prd.md §6.3 块3 row 4
    assert.equal(domain.projectIdOf("ui:project:p1:s1"), "p1");
    assert.equal(domain.projectIdOf("ui:copilot:abc"), undefined);
    assert.equal(domain.projectIdOf(null), undefined);
    assert.equal(domain.projectIdOf(undefined), undefined);
    assert.equal(domain.projectIdOf(42), undefined);
  });

  it("AC3 newUiSpaceKeyFor：同分组前缀 + 新 UUID；非 ui 空间 → undefined", async () => {
    const domain = await loadDomain();

    // EXPECTED-TRACE: prd.md §6.3 块3 row 5
    const key = domain.newUiSpaceKeyFor("ui:project:p1:s1");
    assert.ok(key.startsWith("ui:project:p1:"), "同分组前缀");
    assert.match(key.slice("ui:project:p1:".length), UUID_RE, "余段为新 UUID");
    assert.notEqual(key, domain.newUiSpaceKeyFor("ui:project:p1:s1"), "每次生成新 sessionId");

    const copilotKey = domain.newUiSpaceKeyFor("ui:copilot:abc");
    assert.ok(copilotKey.startsWith("ui:copilot:"));
    assert.match(copilotKey.slice("ui:copilot:".length), UUID_RE);

    assert.equal(domain.newUiSpaceKeyFor("feishu:xxx"), undefined);
  });
});

describe("REQ-AGENT-114 gitStateForSpace 元数据投影（none 路径）", () => {
  let workdir;

  beforeEach(() => {
    workdir = fs.mkdtempSync(path.join(os.tmpdir(), "session-domain-git-"));
    process.env.DB_PATH = path.join(workdir, "data.db");
  });

  afterEach(() => {
    delete process.env.DB_PATH;
    fs.rmSync(workdir, { recursive: true, force: true });
  });

  it("AC4 非项目空间 → {state:'none'}（不触 DB）", async () => {
    const domain = await loadDomain();

    // EXPECTED-TRACE: prd.md §6.3 块6/REQ-AGENT-058——通用/飞书空间 → none
    assert.deepEqual(domain.gitStateForSpace("ui:copilot:abc"), { state: "none" });
    assert.deepEqual(domain.gitStateForSpace("feishu:xxx"), { state: "none" });
  });

  it("AC4 项目空间但项目已删/DB 无行 → {state:'none'}", async () => {
    const domain = await loadDomain();

    // EXPECTED-TRACE: prd.md §6.3——孤儿（项目已删）→ none
    assert.deepEqual(domain.gitStateForSpace("ui:project:no-such-project:s1"), { state: "none" });
  });
});
