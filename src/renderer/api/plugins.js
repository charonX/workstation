import { get, post, del } from "./client.js";

// 插件 HTTP API（REQ-AGENT-083/090 支撑面，见 src/http/routes/plugins.js）：
//   GET    /api/plugins[?project=<id>]         → 插件清单（内置 pi-mcp-adapter 行由 HTTP 层合成）
//   POST   /api/plugins { source }             → extensionService.add（成功返回新行）
//   DELETE /api/plugins/:source                → 移除插件
//   POST   /api/plugins/:name/project-enable { projectId, enabled } → 按项目启用
export function listPlugins(projectId) {
  const endpoint = projectId ? `/api/plugins?project=${encodeURIComponent(projectId)}` : "/api/plugins";
  return get(endpoint);
}

export function addPlugin(source) {
  return post("/api/plugins", { source });
}

export function removePlugin(source) {
  return del(`/api/plugins/${encodeURIComponent(source)}`);
}

export function setPluginProjectEnabled(name, projectId, enabled) {
  return post(`/api/plugins/${encodeURIComponent(name)}/project-enable`, {
    projectId,
    enabled: !!enabled,
  });
}

// MCP server HTTP API（REQ-AGENT-084/090 支撑面，见 src/http/routes/mcp.js）：
//   GET    /api/mcp                             → mcpService.list()
//   POST   /api/mcp { name, type, command?, args?, url?, ... } → create
//   DELETE /api/mcp/:name                       → remove
//   POST   /api/mcp/:name/global-enabled { enabled }          → 全局开关
//   POST   /api/mcp/:name/project-enable { projectId, enabled } → 按项目启用
export function listMcpServers() {
  return get("/api/mcp");
}

export function addMcpServer(body) {
  return post("/api/mcp", body);
}

export function removeMcpServer(name) {
  return del(`/api/mcp/${encodeURIComponent(name)}`);
}

export function setMcpGlobalEnabled(name, enabled) {
  return post(`/api/mcp/${encodeURIComponent(name)}/global-enabled`, {
    enabled: !!enabled,
  });
}

export function setMcpProjectEnabled(name, projectId, enabled) {
  return post(`/api/mcp/${encodeURIComponent(name)}/project-enable`, {
    projectId,
    enabled: !!enabled,
  });
}
