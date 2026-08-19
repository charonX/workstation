import { getDb } from "../db.js";
import crypto from "node:crypto";

// 数据库连接经 getDb() 按路径缓存（同路径同句柄、可安全持有，REQ-WORKSPACE-014）：
// 每次操作直接取用，始终返回有效缓存连接；closeDb()/resetDb() 后下次调用自动重开——
// 无需模块级持句柄与自愈（BUG-001：删除单槽时代 getDbRef/isDbClosedError 防御机制）。

const VALID_TYPES = new Set(["artifact", "execution-failed", "channel-status"]);

function rowToNotification(row) {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body,
    executionId: row.executionId,
    createdAt: row.createdAt,
    readAt: row.readAt ?? null
  };
}

export function notify({ type, title, body, executionId } = {}) {
  try {
    if (!VALID_TYPES.has(type)) {
      console.error(`E-NOTIFY-FAILED: invalid notification type: ${type}`);
      return undefined;
    }
    const db = getDb();
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const normalizedExecutionId = executionId ?? null;
    db.prepare(
      `INSERT INTO notifications (id, type, title, body, executionId, createdAt, readAt)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(id, type, title, body, normalizedExecutionId, createdAt, null);
    return rowToNotification({ id, type, title, body, executionId: normalizedExecutionId, createdAt, readAt: null });
  } catch (err) {
    console.error(`E-NOTIFY-FAILED: failed to write notification: ${err.message}`);
    return undefined;
  }
}

export function list({ unreadOnly = false } = {}) {
  const db = getDb();
  let sql = "SELECT * FROM notifications";
  if (unreadOnly) {
    sql += " WHERE readAt IS NULL";
  }
  sql += " ORDER BY createdAt DESC";
  const rows = db.prepare(sql).all();
  return rows.map(rowToNotification);
}

export function markRead({ ids, all = false } = {}) {
  const db = getDb();
  const readAt = new Date().toISOString();
  if (all) {
    db.prepare("UPDATE notifications SET readAt = ? WHERE readAt IS NULL").run(readAt);
  } else if (Array.isArray(ids) && ids.length > 0) {
    const placeholders = ids.map(() => "?").join(",");
    db.prepare(
      `UPDATE notifications SET readAt = ? WHERE id IN (${placeholders})`
    ).run(readAt, ...ids);
  }
}
