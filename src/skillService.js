// Temporary stub for test compilation.

let skills = [];
let links = [];

export function resetSkills(seed = []) {
  skills = seed.map(s => ({ ...s }));
  links = [];
}

export function listSkills() {
  return skills.map(s => ({ ...s }));
}

export function linkSkill(skillId, projectId) {
  if (!links.some(l => l.skillId === skillId && l.projectId === projectId)) {
    links.push({ skillId, projectId });
  }
}

export function unlinkSkill(skillId, projectId) {
  links = links.filter(l => !(l.skillId === skillId && l.projectId === projectId));
}

export function getLinkedProjects(skillId) {
  return links.filter(l => l.skillId === skillId).map(l => l.projectId);
}
