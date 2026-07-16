import { getDb, resetDb } from "../db.js";
import * as settingsService from "./settingsService.js";
import * as projectService from "./projectService.js";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function resetSkills(seed = []) {
  resetDb();
  const db = getDb();
  const insertSkill = db.prepare(`
    INSERT INTO skills (id, repoId, name, description, repoPath, version, dependencies, category, author, tags, parameters, examples, readme)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const skill of seed) {
    insertSkill.run(
      skill.id,
      skill.repoId ?? "legacy-repo",
      skill.name,
      skill.description ?? null,
      skill.repoPath,
      skill.version ?? null,
      JSON.stringify(skill.dependencies ?? []),
      skill.category ?? null,
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
    repoId: row.repoId,
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

function rowToRepo(row) {
  return {
    id: row.id,
    name: row.name,
    repoPath: row.repoPath,
    installSource: row.installSource,
    originalIdentifier: row.originalIdentifier,
    createdAt: row.createdAt
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

function parseScalar(raw) {
  if (raw == null) return "";
  const v = raw.trim();
  return v.replace(/^["']|["']$/g, "");
}

function parseList(raw) {
  if (raw == null) return [];
  const v = raw.trim();
  if (!v) return [];
  if (v.startsWith("[") && v.endsWith("]")) {
    return v
      .slice(1, -1)
      .split(",")
      .map(s => s.trim())
      .filter(Boolean)
      .map(s => s.replace(/^["']|["']$/g, ""));
  }
  const lines = v.split("\n").map(l => l.trim()).filter(Boolean);
  if (lines.length > 0 && lines.every(l => l.startsWith("-"))) {
    return lines
      .map(l => l.replace(/^-\s*/, "").trim())
      .filter(Boolean)
      .map(s => s.replace(/^["']|["']$/g, ""));
  }
  if (v.includes(",")) {
    return v
      .split(",")
      .map(s => s.trim())
      .filter(Boolean)
      .map(s => s.replace(/^["']|["']$/g, ""));
  }
  return [parseScalar(raw)];
}

function parseFrontmatter(text) {
  const result = {};
  const lines = text.split("\n");
  let currentKey = null;
  const currentRaw = [];

  function flush() {
    if (currentKey) {
      result[currentKey] = currentRaw.join("\n").trim();
      currentRaw.length = 0;
    }
  }

  for (const line of lines) {
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (match) {
      flush();
      currentKey = match[1];
      currentRaw.push(match[2]);
    } else if (currentKey) {
      currentRaw.push(line);
    }
  }
  flush();
  return result;
}

function parseSkillMarkdown(filePath) {
  try {
    const content = fs.readFileSync(filePath, "utf8");
    const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (!match) {
      return { frontmatter: {}, body: content.trim() };
    }
    return { frontmatter: parseFrontmatter(match[1]), body: match[2].trim() };
  } catch {
    return { frontmatter: {}, body: "" };
  }
}

function findRepoSkillDirs(repoRoot) {
  const skillsDir = path.join(repoRoot, "skills");
  if (!fs.existsSync(skillsDir) || !fs.statSync(skillsDir).isDirectory()) {
    return [];
  }

  const results = [];
  function walk(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    let hasSkillMd = false;
    for (const entry of entries) {
      if (entry.isDirectory()) {
        walk(path.join(dir, entry.name));
      } else if (entry.name.toLowerCase() === "SKILL.md".toLowerCase()) {
        hasSkillMd = true;
      }
    }
    if (hasSkillMd) {
      results.push(dir);
    }
  }
  walk(skillsDir);
  return results;
}

function scanRepoSkills(repoRoot) {
  const skillDirs = findRepoSkillDirs(repoRoot);
  return skillDirs.map((dir) => {
    const parsed = parseSkillMarkdown(path.join(dir, "SKILL.md"));
    const relativePath = path.relative(repoRoot, dir);
    return {
      name: parsed.frontmatter.name || path.basename(dir),
      description: parsed.frontmatter.description || null,
      category: parsed.frontmatter.category || null,
      author: parsed.frontmatter.author || null,
      version: parsed.frontmatter.version || null,
      repoPath: relativePath,
      tags: parseList(parsed.frontmatter.tags || ""),
      dependencies: parseList(parsed.frontmatter.dependencies || ""),
      readme: parsed.body || null
    };
  });
}

export function createSkillRepo({ name, repoPath, installSource, originalIdentifier }) {
  const db = getDb();
  const id = `repo-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  db.prepare(`
    INSERT INTO skill_repos (id, name, repoPath, installSource, originalIdentifier, createdAt)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, name, repoPath, installSource, originalIdentifier ?? null, new Date().toISOString());
  return getSkillRepo(id);
}

export function getSkillRepo(repoId) {
  const db = getDb();
  const row = db.prepare("SELECT * FROM skill_repos WHERE id = ?").get(repoId);
  return row ? rowToRepo(row) : undefined;
}

export function getSkillRepoByPath(repoPath) {
  const db = getDb();
  const row = db.prepare("SELECT * FROM skill_repos WHERE repoPath = ?").get(repoPath);
  return row ? rowToRepo(row) : undefined;
}

export function createSkill(skill, repoId) {
  const db = getDb();
  const id = skill.id || `skill-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  db.prepare(`
    INSERT INTO skills (id, repoId, name, description, repoPath, version, dependencies, category, author, tags, parameters, examples, readme)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    repoId,
    skill.name,
    skill.description ?? null,
    skill.repoPath,
    skill.version ?? null,
    JSON.stringify(skill.dependencies || []),
    skill.category ?? null,
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
    ...rowToSkill(row),
    tabs: ["Overview", "Parameters", "Examples", "README"]
  };
}

export function listSkills() {
  const db = getDb();
  return db.prepare("SELECT * FROM skills").all().map(rowToSkill);
}

export function listLinkableSkills() {
  const db = getDb();
  const validRepoIds = new Set(
    db.prepare("SELECT id FROM skill_repos").all().map((row) => row.id)
  );
  return db
    .prepare("SELECT * FROM skills")
    .all()
    .map(rowToSkill)
    .filter((skill) => validRepoIds.has(skill.repoId));
}

export function listSkillRepos() {
  const db = getDb();
  const repos = db.prepare("SELECT * FROM skill_repos ORDER BY createdAt DESC").all().map(rowToRepo);
  const skills = db.prepare("SELECT * FROM skills").all().map(rowToSkill);
  const byRepo = new Map(repos.map((r) => [r.id, []]));
  for (const skill of skills) {
    byRepo.get(skill.repoId)?.push(skill);
  }
  return repos.map((repo) => ({ repo, skills: byRepo.get(repo.id) || [] }));
}

const installJobs = new Map();

function emitJobEvent(job, event) {
  if (event.type === "log") {
    job.logs.push(event.text);
  } else if (event.type === "success") {
    job.status = "success";
    job.result = { repo: event.repo, skills: event.skills };
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

function recordRepoAndSkills(repoPath, { name, installSource, originalIdentifier }, job) {
  const skillDirs = findRepoSkillDirs(repoPath);
  if (skillDirs.length === 0) {
    throw new Error(`Installed repo does not contain any skill directories with SKILL.md under skills/`);
  }

  const repo = createSkillRepo({ name, repoPath, installSource, originalIdentifier });
  const skills = [];
  for (const skillData of scanRepoSkills(repoPath)) {
    skills.push(createSkill(skillData, repo.id));
  }
  emitJobEvent(job, { type: "success", repo, skills });
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

    if (source === "local") {
      const err = new Error("Local install source is not supported");
      err.status = 400;
      throw err;
    }

    if (source === "npm") {
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
      const name = pkgJson.name || packageName;
      const repoPath = path.join(skillRepoPath, sanitizeSkillName(name));

      emitJobEvent(job, { type: "log", text: `Copying installed package to ${repoPath}` });
      fs.cpSync(installedDir, repoPath, { recursive: true, force: true, dereference: true });
      emitJobEvent(job, { type: "log", text: "Installed package copied successfully" });

      recordRepoAndSkills(repoPath, { name, installSource: source, originalIdentifier: identifier }, job);
    } else if (source === "plugin") {
      const name = sanitizeSkillName(identifier);
      const repoPath = path.join(skillRepoPath, name);
      const skillDir = path.join(repoPath, "skills", name);
      fs.mkdirSync(skillDir, { recursive: true });

      const skillMd = [
        "---",
        `name: ${name}`,
        `description: Installed from plugin`,
        "---",
        "",
        `# ${name}`,
        "",
        `Installed from plugin identifier: ${identifier}`
      ].join("\n");
      fs.writeFileSync(path.join(skillDir, "SKILL.md"), skillMd);
      emitJobEvent(job, { type: "log", text: `Created managed plugin directory at ${repoPath}` });

      recordRepoAndSkills(repoPath, { name, installSource: source, originalIdentifier: identifier }, job);
    } else {
      throw new Error(`Unsupported install source: ${source}`);
    }
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

  if (source === "local") {
    const err = new Error("Local install source is not supported");
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
    listener({ type: "success", repo: job.result.repo, skills: job.result.skills });
  }
  if (job.status === "error") {
    listener({ type: "error", message: job.errorMessage });
  }
  job.listeners.add(listener);
  return () => job.listeners.delete(listener);
}

function expandHome(filePath) {
  if (typeof filePath !== "string") return filePath;
  if (filePath === "~" || filePath.startsWith("~/")) {
    return path.join(os.homedir(), filePath.slice(1));
  }
  return filePath;
}

function skillRepoSkillDir(skill) {
  const repo = getSkillRepo(skill.repoId);
  if (!repo) return null;
  return path.join(repo.repoPath, skill.repoPath);
}

function skillSymlinkPaths(skill, project) {
  if (!project?.localPath) return null;
  const repo = getSkillRepo(skill.repoId);
  if (!repo) return null;
  const targetDir = path.join(repo.repoPath, skill.repoPath);
  const linkDir = path.join(
    expandHome(project.localPath),
    ".opc",
    "skills",
    repo.name.replace(/[^a-zA-Z0-9_-]/g, "_")
  );
  const linkPath = path.join(linkDir, skill.name.replace(/[^a-zA-Z0-9_-]/g, "_"));
  return { targetDir, linkDir, linkPath };
}

function createSkillSymlink(skill, project) {
  const paths = skillSymlinkPaths(skill, project);
  if (!paths) return;
  fs.mkdirSync(paths.linkDir, { recursive: true });
  const existing = fs.lstatSync(paths.linkPath, { throwIfNoEntry: false });
  if (existing) {
    fs.rmSync(paths.linkPath, { recursive: true, force: true });
  }
  fs.symlinkSync(paths.targetDir, paths.linkPath, process.platform === "win32" ? "junction" : "dir");
}

function removeSkillSymlink(skill, project) {
  const paths = skillSymlinkPaths(skill, project);
  if (!paths) return;
  const existing = fs.lstatSync(paths.linkPath, { throwIfNoEntry: false });
  if (existing) {
    fs.rmSync(paths.linkPath, { recursive: true, force: true });
  }
}

function resolveDependencySkill(raw, allSkills) {
  const byId = allSkills.find((s) => s.id === raw);
  if (byId) return byId;
  return allSkills.find((s) => s.name === raw);
}

export function linkSkill(skillId, projectId, visited = new Set()) {
  if (visited.has(skillId)) return;
  visited.add(skillId);

  const db = getDb();
  const exists = db.prepare(`
    SELECT 1 FROM project_skills WHERE projectId = ? AND skillId = ?
  `).get(projectId, skillId);
  if (!exists) {
    db.prepare(`
      INSERT INTO project_skills (projectId, skillId) VALUES (?, ?)
    `).run(projectId, skillId);
  }

  const skill = getSkillDetail(skillId);
  const project = projectService.getProjectDetail(projectId);
  if (skill && project) {
    createSkillSymlink(skill, project);
  }

  if (skill?.dependencies?.length > 0) {
    const allSkills = listLinkableSkills();
    for (const dep of skill.dependencies) {
      const depSkill = resolveDependencySkill(dep, allSkills);
      if (depSkill) {
        linkSkill(depSkill.id, projectId, visited);
      }
    }
  }
}

export function unlinkSkill(skillId, projectId) {
  const db = getDb();
  const skill = getSkillDetail(skillId);
  const project = projectService.getProjectDetail(projectId);
  if (skill && project) {
    removeSkillSymlink(skill, project);
  }
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

export function deleteSkillRepo(repoId) {
  const db = getDb();
  const repo = db.prepare("SELECT * FROM skill_repos WHERE id = ?").get(repoId);
  if (!repo) return { deleted: false, reason: "not_found" };

  const skillIds = db.prepare("SELECT id FROM skills WHERE repoId = ?").all(repoId).map(row => row.id);

  if (fs.existsSync(repo.repoPath)) {
    fs.rmSync(repo.repoPath, { recursive: true, force: true });
  }

  const idList = skillIds.map(() => "?").join(",");
  if (skillIds.length > 0) {
    db.prepare(`DELETE FROM project_skills WHERE skillId IN (${idList})`).run(...skillIds);
    db.prepare(`DELETE FROM skills WHERE repoId = ?`).run(repoId);
  }
  db.prepare("DELETE FROM skill_repos WHERE id = ?").run(repoId);

  return { deleted: true };
}
