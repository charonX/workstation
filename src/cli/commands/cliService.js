// src/cli/commands/cliService.js
// REQ-CLI-SERVICE-010: 产品 CLI cli-service 命令族
// EXPECTED-TRACE: prd.md §10.4 接口 1/2/3, §11.1 Seam 1/2/3

import { ensureServer } from "../server.js";
import { usageError, handleResponse } from "./mcp.js";

export { usageError, handleResponse };

/**
 * 封装向本地 HTTP 服务发送请求的统一方法
 * @param {string} apiPath
 * @param {RequestInit & { body?: any }} [options]
 */
async function request(apiPath, options = {}) {
  const server = await ensureServer();
  const headers = {
    "Content-Type": "application/json",
    ...(process.env.OPC_WORKSTATION_CONFIG_DIR ? { "x-opc-config-dir": process.env.OPC_WORKSTATION_CONFIG_DIR } : {}),
    ...options.headers,
  };
  const body = options.body && typeof options.body !== "string" ? JSON.stringify(options.body) : options.body;
  const res = await fetch(`${server.baseUrl}${apiPath}`, { ...options, headers, body });
  return handleResponse(res);
}

/**
 * 解析单个 KEY=VALUE 并写入目标字典
 * @param {string} pair
 * @param {Record<string, string>} out
 */
function parseKeyValue(pair, out) {
  const eq = pair.indexOf("=");
  if (eq === -1) throw usageError(`Expected KEY=VALUE, got: ${pair}`);
  const key = pair.slice(0, eq).trim();
  const val = pair.slice(eq + 1).trim();
  if (!key) throw usageError(`Expected KEY=VALUE, got: ${pair}`);
  out[key] = val;
}

export async function list(flags = {}, _positional = []) {
  const params = new URLSearchParams();
  if (flags.refresh) params.set("refresh", "1");
  if (flags.project) params.set("project", String(flags.project));
  const queryStr = params.toString() ? `?${params.toString()}` : "";
  return request(`/api/cli-services${queryStr}`);
}

export async function probe(flags = {}, positional = []) {
  const id = positional[0];
  if (!id) throw usageError("Usage: cli-service probe <id> [--json]");
  return request(`/api/cli-services/${encodeURIComponent(id)}?refresh=1`);
}

async function toggleEnablement(actionName, enabled, flags = {}, positional = []) {
  const id = positional[0];
  if (!id) throw usageError(`Usage: cli-service ${actionName} <id> [--project <projectId>]`);
  const apiPath = flags.project
    ? `/api/cli-services/${encodeURIComponent(id)}/projects/${encodeURIComponent(String(flags.project))}`
    : `/api/cli-services/${encodeURIComponent(id)}`;
  return request(apiPath, {
    method: "PUT",
    body: { enabled },
  });
}

export async function enable(flags = {}, positional = []) {
  return toggleEnablement("enable", true, flags, positional);
}

export async function disable(flags = {}, positional = []) {
  return toggleEnablement("disable", false, flags, positional);
}

export async function env(flags = {}, positional = []) {
  const subAction = positional[0];
  const id = positional[1];

  if (subAction === "set") {
    if (!id) throw usageError("Usage: cli-service env set <id> KEY=VALUE...");
    const pairs = positional.slice(2);
    if (pairs.length === 0 && !flags.env) {
      throw usageError("Usage: cli-service env set <id> KEY=VALUE...");
    }
    const envMap = {};
    if (flags.env) {
      for (const pair of String(flags.env).split(",")) {
        parseKeyValue(pair, envMap);
      }
    }
    for (const pair of pairs) {
      parseKeyValue(pair, envMap);
    }
    const data = await request(`/api/cli-services/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: { env: envMap },
    });
    return {
      id,
      envKeys: data.service?.envKeys || Object.keys(envMap),
    };
  }

  if (subAction === "list") {
    if (!id) throw usageError("Usage: cli-service env list <id>");
    const service = await request(`/api/cli-services/${encodeURIComponent(id)}`);
    return {
      id,
      envKeys: service.envKeys || [],
    };
  }

  throw usageError("Usage: cli-service env <set|list> <id> [KEY=VALUE...]");
}
