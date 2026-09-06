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

/**
 * CLI 服务 HTTP 请求分发
 * @param {import("node:http").IncomingMessage} req
 * @param {import("node:http").ServerResponse} res
 * @param {any} p1 - server.js 模式为 body，测试直调模式为 pathname
 * @param {any} p2 - server.js 模式为 subPath，测试直调模式为 query
 */
export async function handleCliServices(req, res, p1, p2) {
  let body = {};
  let subPath = [];
  let query = {};

  if (Array.isArray(p2)) {
    // server.js 派发: p1 = body, p2 = subPath
    body = p1 || {};
    subPath = p2;
    try {
      const parsedUrl = new URL(req.url, "http://127.0.0.1");
      query = Object.fromEntries(parsedUrl.searchParams);
    } catch {
      query = {};
    }
  } else if (typeof p1 === "string") {
    // 单元测试直调: p1 = pathname, p2 = query
    query = p2 || {};
    const cleanPath = p1.split("?")[0];
    subPath = cleanPath.replace(/^\/api\/cli-services\/?/, "").split("/").filter(Boolean);
    if (req.body && typeof req.body === "object") {
      body = req.body;
    } else {
      body = await new Promise((resolve) => {
        if (req.method === "GET") return resolve({});
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
      });
    }
  }

  const configDir =
    req.headers?.["x-opc-config-dir"] ||
    process.env.OPC_WORKSTATION_CONFIG_DIR ||
    path.join(os.homedir(), ".opc-workstation");
  const cliService = await createCliService({ configDir });

  // GET /api/cli-services
  if (subPath.length === 0 && req.method === "GET") {
    try {
      const refresh = query.refresh === "1" || query.refresh === "true" || query.refresh === true;
      const projectId = query.project || undefined;
      const services = await cliService.list({ refresh, projectId });
      return sendJson(res, 200, { services });
    } catch (err) {
      return sendJson(res, 500, { error: err?.code || "INTERNAL_ERROR", message: err.message });
    }
  }

  // GET /api/cli-services/:id 或 GET /api/cli-services/:id/probe
  if ((subPath.length === 1 || (subPath.length === 2 && subPath[1] === "probe")) && req.method === "GET") {
    const id = decodeParam(subPath[0]);
    if (!findRegistryItem(id)) {
      return sendJson(res, 404, { error: "E-CLI-UNKNOWN-ID", message: `未知 CLI 服务 id: ${id}` });
    }
    try {
      const refresh = query.refresh === "1" || query.refresh === "true" || query.refresh === true;
      const services = await cliService.list({ refresh });
      const service = services.find((s) => s.id === id);
      if (!service) {
        return sendJson(res, 404, { error: "E-CLI-UNKNOWN-ID", message: `未知 CLI 服务 id: ${id}` });
      }
      return sendJson(res, 200, service);
    } catch (err) {
      return sendJson(res, 500, { error: err?.code || "INTERNAL_ERROR", message: err.message });
    }
  }

  // PUT /api/cli-services/:id/projects/:projectId
  if (subPath.length === 3 && subPath[1] === "projects" && req.method === "PUT") {
    const id = decodeParam(subPath[0]);
    const projectId = decodeParam(subPath[2]);
    if (!findRegistryItem(id)) {
      return sendJson(res, 404, { error: "E-CLI-UNKNOWN-ID", message: `未知 CLI 服务 id: ${id}` });
    }
    try {
      const updatedConfig = await cliService.setProjectEnabled(projectId, id, Boolean(body?.enabled));
      return sendJson(res, 200, { service: updatedConfig });
    } catch (err) {
      if (err?.code === "E-CLI-GLOBALLY-DISABLED") {
        return sendJson(res, 409, { error: "E-CLI-GLOBALLY-DISABLED", message: err.message });
      }
      if (err?.code === "E-CLI-UNKNOWN-ID") {
        return sendJson(res, 404, { error: "E-CLI-UNKNOWN-ID", message: err.message });
      }
      return sendJson(res, 400, { error: err?.code || "VALIDATION_ERROR", message: err.message });
    }
  }

  // PUT /api/cli-services/:id
  if (subPath.length === 1 && req.method === "PUT") {
    const id = decodeParam(subPath[0]);
    if (!findRegistryItem(id)) {
      return sendJson(res, 404, { error: "E-CLI-UNKNOWN-ID", message: `未知 CLI 服务 id: ${id}` });
    }
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
      if (err?.code === "E-CLI-NOT-INSTALLED") {
        return sendJson(res, 409, { error: "E-CLI-NOT-INSTALLED", message: err.message });
      }
      if (err?.code === "E-CLI-INVALID-TIMEOUT" || err?.code === "E-CLI-INVALID-ENV-KEY") {
        return sendJson(res, 400, { error: err.code, message: err.message });
      }
      if (err?.code === "E-CLI-UNKNOWN-ID") {
        return sendJson(res, 404, { error: "E-CLI-UNKNOWN-ID", message: err.message });
      }
      return sendJson(res, 500, { error: err?.code || "INTERNAL_ERROR", message: err.message });
    }
  }

  return sendJson(res, 404, { error: "NOT_FOUND", message: "Not found" });
}
