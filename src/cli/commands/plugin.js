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
// 共享 CLI HTTP client 助手（usageError/handleResponse/setProjectEnabled）
// 由 mcp.js 拥有并导出（约定：目录内 mcp 模块为共享 helper 归属，plugin 依赖 mcp）。
import { usageError, handleResponse, setProjectEnabled } from "./mcp.js";

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
  return setProjectEnabled("/api/plugins", "plugin", flags, positional, true);
}

export async function disable(flags, positional = []) {
  return setProjectEnabled("/api/plugins", "plugin", flags, positional, false);
}

