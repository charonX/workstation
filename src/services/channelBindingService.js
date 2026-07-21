import { getDb } from "../db.js";
import crypto from "node:crypto";

function timestamp() {
  return new Date().toISOString();
}

function rowToBinding(row) {
  if (!row) return null;
  return {
    id: row.id,
    channelType: row.channelType,
    flowId: row.flowId,
    projectId: row.projectId,
    createdAt: row.createdAt
  };
}

export function createBindingRaw(db, { channelType, flowId, projectId, force = false } = {}) {
  if (!channelType) throw new Error("E-BINDING-INVALID: channelType is required");
  if (!flowId) throw new Error("E-BINDING-INVALID: flowId is required");
  if (!projectId) throw new Error("E-BINDING-INVALID: projectId is required");

  const existing = db.prepare("SELECT * FROM channel_bindings WHERE channelType = ?").get(channelType);
  if (existing && !force) {
    const err = new Error("E-BINDING-EXISTS: channel binding already exists");
    err.code = "E-BINDING-EXISTS";
    throw err;
  }

  const id = crypto.randomUUID();
  const createdAt = timestamp();

  if (existing) {
    db.prepare("DELETE FROM channel_bindings WHERE channelType = ?").run(channelType);
  }
  db.prepare(`
    INSERT INTO channel_bindings (id, channelType, flowId, projectId, createdAt)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, channelType, flowId, projectId, createdAt);

  return rowToBinding({ id, channelType, flowId, projectId, createdAt });
}

export function createBinding({ channelType, flowId, projectId, force = false } = {}) {
  const db = getDb();
  const writeBinding = db.transaction(() => createBindingRaw(db, { channelType, flowId, projectId, force }));
  return writeBinding();
}

export function getBinding(channelType) {
  if (!channelType) return null;
  const db = getDb();
  const row = db.prepare("SELECT * FROM channel_bindings WHERE channelType = ?").get(channelType);
  return rowToBinding(row);
}

export function deleteBinding(channelType) {
  if (!channelType) return false;
  const db = getDb();
  const result = db.prepare("DELETE FROM channel_bindings WHERE channelType = ?").run(channelType);
  return result.changes > 0;
}
