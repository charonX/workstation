// src/cli/commands/cliService.js
// REQ-CLI-SERVICE-010: 产品 CLI cli-service 命令族
// EXPECTED-TRACE: prd.md §10.4 接口 1/2/3, §11.1 Seam 1/2/3

import { ensureServer } from "../server.js";
import { usageError, handleResponse } from "./mcp.js";

export { usageError, handleResponse };

function getHeaders() {
  const headers = { "Content-Type": "application/json" };
  if (process.env.OPC_WORKSTATION_CONFIG_DIR) {
    headers["x-opc-config-dir"] = process.env.OPC_WORKSTATION_CONFIG_DIR;
  }
  return headers;
}

export async function list(flags = {}, _positional = []) {
  const server = await ensureServer();
  const params = new URLSearchParams();
  if (flags.refresh) params.set("refresh", "1");
  if (flags.project) params.set("project", String(flags.project));
  const queryStr = params.toString() ? `?${params.toString()}` : "";
  const res = await fetch(`${server.baseUrl}/api/cli-services${queryStr}`, {
    headers: getHeaders(),
  });
  return handleResponse(res);
}

export async function probe(flags = {}, positional = []) {
  const id = positional[0];
  if (!id) throw usageError("Usage: cli-service probe <id> [--json]");
  const server = await ensureServer();
  const res = await fetch(`${server.baseUrl}/api/cli-services/${encodeURIComponent(id)}?refresh=1`, {
    headers: getHeaders(),
  });
  return handleResponse(res);
}

export async function enable(flags = {}, positional = []) {
  const id = positional[0];
  if (!id) throw usageError("Usage: cli-service enable <id> [--project <projectId>]");
  const server = await ensureServer();
  if (flags.project) {
    const res = await fetch(
      `${server.baseUrl}/api/cli-services/${encodeURIComponent(id)}/projects/${encodeURIComponent(String(flags.project))}`,
      {
        method: "PUT",
        headers: getHeaders(),
        body: JSON.stringify({ enabled: true }),
      }
    );
    return handleResponse(res);
  }
  const res = await fetch(`${server.baseUrl}/api/cli-services/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: getHeaders(),
    body: JSON.stringify({ enabled: true }),
  });
  return handleResponse(res);
}

export async function disable(flags = {}, positional = []) {
  const id = positional[0];
  if (!id) throw usageError("Usage: cli-service disable <id> [--project <projectId>]");
  const server = await ensureServer();
  if (flags.project) {
    const res = await fetch(
      `${server.baseUrl}/api/cli-services/${encodeURIComponent(id)}/projects/${encodeURIComponent(String(flags.project))}`,
      {
        method: "PUT",
        headers: getHeaders(),
        body: JSON.stringify({ enabled: false }),
      }
    );
    return handleResponse(res);
  }
  const res = await fetch(`${server.baseUrl}/api/cli-services/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: getHeaders(),
    body: JSON.stringify({ enabled: false }),
  });
  return handleResponse(res);
}

export async function env(flags = {}, positional = []) {
  const subAction = positional[0];
  if (subAction === "set") {
    const id = positional[1];
    if (!id) throw usageError("Usage: cli-service env set <id> KEY=VALUE...");
    const pairs = positional.slice(2);
    if (pairs.length === 0 && !flags.env) {
      throw usageError("Usage: cli-service env set <id> KEY=VALUE...");
    }
    const envMap = {};
    if (flags.env) {
      for (const pair of String(flags.env).split(",")) {
        const eq = pair.indexOf("=");
        if (eq === -1) throw usageError(`Expected KEY=VALUE, got: ${pair}`);
        const key = pair.slice(0, eq).trim();
        const val = pair.slice(eq + 1).trim();
        if (!key) throw usageError(`Expected KEY=VALUE, got: ${pair}`);
        envMap[key] = val;
      }
    }
    for (const pair of pairs) {
      const eq = pair.indexOf("=");
      if (eq === -1) throw usageError(`Expected KEY=VALUE, got: ${pair}`);
      const key = pair.slice(0, eq).trim();
      const val = pair.slice(eq + 1).trim();
      if (!key) throw usageError(`Expected KEY=VALUE, got: ${pair}`);
      envMap[key] = val;
    }
    const server = await ensureServer();
    const res = await fetch(`${server.baseUrl}/api/cli-services/${encodeURIComponent(id)}`, {
      method: "PUT",
      headers: getHeaders(),
      body: JSON.stringify({ env: envMap }),
    });
    const data = await handleResponse(res);
    return {
      id,
      envKeys: data.service?.envKeys || Object.keys(envMap),
    };
  }

  if (subAction === "list") {
    const id = positional[1];
    if (!id) throw usageError("Usage: cli-service env list <id>");
    const server = await ensureServer();
    const res = await fetch(`${server.baseUrl}/api/cli-services/${encodeURIComponent(id)}`, {
      headers: getHeaders(),
    });
    const service = await handleResponse(res);
    return {
      id,
      envKeys: service.envKeys || [],
    };
  }

  throw usageError("Usage: cli-service env <set|list> <id> [KEY=VALUE...]");
}
