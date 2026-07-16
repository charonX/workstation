import { getDb, resetDb } from "../db.js";
import * as settingsService from "./settingsService.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

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

function resolveTilde(inputPath) {
  if (!inputPath || typeof inputPath !== "string") return inputPath;
  if (inputPath === "~") return os.homedir();
  if (inputPath.startsWith("~" + path.sep)) {
    return path.join(os.homedir(), inputPath.slice(2));
  }
  return inputPath;
}

function copyDirRecursive(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function sanitizeSkillName(identifier) {
  return path.basename(identifier).replace(/[^a-zA-Z0-9_-]/g, "_");
}

function parseSkillMarkdown(filePath) {
  try {
    const content = fs.readFileSync(filePath, "utf8");
    const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (!match) {
      return { frontmatter: {}, body: content.trim() };
    }
    const frontmatter = {};
    for (const line of match[1].split("\n")) {
      const idx = line.indexOf(":");
      if (idx > 0) {
        frontmatter[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
      }
    }
    return { frontmatter, body: match[2].trim() };
  } catch {
    return { frontmatter: {}, body: "" };
  }
}

export function createSkill(skill) {
  const db = getDb();
  const id = skill.id || `skill-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  db.prepare(`
    INSERT INTO skills (id, name, description, repoPath, version, dependencies, category, installSource, author, tags, parameters, examples, readme)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    skill.name,
    skill.description ?? null,
    skill.repoPath,
    skill.version ?? null,
    JSON.stringify(skill.dependencies || []),
    skill.category ?? null,
    skill.installSource ?? skill.source ?? null,
    skill.author ?? null,
    JSON.stringify(skill.tags || []),
    JSON.stringify(skill.parameters || []),
    JSON.stringify(skill.examples || []),
    skill.readme ?? null
  );
  return getSkillDetail(id);
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
    installSource: row.installSource,
    tags: JSON.parse(row.tags || "[]"),
    parameters: JSON.parse(row.parameters || "[]"),
    examples: JSON.parse(row.examples || "[]"),
    readme: row.readme,
    tabs: ["Overview", "Parameters", "Examples", "README"]
  };
}

export function installSkill({ source, identifier }) {
  const db = getDb();
  const settings = settingsService.loadSettings();
  const skillRepoPath = resolveTilde(settings.skillRepoPath);

  if (!skillRepoPath) {
    const err = new Error("Skill repository path is not configured");
    err.status = 400;
    throw err;
  }

  let name;
  let repoPath;
  let description = null;
  let readme = null;

  if (source === "local") {
    const sourceDir = resolveTilde(identifier);
    if (!fs.existsSync(sourceDir) || !fs.statSync(sourceDir).isDirectory()) {
      const err = new Error("Local skill path does not exist or is not a directory");
      err.status = 400;
      throw err;
    }

    const skillFilePath = path.join(sourceDir, "SKILL.md");
    if (fs.existsSync(skillFilePath)) {
      const parsed = parseSkillMarkdown(skillFilePath);
      name = parsed.frontmatter.name || path.basename(sourceDir);
      description = parsed.frontmatter.description || null;
      readme = parsed.body || null;
    } else {
      name = path.basename(sourceDir);
    }

    repoPath = path.join(skillRepoPath, name);
    copyDirRecursive(sourceDir, repoPath);
  } else {
    // npm or plugin: create a managed directory under skillRepoPath.
    // TODO: integrate real registry installation (npm pack / plugin marketplace).
    name = sanitizeSkillName(identifier);
    repoPath = path.join(skillRepoPath, name);
    fs.mkdirSync(repoPath, { recursive: true });

    const skillMd = [
      "---",
      `name: ${name}`,
      `description: Installed from ${source}`,
      `installSource: ${source}`,
      `originalIdentifier: ${identifier}`,
      "---",
      "",
      `# ${name}`,
      "",
      `Installed from ${source} identifier: ${identifier}`
    ].join("\n");
    fs.writeFileSync(path.join(repoPath, "SKILL.md"), skillMd);
  }

  const id = `${source}-${name}-${Date.now()}`;
  const insertSkill = db.prepare(`
    INSERT INTO skills (id, name, description, repoPath, version, installSource, readme)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  insertSkill.run(id, name, description, repoPath, null, source, readme);

  return getSkillDetail(id);
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

export function deleteSkill(skillId) {
  const db = getDb();
  const skill = db.prepare("SELECT id FROM skills WHERE id = ?").get(skillId);
  if (!skill) return { deleted: false, reason: "not_found" };

  const linked = db.prepare("SELECT 1 FROM project_skills WHERE skillId = ? LIMIT 1").get(skillId);
  if (linked) return { deleted: false, reason: "linked" };

  db.prepare("DELETE FROM skills WHERE id = ?").run(skillId);
  return { deleted: true };
}
