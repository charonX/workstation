// src/http/routes/mcp.js
// REQ-AGENT-090（支撑）：MCP server HTTP API——mcpService 之上加 HTTP 面（ADR-001
// CLI/HTTP 共享服务层，CLI 即测试 seam）。
//
//   GET    /api/mcp                               → mcpService.list()
//   POST   /api/mcp                               → mcpService.create
//   DELETE /api/mcp/:name                         → mcpService.remove
//   POST   /api/mcp/:name/project-enable  { projectId, enabled } → mcpService.setProjectEnabled
//   POST   /api/mcp/:name/global-enabled { enabled }             → mcpService.setGlobalEnabled
//
// mcp 的 projectId 是字符串直接存（无 dir 解析，见 mcpService.setProjectEnabled）。

import { createMcpService } from "../../services/mcpService.js";

function getService() {
  return createMcpService();
}

function normalizeBool(value) {
  return value === true || value === "true";
}

export async function handleMcp(req, res, body, pathParts) {
  if (pathParts.length === 0) {
    if (req.method === "GET") {
      try {
        return ok(res, getService().list());
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

function decodeParam(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function ok(res, data) {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

function badRequest(res, message) {
  res.writeHead(400, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "VALIDATION_ERROR", message }));
}

// 业务错误 → 4xx + JSON { error, message }（CLI 侧 stderr 展示，退出码非零）。
function mapError(res, err) {
  const status = err.status || 400;
  const body = { error: err.code || (status === 500 ? "INTERNAL_ERROR" : "VALIDATION_ERROR"), message: err.message };
  res.writeHead(status, { "Content-Type": "application/json" });
  return res.end(JSON.stringify(body));
}

function notFound(res, message = "Not found") {
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "NOT_FOUND", message }));
}
