import { get, post, put, del } from "./client.js";

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
//   PUT    /api/mcp/:name { 部分字段 }           → update（BUG-008；token 缺省=保留）
//   DELETE /api/mcp/:name                       → remove
//   POST   /api/mcp/:name/global-enabled { enabled }          → 全局开关
//   POST   /api/mcp/:name/project-enable { projectId, enabled } → 按项目启用
//   GET    /api/mcp/:name/tools → probeTools（BUG-013 AC7：直连拉 tools/list，{ tools: [...] }）
export function listMcpServers(projectId) {
  // BUG-012：带 projectId 时走项目感知清单（row.enabled = 该项目启用态）——
  // 对齐 listPlugins(projectId) 先例；无参保持全局开关语义。
  const endpoint = projectId ? `/api/mcp?project=${encodeURIComponent(projectId)}` : "/api/mcp";
  return get(endpoint);
}

export function addMcpServer(body) {
  return post("/api/mcp", body);
}

export function updateMcpServer(name, body) {
  return put(`/api/mcp/${encodeURIComponent(name)}`, body);
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

// BUG-013（REQ-AGENT-084 AC7）：工具探测——直连 server 拉 tools/list；
// 连接失败时 get() 抛业务错误（message 含「连接失败」），调用方呈弹窗错误态。
export function listMcpTools(name) {
  return get(`/api/mcp/${encodeURIComponent(name)}/tools`);
}
