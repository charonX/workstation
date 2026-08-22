// REQ-TRACE: 2026-08-19-feishu-reset-history-archive/REQ-AGENT-123, 2026-08-19-feishu-reset-history-archive/REQ-AGENT-124
// REQ-VERSION: v2-hash:507ffe922e1d620d7fe0d6382a3c2d3b359d27085338c3b76769d794f7df5dc1
// CAPABILITY-TRACE: agent-dialogue
// ENTITY-TRACE: conversation-space
// EXPECTED-TRACE: prd.md §6.3 row 2, row 5, row 6, §8 row 2, §10.4 contract 1, contract 2
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { getDb, closeDb } from "../../../../../../src/db.js";
import { createSessionStore } from "../../../../../../src/services/sessionStore.js";

describe("REQ-AGENT-123 & REQ-AGENT-124 飞书 /reset 归档事务与异常分支", () => {
  let workdir;
  let sessionDir;
  let dbPath;
  let store;

  beforeEach(() => {
    workdir = fs.mkdtempSync(path.join(os.tmpdir(), "feishu-reset-archive-"));
    sessionDir = path.join(workdir, "sessions");
    dbPath = path.join(workdir, "agent-sessions.db");
    fs.mkdirSync(sessionDir, { recursive: true });
    store = createSessionStore({ dbPath, sessionDir });
  });

  afterEach(() => {
    closeDb(dbPath);
    fs.rmSync(workdir, { recursive: true, force: true });
  });

  function seedFeishuSession({ spaceKey, sessionRef, title, lastActiveAt, createdAt, messageCount = 1 }) {
    fs.mkdirSync(path.dirname(sessionRef), { recursive: true });
    if (messageCount > 0) {
      const messages = [];
      for (let i = 0; i < messageCount; i++) {
        messages.push(JSON.stringify({
          type: "message",
          id: `m_${i + 1}`,
          timestamp: new Date().toISOString(),
          message: { role: "user", content: `你好 ${i + 1}` }
        }));
      }
      fs.writeFileSync(sessionRef, messages.join("\n") + "\n", "utf8");
    } else {
      fs.writeFileSync(sessionRef, "", "utf8");
    }

    const db = getDb(dbPath);
    db.prepare(`
      INSERT INTO agent_sessions (spaceKey, sessionRef, createdAt, lastActiveAt, title)
      VALUES (?, ?, ?, ?, ?)
    `).run(spaceKey, sessionRef, createdAt || "2026-08-19T10:00:00.000Z", lastActiveAt || "2026-08-19T10:05:00.000Z", title ?? null);
  }

  it("REQ-AGENT-123 AC1: 正常世代归档（旧行改名 …:gen2 + 新活跃行）", () => {
    const spaceKey = "feishu:oc_123";
    const oldSessionRef = path.join(sessionDir, "feishu_oc_123.2.jsonl");
    seedFeishuSession({
      spaceKey,
      sessionRef: oldSessionRef,
      title: "你好帮我查一下",
      createdAt: "2026-08-19T09:00:00.000Z",
      lastActiveAt: "2026-08-19T09:30:00.000Z",
      messageCount: 2
    });

    const info = store.reset(spaceKey);

    // EXPECTED-TRACE: prd.md §6.3 row 2
    assert.ok(info, "reset 应返回 session info");
    assert.equal(info.spaceKey, spaceKey);
    assert.equal(info.reset, true);
    assert.match(info.sessionRef, /feishu_oc_123\.3\.jsonl$/);
    assert.ok(fs.existsSync(info.sessionRef), "新世代 JSONL 文件应已 touch 创建");

    const db = getDb(dbPath);
    const rows = db.prepare("SELECT * FROM agent_sessions ORDER BY spaceKey ASC").all();
    assert.equal(rows.length, 2, "应包含归档行与新活跃行共 2 行");

    const archiveRow = rows.find((r) => r.spaceKey === "feishu:oc_123:gen2");
    assert.ok(archiveRow, "归档行 feishu:oc_123:gen2 应存在");
    assert.equal(archiveRow.sessionRef, oldSessionRef);
    assert.equal(archiveRow.title, "你好帮我查一下");
    assert.equal(archiveRow.lastActiveAt, "2026-08-19T09:30:00.000Z");

    const activeRow = rows.find((r) => r.spaceKey === "feishu:oc_123");
    assert.ok(activeRow, "活跃行 feishu:oc_123 应存在");
    assert.equal(activeRow.sessionRef, info.sessionRef);
    assert.equal(activeRow.title, null, "新活跃行 title 应重置为 NULL");
    // EXPECTED-TRACE: prd.md §6.3 row 2（新活跃行 provider/model=NULL 回落默认、createdAt=lastActiveAt=此刻）
    assert.equal(activeRow.provider, null, "新活跃行 provider 应为 NULL（回落默认配置）");
    assert.equal(activeRow.model, null, "新活跃行 model 应为 NULL（回落默认配置）");
    assert.equal(activeRow.createdAt, activeRow.lastActiveAt, "新活跃行 createdAt=lastActiveAt=此刻");
    assert.ok(Date.parse(activeRow.createdAt) >= Date.parse("2026-08-19T09:30:00.000Z"),
      "新活跃行 createdAt 应为 reset 时刻（晚于旧行 lastActiveAt）");
  });

  it("REQ-AGENT-123 AC2: 首世代归档（旧 sessionRef 无 .gen 后缀 → gen1）", () => {
    const spaceKey = "feishu:oc_first";
    const oldSessionRef = path.join(sessionDir, "feishu_oc_first.jsonl");
    seedFeishuSession({
      spaceKey,
      sessionRef: oldSessionRef,
      title: "首世代对话",
      messageCount: 1
    });

    // EXPECTED-TRACE: prd.md §10.4 contract 1
    const info = store.reset(spaceKey);
    assert.ok(info);
    assert.match(info.sessionRef, /feishu_oc_first\.2\.jsonl$/);

    const db = getDb(dbPath);
    const archiveRow = db.prepare("SELECT * FROM agent_sessions WHERE spaceKey = ?").get("feishu:oc_first:gen1");
    assert.ok(archiveRow, "首世代应归档为 feishu:oc_first:gen1");
    assert.equal(archiveRow.sessionRef, oldSessionRef);
    assert.equal(archiveRow.title, "首世代对话");
  });

  it("REQ-AGENT-123 AC3: 连续两次归档，键名递增且不碰撞", () => {
    const spaceKey = "feishu:oc_chain";
    const gen2Ref = path.join(sessionDir, "feishu_oc_chain.2.jsonl");
    seedFeishuSession({
      spaceKey,
      sessionRef: gen2Ref,
      title: "第 2 世代",
      messageCount: 1
    });

    // EXPECTED-TRACE: prd.md §6.3 row 5
    const info1 = store.reset(spaceKey);
    assert.match(info1.sessionRef, /feishu_oc_chain\.3\.jsonl$/);

    // 写入新世代有效消息
    fs.writeFileSync(info1.sessionRef, JSON.stringify({
      type: "message",
      id: "m_new",
      timestamp: new Date().toISOString(),
      message: { role: "user", content: "第 3 世代消息" }
    }) + "\n", "utf8");

    const info2 = store.reset(spaceKey);
    assert.match(info2.sessionRef, /feishu_oc_chain\.4\.jsonl$/);

    const db = getDb(dbPath);
    const rows = db.prepare("SELECT spaceKey, sessionRef FROM agent_sessions ORDER BY spaceKey ASC").all();
    assert.equal(rows.length, 3, "应有 2 个归档行与 1 个活跃行共 3 行");
    const keys = rows.map((r) => r.spaceKey);
    assert.deepEqual(keys.sort(), ["feishu:oc_chain", "feishu:oc_chain:gen2", "feishu:oc_chain:gen3"].sort());
  });

  it("REQ-AGENT-123 AC4: onReset 回调触发且参数形态保持", () => {
    const spaceKey = "feishu:oc_cb";
    const ref = path.join(sessionDir, "feishu_oc_cb.jsonl");
    seedFeishuSession({ spaceKey, sessionRef: ref, messageCount: 1 });

    const notifications = [];
    store.onReset((key, info) => {
      notifications.push({ key, info });
    });

    // EXPECTED-TRACE: prd.md §10.4 contract 2
    const res = store.reset(spaceKey);
    assert.equal(notifications.length, 1);
    assert.equal(notifications[0].key, spaceKey);
    assert.equal(notifications[0].info.spaceKey, spaceKey);
    assert.equal(notifications[0].info.reset, true);
    assert.equal(notifications[0].info.sessionRef, res.sessionRef);
  });

  it("REQ-AGENT-124 AC1: 空世代 reset 不产生归档行（原地换代）", () => {
    const spaceKey = "feishu:oc_empty";
    const oldSessionRef = path.join(sessionDir, "feishu_oc_empty.2.jsonl");
    seedFeishuSession({
      spaceKey,
      sessionRef: oldSessionRef,
      title: null,
      messageCount: 0 // 空文件
    });

    // EXPECTED-TRACE: prd.md §6.3 row 6, §8 row 4
    const info = store.reset(spaceKey);
    assert.ok(info);
    assert.match(info.sessionRef, /feishu_oc_empty\.3\.jsonl$/);

    const db = getDb(dbPath);
    const rows = db.prepare("SELECT * FROM agent_sessions").all();
    assert.equal(rows.length, 1, "空世代不应产生归档行，表总行数维持 1");
    assert.equal(rows[0].spaceKey, spaceKey);
    assert.equal(rows[0].sessionRef, info.sessionRef);
  });

  it("REQ-AGENT-124 AC2: 从未对话过的 chat 发 reset 返回 undefined", () => {
    // EXPECTED-TRACE: prd.md §6.2 branch 2
    const res = store.reset("feishu:oc_unknown");
    assert.equal(res, undefined, "无行会话 reset 返回 undefined");

    const db = getDb(dbPath);
    const count = db.prepare("SELECT COUNT(*) as count FROM agent_sessions").get().count;
    assert.equal(count, 0, "不应产生任何会话行");
  });

  it("REQ-AGENT-124 AC3: 归档事务 DB 写失败 → E-SESSION-PERSIST + 降级原地换代（无半成品归档行）", () => {
    const spaceKey = "feishu:oc_fail";
    const oldSessionRef = path.join(sessionDir, "feishu_oc_fail.2.jsonl");
    seedFeishuSession({
      spaceKey,
      sessionRef: oldSessionRef,
      title: "故障注入会话",
      messageCount: 1
    });
    // DB 层失败注入：预存归档目标键冲突行 → 归档 UPDATE 撞 UNIQUE 约束，事务整体回滚。
    // （归档分支 touchSessionFile 在 try 外，只读目录类 fs 失败会直接抛出、走不到降级
    //  分支——注入点必须是 DB 层失败，prd.md §11.1 v0.2 修正）
    const db = getDb(dbPath);
    db.prepare(`
      INSERT INTO agent_sessions (spaceKey, sessionRef, createdAt, lastActiveAt, title)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      "feishu:oc_fail:gen2",
      path.join(sessionDir, "feishu_oc_fail.legacy.jsonl"),
      "2026-08-01T00:00:00.000Z",
      "2026-08-01T00:00:00.000Z",
      "预存冲突行"
    );

    const stderrWrites = [];
    const originalWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = (chunk) => {
      stderrWrites.push(String(chunk));
      return true;
    };
    let info;
    try {
      // EXPECTED-TRACE: prd.md §8 row 2（写失败降级）+ §6.3 row 2（原地换代语义）
      info = store.reset(spaceKey);
    } finally {
      process.stderr.write = originalWrite;
    }

    // (a) stderr 输出 E-SESSION-PERSIST 降级诊断
    assert.ok(
      stderrWrites.some((line) => line.includes("E-SESSION-PERSIST") && line.includes("reset 归档事务")),
      `stderr 应含 E-SESSION-PERSIST 归档事务降级诊断，实际：${stderrWrites.join("")}`
    );

    // (b) 降级为原地换代：返回活跃键 + 世代 +1（内存态继续）
    assert.ok(info, "降级后 reset 仍应返回 session info");
    assert.equal(info.spaceKey, spaceKey);
    assert.match(info.sessionRef, /feishu_oc_fail\.3\.jsonl$/);
    assert.ok(fs.existsSync(info.sessionRef), "新世代 JSONL 文件应存在（归档路径已 touch）");

    // (c) 无半成品归档行：活跃行 spaceKey 未改名（事务回滚）、归档目标行仍是预存冲突行、总行数不变
    const rows = db.prepare("SELECT * FROM agent_sessions ORDER BY spaceKey ASC").all();
    assert.equal(rows.length, 2, "归档事务回滚 + 原地换代不插行，总行数维持 2");
    const activeRow = rows.find((r) => r.spaceKey === spaceKey);
    assert.ok(activeRow, "活跃行 spaceKey 应保持不变（改名已回滚）");
    assert.equal(activeRow.sessionRef, info.sessionRef, "活跃行 sessionRef 原地换代");
    assert.equal(activeRow.title, "故障注入会话", "活跃行 title 未被归档流程带走");
    const conflictRow = rows.find((r) => r.spaceKey === "feishu:oc_fail:gen2");
    assert.equal(conflictRow.title, "预存冲突行", "归档目标行仍是预存冲突行（未被改名覆盖）");
  });

  it("REQ-AGENT-124 AC4: 畸形 sessionRef 兜底为 gen1 归档键", () => {
    const spaceKey = "feishu:oc_malformed";
    const ref = path.join(sessionDir, "invalid_custom_path.txt");
    seedFeishuSession({ spaceKey, sessionRef: ref, title: "畸形", messageCount: 1 });

    // EXPECTED-TRACE: prd.md §10.4 contract 1 malformed case
    const info = store.reset(spaceKey);
    assert.ok(info);

    const db = getDb(dbPath);
    const archiveRow = db.prepare("SELECT * FROM agent_sessions WHERE spaceKey = ?").get("feishu:oc_malformed:gen1");
    assert.ok(archiveRow, "畸形 ref 兜底生成 feishu:oc_malformed:gen1 归档行");
  });
});
