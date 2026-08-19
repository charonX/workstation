// REQ-TRACE: 2026-08-19-feishu-reset-history-archive/REQ-AGENT-123, 2026-08-19-feishu-reset-history-archive/REQ-AGENT-125
// BUG-TRACE: BUG-001
// REQ-VERSION: v1-hash:8a4fce4fe307c46375fff08faf1aac3342adbe8a95b92c97c15fc3886d629003
// CAPABILITY-TRACE: agent-dialogue
// ENTITY-TRACE: conversation-space
// EXPECTED-TRACE: prd.md §6.3 row 2（归档行 title/sessionRef/lastActiveAt/createdAt 全保留）+ review.md R1 bug 分类记录（code-defect，人确认 2026-08-19）
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true

// BUG-001 回归（code-defect，根因：PRD §10.3 消费方清单漏了重启水合）：
//   agentService 启动水合循环 store.list() 无归档过滤，对 feishu:<chatId>:gen<N>
//   归档行调 getOrCreate → (a) 归档 JSONL 存在时 UPDATE lastActiveAt=now（破坏
//   「归档行 lastActiveAt 保持原值」与列表排序）；(b) 归档 JSONL 缺失且行在窗口内时
//   走 missing-file 分支 bumpGeneration 改写归档行 sessionRef 指向空新文件（静默
//   销毁历史指针）；(c) 归档行被装配为活 worker 会话（API key 注入）。
// 修复：水合循环跳过 feishu :gen\d+$ 归档键（agentService.js 水合循环 +
//   sessionDomain.isFeishuArchiveKey）。
//
// seam：真实 spawn worker（hydrationWindow.test.js 同型）+ options.sessionStore
//   注入同一 store 实例（种子/reset/断言与水合同一 DB）+ 二次 ready 等水合完成。
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { getDb, closeDb } from "../../../../../../src/db.js";
import { createSessionStore } from "../../../../../../src/services/sessionStore.js";

async function loadAgentService() {
  const mod = await import("../../../../../../src/services/agentService.js").catch(() => null);
  assert.ok(mod, "seam 未就绪：src/services/agentService.js 尚未实现");
  return mod.createAgentService;
}

async function waitUntil(predicate, { timeout = 10000, interval = 100, label = "条件" } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
  assert.fail(`超时等待 ${label}`);
}

function readRow(dbPath, spaceKey) {
  return getDb(dbPath).prepare("SELECT * FROM agent_sessions WHERE spaceKey = ?").get(spaceKey);
}

describe("BUG-001 重启水合不消费飞书归档行", () => {
  let workdir;
  let sessionDir;
  let dbPath;
  let store;
  let agentService;

  beforeEach(() => {
    workdir = fs.mkdtempSync(path.join(os.tmpdir(), "feishu-archive-hydration-"));
    sessionDir = path.join(workdir, "sessions");
    dbPath = path.join(workdir, "agent-sessions.db");
    fs.mkdirSync(sessionDir, { recursive: true });
    store = createSessionStore({ dbPath, sessionDir });
    agentService = null;
  });

  afterEach(async () => {
    if (agentService) {
      try { await agentService.stop(); } catch { /* noop */ }
    }
    closeDb(dbPath);
    fs.rmSync(workdir, { recursive: true, force: true });
  });

  // 种子：活跃 feishu 行 + 一条有效消息，reset 归档；返回归档键与归档前行。
  function seedAndReset(spaceKey) {
    const info = store.getOrCreate(spaceKey, { sessionDir });
    fs.writeFileSync(info.sessionRef, JSON.stringify({
      type: "message",
      id: "m_1",
      timestamp: "2026-08-19T08:00:00.000Z",
      message: { role: "user", content: "归档前历史消息" }
    }) + "\n", "utf8");
    const before = readRow(dbPath, spaceKey);
    const resetInfo = store.reset(spaceKey);
    assert.ok(resetInfo, "前置：reset 应成功");
    return { archiveKey: `${spaceKey}:gen1`, before, resetInfo };
  }

  async function startAndHydrate() {
    const createAgentService = await loadAgentService();
    const entry = path.join(workdir, "agent-entry.js");
    agentService = createAgentService({ cwd: workdir, sessionDir, entry, sessionStore: store });
    const ready = [];
    agentService.on("ready", () => ready.push(1));
    await agentService.start();
    await waitUntil(() => ready.length === 1, { label: "ready（启动水合）" });
    // 水合循环与 ready 同 tick 顺序执行；以活跃行句柄在册为水合完成锚点。
    await waitUntil(() => agentService.getSession("feishu:oc_hyd"), { label: "活跃行水合在册" });
  }

  it("水合跳过归档行：无 worker 句柄，归档行 lastActiveAt/sessionRef 保持 reset 保留的原值", async () => {
    const { archiveKey, before } = seedAndReset("feishu:oc_hyd");
    // 归档行 lastActiveAt 复位为 reset 前的会话活跃时刻（模拟「reset 发生在更早
    // 时间点」）；归档 JSONL mtime 新鲜 → 必定落在水合窗口内（BUG-001 触发条件）。
    getDb(dbPath).prepare("UPDATE agent_sessions SET lastActiveAt = ? WHERE spaceKey = ?")
      .run(before.lastActiveAt, archiveKey);

    await startAndHydrate();

    // (a) 活跃行照常水合（防过度过滤）；归档行不得装配为活 worker 会话。
    assert.ok(agentService.getSession("feishu:oc_hyd"), "活跃行应水合在册");
    assert.equal(agentService.getSession(archiveKey), undefined,
      `归档行 ${archiveKey} 不应被水合为活会话（BUG-001 c）`);

    // (b) 归档行字段保持 reset 保留的原值（REQ-AGENT-123 AC1）。
    const archiveRow = readRow(dbPath, archiveKey);
    assert.ok(archiveRow, "归档行应存在");
    assert.equal(archiveRow.lastActiveAt, before.lastActiveAt,
      "归档行 lastActiveAt 不得被水合刷新（BUG-001 a）");
    assert.equal(archiveRow.sessionRef, before.sessionRef, "归档行 sessionRef 应保持指向历史 JSONL");
  });

  it("归档 JSONL 缺失时水合不改写归档行 sessionRef（历史指针不毁）", async () => {
    const { archiveKey, before } = seedAndReset("feishu:oc_hyd");
    // 删除归档 JSONL（REQ-AGENT-125 AC3 场景），同时把归档行 lastActiveAt 推到
    // 窗口内——旧实现经窗口 fallback 判定仍会调 getOrCreate → missing-file 分支
    // bumpGeneration 改写 sessionRef（BUG-001 b）。
    fs.unlinkSync(before.sessionRef);
    getDb(dbPath).prepare("UPDATE agent_sessions SET lastActiveAt = ? WHERE spaceKey = ?")
      .run(new Date().toISOString(), archiveKey);

    await startAndHydrate();

    const archiveRow = readRow(dbPath, archiveKey);
    assert.ok(archiveRow, "归档行应存在");
    assert.equal(archiveRow.sessionRef, before.sessionRef,
      "归档 JSONL 缺失时水合不得改写归档行 sessionRef（BUG-001 b：历史指针应保留原引用）");
    assert.equal(agentService.getSession(archiveKey), undefined, "归档行不应被水合为活会话");
  });
});
