// src/http/routes/mcp.js
// REQ-AGENT-090（支撑）：MCP server HTTP API——mcpService 之上加 HTTP 面（ADR-001
// CLI/HTTP 共享服务层，CLI 即测试 seam）。
//
//   GET    /api/mcp                               → mcpService.list()
//   GET    /api/mcp?project=<id>                  → mcpService.list(projectId) 项目感知（BUG-012）
//   POST   /api/mcp                               → mcpService.create
//   PUT    /api/mcp/:name                         → mcpService.update（BUG-008）
//   DELETE /api/mcp/:name                         → mcpService.remove
//   POST   /api/mcp/:name/project-enable  { projectId, enabled } → mcpService.setProjectEnabled
//   POST   /api/mcp/:name/global-enabled { enabled }             → mcpService.setGlobalEnabled
//
// mcp 的 projectId 是字符串直接存（无 dir 解析，见 mcpService.setProjectEnabled）。
//
// 本文件同时拥有并导出 plugins/mcp 共用的 HTTP 响应助手（ok/badRequest/mapError/
// notFound/decodeParam/normalizeBool），plugins.js 依赖本模块（重 → 轻依赖方向）。
// 长期应上移到独立 src/http/routes/_respond.js 并让 skills/settings 等路由复用。

import { createMcpService } from "../../services/mcpService.js";

function getService() {
  return createMcpService();
}

export function normalizeBool(value) {
  return value === true || value === "true";
}

export async function handleMcp(req, res, body, pathParts) {
  if (pathParts.length === 0) {
    if (req.method === "GET") {
      try {
        // BUG-012：?project=<id> 项目感知清单（对齐 plugins.js:129 先例）——
        // 项目启用弹层的真实启用态数据源。
        const url = new URL(req.url, `http://${req.headers.host}`);
        const projectId = url.searchParams.get("project") || undefined;
        return ok(res, getService().list(projectId));
      } catch (err) {
        return mapError(res, err);
      }
    }
    if (req.method === "POST") {
      try {
        return ok(res, await getService().create(body || {}));
      } catch (err) {
        return mapError(res, err);
      }
    }
    return notFound(res);
  }

  const name = decodeParam(pathParts[0]);

  // REQ-AGENT-084 CRUD-U（BUG-008）：PUT 编辑 server（部分字段补丁；token 缺省=保留）。
  if (pathParts.length === 1 && req.method === "PUT") {
    try {
      return ok(res, await getService().update(name, body || {}));
    } catch (err) {
      // 对齐 DELETE 先例：不存在 → 404（service 对缺失名抛「不存在」文案错误）。
      if (err?.message?.includes("不存在")) return notFound(res, err.message);
      return mapError(res, err);
    }
  }

  if (pathParts.length === 1 && req.method === "DELETE") {
    try {
      const removed = getService().remove(name);
      if (!removed) return notFound(res, `MCP server not found: ${name}`);
      return ok(res, { removed: true, name });
    } catch (err) {
      return mapError(res, err);
    }
  }

  if (pathParts.length === 2 && pathParts[1] === "project-enable" && req.method === "POST") {
    const { projectId, enabled } = body || {};
    if (!projectId) return badRequest(res, "projectId is required");
    try {
      return ok(res, getService().setProjectEnabled(projectId, name, normalizeBool(enabled)));
    } catch (err) {
      return mapError(res, err);
    }
  }

  if (pathParts.length === 2 && pathParts[1] === "global-enabled" && req.method === "POST") {
    const { enabled } = body || {};
    try {
      return ok(res, getService().setGlobalEnabled(name, normalizeBool(enabled)));
    } catch (err) {
      return mapError(res, err);
    }
  }

  return notFound(res);
}

export function decodeParam(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function ok(res, data) {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

export function badRequest(res, message) {
  res.writeHead(400, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "VALIDATION_ERROR", message }));
}

// 业务错误 → 4xx + JSON { error, message }（CLI 侧 stderr 展示，退出码非零）。
export function mapError(res, err) {
  const status = err.status || 400;
  const body = { error: err.code || (status === 500 ? "INTERNAL_ERROR" : "VALIDATION_ERROR"), message: err.message };
  res.writeHead(status, { "Content-Type": "application/json" });
  return res.end(JSON.stringify(body));
}

export function notFound(res, message = "Not found") {
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "NOT_FOUND", message }));
}
