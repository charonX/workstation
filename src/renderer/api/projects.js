import { get, post, put, del } from "./client.js";

export function getProjects(q) {
  const endpoint = q ? `/api/projects?q=${encodeURIComponent(q)}` : "/api/projects";
  return get(endpoint);
}

export function createProject(body) {
  return post("/api/projects", body);
}

// PUT /api/projects/:id — partial update; agentTypes triggers server-side
// convergence and the response includes the updated project + {convergence}.
export function putProject(projectId, body) {
  return put(`/api/projects/${encodeURIComponent(projectId)}`, body);
}

export function getProjectDetail(projectId) {
  return get(`/api/projects/${encodeURIComponent(projectId)}`);
}

// Project skills: live view of declared agent dirs (REQ-SKILL-012).
export function getProjectSkills(projectId) {
  return get(`/api/projects/${encodeURIComponent(projectId)}/skills`);
}

export function linkProjectSkill(projectId, { slug, skillName }) {
  return post(`/api/projects/${encodeURIComponent(projectId)}/skills`, { slug, skillName });
}

// Bulk link/unlink (REQ-SKILL-010 AC8 / REQ-SKILL-011 AC5). The endpoints
// also accept the single-object / path-segment forms for backward compat.
export function linkProjectSkills(projectId, skills) {
  return post(`/api/projects/${encodeURIComponent(projectId)}/skills`, { skills });
}

export function unlinkProjectSkill(projectId, { slug, skillName }) {
  return del(
    `/api/projects/${encodeURIComponent(projectId)}/skills/${encodeURIComponent(slug)}/${encodeURIComponent(skillName)}`
  );
}

export function unlinkProjectSkills(projectId, skills) {
  return del(`/api/projects/${encodeURIComponent(projectId)}/skills`, { skills });
}

export function resyncProjectSkills(projectId) {
  return post(`/api/projects/${encodeURIComponent(projectId)}/skills/resync`);
}

export function deleteProject(projectId) {
  return del(`/api/projects/${encodeURIComponent(projectId)}`);
}

// —— PI 权限配置（REQ-AGENT-059~068，2026-08-10-pi-permission-config-ui）——
// GET → {global, project, merged, rules[]}（继承视图数据面，tech-design §3.1）；
// project=null = 未配置（UI 空态）。
export function getProjectPermission(projectId) {
  return get(`/api/projects/${encodeURIComponent(projectId)}/permission`);
}

// PUT body = 完整项目配置 JSON → {saved, mtime}。400 E-PERMISSION-INVALID 时抛
// {code, message, issues:[{path, message}]}（client.js 已透传 code/issues——
// 权限端点错误响应带顶层 `code` 字段，permission 面内自定义字段原样写、
// 顶层未知键拒绝保存，裁决 A）。
export function putProjectPermission(projectId, config) {
  return put(`/api/projects/${encodeURIComponent(projectId)}/permission`, config);
}
