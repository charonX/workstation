// REQ-TRACE: 2026-08-16-deepen-session-domain/REQ-AGENT-114
// REQ-VERSION: v2-hash:77f0f186fe65139c162d3db19364b93827432d5424fd502d067f24df71cbb28c
// CAPABILITY-TRACE: agent-dialogue
// ENTITY-TRACE: conversation-space
// EXPECTED-TRACE: prd.md §6.3 块3 key 解析锚点（uiGroupPrefixFor 三组映射/projectIdOf/newUiSpaceKeyFor 前缀+UUID/非 ui→undefined）+ REQ-114 AC4 gitState 四态
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: false

// REQ-AGENT-114：空间 key 解析与会话元数据投影搬迁（ADR-016 ui 空间语法）。
// uiGroupPrefixFor / projectIdOf / newUiSpaceKeyFor / gitStateForSpace 从
// sessionDomain.js 直测。gitStateForSpace 四态全直测：none 三态（非项目空间/
// 项目已删/DB 异常）+ 正分支（branch/detached）。
// v2 修订：review 实证既有测试对 session-git 首帧零断言（v1「由 sessionEvents
// 承载」声明失实，signoff 已认领更正）——正分支改由本文件直测承载：DB_PATH
// 临时库 seed projects 行 + 真实临时 git 仓（sessionStats makeGitRepo 先例），
// DB 读取路径（getDb → projects.localPath → readGitBranch）整体钉住。
//
// seam：src/services/sessionDomain.js 的四个导出函数。

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getDb, closeDb } from "../../../../../../src/db.js";

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
  let savedDbPath;

  beforeEach(() => {
    savedDbPath = process.env.DB_PATH;
    workdir = fs.mkdtempSync(path.join(os.tmpdir(), "session-domain-git-"));
    process.env.DB_PATH = path.join(workdir, "data.db");
  });

  afterEach(() => {
    closeDb();
    if (savedDbPath === undefined) delete process.env.DB_PATH;
    else process.env.DB_PATH = savedDbPath;
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

  it("AC4 正分支直测：项目空间 + 真实 git 仓 → branch / detached（DB 读取路径钉住）", async () => {
    const domain = await loadDomain();

    // 真实临时 git 仓（sessionStats makeGitRepo fixture 先例）
    const repo = fs.mkdtempSync(path.join(workdir, "repo-"));
    execSync("git init -q -b main", { cwd: repo });
    fs.writeFileSync(path.join(repo, "README.md"), "fixture");
    execSync("git add -A && git commit -qm init", { cwd: repo });

    // DB_PATH 临时库 seed projects 行（localPath → 真实仓）
    getDb()
      .prepare("INSERT INTO projects (id, name, sourceType, localPath, updatedAt) VALUES (?, ?, ?, ?, ?)")
      .run("p-git", "fixture", "local", repo, "2026-08-17T00:00:00Z");

    // EXPECTED-TRACE: prd.md §6.3 块6/REQ-AGENT-058——分支仓 → {state:"branch", branch}
    assert.deepEqual(domain.gitStateForSpace("ui:project:p-git:s1"), { state: "branch", branch: "main" });

    // EXPECTED-TRACE: 同上——detached HEAD → {state:"detached"}
    execSync("git checkout -q --detach", { cwd: repo });
    assert.deepEqual(domain.gitStateForSpace("ui:project:p-git:s1"), { state: "detached" });
  });
});
