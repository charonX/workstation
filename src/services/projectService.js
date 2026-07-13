import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { simpleGit } from "simple-git";
import { getDb, resetDb } from "../db.js";
import * as settingsService from "./settingsService.js";

function timestamp() {
  return new Date().toISOString();
}

function expandHome(filePath) {
  if (typeof filePath !== "string") return filePath;
  if (filePath === "~" || filePath.startsWith("~/")) {
    return path.join(os.homedir(), filePath.slice(1));
  }
  return filePath;
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

function deriveRepoName(repoUrl) {
  if (!repoUrl) return "";
  try {
    const url = new URL(repoUrl);
    // Strip trailing ".git" so file://path/to/repo/.git yields "repo".
    const normalized = url.pathname.replace(/\.git$/i, "");
    const baseName = path.basename(normalized);
    return baseName.replace(/\.git$/i, "");
  } catch {
    // Fallback for SCP-like URLs such as git@github.com:owner/repo.git
    const match = repoUrl.match(/[:/]([^/]+?)(?:\.git)?$/i);
    return match ? match[1] : "";
  }
}

export async function createGitProject({ name, description, repoUrl, branch, cloneDirectory }) {
  if (!repoUrl) throw new Error("Repository URL is required");

  const repoName = deriveRepoName(repoUrl);
  const projectName = name || repoName;
  if (!projectName) throw new Error("Project name is required and could not be derived from repository URL");

  const settings = settingsService.loadSettings();
  const workspaceRoot = expandHome(settings.workspaceRoot);
  if (!workspaceRoot) throw new Error("Workspace root is not configured");

  const targetDirName = cloneDirectory || projectName;
  const localPath = path.join(workspaceRoot, targetDirName);

  fs.mkdirSync(workspaceRoot, { recursive: true });

  if (fs.existsSync(localPath)) {
    throw new Error(`Target directory already exists: ${localPath}`);
  }

  const git = simpleGit();
  await git.clone(repoUrl, localPath, {
    "--branch": branch || "main",
    "--single-branch": null
  });

  const project = {
    id: nextProjectId(),
    name: projectName,
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

export function deleteProject(projectId) {
  const db = getDb();
  const project = db.prepare("SELECT id FROM projects WHERE id = ?").get(projectId);
  if (!project) return false;

  db.prepare("DELETE FROM logs WHERE executionId IN (SELECT id FROM executions WHERE projectId = ?)").run(projectId);
  db.prepare("DELETE FROM executions WHERE projectId = ?").run(projectId);
  db.prepare("DELETE FROM schedules WHERE projectId = ?").run(projectId);
  db.prepare("DELETE FROM flows WHERE projectId = ?").run(projectId);
  db.prepare("DELETE FROM project_skills WHERE projectId = ?").run(projectId);
  db.prepare("DELETE FROM projects WHERE id = ?").run(projectId);
  return true;
}
