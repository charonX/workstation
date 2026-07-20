import { getDb } from "../db.js";
import crypto from "node:crypto";

const VALID_TYPES = new Set(["webpage", "rss", "x", "wechat"]);

function rowToSource(row) {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    tags: JSON.parse(row.tags || "[]"),
    config: row.config,
    enabled: Boolean(row.enabled),
    createdAt: row.createdAt
  };
}

function validationError(message, code) {
  const err = new Error(message);
  err.code = code;
  return err;
}

function normalizeTags(tags) {
  if (!Array.isArray(tags)) return null;
  const normalized = [];
  for (const tag of tags) {
    const str = typeof tag === "string" ? tag.trim() : String(tag).trim();
    if (str.length === 0 || str.length > 16) return null;
    normalized.push(str);
  }
  return normalized;
}

function isValidHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function validateFields({ name, type, tags, config }, { partial = false } = {}) {
  if (!partial || name !== undefined) {
    const trimmed = typeof name === "string" ? name.trim() : "";
    if (trimmed.length === 0 || trimmed.length > 64) {
      throw validationError("名称必填且不超过 64 字符", "E-SRC-NAME");
    }
  }

  if (!partial || type !== undefined) {
    if (!VALID_TYPES.has(type)) {
      throw validationError("不支持的内容源类型", "E-SRC-TYPE");
    }
  }

  if (!partial || tags !== undefined) {
    const normalized = normalizeTags(tags);
    if (!normalized || normalized.length === 0) {
      throw validationError("请至少添加一个品类标签，单个标签不超过 16 字符", "E-SRC-TAG");
    }
  }

  if (!partial || config !== undefined) {
    const effectiveType = type;
    if (effectiveType === "webpage" || effectiveType === "rss") {
      if (typeof config !== "string" || !isValidHttpUrl(config.trim())) {
        throw validationError("请提供合法 URL", "E-SRC-CONFIG");
      }
    } else if (effectiveType === "x" || effectiveType === "wechat") {
      if (typeof config !== "string" || config.trim().length === 0) {
        throw validationError("请提供账号标识", "E-SRC-CONFIG");
      }
    }
  }
}

export function create({ name, type, tags, config, enabled } = {}) {
  validateFields({ name, type, tags, config });

  const db = getDb();
  const trimmedName = name.trim();
  const existing = db.prepare("SELECT id FROM content_sources WHERE name = ?").get(trimmedName);
  if (existing) {
    throw validationError("内容源名称已存在", "E-SRC-DUP");
  }

  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const normalizedTags = normalizeTags(tags);
  const normalizedEnabled = enabled === undefined ? 1 : enabled ? 1 : 0;

  db.prepare(
    `INSERT INTO content_sources (id, name, type, tags, config, enabled, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(id, trimmedName, type, JSON.stringify(normalizedTags), config.trim(), normalizedEnabled, createdAt);

  return get(id);
}

export function list() {
  const db = getDb();
  const rows = db.prepare("SELECT * FROM content_sources ORDER BY createdAt DESC").all();
  return rows.map(rowToSource);
}

export function listByTag({ tag, enabledOnly = false } = {}) {
  if (typeof tag !== "string" || tag.length === 0) return [];
  const sources = list();
  return sources.filter((s) => {
    if (enabledOnly && !s.enabled) return false;
    return s.tags.includes(tag);
  });
}

export function get(id) {
  const db = getDb();
  const row = db.prepare("SELECT * FROM content_sources WHERE id = ?").get(id);
  if (!row) return undefined;
  return rowToSource(row);
}

export function update(id, fields = {}) {
  const existing = get(id);
  if (!existing) return undefined;

  const { name, type, tags, config, enabled } = fields;

  // Type is required when config is being validated against a new value.
  const effectiveType = type !== undefined ? type : existing.type;
  validateFields(
    { name, type, tags, config: config !== undefined ? config : existing.config },
    { partial: true }
  );

  const db = getDb();
  const updates = [];
  const params = [];

  if (name !== undefined) {
    const trimmed = name.trim();
    if (trimmed !== existing.name) {
      const dup = db.prepare("SELECT id FROM content_sources WHERE name = ? AND id != ?").get(trimmed, id);
      if (dup) {
        throw validationError("内容源名称已存在", "E-SRC-DUP");
      }
    }
    updates.push("name = ?");
    params.push(trimmed);
  }

  if (type !== undefined) {
    updates.push("type = ?");
    params.push(type);
  }

  if (tags !== undefined) {
    updates.push("tags = ?");
    params.push(JSON.stringify(normalizeTags(tags)));
  }

  if (config !== undefined) {
    updates.push("config = ?");
    params.push(config.trim());
  }

  if (enabled !== undefined) {
    updates.push("enabled = ?");
    params.push(enabled ? 1 : 0);
  }

  if (updates.length === 0) {
    return existing;
  }

  params.push(id);
  db.prepare(`UPDATE content_sources SET ${updates.join(", ")} WHERE id = ?`).run(...params);
  return get(id);
}

export function toggle(id) {
  const existing = get(id);
  if (!existing) return undefined;
  return update(id, { enabled: !existing.enabled });
}

export function deleteSource(id) {
  const db = getDb();
  const result = db.prepare("DELETE FROM content_sources WHERE id = ?").run(id);
  return result.changes > 0;
}
