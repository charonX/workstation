import { get, post } from "./client.js";

export function getSkills() {
  return get("/api/skills");
}

export function getSkill(skillId) {
  return get(`/api/skills/${skillId}`);
}

export function installSkill(body) {
  return post("/api/skills/install", body);
}
