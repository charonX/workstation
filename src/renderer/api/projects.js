import { get, post, patch } from "./client.js";

export function getProjects(q) {
  const endpoint = q ? `/api/projects?q=${encodeURIComponent(q)}` : "/api/projects";
  return get(endpoint);
}

export function createProject(body) {
  return post("/api/projects", body);
}

export function getProjectDetail(projectId) {
  return get(`/api/projects/${projectId}`);
}

export function updateProjectSkills(projectId, skillId, linked) {
  return patch(`/api/projects/${projectId}/skills`, { skillId, linked });
}
