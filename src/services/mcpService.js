// src/services/mcpService.js
// REQ-AGENT-084：MCP server 配置 CRUD + 项目级启用 + effectiveConfig 快照（B4）。
//
// ServerRow = { id, name, type: "stdio"|"http", command?, args?, env?, url?, headers?,
//               auth?: "none"|"bearer"|"oauth", enabled /* 全局开关默认 true */ }
//
// bearer token（BUG-006，REQ-AGENT-084 标准 6）：create/update 接受 token 明文入参，
// 经 secretStore 加密存 token_enc 列——DB/API/list 永不出现明文；effectiveConfig 快照
// 解密映射桥 ServerEntry.bearerToken（pi-mcp-adapter 据此注入 Authorization 头）。
//
// DB 落库（mcp_servers + mcp_project_enablement，见 src/db.js），SQLite 为真相。
// DB 路径解析：`DB_PATH` ?? `<configDir>/data.db`（configDir = OPC_WORKSTATION_CONFIG_DIR
// 或 ~/.opc-workstation）——测试只设 OPC_WORKSTATION_CONFIG_DIR 即隔离到临时库。
//
// effectiveConfig(projectId) → { servers: { [name]: <桥 config 项> } }，只含
// 「全局开关开 ∧ 项目已启用」的 server；每项对齐 pi-mcp-adapter ServerEntry 形态
// （stdio: command/args/env；http: url/headers/auth/bearerToken）。

import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { getDb } from "../db.js";
import { encryptSecret, decryptSecret } from "./secretStore.js";

function timestamp() {
  return new Date().toISOString();
}

function resolveDbPath() {
  if (process.env.DB_PATH) return process.env.DB_PATH;
  const configDir = process.env.OPC_WORKSTATION_CONFIG_DIR || path.join(os.homedir(), ".opc-workstation");
  return path.join(configDir, "data.db");
}

// ---------------------------------------------------------------------------
// 校验（PRD §7，错误文案锁签核：已存在 / URL / KEY=VALUE / command|命令）
// ---------------------------------------------------------------------------

// slug 安全字符：字母/数字开头，可含 . _ -
const NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;
const ENV_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

function jsonParse(value, fallback) {
  if (value === null || value === undefined || value === "") return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function rowToServerRow(row) {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    command: row.command ?? undefined,
    args: jsonParse(row.args, []),
    env: jsonParse(row.env, {}),
    url: row.url ?? undefined,
    headers: jsonParse(row.headers, {}),
    auth: row.auth ?? "none",
    enabled: row.enabled === 1,
  };
}

function getById(db, id) {
  const row = db.prepare("SELECT * FROM mcp_servers WHERE id = ?").get(id);
  return row ? rowToServerRow(row) : undefined;
}

function getByName(db, name) {
  const row = db.prepare("SELECT * FROM mcp_servers WHERE name = ?").get(name);
  return row ? rowToServerRow(row) : undefined;
}

/** 落库字段序列化：与 mcp_servers 列序 (type, command, args, env, url, headers, auth, token_enc, enabled) 一致，create/update 共用。 */
function toDbColumns(row, existingTokenEnc) {
  return [
    row.type,
    row.command ?? null,
    JSON.stringify(row.args ?? []),
    JSON.stringify(row.env ?? {}),
    row.url ?? null,
    JSON.stringify(row.headers ?? {}),
    row.auth,
    computeTokenEnc(row, existingTokenEnc),
    row.enabled ? 1 : 0,
  ];
}

/**
 * bearer token 落库值：仅 http+bearer 留存（其余一律清 null，stdio/切走 auth 即丢弃）；
 * 新 token 明文经 secretStore 加密；未给新 token 时保留既有密文（update 不强制重填）。
 * 明文 token 永不落库。
 */
function computeTokenEnc(row, existingTokenEnc) {
  if (row.type !== "http" || row.auth !== "bearer") return null;
  if (typeof row.token === "string" && row.token.trim() !== "") {
    return encryptSecret(row.token.trim());
  }
  return existingTokenEnc ?? null;
}

/** env/headers 必须是 { KEY: string }，KEY 为合法环境变量名（错误文案含 KEY=VALUE）。 */
function validateKeyValue(obj, fieldLabel) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
    throw new Error(`${fieldLabel} 格式为 KEY=VALUE`);
  }
  for (const [key, value] of Object.entries(obj)) {
    if (!ENV_KEY_RE.test(key)) {
      throw new Error(`${fieldLabel} 格式为 KEY=VALUE（KEY 不合法: ${key}）`);
    }
    if (typeof value !== "string") {
      throw new Error(`${fieldLabel} 格式为 KEY=VALUE`);
    }
  }
}

function validateName(db, name) {
  if (typeof name !== "string" || name.trim() === "") {
    throw new Error("MCP 名称不合法: name is required");
  }
  if (!NAME_RE.test(name)) {
    throw new Error(`MCP 名称不合法（仅支持 slug 安全字符）: ${name}`);
  }
  const existing = db.prepare("SELECT id FROM mcp_servers WHERE name = ?").get(name);
  if (existing) {
    throw new Error(`MCP server 已存在: ${name}`);
  }
}

function validateHttp(row, existingTokenEnc) {
  if (typeof row.url !== "string" || row.url.trim() === "") {
    throw new Error("URL 不合法: url is required");
  }
  let parsed;
  try {
    parsed = new URL(row.url);
  } catch {
    throw new Error("URL 不合法: 仅支持 http/https");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("URL 不合法: 仅支持 http/https");
  }
  if (row.headers !== undefined) validateKeyValue(row.headers, "headers");
  if (row.auth !== undefined && !["none", "bearer", "oauth"].includes(row.auth)) {
    throw new Error("auth 不合法: 仅支持 none/bearer/oauth");
  }
  // BUG-006：bearer 必须有 token 来源——新明文或既有密文（update 可只改其他字段）。
  if (row.auth === "bearer") {
    const hasNew = typeof row.token === "string" && row.token.trim() !== "";
    if (!hasNew && !existingTokenEnc) {
      throw new Error("auth=bearer 必须提供 token（加密存系统凭据库）");
    }
  }
}

function validateStdio(row) {
  if (typeof row.command !== "string" || row.command.trim() === "") {
    throw new Error("启动命令必填 (command is required)");
  }
  if (row.args !== undefined) {
    if (!Array.isArray(row.args) || row.args.some((a) => typeof a !== "string")) {
      throw new Error("args 必须为字符串数组");
    }
  }
  if (row.env !== undefined) validateKeyValue(row.env, "env");
}

function normalizeRow(row) {
  return {
    name: row?.name,
    type: row?.type,
    command: row?.command,
    args: row?.args,
    env: row?.env,
    url: row?.url,
    headers: row?.headers,
    auth: row?.auth ?? "none",
    token: row?.token,
    enabled: row?.enabled ?? true,
  };
}

/** 对齐 pi-mcp-adapter ServerEntry：stdio 输出 command/args/env；http 输出 url/headers/auth/bearerToken。 */
function toBridgeEntry(row, tokenEnc) {
  const entry = {};
  if (row.type === "stdio") {
    if (row.command) entry.command = row.command;
    if (Array.isArray(row.args) && row.args.length > 0) entry.args = row.args;
    if (row.env && Object.keys(row.env).length > 0) entry.env = row.env;
  } else if (row.type === "http") {
    if (row.url) entry.url = row.url;
    if (row.headers && Object.keys(row.headers).length > 0) entry.headers = row.headers;
    if (row.auth && row.auth !== "none") entry.auth = row.auth; // "bearer" | "oauth"
    // BUG-006：快照是唯一解密点——桥据此注入 Authorization: Bearer 头
    if (row.auth === "bearer" && tokenEnc) entry.bearerToken = decryptSecret(tokenEnc);
  }
  return entry;
}

// ---------------------------------------------------------------------------
// 服务
// ---------------------------------------------------------------------------

export function createMcpService() {
  const dbPath = resolveDbPath();
  const db = () => getDb(dbPath);

  return {
    async create(row) {
      const d = db();
      const normalized = normalizeRow(row);
      validateName(d, normalized.name);
      if (normalized.type === "stdio") {
        validateStdio(normalized);
      } else if (normalized.type === "http") {
        validateHttp(normalized);
      } else {
        throw new Error("type 不合法: 仅支持 stdio/http");
      }
      const id = crypto.randomUUID();
      const createdAt = timestamp();
      d.prepare(
        `INSERT INTO mcp_servers
           (id, name, type, command, args, env, url, headers, auth, token_enc, enabled, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(id, normalized.name, ...toDbColumns(normalized), createdAt);
      return getById(d, id);
    },

    list() {
      const d = db();
      const rows = d.prepare("SELECT * FROM mcp_servers ORDER BY name").all();
      return rows.map(rowToServerRow);
    },

    remove(name) {
      const d = db();
      const existing = getByName(d, name);
      if (!existing) return false;
      const tx = d.transaction(() => {
        d.prepare("DELETE FROM mcp_project_enablement WHERE serverId = ?").run(existing.id);
        d.prepare("DELETE FROM mcp_servers WHERE id = ?").run(existing.id);
      });
      tx();
      return true;
    },

    update(name, patch) {
      const d = db();
      const existing = getByName(d, name);
      if (!existing) {
        throw new Error(`MCP server 不存在: ${name}`);
      }
      const base = existing;
      const p = patch ?? {};
      const merged = {
        ...base,
        ...(p.type !== undefined ? { type: p.type } : {}),
        ...(p.command !== undefined ? { command: p.command } : {}),
        ...(p.args !== undefined ? { args: p.args } : {}),
        ...(p.env !== undefined ? { env: p.env } : {}),
        ...(p.url !== undefined ? { url: p.url } : {}),
        ...(p.headers !== undefined ? { headers: p.headers } : {}),
        ...(p.auth !== undefined ? { auth: p.auth } : {}),
        ...(p.token !== undefined ? { token: p.token } : {}),
        ...(p.enabled !== undefined ? { enabled: p.enabled } : {}),
        name,
      };
      // 既有密文：bearer 未给新 token 时保留；校验「bearer 必须有 token 来源」也认它。
      const existingTokenEnc = d.prepare("SELECT token_enc FROM mcp_servers WHERE id = ?").get(existing.id)?.token_enc ?? null;
      if (merged.type === "stdio") validateStdio(merged);
      else if (merged.type === "http") validateHttp(merged, existingTokenEnc);
      d.prepare(
        `UPDATE mcp_servers SET type = ?, command = ?, args = ?, env = ?, url = ?, headers = ?, auth = ?, token_enc = ?, enabled = ?
         WHERE id = ?`
      ).run(...toDbColumns(merged, existingTokenEnc), existing.id);
      return getById(d, existing.id);
    },

    setGlobalEnabled(name, enabled) {
      const d = db();
      const existing = getByName(d, name);
      if (!existing) {
        throw new Error(`MCP server 不存在: ${name}`);
      }
      d.prepare("UPDATE mcp_servers SET enabled = ? WHERE id = ?").run(enabled ? 1 : 0, existing.id);
      return getByName(d, name);
    },

    setProjectEnabled(projectId, name, enabled) {
      const d = db();
      const existing = getByName(d, name);
      if (!existing) {
        throw new Error(`MCP server 不存在: ${name}`);
      }
      if (!projectId) {
        throw new Error("setProjectEnabled: projectId is required");
      }
      d.prepare(
        `INSERT INTO mcp_project_enablement (serverId, projectId, enabled)
         VALUES (?, ?, ?)
         ON CONFLICT(serverId, projectId) DO UPDATE SET enabled = excluded.enabled`
      ).run(existing.id, projectId, enabled ? 1 : 0);
      return existing;
    },

    /** 只含「全局开关开 ∧ 项目已启用」的 server；形态直接被 createMcpAdapter({config}) 消费。 */
    effectiveConfig(projectId) {
      const d = db();
      const rows = d
        .prepare(
          `SELECT s.* FROM mcp_servers s
           JOIN mcp_project_enablement e ON e.serverId = s.id
           WHERE s.enabled = 1 AND e.projectId = ? AND e.enabled = 1
           ORDER BY s.name`
        )
        .all(projectId);
      const servers = {};
      for (const row of rows) {
        servers[row.name] = toBridgeEntry(rowToServerRow(row), row.token_enc);
      }
      return { servers };
    },
  };
}
