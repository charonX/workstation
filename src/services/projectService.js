import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { simpleGit } from "simple-git";
import { getDb, resetDb } from "../db.js";
import * as settingsService from "./settingsService.js";
import * as agentRegistryService from "./agentRegistryService.js";

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
  return crypto.randomUUID();
}

// REQ-WORKSPACE-011: agentTypes is a JSON array of agent registry keys.
// Non-array input and unknown keys are rejected (INVALID_AGENT_TYPES);
// duplicates are removed keeping first-occurrence order; [] is legal
// (semantics: no distribution yet).
export function validateAgentTypes(value) {
  if (!Array.isArray(value)) {
    const err = new Error("agentTypes must be an array of agent registry keys");
    err.status = 400;
    err.code = "INVALID_AGENT_TYPES";
    err.invalidAgents = [];
    throw err;
  }
  const invalidAgents = [...new Set(value.filter((key) => !agentRegistryService.isValidAgentKey(key)))];
  if (invalidAgents.length > 0) {
    const err = new Error(`Unknown agent types: ${invalidAgents.join(", ")}`);
    err.status = 400;
    err.code = "INVALID_AGENT_TYPES";
    err.invalidAgents = invalidAgents;
    throw err;
  }
  return [...new Set(value)];
}

function parseAgentTypes(raw) {
  try {
    const parsed = JSON.parse(raw || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
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
    agentTypes: parseAgentTypes(row.agentTypes),
    updatedAt: row.updatedAt
  };
}

function insertProject(db, project) {
  db.prepare(`
    INSERT INTO projects (id, name, description, sourceType, repoUrl, branch, localPath, agentTypes, updatedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    project.id,
    project.name,
    project.description ?? null,
    project.sourceType,
    project.repoUrl ?? null,
    project.branch ?? null,
    project.localPath ?? null,
    JSON.stringify(project.agentTypes ?? []),
    project.updatedAt
  );
  return rowToProject(project);
}

export function createLocalProject({ name, description, localPath, agentTypes }) {
  if (!name) throw new Error("Project name is required");
  const project = {
    id: nextProjectId(),
    name,
    description,
    sourceType: "local",
    repoUrl: null,
    branch: null,
    localPath,
    agentTypes: agentTypes === undefined ? [] : validateAgentTypes(agentTypes),
    updatedAt: timestamp()
  };
  const db = getDb();
  return insertProject(db, project);
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

export async function createGitProject({ name, description, repoUrl, branch, cloneDirectory, agentTypes }) {
  if (!repoUrl) throw new Error("Repository URL is required");

  const repoName = deriveRepoName(repoUrl);
  const projectName = name || repoName;
  if (!projectName) throw new Error("Project name is required and could not be derived from repository URL");

  const settings = settingsService.loadSettings();
  const workspaceRoot = expandHome(settings.workspaceRoot);
  if (!workspaceRoot) throw new Error("Workspace root is not configured");

  const targetDirName = cloneDirectory || repoName;
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
    agentTypes: agentTypes === undefined ? [] : validateAgentTypes(agentTypes),
    updatedAt: timestamp()
  };
  const db = getDb();
  return insertProject(db, project);
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
    agentTypes: parseAgentTypes(project.agentTypes),
    updatedAt: project.updatedAt,
    flowsCount,
    runsCount
  };
}

// PUT /api/projects/:id backing store: partial update of name/description/
// agentTypes. Returns the updated project detail, or null when unknown.
// agentTypes convergence (link migration on change) is executed by the caller.
export function updateProject(projectId, fields = {}) {
  const db = getDb();
  const existing = db.prepare("SELECT * FROM projects WHERE id = ?").get(projectId);
  if (!existing) return null;

  const sets = [];
  const values = [];
  if (Object.prototype.hasOwnProperty.call(fields, "name")) {
    if (typeof fields.name !== "string" || fields.name.trim() === "") {
      const err = new Error("Project name is required");
      err.status = 400;
      throw err;
    }
    sets.push("name = ?");
    values.push(fields.name);
  }
  if (Object.prototype.hasOwnProperty.call(fields, "description")) {
    sets.push("description = ?");
    values.push(fields.description ?? null);
  }
  if (Object.prototype.hasOwnProperty.call(fields, "agentTypes")) {
    sets.push("agentTypes = ?");
    values.push(JSON.stringify(validateAgentTypes(fields.agentTypes)));
  }
  if (sets.length > 0) {
    sets.push("updatedAt = ?");
    values.push(timestamp());
    values.push(projectId);
    db.prepare(`UPDATE projects SET ${sets.join(", ")} WHERE id = ?`).run(...values);
  }
  return getProjectDetail(projectId);
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
  db.prepare("DELETE FROM projects WHERE id = ?").run(projectId);
  return true;
}
