import { getDb } from "../db.js";
import crypto from "node:crypto";

let db = null;

function getDbRef() {
  // better-sqlite3 exposes .open on the connection; closeDb() (e.g. between
  // test servers) invalidates the cached handle, and re-requesting via getDb()
  // lands on the active DB_PATH connection.
  if (!db || !db.open) {
    db = getDb();
  }
  return db;
}

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

function isDbClosedError(err) {
  const message = err?.message || "";
  return (
    message.toLowerCase().includes("database connection is closed") ||
    // better-sqlite3 reports "The database connection is not open" when the
    // cached handle was closed underneath us (see getDbRef self-heal).
    message.toLowerCase().includes("database connection is not open")
  );
}

export function notify({ type, title, body, executionId } = {}) {
  try {
    if (!VALID_TYPES.has(type)) {
      console.error(`E-NOTIFY-FAILED: invalid notification type: ${type}`);
      return undefined;
    }
    const dbRef = getDbRef();
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const normalizedExecutionId = executionId ?? null;
    dbRef.prepare(
      `INSERT INTO notifications (id, type, title, body, executionId, createdAt, readAt)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(id, type, title, body, normalizedExecutionId, createdAt, null);
    return rowToNotification({ id, type, title, body, executionId: normalizedExecutionId, createdAt, readAt: null });
  } catch (err) {
    console.error(`E-NOTIFY-FAILED: failed to write notification: ${err.message}`);
    if (isDbClosedError(err)) {
      db = null;
    }
    return undefined;
  }
}

export function list({ unreadOnly = false } = {}) {
  const dbRef = getDbRef();
  let sql = "SELECT * FROM notifications";
  if (unreadOnly) {
    sql += " WHERE readAt IS NULL";
  }
  sql += " ORDER BY createdAt DESC";
  const rows = dbRef.prepare(sql).all();
  return rows.map(rowToNotification);
}

export function markRead({ ids, all = false } = {}) {
  const dbRef = getDbRef();
  const readAt = new Date().toISOString();
  if (all) {
    dbRef.prepare("UPDATE notifications SET readAt = ? WHERE readAt IS NULL").run(readAt);
  } else if (Array.isArray(ids) && ids.length > 0) {
    const placeholders = ids.map(() => "?").join(",");
    dbRef.prepare(
      `UPDATE notifications SET readAt = ? WHERE id IN (${placeholders})`
    ).run(readAt, ...ids);
  }
}
