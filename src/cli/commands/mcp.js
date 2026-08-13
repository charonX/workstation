// src/cli/commands/mcp.js
// REQ-AGENT-090：`opc-workstation mcp` 命令族（ADR-001 共享服务层，CLI 即测试 seam）。
//
//   mcp add <name> --type stdio --command <cmd> [--args a,b] [--env K=V]…
//   mcp add <name> --type http --url <u> [--header K=V]… [--auth none|bearer|oauth]
//   mcp list                                     -> GET /api/mcp
//   mcp enable|disable <name> --project <id>     -> POST /api/mcp/:name/project-enable
//
// stdout 一律结构化 JSON（HTTP API 响应原样透传）；业务错误非零退出 + stderr 含错误文案
//（HTTP 错误体 { error, message } → stderr + process.exit(1)）。
//
// 注：opc-workstation 的共享 parseArgs 对同一 flag 只保留末值（不支持重复 flag），
// 故 `--env K=V --env K2=V2` 的重复形态退化为单个；`--env`/`--header` 支持逗号分隔
// `K=V,K2=V2`（build-progress 记录该偏差，Slice 5/后续可升级 parseArgs 为累积数组）。

import { ensureServer } from "../server.js";

export async function add(flags, positional = []) {
  const name = positional[0];
  if (!name) throw usageError("Usage: mcp add <name> --type <stdio|http> [--command <cmd> --args a,b --env K=V ...]");
  const type = flags.type;
  if (type !== "stdio" && type !== "http") {
    throw usageError("--type must be stdio or http");
  }
  const body = { name, type };
  if (type === "stdio") {
    if (!flags.command) throw usageError("--command is required for stdio servers");
    body.command = String(flags.command);
    if (flags.args !== undefined) body.args = splitCsv(flags.args);
    if (flags.env !== undefined) body.env = parseKeyValues(flags.env);
  } else {
    if (!flags.url) throw usageError("--url is required for http servers");
    body.url = String(flags.url);
    if (flags.header !== undefined) body.headers = parseKeyValues(flags.header);
    if (flags.auth !== undefined) body.auth = String(flags.auth);
  }
  const server = await ensureServer();
  const res = await fetch(`${server.baseUrl}/api/mcp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  return handleResponse(res);
}

export async function list() {
  const server = await ensureServer();
  const res = await fetch(`${server.baseUrl}/api/mcp`);
  return handleResponse(res);
}

export async function enable(flags, positional = []) {
  return setProjectEnabled("/api/mcp", "mcp", flags, positional, true);
}

export async function disable(flags, positional = []) {
  return setProjectEnabled("/api/mcp", "mcp", flags, positional, false);
}

// 共享 project-enable 调用（plugin/mcp 命令族共用）：resource 为 API 基路径
//（/api/plugins 与 /api/mcp 单复数不一致，故不能从 entity 名推导），label 用于 usage 文案。
export async function setProjectEnabled(resource, label, flags, positional, enabled) {
  const name = positional[0];
  if (!name) throw usageError(`Usage: ${label} enable|disable <name> --project <id>`);
  if (!flags.project) throw usageError(`Usage: ${label} enable|disable <name> --project <id>`);
  const server = await ensureServer();
  const res = await fetch(`${server.baseUrl}${resource}/${encodeURIComponent(name)}/project-enable`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ projectId: String(flags.project), enabled })
  });
  return handleResponse(res);
}

function splitCsv(value) {
  return String(value)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseKeyValues(value) {
  const out = {};
  for (const pair of String(value).split(",")) {
    const eq = pair.indexOf("=");
    if (eq === -1) throw usageError(`Expected KEY=VALUE, got: ${pair}`);
    const key = pair.slice(0, eq).trim();
    const val = pair.slice(eq + 1).trim();
    if (!key) throw usageError(`Expected KEY=VALUE, got: ${pair}`);
    out[key] = val;
  }
  return out;
}

export function usageError(message) {
  const err = new Error(message);
  err.status = 400;
  err.data = { error: "USAGE_ERROR", message };
  return err;
}

export async function handleResponse(res) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.message || `Request failed with status ${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}
