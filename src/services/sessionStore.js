// src/services/sessionStore.js
// sessionStore（tech-design「sessionStore（SQLite）」）：agent_sessions 表服务。
//
// 职责（REQ-AGENT-008~011 接口契约）：
// - agent_sessions 表（spaceKey/sessionRef/createdAt/lastActiveAt/summaryRef）；
//   spaceKey 唯一；SQLite 为真相（W-3）——主进程会话注册表仅为活跃句柄缓存，
//   崩溃/应用重启后按本表重建。
// - 空间首次对话 → 建表行 + JSONL 占位文件（H2 假设：会话文件落自定义目录）；
//   已有空间 → 复用；JSONL 缺失 → 新建会话（世代 +1，sessionRef 换代）+
//   提示历史不可恢复（REQ-AGENT-009 标准 2）。
// - /reset（REQ-AGENT-010）：仅当前空间——sessionRef 世代 +1 + 新 JSONL +
//   summaryRef 清空 + 通知监听者（agentService 据此清会话上下文 / 下发
//   reset-session IPC）。
// - summaryRef（REQ-AGENT-011）：压缩由平台侧逻辑驱动，压缩后经
//   updateSummaryRef 更新（摘要索引，不存消息全文）。
// - B1：PI JSONL 会话树 = 运行时真相；平台侧不复制消息全文（本表无消息列）。
//
// 会话 key 规范：feishu:<chatId>（单聊/群聊各一；ui:copilot 留待下一 story）。
// sessionRef 命名规范与 agentService 共用：<sessionDir>/<safeKey>[.N].jsonl
// （N = 世代，provider/key 变更重建或 /reset 时递增）。
//
// ADR-009：惰性初始化——模块级无副作用；数据库连接经 getDb() 按路径缓存。

import fs from "node:fs";
import path from "node:path";
import { getDb, defaultDbPath } from "../db.js";

// PRD §8 E-SESSION-PERSIST：SQLite/JSONL 写失败 → 告警日志 + 内存态继续（对话可用，
// 仅重启不恢复）。只吞持久化类异常（带 err.code：fs E* / SQLite SQLITE_*）；参数错误等
// 非持久化异常（无 code 的编程/系统错误）仍抛出（缺口 1，2026-08-04 补实现）。
export function degradePersistFailure(operation, err) {
  if (!err || typeof err.code !== "string") throw err;
  process.stderr.write(
    `E-SESSION-PERSIST: ${operation} 写入失败：${err?.message ?? String(err)}（内存态继续，重启不恢复）\n`
  );
}

// 空间 key → 安全文件名片段（与 agentService 历史命名一致）。
export function safeKeyFor(spaceKey) {
  return String(spaceKey).replace(/[^a-zA-Z0-9_-]/g, "_");
}

// JSONL 世代解析："feishu_oc_1.jsonl" → 1；"feishu_oc_1.2.jsonl" → 2。
export function generationFromRef(sessionRef) {
  const m = /\.(\d+)\.jsonl$/.exec(sessionRef ?? "");
  return m ? Number(m[1]) : 1;
}

// sessionRef = JSONL 路径（世代 >1 带 .N 后缀；provider/key 变更重建或 /reset 递增）。
export function sessionRefFor(sessionDir, spaceKey, generation = 1) {
  const safeKey = safeKeyFor(spaceKey);
  const suffix = generation > 1 ? `.${generation}` : "";
  return path.join(sessionDir, `${safeKey}${suffix}.jsonl`);
}

// JSONL 占位：仅确保文件存在（不截断既有内容）。worker 以「存在且非空」区分
// 可恢复会话与新建会话（与 store 的缺失判定保持一致）。
function touchSessionFile(ref) {
  fs.mkdirSync(path.dirname(ref), { recursive: true });
  fs.closeSync(fs.openSync(ref, "a"));
}

export function createSessionStore(options = {}) {
  // 数据库连接按路径每次操作时获取（getDb 单连接缓存，路径一致时零开销）：
  // 全局 getDb() 单连接按路径切换——其他服务（taskService 等走 data.db）切换会
  // 关闭本库连接，捕获引用会在切换后失效（"database is not open"）。按操作
  // 重新获取保证跨服务切换后本库仍可用（Slice 8 接线依赖：确认服务/任务卡片
  // 与对话存储同库时确认回调/任务事件前后的切换安全）。
  const dbPath = options.dbPath ?? defaultDbPath();
  const db = () => getDb(dbPath);
  const baseSessionDir = options.sessionDir;
  const resetListeners = new Set();

  function nowIso() {
    return new Date().toISOString();
  }

  function rowToInfo(row) {
    if (!row) return undefined;
    return {
      spaceKey: row.spaceKey,
      sessionRef: row.sessionRef,
      createdAt: row.createdAt,
      lastActiveAt: row.lastActiveAt,
      summaryRef: row.summaryRef ?? null,
    };
  }

  // 换代：JSONL 世代 +1（新文件）+ agent_sessions 行更新（sessionRef 换代 +
  // summaryRef 清空）。getOrCreate（JSONL 缺失重建）与 reset（/reset）共用；
  // SQLite 写失败按 E-SESSION-PERSIST 降级（内存态继续，仅重启不恢复）。
  function bumpGeneration(spaceKey, currentRef, dir, ts, operation) {
    const gen = generationFromRef(currentRef) + 1;
    const ref = sessionRefFor(dir, spaceKey, gen);
    touchSessionFile(ref);
    try {
      db().prepare("UPDATE agent_sessions SET sessionRef = ?, summaryRef = NULL, lastActiveAt = ? WHERE spaceKey = ?").run(
        ref,
        ts,
        spaceKey
      );
    } catch (err) {
      // E-SESSION-PERSIST：换代写失败 → 内存态继续（本次会话仍可用，仅重启不恢复）。
      degradePersistFailure(operation, err);
    }
    return ref;
  }

  // 空间首次对话 → 建表行 + JSONL 占位；已有空间 → 复用/恢复；JSONL 缺失 →
  // 新建会话（世代 +1）+ 提示历史不可恢复，不阻塞对话（REQ-AGENT-009 标准 2）。
  function getOrCreate(spaceKey, { sessionDir } = {}) {
    const dir = sessionDir ?? baseSessionDir;
    if (!dir) {
      throw Object.assign(new Error("E-SESSION-PERSIST: sessionDir 未提供"), { code: "E-SESSION-PERSIST" });
    }
    const row = db().prepare("SELECT * FROM agent_sessions WHERE spaceKey = ?").get(spaceKey);
    const ts = nowIso();
    if (!row) {
      const ref = sessionRefFor(dir, spaceKey, 1);
      touchSessionFile(ref);
      try {
        db().prepare(
          "INSERT INTO agent_sessions (spaceKey, sessionRef, createdAt, lastActiveAt) VALUES (?, ?, ?, ?)"
        ).run(spaceKey, ref, ts, ts);
      } catch (err) {
        // SQLite 写失败（E-SESSION-PERSIST）：内存态继续，仅重启不恢复（PRD §8）。
        degradePersistFailure("getOrCreate 建行", err);
      }
      return { spaceKey, sessionRef: ref, createdAt: ts, lastActiveAt: ts, summaryRef: null, created: true };
    }
    if (!fs.existsSync(row.sessionRef)) {
      // 恢复失败（JSONL 缺失）→ 新建会话（旧引用作废），提示历史不可恢复。
      const ref = bumpGeneration(spaceKey, row.sessionRef, dir, ts, "getOrCreate 换代");
      return {
        spaceKey,
        sessionRef: ref,
        createdAt: row.createdAt,
        lastActiveAt: ts,
        summaryRef: null,
        created: false,
        rebuilt: true,
        recoveryHint: "历史会话不可恢复，已新建会话",
      };
    }
    try {
      db().prepare("UPDATE agent_sessions SET lastActiveAt = ? WHERE spaceKey = ?").run(ts, spaceKey);
    } catch (err) {
      degradePersistFailure("getOrCreate 活跃时间", err);
    }
    return { ...rowToInfo(row), lastActiveAt: ts, created: false };
  }

  function get(spaceKey) {
    return rowToInfo(db().prepare("SELECT * FROM agent_sessions WHERE spaceKey = ?").get(spaceKey));
  }

  function list() {
    return db().prepare("SELECT * FROM agent_sessions ORDER BY createdAt").all().map(rowToInfo);
  }

  // 压缩后更新摘要索引（REQ-AGENT-011 标准 2；ref = 平台侧摘要索引，非消息全文）。
  function updateSummaryRef(spaceKey, ref) {
    try {
      db().prepare("UPDATE agent_sessions SET summaryRef = ?, lastActiveAt = ? WHERE spaceKey = ?").run(ref, nowIso(), spaceKey);
    } catch (err) {
      // E-SESSION-PERSIST：摘要索引写失败 → 内存态继续（压缩本身不打断对话）。
      degradePersistFailure("updateSummaryRef", err);
    }
  }

  // provider/key 变更重建（数据流 7）时同步换代 sessionRef（SQLite 为真相）。
  function updateSessionRef(spaceKey, ref) {
    try {
      db().prepare("UPDATE agent_sessions SET sessionRef = ?, lastActiveAt = ? WHERE spaceKey = ?").run(ref, nowIso(), spaceKey);
    } catch (err) {
      // E-SESSION-PERSIST：换代写失败 → 内存态继续（本次会话仍可用，仅重启不恢复）。
      degradePersistFailure("updateSessionRef", err);
    }
  }

  // /reset（REQ-AGENT-010）：仅当前空间——JSONL 世代 +1（新文件）+ summaryRef
  // 清空 + 通知监听者（agentService 清会话上下文 / 下发 reset-session IPC）。
  // 其他空间行不受影响（按 spaceKey 定位更新）。
  function reset(spaceKey) {
    const row = db().prepare("SELECT * FROM agent_sessions WHERE spaceKey = ?").get(spaceKey);
    if (!row) return undefined;
    const ts = nowIso();
    const ref = bumpGeneration(spaceKey, row.sessionRef, baseSessionDir, ts, "reset 换代");
    const info = { spaceKey, sessionRef: ref, createdAt: row.createdAt, lastActiveAt: ts, summaryRef: null, reset: true };
    for (const listener of resetListeners) {
      try {
        listener(spaceKey, info);
      } catch (err) {
        // 监听者（agentService 会话句柄更新）失败不阻断重置本身。
        process.stderr.write(`sessionStore reset 监听者异常: ${err?.message ?? String(err)}\n`);
      }
    }
    return info;
  }

  // 订阅 /reset 通知（agentService 在创建时注册，清对应空间上下文）。
  function onReset(listener) {
    resetListeners.add(listener);
    return () => resetListeners.delete(listener);
  }

  return { getOrCreate, get, list, reset, updateSummaryRef, updateSessionRef, onReset };
}
