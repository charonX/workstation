import { getDb, resetDb } from "../db.js";
import * as settingsService from "./settingsService.js";
import { spawn } from "node:child_process";
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

const installJobs = new Map();

function emitJobEvent(job, event) {
  if (event.type === "log") {
    job.logs.push(event.text);
  } else if (event.type === "success") {
    job.status = "success";
    job.skill = event.skill;
  } else if (event.type === "error") {
    job.status = "error";
    job.errorMessage = event.message;
  }
  for (const listener of job.listeners) {
    listener(event);
  }
}

function runCommand(command, args, cwd, job) {
  const cmd = process.platform === "win32" ? `${command}.cmd` : command;
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, shell: process.platform === "win32" });
    const push = (data) => {
      for (const line of data.toString().split(/\r?\n/)) {
        if (line.length > 0) emitJobEvent(job, { type: "log", text: line });
      }
    };
    child.stdout.on("data", push);
    child.stderr.on("data", push);
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Command failed with exit code ${code}`));
    });
  });
}

function guessPackageName(identifier, dependencies) {
  if (dependencies.length === 0) return null;
  const base = path.basename(identifier);
  if (dependencies.includes(base)) return base;
  const nameOnly = identifier.replace(/@[^@/]+$/, "");
  if (dependencies.includes(nameOnly)) return nameOnly;
  return dependencies[0];
}

async function runInstallJob(job, { source, identifier }) {
  try {
    job.status = "running";

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

      const parsed = parseSkillMarkdown(path.join(sourceDir, "SKILL.md"));
      name = parsed.frontmatter.name || path.basename(sourceDir);
      description = parsed.frontmatter.description || null;
      readme = parsed.body || null;
      repoPath = path.join(skillRepoPath, name);

      emitJobEvent(job, { type: "log", text: `Copying local skill from ${sourceDir} to ${repoPath}` });
      fs.cpSync(sourceDir, repoPath, { recursive: true, force: true, dereference: true });
      emitJobEvent(job, { type: "log", text: "Local skill copied successfully" });
    } else if (source === "npm") {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opc-skill-install-"));
      emitJobEvent(job, { type: "log", text: `Running npm install --prefix ${tempDir} ${identifier}` });
      await runCommand("npm", ["install", "--prefix", tempDir, identifier], undefined, job);
      emitJobEvent(job, { type: "log", text: "npm install completed; resolving installed package" });

      const tempPackageJson = JSON.parse(fs.readFileSync(path.join(tempDir, "package.json"), "utf8"));
      const dependencies = Object.keys(tempPackageJson.dependencies || {});
      const packageName = guessPackageName(identifier, dependencies);
      if (!packageName) {
        throw new Error("npm install did not produce any dependencies");
      }

      const installedDir = path.join(tempDir, "node_modules", packageName);
      if (!fs.existsSync(installedDir)) {
        throw new Error(`Installed package directory not found: ${installedDir}`);
      }

      const pkgJson = JSON.parse(fs.readFileSync(path.join(installedDir, "package.json"), "utf8"));
      const parsed = parseSkillMarkdown(path.join(installedDir, "SKILL.md"));
      name = parsed.frontmatter.name || pkgJson.name || path.basename(identifier);
      description = parsed.frontmatter.description || pkgJson.description || null;
      readme = parsed.body || null;
      repoPath = path.join(skillRepoPath, name);

      emitJobEvent(job, { type: "log", text: `Copying installed package to ${repoPath}` });
      fs.cpSync(installedDir, repoPath, { recursive: true, force: true, dereference: true });
      emitJobEvent(job, { type: "log", text: "Installed package copied successfully" });
    } else if (source === "plugin") {
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
      emitJobEvent(job, { type: "log", text: `Created managed plugin directory at ${repoPath}` });
    } else {
      throw new Error(`Unsupported install source: ${source}`);
    }

    const skill = createSkill({ name, description, repoPath, version: null, installSource: source, readme });
    emitJobEvent(job, { type: "success", skill });
  } catch (err) {
    emitJobEvent(job, { type: "error", message: err.message });
  }
}

export function startInstallJob(body) {
  const { source, identifier } = body || {};
  if (!source || !identifier) {
    const err = new Error("source and identifier are required");
    err.status = 400;
    throw err;
  }

  const settings = settingsService.loadSettings();
  if (!resolveTilde(settings.skillRepoPath)) {
    const err = new Error("Skill repository path is not configured");
    err.status = 400;
    throw err;
  }

  const job = {
    id: `install-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    status: "pending",
    logs: [],
    listeners: new Set()
  };
  installJobs.set(job.id, job);
  runInstallJob(job, { source, identifier });
  return { jobId: job.id };
}

export function getInstallJob(jobId) {
  return installJobs.get(jobId);
}

export function subscribeInstallJob(jobId, listener) {
  const job = installJobs.get(jobId);
  if (!job) return undefined;
  for (const text of job.logs) {
    listener({ type: "log", text });
  }
  if (job.status === "success") {
    listener({ type: "success", skill: job.skill });
  }
  if (job.status === "error") {
    listener({ type: "error", message: job.errorMessage });
  }
  job.listeners.add(listener);
  return () => job.listeners.delete(listener);
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
