// src/http/routes/cliServices.js
// REQ-CLI-SERVICE-004: CLI 服务配置持久化与两层启用
// REQ-CLI-SERVICE-005: 环境变量配置加密存储与安全回显
// EXPECTED-TRACE: prd.md §6.3 块 3, §10.4 接口 1/2/3

import os from "node:os";
import path from "node:path";
import { createCliService } from "../../services/cliService.js";
import { findRegistryItem } from "../../services/cliRegistry.js";

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, { "Content-Type": "application/json" });
  return res.end(JSON.stringify(data));
}

function decodeParam(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function isRefreshQuery(query) {
  return query?.refresh === "1" || query?.refresh === "true" || query?.refresh === true;
}

function resolveConfigDir(req) {
  return (
    req?.headers?.["x-opc-config-dir"] ||
    process.env.OPC_WORKSTATION_CONFIG_DIR ||
    path.join(os.homedir(), ".opc-workstation")
  );
}

function notFoundService(res, id) {
  return sendJson(res, 404, { error: "E-CLI-UNKNOWN-ID", message: `未知 CLI 服务 id: ${id}` });
}

function handleRouteError(res, err, fallbackStatus = 500) {
  const code = err?.code;
  let status = fallbackStatus;
  if (code === "E-CLI-UNKNOWN-ID") {
    status = 404;
  } else if (code === "E-CLI-NOT-INSTALLED" || code === "E-CLI-GLOBALLY-DISABLED") {
    status = 409;
  } else if (code === "E-CLI-INVALID-TIMEOUT" || code === "E-CLI-INVALID-ENV-KEY" || code === "VALIDATION_ERROR") {
    status = 400;
  }
  return sendJson(res, status, {
    error: code || (status === 500 ? "INTERNAL_ERROR" : "VALIDATION_ERROR"),
    message: err?.message || String(err),
  });
}

function readRequestBody(req) {
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
    });
    req.on("end", () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        resolve({});
      }
    });
    req.on("error", () => resolve({}));
  });
}

async function parseRequestInput(req, p1, p2) {
  if (Array.isArray(p2)) {
    // server.js 派发: p1 = body, p2 = subPath
    let query = {};
    try {
      const parsedUrl = new URL(req.url, "http://127.0.0.1");
      query = Object.fromEntries(parsedUrl.searchParams);
    } catch {
      query = {};
    }
    return { body: p1 || {}, subPath: p2, query };
  }

  // 单元测试直调: p1 = pathname, p2 = query
  const query = p2 || {};
  const cleanPath = typeof p1 === "string" ? p1.split("?")[0] : "";
  const subPath = cleanPath.replace(/^\/api\/cli-services\/?/, "").split("/").filter(Boolean);
  let body = req.body && typeof req.body === "object" ? req.body : {};
  if (!req.body && req.method !== "GET") {
    body = await readRequestBody(req);
  }
  return { body, subPath, query };
}

/**
 * CLI 服务 HTTP 请求分发
 * @param {import("node:http").IncomingMessage} req
 * @param {import("node:http").ServerResponse} res
 * @param {any} p1 - server.js 模式为 body，测试直调模式为 pathname
 * @param {any} p2 - server.js 模式为 subPath，测试直调模式为 query
 */
export async function handleCliServices(req, res, p1, p2) {
  const { body, subPath, query } = await parseRequestInput(req, p1, p2);
  const cliService = await createCliService({ configDir: resolveConfigDir(req) });

  // 接口 1: GET /api/cli-services
  if (subPath.length === 0 && req.method === "GET") {
    try {
      const services = await cliService.list({
        refresh: isRefreshQuery(query),
        projectId: query.project || undefined,
      });
      return sendJson(res, 200, { services });
    } catch (err) {
      return handleRouteError(res, err, 500);
    }
  }

  // 接口 1: GET /api/cli-services/:id 或 GET /api/cli-services/:id/probe
  if ((subPath.length === 1 || (subPath.length === 2 && subPath[1] === "probe")) && req.method === "GET") {
    const id = decodeParam(subPath[0]);
    if (!findRegistryItem(id)) return notFoundService(res, id);
    try {
      const services = await cliService.list({ refresh: isRefreshQuery(query) });
      const service = services.find((s) => s.id === id);
      if (!service) return notFoundService(res, id);
      return sendJson(res, 200, service);
    } catch (err) {
      return handleRouteError(res, err, 500);
    }
  }

  // 接口 3: PUT /api/cli-services/:id/projects/:projectId
  if (subPath.length === 3 && subPath[1] === "projects" && req.method === "PUT") {
    const id = decodeParam(subPath[0]);
    const projectId = decodeParam(subPath[2]);
    if (!findRegistryItem(id)) return notFoundService(res, id);
    try {
      const updatedConfig = await cliService.setProjectEnabled(projectId, id, Boolean(body?.enabled));
      return sendJson(res, 200, { service: updatedConfig });
    } catch (err) {
      return handleRouteError(res, err, 400);
    }
  }

  // 接口 2: PUT /api/cli-services/:id
  if (subPath.length === 1 && req.method === "PUT") {
    const id = decodeParam(subPath[0]);
    if (!findRegistryItem(id)) return notFoundService(res, id);
    try {
      let updatedConfig;
      if (body.enabled !== undefined) {
        updatedConfig = await cliService.setGlobalEnabled(id, Boolean(body.enabled));
      }
      if (body.env !== undefined || body.timeoutSec !== undefined) {
        const patch = {};
        if (body.env !== undefined) patch.env = body.env;
        if (body.timeoutSec !== undefined) patch.timeoutSec = body.timeoutSec;
        updatedConfig = await cliService.updateConfig(id, patch);
      }
      if (!updatedConfig) {
        updatedConfig = await cliService.getConfig(id);
      }
      return sendJson(res, 200, { service: updatedConfig });
    } catch (err) {
      return handleRouteError(res, err, 500);
    }
  }

  return sendJson(res, 404, { error: "NOT_FOUND", message: "Not found" });
}
