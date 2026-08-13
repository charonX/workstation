// src/cli/commands/plugin.js
// REQ-AGENT-090：`opc-workstation plugin` 命令族（ADR-001 共享服务层，CLI 即测试 seam）。
//
//   plugin add <source>                    -> POST /api/plugins { source }
//   plugin remove <source>                 -> DELETE /api/plugins/:source
//   plugin list [--project <id>]           -> GET /api/plugins[?project=<id>]
//   plugin enable|disable <name> --project <id> -> POST /api/plugins/:name/project-enable
//
// stdout 一律结构化 JSON（HTTP API 响应原样透传）；业务错误非零退出 + stderr 含错误文案
//（HTTP 错误体 { error, message } → stderr + process.exit(1)）。

import { ensureServer } from "../server.js";

export async function add(flags, positional = []) {
  const source = positional[0];
  if (!source) throw usageError("Usage: plugin add <source>");
  const server = await ensureServer();
  const res = await fetch(`${server.baseUrl}/api/plugins`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ source })
  });
  return handleResponse(res);
}

export async function remove(flags, positional = []) {
  const source = positional[0];
  if (!source) throw usageError("Usage: plugin remove <source>");
  const server = await ensureServer();
  const res = await fetch(`${server.baseUrl}/api/plugins/${encodeURIComponent(source)}`, { method: "DELETE" });
  return handleResponse(res);
}

export async function list(flags = {}) {
  const server = await ensureServer();
  const q = flags.project ? `?project=${encodeURIComponent(String(flags.project))}` : "";
  const res = await fetch(`${server.baseUrl}/api/plugins${q}`);
  return handleResponse(res);
}

export async function enable(flags, positional = []) {
  return setProjectEnabled(flags, positional, true);
}

export async function disable(flags, positional = []) {
  return setProjectEnabled(flags, positional, false);
}

async function setProjectEnabled(flags, positional, enabled) {
  const name = positional[0];
  if (!name) throw usageError("Usage: plugin enable|disable <name> --project <id>");
  if (!flags.project) throw usageError("Usage: plugin enable|disable <name> --project <id>");
  const server = await ensureServer();
  const res = await fetch(`${server.baseUrl}/api/plugins/${encodeURIComponent(name)}/project-enable`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ projectId: String(flags.project), enabled })
  });
  return handleResponse(res);
}

function usageError(message) {
  const err = new Error(message);
  err.status = 400;
  err.data = { error: "USAGE_ERROR", message };
  return err;
}

async function handleResponse(res) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.message || `Request failed with status ${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}
