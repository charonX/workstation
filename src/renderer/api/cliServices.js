import { get, put } from "./client.js";

/**
 * 列出所有 CLI 服务清单及探测状态
 * @param {Object} [options]
 * @param {boolean} [options.refresh=false] 是否强制绕过缓存重新探测
 * @param {string|null} [options.projectId=null] 可选项目 ID，用于获取项目级启用态
 */
export function listCliServices({ refresh = false, projectId = null } = {}) {
  const params = new URLSearchParams();
  if (refresh) params.set("refresh", "1");
  if (projectId) params.set("project", projectId);
  const qs = params.toString();
  return get(qs ? `/api/cli-services?${qs}` : "/api/cli-services");
}

/**
 * 更新指定 CLI 服务的全局配置（启用态、环境变量、超时等）
 * @param {string} id CLI 服务 ID (claude, codex, crawl4ai)
 * @param {Object} body
 * @param {boolean} [body.enabled]
 * @param {Record<string, string>} [body.env]
 * @param {number} [body.timeoutSec]
 */
export function updateCliService(id, body) {
  return put(`/api/cli-services/${encodeURIComponent(id)}`, body);
}

/**
 * 设置指定 CLI 服务在特定项目中的启用状态
 * @param {string} id CLI 服务 ID
 * @param {string} projectId 项目 ID
 * @param {boolean} enabled 是否启用
 */
export function setCliServiceProjectEnabled(id, projectId, enabled) {
  return put(`/api/cli-services/${encodeURIComponent(id)}/projects/${encodeURIComponent(projectId)}`, {
    enabled: Boolean(enabled),
  });
}

/**
 * 获取所有 CLI 服务的项目启用映射聚合关系
 */
export function getCliServiceProjectEnablements() {
  return get("/api/cli-services/project-enablements");
}

