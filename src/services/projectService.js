import { getDb, resetDb } from "../db.js";

function timestamp() {
  return new Date().toISOString();
}

export function resetProjects(seed = []) {
  resetDb();
  const db = getDb();
  const insert = db.prepare(`
    INSERT INTO projects (id, name, description, sourceType, repoUrl, branch, localPath, updatedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const project of seed) {
    insert.run(
      project.id ?? nextProjectId(),
      project.name,
      project.description ?? null,
      project.sourceType ?? "local",
      project.repoUrl ?? null,
      project.branch ?? null,
      project.localPath ?? null,
      project.updatedAt ?? timestamp()
    );
  }
}

function nextProjectId() {
  const db = getDb();
  const row = db.prepare("SELECT COUNT(*) AS count FROM projects").get();
  return "p" + (row.count + 1);
}

function rowToProject(row) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    sourceType: row.sourceType,
    repoUrl: row.repoUrl,
    branch: row.branch,
    localPath: row.localPath,
    updatedAt: row.updatedAt
  };
}

export function createLocalProject({ name, description, localPath }) {
  if (!name) throw new Error("Project name is required");
  const project = {
    id: nextProjectId(),
    name,
    description,
    sourceType: "local",
    repoUrl: null,
    branch: null,
    localPath,
    updatedAt: timestamp()
  };
  const db = getDb();
  db.prepare(`
    INSERT INTO projects (id, name, description, sourceType, repoUrl, branch, localPath, updatedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    project.id,
    project.name,
    project.description ?? null,
    project.sourceType,
    project.repoUrl,
    project.branch,
    project.localPath,
    project.updatedAt
  );
  return rowToProject(project);
}

export function createGitProject({ name, description, repoUrl, branch, localPath }) {
  if (!name) throw new Error("Project name is required");
  if (!repoUrl) throw new Error("Repository URL is required");
  const project = {
    id: nextProjectId(),
    name,
    description,
    sourceType: "git",
    repoUrl,
    branch: branch || "main",
    localPath,
    updatedAt: timestamp()
  };
  const db = getDb();
  db.prepare(`
    INSERT INTO projects (id, name, description, sourceType, repoUrl, branch, localPath, updatedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    project.id,
    project.name,
    project.description ?? null,
    project.sourceType,
    project.repoUrl,
    project.branch,
    project.localPath,
    project.updatedAt
  );
  return rowToProject(project);
}

export function listProjects() {
  const db = getDb();
  return db.prepare("SELECT * FROM projects").all().map(rowToProject);
}

export function getProjectDetail(projectId) {
  const db = getDb();
  const project = db.prepare("SELECT * FROM projects WHERE id = ?").get(projectId);
  if (!project) return null;
  const flowsCount = db.prepare("SELECT COUNT(*) AS count FROM flows WHERE projectId = ?").get(projectId).count;
  const runsCount = db.prepare("SELECT COUNT(*) AS count FROM executions WHERE projectId = ?").get(projectId).count;
  return {
    id: project.id,
    name: project.name,
    description: project.description,
    sourceType: project.sourceType,
    repoUrl: project.repoUrl,
    branch: project.branch,
    localPath: project.localPath,
    updatedAt: project.updatedAt,
    flowsCount,
    runsCount
  };
}

export function filterProjects(projects, filter) {
  const term = (filter || "").toLowerCase();
  if (!term) return projects;
  return projects.filter(p => p.name.toLowerCase().includes(term));
}
