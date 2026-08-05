// REQ-TRACE: 2026-08-02-builtin-agent/REQ-AGENT-008, 2026-08-02-builtin-agent/REQ-AGENT-010, 2026-08-02-builtin-agent/REQ-AGENT-011
// REQ-VERSION: v1-hash:16f30c7bbd781fb9f86f573f3c92dc0c96a1aa38aecf3bd08c54caa0cdb712f4
// CAPABILITY-TRACE: agent-dialogue
// ENTITY-TRACE: conversation-space
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { getDb } from "../../../../../../src/db.js";

// seam：sessionStore（临时 SQLite，DB_PATH 指向临时目录）+ agent_sessions 表（SQLite 为真相，W-3）。

// seam：sessionStore（tech-design「sessionStore（SQLite）」）。
// 建议落点 src/services/sessionStore.js，导出 createSessionStore({ dbPath }) →
// { getOrCreate(spaceKey, {sessionDir}) → {spaceKey, sessionRef, createdAt, lastActiveAt, summaryRef, created},
//   get(spaceKey), reset(spaceKey), updateSummaryRef(spaceKey, ref) }。
async function loadSessionStore() {
  const mod = await import("../../../../../../src/services/sessionStore.js").catch(() => null);
  assert.ok(mod, "seam 未就绪：src/services/sessionStore.js 尚未实现（REQ-AGENT-008）");
  assert.equal(typeof mod.createSessionStore, "function", "sessionStore 应导出 createSessionStore()");
  return mod.createSessionStore;
}

// seam：agentService 内存版快速路径（同上目录 agentDialogue.test.js 的契约）。
async function loadAgentService() {
  const mod = await import("../../../../../../src/services/agentService.js").catch(() => null);
  assert.ok(mod, "seam 未就绪：src/services/agentService.js 尚未实现（REQ-AGENT-008 隔离/持久化断言）");
  assert.equal(typeof mod.createAgentService, "function", "agentService 应导出 createAgentService()");
  return mod.createAgentService;
}

describe("REQ-AGENT-008 对话空间模型与持久化", () => {
  let workdir;
  let sessionDir;
  let dbPath;
  let store;

  beforeEach(async () => {
    workdir = fs.mkdtempSync(path.join(os.tmpdir(), "session-store-"));
    sessionDir = path.join(workdir, "sessions");
    dbPath = path.join(workdir, "store.db");
    process.env.DB_PATH = dbPath;
    const createSessionStore = await loadSessionStore();
    store = createSessionStore({ dbPath, sessionDir });
  });

  afterEach(() => {
    fs.rmSync(workdir, { recursive: true, force: true });
  });

  it("agent_sessions 表结构与 spaceKey 唯一", async () => {
    const db = getDb();
    const cols = db.prepare("PRAGMA table_info(agent_sessions)").all().map((c) => c.name);
    for (const col of ["spaceKey", "sessionRef", "createdAt", "lastActiveAt", "summaryRef"]) {
      assert.ok(cols.includes(col), `agent_sessions 应含列 ${col}，实际: ${cols.join(",")}`);
    }
    // spaceKey 唯一约束（REQ-AGENT-008 标准 1）。
    const ts = new Date().toISOString();
    try {
      db.prepare("INSERT INTO agent_sessions (spaceKey, sessionRef, createdAt, lastActiveAt) VALUES (?, ?, ?, ?)")
        .run("feishu:oc_1", "/tmp/x.jsonl", ts, ts);
    } catch (err) {
      assert.fail(`agent_sessions 表应可写入（结构未实现?）: ${err.message}`);
    }
    assert.throws(
      () => db.prepare("INSERT INTO agent_sessions (spaceKey, sessionRef, createdAt, lastActiveAt) VALUES (?, ?, ?, ?)")
        .run("feishu:oc_1", "/tmp/y.jsonl", ts, ts),
      /UNIQUE/,
      "spaceKey 应唯一约束"
    );
  });

  it("首次对话建空间 + 创建 PI 会话；已有空间复用/恢复", async () => {
    const s1 = store.getOrCreate("feishu:oc_1", { sessionDir });
    assert.equal(s1.created, true, "首次应创建空间");
    assert.ok(s1.sessionRef && s1.sessionRef.endsWith(".jsonl"), `sessionRef 应为 JSONL 路径，实际: ${s1.sessionRef}`);
    assert.ok(fs.existsSync(s1.sessionRef), "JSONL 会话文件应落自定义目录（H2 假设）");
    const s2 = store.getOrCreate("feishu:oc_1", { sessionDir });
    assert.equal(s2.created, false, "已有空间应复用/恢复");
    assert.equal(s2.sessionRef, s1.sessionRef, "复用应指向同一 JSONL");
    const { c } = getDb().prepare("SELECT COUNT(*) AS c FROM agent_sessions").get();
    assert.equal(c, 1, "同一空间只应有一行");
  });

  it("空间间上下文隔离", async () => {
    const createAgentService = await loadAgentService();
    const svc = createAgentService({ sessionStore: store, inMemory: true });
    const a = svc.createSession({ spaceKey: "feishu:oc_a", provider: { async respond() { return [{ type: "text_end", content: "A 回复" }]; } } });
    const b = svc.createSession({ spaceKey: "feishu:oc_b", provider: { async respond() { return [{ type: "text_end", content: "B 回复" }]; } } });
    await svc.prompt("feishu:oc_a", "机密内容：项目代号极光");
    await svc.prompt("feishu:oc_b", "普通问候");
    const ctxA = JSON.stringify(a.getContext());
    const ctxB = JSON.stringify(b.getContext());
    assert.ok(ctxA.includes("极光"), "A 空间自身上下文应保留");
    assert.ok(!ctxB.includes("极光"), "A 空间对话历史不应进入 B 空间 prompt 上下文（REQ-AGENT-008 标准 3）");
  });

  it("对话消息经 PI JSONL 持久化，平台侧不复制全文", async () => {
    const createAgentService = await loadAgentService();
    const svc = createAgentService({ sessionStore: store, inMemory: true });
    svc.createSession({ spaceKey: "feishu:oc_1", provider: { async respond() { return [{ type: "text_end", content: "回复 1" }]; } } });
    await svc.prompt("feishu:oc_1", "第一条对话消息：统计日报");
    const row = getDb().prepare("SELECT * FROM agent_sessions WHERE spaceKey = ?").get("feishu:oc_1");
    assert.ok(row, "应有 agent_sessions 行");
    const jsonl = fs.readFileSync(row.sessionRef, "utf8");
    assert.ok(jsonl.includes("第一条对话消息：统计日报"), "对话消息应经 PI JSONL 持久化（message_end 落盘）");
    assert.ok(!JSON.stringify(row).includes("第一条对话消息：统计日报"), "平台侧不复制消息全文（B1）");
  });
});

describe("REQ-AGENT-010 显式重置会话", () => {
  let workdir;
  let sessionDir;
  let dbPath;
  let store;

  beforeEach(async () => {
    workdir = fs.mkdtempSync(path.join(os.tmpdir(), "session-store-"));
    sessionDir = path.join(workdir, "sessions");
    dbPath = path.join(workdir, "store.db");
    process.env.DB_PATH = dbPath;
    const createSessionStore = await loadSessionStore();
    store = createSessionStore({ dbPath, sessionDir });
  });

  afterEach(() => {
    fs.rmSync(workdir, { recursive: true, force: true });
  });

  it("/reset 清空当前空间上下文，其他空间不受影响", async () => {
    const createAgentService = await loadAgentService();
    const svc = createAgentService({ sessionStore: store, inMemory: true });
    const a = svc.createSession({ spaceKey: "feishu:oc_a", provider: { async respond() { return [{ type: "text_end", content: "A 回复" }]; } } });
    const b = svc.createSession({ spaceKey: "feishu:oc_b", provider: { async respond() { return [{ type: "text_end", content: "B 回复" }]; } } });
    await svc.prompt("feishu:oc_a", "A 的历史内容");
    await svc.prompt("feishu:oc_b", "B 的历史内容");
    // /reset 仅作用于当前空间（REQ-AGENT-010 标准 1/2）。
    store.reset("feishu:oc_a");
    const ctxA = JSON.stringify(a.getContext());
    const ctxB = JSON.stringify(b.getContext());
    assert.ok(!ctxA.includes("A 的历史内容"), "重置后当前空间应无历史上下文（标准 3：首条消息不携带历史）");
    assert.ok(ctxB.includes("B 的历史内容"), "其他空间上下文不受影响");
  });
});

describe("REQ-AGENT-011 滚动摘要压缩", () => {
  let workdir;
  let sessionDir;
  let dbPath;
  let store;

  beforeEach(async () => {
    workdir = fs.mkdtempSync(path.join(os.tmpdir(), "session-store-"));
    sessionDir = path.join(workdir, "sessions");
    dbPath = path.join(workdir, "store.db");
    process.env.DB_PATH = dbPath;
    const createSessionStore = await loadSessionStore();
    store = createSessionStore({ dbPath, sessionDir });
  });

  afterEach(() => {
    fs.rmSync(workdir, { recursive: true, force: true });
  });

  it("超过阈值 → 旧消息折叠为摘要注入，关键信息不丢", async () => {
    const createAgentService = await loadAgentService();
    // 压缩阈值 = 实现常量，可注入断言（签核决策 17）。
    const svc = createAgentService({ sessionStore: store, inMemory: true, compressionThreshold: 3 });
    const a = svc.createSession({
      spaceKey: "feishu:oc_a",
      provider: { async respond() { return [{ type: "text_end", content: "ok" }]; } },
      // 摘要生成由实现自选（LLM 单轮或确定性截断），测试注入确定性摘要器断言语义。
      summarize: (msgs) => "[摘要] 关键实体：日报"
    });
    for (let i = 0; i < 5; i += 1) {
      await svc.prompt("feishu:oc_a", `消息 ${i} 关于日报`);
    }
    const ctx = JSON.stringify(a.getContext());
    assert.ok(ctx.includes("[摘要]"), "超过阈值后旧消息应折叠为摘要注入后续 prompt");
    assert.ok(ctx.includes("日报"), "摘要应保留关键信息（关键实体不丢，REQ-AGENT-011 标准 1）");
    assert.ok(!ctx.includes("消息 0"), "旧消息应折叠（不再全文注入）");
  });

  it("压缩后 summaryRef 更新且对用户无感", async () => {
    const createAgentService = await loadAgentService();
    const svc = createAgentService({ sessionStore: store, inMemory: true, compressionThreshold: 3 });
    svc.createSession({
      spaceKey: "feishu:oc_a",
      provider: { async respond() { return [{ type: "text_end", content: "ok" }]; } },
      summarize: (msgs) => "摘要#1"
    });
    const before = getDb().prepare("SELECT summaryRef FROM agent_sessions WHERE spaceKey = ?").get("feishu:oc_a")?.summaryRef ?? null;
    for (let i = 0; i < 5; i += 1) {
      await svc.prompt("feishu:oc_a", `消息 ${i}`);
    }
    const after = getDb().prepare("SELECT summaryRef FROM agent_sessions WHERE spaceKey = ?").get("feishu:oc_a")?.summaryRef ?? null;
    assert.notEqual(after, before, "压缩后 agent_sessions.summaryRef 应更新（REQ-AGENT-011 标准 2）");
    // 压缩对用户无感：对话未被打断。
    const reply = await svc.prompt("feishu:oc_a", "继续");
    assert.ok(reply !== undefined, "压缩过程不应打断对话");
  });
});
