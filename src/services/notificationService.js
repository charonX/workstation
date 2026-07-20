import { getDb } from "../db.js";
import crypto from "node:crypto";

let db = null;

function getDbRef() {
  if (!db) {
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
  return message.toLowerCase().includes("database connection is closed");
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
    dbRef.prepare(
      `INSERT INTO notifications (id, type, title, body, executionId, createdAt, readAt)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(id, type, title, body, executionId ?? null, createdAt, null);
    return rowToNotification({ id, type, title, body, executionId: executionId ?? null, createdAt, readAt: null });
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
  const where = unreadOnly ? "WHERE readAt IS NULL" : "";
  const rows = dbRef.prepare(
    `SELECT * FROM notifications ${where} ORDER BY createdAt DESC`
  ).all();
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
