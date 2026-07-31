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

export function unlinkProjectSkill(projectId, { slug, skillName }) {
  return del(
    `/api/projects/${encodeURIComponent(projectId)}/skills/${encodeURIComponent(slug)}/${encodeURIComponent(skillName)}`
  );
}

export function resyncProjectSkills(projectId) {
  return post(`/api/projects/${encodeURIComponent(projectId)}/skills/resync`);
}

export function deleteProject(projectId) {
  return del(`/api/projects/${encodeURIComponent(projectId)}`);
}
