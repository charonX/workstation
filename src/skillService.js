import { getDb, resetDb } from "./db.js";

export function resetSkills(seed = []) {
  resetDb();
  const db = getDb();
  const insertSkill = db.prepare(`
    INSERT INTO skills (id, name, description, repoPath, version, dependencies)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  for (const skill of seed) {
    insertSkill.run(
      skill.id,
      skill.name,
      skill.description ?? null,
      skill.repoPath,
      skill.version ?? null,
      JSON.stringify(skill.dependencies ?? [])
    );
  }
}

function rowToSkill(row) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    repoPath: row.repoPath,
    version: row.version,
    dependencies: JSON.parse(row.dependencies || "[]")
  };
}

export function listSkills() {
  const db = getDb();
  return db.prepare("SELECT * FROM skills").all().map(rowToSkill);
}

export function linkSkill(skillId, projectId) {
  const db = getDb();
  const exists = db.prepare(`
    SELECT 1 FROM project_skills WHERE projectId = ? AND skillId = ?
  `).get(projectId, skillId);
  if (!exists) {
    db.prepare(`
      INSERT INTO project_skills (projectId, skillId) VALUES (?, ?)
    `).run(projectId, skillId);
  }
}

export function unlinkSkill(skillId, projectId) {
  const db = getDb();
  db.prepare(`
    DELETE FROM project_skills WHERE projectId = ? AND skillId = ?
  `).run(projectId, skillId);
}

export function getLinkedSkills(projectId) {
  const db = getDb();
  return db.prepare(`
    SELECT skillId FROM project_skills WHERE projectId = ?
  `).all(projectId).map(row => row.skillId);
}
