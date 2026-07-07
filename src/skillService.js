import { getDb, resetDb } from "./db.js";

export function resetSkills(seed = []) {
  resetDb();
  const db = getDb();
  const insertSkill = db.prepare(`
    INSERT INTO skills (id, name, description, repoPath, version, dependencies, category, installSource, author, tags, parameters, examples, readme)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const skill of seed) {
    insertSkill.run(
      skill.id,
      skill.name,
      skill.description ?? null,
      skill.repoPath,
      skill.version ?? null,
      JSON.stringify(skill.dependencies ?? []),
      skill.category ?? null,
      skill.installSource ?? null,
      skill.author ?? null,
      JSON.stringify(skill.tags ?? []),
      JSON.stringify(skill.parameters ?? []),
      JSON.stringify(skill.examples ?? []),
      skill.readme ?? null
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
    dependencies: JSON.parse(row.dependencies || "[]"),
    category: row.category,
    author: row.author,
    tags: JSON.parse(row.tags || "[]"),
    parameters: JSON.parse(row.parameters || "[]"),
    examples: JSON.parse(row.examples || "[]"),
    readme: row.readme
  };
}

export function getSkillDetail(skillId) {
  const db = getDb();
  const row = db.prepare("SELECT * FROM skills WHERE id = ?").get(skillId);
  if (!row) {
    return undefined;
  }
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    repoPath: row.repoPath,
    version: row.version,
    category: row.category,
    author: row.author,
    tags: JSON.parse(row.tags || "[]"),
    parameters: JSON.parse(row.parameters || "[]"),
    examples: JSON.parse(row.examples || "[]"),
    readme: row.readme,
    tabs: ["Overview", "Parameters", "Examples", "README"]
  };
}

export function installSkill({ source, identifier }) {
  const db = getDb();
  let name;
  let repoPath;
  let id;

  if (source === "local") {
    name = identifier.split("/").pop();
    repoPath = identifier;
    id = `local-${name}-${Date.now()}`;
  } else {
    // npm or plugin
    name = identifier;
    repoPath = `~/.opc-workstation/skills/${name}`;
    id = `${source}-${name}-${Date.now()}`;
  }

  const insertSkill = db.prepare(`
    INSERT INTO skills (id, name, repoPath, version, installSource)
    VALUES (?, ?, ?, ?, ?)
  `);
  insertSkill.run(id, name, repoPath, null, source);

  return {
    id,
    name,
    repoPath,
    version: null,
    installSource: source
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
