// src/http/routes/mcp.js
// REQ-AGENT-090（支撑）：MCP server HTTP API——mcpService 之上加 HTTP 面（ADR-001
// CLI/HTTP 共享服务层，CLI 即测试 seam）。
//
//   GET    /api/mcp                               → mcpService.list()
//   GET    /api/mcp?project=<id>                  → mcpService.list(projectId) 项目感知（BUG-012）
//   GET    /api/mcp/permission-defaults           → mcpService.listPermissionDefaults（BUG-014 默认层）
//   PUT    /api/mcp/permission-defaults { rules } → mcpService.replacePermissionDefaults（全量替换）
//   GET    /api/mcp/:name/tools                   → mcpService.probeTools（BUG-013 AC7 工具探测）
//   POST   /api/mcp                               → mcpService.create
//   PUT    /api/mcp/:name                         → mcpService.update（BUG-008）
//   DELETE /api/mcp/:name                         → mcpService.remove
//   POST   /api/mcp/:name/project-enable  { projectId, enabled } → mcpService.setProjectEnabled
//   POST   /api/mcp/:name/global-enabled { enabled }             → mcpService.setGlobalEnabled
//
// mcp 的 projectId 是字符串直接存（无 dir 解析，见 mcpService.setProjectEnabled）。
//
import { createMcpService } from "../../services/mcpService.js";
import { ok, badRequest, mapError, notFound, decodeParam, normalizeBool } from "../responders.js";

function getService() {
  return createMcpService();
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

  // REQ-AGENT-087 AC8（BUG-014）：用户级默认权限层——literal 分支必须先于
  // /:name 路由（permission-defaults 为保留字，validateName 拒绝同名 server）。
  if (pathParts.length === 1 && pathParts[0] === "permission-defaults") {
    if (req.method === "GET") {
      try {
        return ok(res, { rules: getService().listPermissionDefaults() });
      } catch (err) {
        return mapError(res, err);
      }
    }
    if (req.method === "PUT") {
      try {
        return ok(res, { rules: getService().replacePermissionDefaults(body?.rules ?? {}) });
      } catch (err) {
        return mapError(res, err);
      }
    }
    return notFound(res);
  }

  const name = decodeParam(pathParts[0]);

  // REQ-AGENT-084 AC7（BUG-013）：工具探测——直连 server 拉 tools/list（即连即断）。
  if (pathParts.length === 2 && pathParts[1] === "tools" && req.method === "GET") {
    try {
      const tools = await getService().probeTools(name);
      return ok(res, { tools });
    } catch (err) {
      // 对齐 PUT/DELETE 先例：不存在 → 404；连接失败等 → 业务错误 4xx。
      if (err?.message?.includes("不存在")) return notFound(res, err.message);
      return mapError(res, err);
    }
  }

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


