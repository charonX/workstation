import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as settingsService from "./settingsService.js";
import * as projectService from "./projectService.js";
import * as agentRegistryService from "./agentRegistryService.js";

// Skill service (ADR-011 revision): disk is the single source of truth.
// - The skill library is a workstation-private directory (settings.skillRepoPath);
//   each direct child directory is a "source directory" (one git clone or one
//   local copy), holding one or more skills (root-level SKILL.md or skills/*/).
// - There is no install-state DB: listing = live scan (tech-design F6),
//   install = clone/copy into the library (F1/F2), update = git pull --ff-only
//   (D6), remove = cascade link removal + delete source dir (F5), and project
//   linking = workstation-owned symlinks straight into the library (F4).
// - Legacy install sources were removed (REQ-SKILL-009); SKILL.md
//   "dependencies" is never read or cascaded (ADR-004 revision).

const execFileAsync = promisify(execFile);

// ---------- shared path helpers ----------

function expandTilde(inputPath) {
  if (typeof inputPath !== "string") return inputPath;
  if (inputPath === "~") return os.homedir();
  if (inputPath.startsWith("~/")) {
    return path.join(os.homedir(), inputPath.slice(2));
  }
  return inputPath;
}

function isDirectory(targetPath) {
  try {
    return fs.statSync(targetPath).isDirectory();
  } catch {
    return false;
  }
}

function realpathBestEffort(targetPath) {
  let current = targetPath;
  const missing = [];
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) break;
    missing.unshift(path.basename(current));
    current = parent;
  }
  try {
    return path.join(fs.realpathSync(current), ...missing);
  } catch {
    return targetPath;
  }
}

// Case-normalized comparison base (macOS/Windows case-insensitive volumes).
function comparisonKey(targetPath) {
  return realpathBestEffort(targetPath).toLowerCase();
}

function isInsideOrEqual(candidate, base) {
  return candidate === base || candidate.startsWith(base + path.sep);
}

function repoRoot() {
  const settings = settingsService.loadSettings();
  return expandTilde(settings.skillRepoPath);
}

function codedError(status, code, message, extra = {}) {
  const err = new Error(message);
  err.status = status;
  err.code = code;
  Object.assign(err, extra);
  return err;
}

// ---------- SKILL.md parsing ----------

function parseScalar(raw) {
  if (raw == null) return "";
  const v = raw.trim();
  return v.replace(/^["']|["']$/g, "");
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

// ---------- skill directory discovery ----------

// A source directory holds skills in one of two layouts (tech-design F6):
// root-level SKILL.md (skillName = source dir name) or skills/<name>/SKILL.md.
function discoverSkillDirs(sourceDir) {
  if (fs.existsSync(path.join(sourceDir, "SKILL.md"))) {
    return [{ skillName: path.basename(sourceDir), dir: sourceDir }];
  }
  const skillsRoot = path.join(sourceDir, "skills");
  if (!isDirectory(skillsRoot)) return [];
  const results = [];
  for (const entry of fs.readdirSync(skillsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(skillsRoot, entry.name);
    if (fs.existsSync(path.join(dir, "SKILL.md"))) {
      results.push({ skillName: entry.name, dir });
    }
  }
  return results;
}

// Link names are skill directory names (disk truth; agents discover skills by
// directory name). Reject anything with path separators, whitespace or
// control characters (PRD §7, review S2).
const ILLEGAL_SKILL_DIR_NAME = /[\s/\\]|[\x00-\x1f]/;

// ---------- user-supplied skill identity (slug / skillName) ----------

// Identities arriving from API clients must be single directory names: no
// path separators, whitespace or control characters, never "." / "..", never
// absolute forms (tech-design D9, review G1). URL params are WHATWG-normalized
// today, but body-supplied identities are not — the invariant is enforced here
// in the service layer so every present and future consumer inherits it.
const ILLEGAL_IDENTITY_CHAR = /[\s/\\]|[\x00-\x1f\x7f]/;

function validateSkillIdentity(value, kind) {
  if (
    typeof value !== "string" ||
    value === "" ||
    value === "." ||
    value === ".." ||
    ILLEGAL_IDENTITY_CHAR.test(value) ||
    path.isAbsolute(value)
  ) {
    throw codedError(
      400,
      "SKILL_IDENTITY_INVALID",
      `Illegal ${kind}: ${JSON.stringify(value)} (must be a single directory name — no separators, whitespace, control characters or traversal)`
    );
  }
}

function validateSourceContent(sourceDir) {
  const skillDirs = discoverSkillDirs(sourceDir);
  if (skillDirs.length === 0) {
    throw codedError(
      400,
      "SKILL_SOURCE_INVALID",
      "Source must contain a SKILL.md at its root or under skills/*/SKILL.md"
    );
  }
  for (const { skillName } of skillDirs) {
    if (ILLEGAL_SKILL_DIR_NAME.test(skillName)) {
      throw codedError(
        400,
        "SKILL_SOURCE_INVALID",
        `Illegal skill directory name: ${JSON.stringify(skillName)} (no whitespace, path separators or control characters allowed)`
      );
    }
  }
  return skillDirs;
}

// ---------- library scan view (REQ-SKILL-006) ----------

function readGitRemoteUrl(sourceDir) {
  try {
    const config = fs.readFileSync(path.join(sourceDir, ".git", "config"), "utf8");
    const section = config.match(/\[remote "origin"\]([^\[]*)/);
    if (!section) return null;
    const urlLine = section[1].match(/^\s*url\s*=\s*(.+)$/m);
    return urlLine ? urlLine[1].trim() : null;
  } catch {
    return null;
  }
}

function isGitSource(sourceDir) {
  // .git may be a directory (normal clone) or a file (worktree/submodule).
  return fs.existsSync(path.join(sourceDir, ".git"));
}

function scanSourceDir(sourceDir, slug) {
  const git = isGitSource(sourceDir);
  const skills = [];
  for (const { skillName, dir } of discoverSkillDirs(sourceDir)) {
    const parsed = parseSkillMarkdown(path.join(dir, "SKILL.md"));
    const name = parseScalar(parsed.frontmatter.name);
    const description = parseScalar(parsed.frontmatter.description);
    // E6: invalid SKILL.md is skipped with a warning; the scan must not fail.
    if (!name || !description) {
      console.warn(
        `[skillService] skipping ${path.join(slug, path.relative(sourceDir, dir)) || slug}: SKILL.md misses name/description`
      );
      continue;
    }
    skills.push({ skillName, name, description });
  }
  skills.sort((a, b) => a.skillName.localeCompare(b.skillName));
  return {
    slug,
    sourceType: git ? "git" : "local",
    sourceUrl: git ? readGitRemoteUrl(sourceDir) : null,
    skills
  };
}

// GET /api/skills — grouped live scan of the library (disk as truth, no cache).
export function listSkillGroups() {
  const root = repoRoot();
  if (!root || !isDirectory(root)) return [];
  const groups = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith(".")) continue;
    try {
      groups.push(scanSourceDir(path.join(root, entry.name), entry.name));
    } catch (err) {
      // E10: a concurrently-changing source dir is skipped, not fatal.
      console.warn(`[skillService] skipping source dir ${entry.name}: ${err.message}`);
    }
  }
  groups.sort((a, b) => a.slug.localeCompare(b.slug));
  return groups;
}

// ---------- jobs ----------

const jobs = new Map();

function createJob() {
  const job = {
    id: `skill-job-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    status: "pending",
    error: null
  };
  jobs.set(job.id, job);
  return job;
}

// GET /api/skills/jobs/:jobId — polling model {id, status, error:{code,message}}.
export function getJob(jobId) {
  const job = jobs.get(jobId);
  if (!job) return undefined;
  return { id: job.id, status: job.status, error: job.error ?? null };
}

function finishJob(job, error) {
  if (error) {
    job.status = "error";
    job.error = { code: error.code ?? "SKILL_JOB_FAILED", message: error.message };
  } else {
    job.status = "success";
    job.error = null;
  }
}

// ---------- git helpers (system git, parameterized execFile, no shell) ----------

// Git identifiers are restricted to non-executable transports (tech-design
// security section: protocol whitelist https/ssh; file:// is local-trust in
// the desktop API model and the signed-off fixtures depend on it). Anything
// else — notably ext:: transports and option-shaped identifiers — can execute
// arbitrary commands and is rejected before any job is created (review G2).
const ALLOWED_GIT_IDENTIFIER = /^(https:\/\/\S+|ssh:\/\/\S+|file:\/\/\S+|[A-Za-z0-9._-]+@[A-Za-z0-9._-]+:\S+)$/;

function assertAllowedGitUrl(identifier) {
  if (!ALLOWED_GIT_IDENTIFIER.test(identifier)) {
    throw codedError(
      400,
      "SKILL_SOURCE_INVALID",
      "Git identifier must be an https://, ssh://, file:// URL or scp-like <user>@<host>:<path>"
    );
  }
}

async function ensureGitAvailable() {
  try {
    await execFileAsync("git", ["--version"]);
  } catch {
    throw codedError(503, "GIT_UNAVAILABLE", "System git is not available on PATH");
  }
}

function gitErrorMessage(err) {
  const stderr = typeof err.stderr === "string" ? err.stderr.trim() : "";
  return stderr || err.message;
}

// ---------- install (REQ-SKILL-007 / REQ-SKILL-008 / REQ-SKILL-009) ----------

// git slugs derive from the URL (owner-repo); collisions get a numeric suffix.
function deriveGitSlug(identifier) {
  const trimmed = String(identifier).replace(/[/\\]+$/, "").replace(/\.git$/i, "");
  const segments = trimmed.split(/[/:]+/).filter(Boolean);
  const last = segments[segments.length - 1] || "skill-source";
  const owner = segments.length > 1 ? segments[segments.length - 2] : null;
  const raw = owner ? `${owner}-${last}` : last;
  return raw.replace(/[^a-zA-Z0-9._-]/g, "-") || "skill-source";
}

function resolveGitSlug(root, identifier) {
  const base = deriveGitSlug(identifier);
  let candidate = base;
  for (let n = 2; fs.existsSync(path.join(root, candidate)); n += 1) {
    candidate = `${base}-${n}`;
  }
  return candidate;
}

async function runGitInstallJob(job, { identifier, slug }) {
  job.status = "running";
  const root = repoRoot();
  const targetDir = path.join(root, slug);
  fs.mkdirSync(root, { recursive: true });
  try {
    // "--" terminates option parsing: even an identifier beginning with "-"
    // can never be interpreted as a git option (defense in depth on top of
    // the protocol whitelist).
    await execFileAsync("git", ["clone", "--depth", "1", "--", identifier, targetDir]);
  } catch (err) {
    // E1: fetch failure — no residue left in the library.
    fs.rmSync(targetDir, { recursive: true, force: true });
    throw codedError(502, "SKILL_FETCH_FAILED", gitErrorMessage(err));
  }
  try {
    validateSourceContent(targetDir);
  } catch (err) {
    // Content validation failure — clean up the clone (tech-design F1).
    fs.rmSync(targetDir, { recursive: true, force: true });
    throw codedError(502, err.code ?? "SKILL_SOURCE_INVALID", err.message);
  }
}

function validateLocalSource(identifier) {
  if (typeof identifier !== "string" || identifier.trim() === "") {
    throw codedError(400, "SKILL_SOURCE_INVALID", "Local source path is required");
  }
  const expanded = expandTilde(identifier.trim());
  if (!isDirectory(expanded)) {
    throw codedError(400, "SKILL_SOURCE_INVALID", `Local source is not an existing directory: ${identifier}`);
  }
  // E2 self-reference guard: the source must not equal/contain the library,
  // nor live inside it.
  const sourceKey = comparisonKey(expanded);
  const rootKey = comparisonKey(repoRoot());
  if (isInsideOrEqual(sourceKey, rootKey) || isInsideOrEqual(rootKey, sourceKey)) {
    throw codedError(
      400,
      "SKILL_SOURCE_INVALID",
      "Local source must not equal, contain or be contained by the skill library itself"
    );
  }
  validateSourceContent(expanded);
  return expanded;
}

function copyLocalSource(sourceDir, targetDir) {
  fs.cpSync(sourceDir, targetDir, {
    recursive: true,
    dereference: false,
    // Local copies must not bring a .git along — a copied source is local-type.
    filter: (src) => path.basename(src) !== ".git"
  });
}

function runLocalInstallJob(job, { sourceDir, slug, force }) {
  job.status = "running";
  const root = repoRoot();
  const targetDir = path.join(root, slug);
  fs.mkdirSync(root, { recursive: true });
  if (force && fs.existsSync(targetDir)) {
    // E12 force: local "update" = wipe and re-copy (tech-design D6/F2).
    fs.rmSync(targetDir, { recursive: true, force: true });
  }
  copyLocalSource(sourceDir, targetDir);
}

// POST /api/skills/install {sourceType: "git"|"local", identifier, force?} -> {jobId}.
// Synchronous rejections: invalid input (400 SKILL_SOURCE_INVALID), local slug
// conflict without force (409 SKILL_SLUG_CONFLICT), git unavailable (503
// GIT_UNAVAILABLE). Everything else lands in the async job's terminal state.
export async function startInstall(body) {
  const { sourceType, identifier, force } = body || {};
  if (sourceType !== "git" && sourceType !== "local") {
    // REQ-SKILL-009: legacy source types are rejected here (their install
    // logic no longer exists anywhere in this service).
    throw codedError(400, "SKILL_SOURCE_INVALID", `Unsupported skill source type: ${sourceType}`);
  }
  if (typeof identifier !== "string" || identifier.trim() === "") {
    throw codedError(400, "SKILL_SOURCE_INVALID", "identifier is required");
  }
  const root = repoRoot();
  if (!root) {
    throw codedError(400, "SKILL_SOURCE_INVALID", "Skill repository path is not configured");
  }

  if (sourceType === "git") {
    // Synchronous rejection, same timing as E2 local validation: no job, no
    // write, when the transport is not on the protocol whitelist.
    assertAllowedGitUrl(identifier.trim());
    await ensureGitAvailable();
    const slug = resolveGitSlug(root, identifier.trim());
    const job = createJob();
    runGitInstallJob(job, { identifier: identifier.trim(), slug })
      .then(() => finishJob(job))
      .catch((err) => finishJob(job, err));
    return { jobId: job.id };
  }

  // local: all validation is synchronous (E2/E12 happen before any write).
  const sourceDir = validateLocalSource(identifier);
  const slug = path.basename(sourceDir);
  if (fs.existsSync(path.join(root, slug)) && force !== true) {
    throw codedError(
      409,
      "SKILL_SLUG_CONFLICT",
      `A source named "${slug}" already exists in the skill library; pass force=true to overwrite it`,
      { existing: { slug } }
    );
  }
  const job = createJob();
  try {
    runLocalInstallJob(job, { sourceDir, slug, force: force === true });
    finishJob(job);
  } catch (err) {
    finishJob(job, err);
  }
  return { jobId: job.id };
}

// ---------- update (REQ-SKILL-016) ----------

async function runUpdateJob(job, sourceDir) {
  job.status = "running";
  // The remote URL lives in .git/config and could have been rewritten inside
  // the library (e.g. to an ext:: transport, which git executes on fetch).
  // Re-validate it against the install-time protocol whitelist before pulling;
  // rejection surfaces as the job's terminal error.
  const remoteUrl = readGitRemoteUrl(sourceDir);
  if (remoteUrl && !ALLOWED_GIT_IDENTIFIER.test(remoteUrl)) {
    throw codedError(
      502,
      "SKILL_UPDATE_FAILED",
      `Remote origin URL is not an allowed git protocol: ${remoteUrl}`
    );
  }
  try {
    // D6: ff-only; on failure surface the error and leave the directory as-is
    // (never reset, never force-overwrite a user's local changes).
    await execFileAsync("git", ["-C", sourceDir, "pull", "--ff-only"]);
  } catch (err) {
    throw codedError(502, "SKILL_UPDATE_FAILED", gitErrorMessage(err));
  }
}

// POST /api/skills/:slug/update -> {jobId} (git) | 400 local | 404 unknown.
export async function requestSourceUpdate(slug) {
  validateSkillIdentity(slug, "slug");
  const root = repoRoot();
  const sourceDir = path.join(root, slug);
  if (!isDirectory(sourceDir)) {
    throw codedError(404, "NOT_FOUND", `Skill source not found: ${slug}`);
  }
  if (!isGitSource(sourceDir)) {
    // E8: local sources have no upstream; re-adding with force is the update path.
    throw codedError(
      400,
      "SKILL_UPDATE_UNSUPPORTED",
      "Local skill sources cannot be updated automatically; re-add the source with force=true to overwrite it"
    );
  }
  await ensureGitAvailable();
  const job = createJob();
  runUpdateJob(job, sourceDir)
    .then(() => finishJob(job))
    .catch((err) => finishJob(job, err));
  return { jobId: job.id };
}

// ---------- link primitives (project agent dirs -> library) ----------

function agentSkillsDir(agentKey) {
  const agent = agentRegistryService.listAgents().find((a) => a.name === agentKey);
  return agent ? agent.skillsDir : null;
}

function createSymlink(targetDir, linkPath) {
  fs.mkdirSync(path.dirname(linkPath), { recursive: true });
  // D9: junction on Windows does not need developer mode; plain dir symlink elsewhere.
  fs.symlinkSync(targetDir, linkPath, process.platform === "win32" ? "junction" : "dir");
}

// Remove symlinks under dirPath whose realpath lands inside baseKey.
// Only the links themselves are removed — external entities are never touched
// (D4/D9). Returns the removed entry names.
function removeLinksInto(dirPath, baseKey) {
  const removed = [];
  if (!isDirectory(dirPath)) return removed;
  let entries;
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch (err) {
    console.warn(`[skillService] cannot scan ${dirPath}: ${err.message}`);
    return removed;
  }
  for (const entry of entries) {
    const linkPath = path.join(dirPath, entry.name);
    let lst;
    try {
      lst = fs.lstatSync(linkPath);
    } catch {
      continue; // E10: entry vanished mid-scan
    }
    if (!lst.isSymbolicLink()) continue;
    let real;
    try {
      real = fs.realpathSync(linkPath).toLowerCase();
    } catch {
      continue; // dangling link: not ours to judge here
    }
    if (real === baseKey || real.startsWith(baseKey + path.sep)) {
      fs.rmSync(linkPath, { force: true });
      removed.push(entry.name);
    }
  }
  return removed;
}

// Per declared agent dir of a project (skillsDir deduped), call fn(dirPath,
// agents). Unknown registry keys are skipped with a warning (E9) and reported.
function forEachAgentSkillsDir(project, agentKeys, fn) {
  const byDir = new Map();
  const invalidAgents = [];
  for (const key of agentKeys) {
    const skillsDir = agentSkillsDir(key);
    if (!skillsDir) {
      console.warn(`[skillService] agent "${key}" not found in registry; skipping`);
      invalidAgents.push(key);
      continue;
    }
    if (!byDir.has(skillsDir)) byDir.set(skillsDir, []);
    byDir.get(skillsDir).push(key);
  }
  const localPath = expandTilde(project.localPath || "");
  for (const [skillsDir, agents] of byDir) {
    fn(path.join(localPath, skillsDir), agents, skillsDir);
  }
  return invalidAgents;
}

// ---------- project linking (REQ-SKILL-010; consumed by REQ-SKILL-015/017) ----------

function resolveSkillTargetDir(slug, skillName) {
  const root = repoRoot();
  const sourceDir = path.join(root, slug);
  if (!isDirectory(sourceDir)) {
    throw codedError(404, "NOT_FOUND", `Skill source not found: ${slug}`);
  }
  const match = discoverSkillDirs(sourceDir).find((s) => s.skillName === skillName);
  if (!match) {
    throw codedError(404, "NOT_FOUND", `Skill not found in source "${slug}": ${skillName}`);
  }
  // D9 defense in depth: the resolved skill directory must live inside the
  // library by realpath — a symlink committed inside a cloned source must
  // never become the target of a link we create.
  if (!isInsideOrEqual(comparisonKey(match.dir), comparisonKey(root))) {
    throw codedError(
      400,
      "SKILL_SOURCE_INVALID",
      `Skill directory for "${skillName}" resolves outside the skill library; refusing to link`
    );
  }
  return match.dir;
}

function emptyAgentResult(agent, skillsDir) {
  return { agent, skillsDir, linked: [], unlinked: [], failed: [], conflicts: [] };
}

// POST /api/projects/:id/skills {slug, skillName}: link a library skill into
// every declared agent dir (workstation-owned symlinks straight into the
// library; skillsDir-deduped; idempotent; external occupation = conflict, the
// external entity is left untouched; per-agent failures surface in failed[]).
export function linkSkillToProject(project, { slug, skillName } = {}) {
  if (!slug || !skillName) {
    throw codedError(400, "SKILL_IDENTITY_REQUIRED", "Both slug and skillName are required");
  }
  validateSkillIdentity(slug, "slug");
  validateSkillIdentity(skillName, "skillName");
  const targetDir = resolveSkillTargetDir(slug, skillName);
  const agentTypes = Array.isArray(project?.agentTypes) ? project.agentTypes : [];
  if (agentTypes.length === 0) {
    // E7: nothing to distribute into — declare agent types first.
    throw codedError(
      409,
      "PROJECT_AGENTS_EMPTY",
      "Project has no agent types declared; set agentTypes before linking skills"
    );
  }

  const targetKey = comparisonKey(targetDir);
  const results = new Map();
  const invalidAgents = forEachAgentSkillsDir(project, agentTypes, (dirPath, agents, skillsDir) => {
    const linkPath = path.join(dirPath, skillName);
    const perAgent = agents.map((agent) => {
      const result = emptyAgentResult(agent, skillsDir);
      results.set(agent, result);
      return result;
    });
    const report = (kind) => {
      for (const result of perAgent) result[kind].push(skillName);
    };
    try {
      const existing = fs.lstatSync(linkPath, { throwIfNoEntry: false });
      if (existing) {
        if (existing.isSymbolicLink()) {
          let real = null;
          try {
            real = fs.realpathSync(linkPath).toLowerCase();
          } catch {
            real = null;
          }
          if (real && real === targetKey) {
            report("linked"); // idempotent repeat link
          } else {
            report("conflicts"); // external symlink occupies the target
          }
        } else {
          report("conflicts"); // external entity occupies the target
        }
        return;
      }
      createSymlink(targetDir, linkPath);
      report("linked");
    } catch (err) {
      console.warn(`[skillService] failed to link ${skillName} into ${dirPath}: ${err.message}`);
      report("failed"); // E5: surface, never silently fall back to copying
    }
  });
  for (const agent of invalidAgents) {
    const result = emptyAgentResult(agent, null);
    result.invalid = true;
    results.set(agent, result);
  }
  return { agents: agentTypes.map((agent) => results.get(agent)).filter(Boolean) };
}

// ---------- source removal (REQ-SKILL-015) ----------

// DELETE /api/skills/:slug: cascade-remove every project symlink resolving
// into <repoRoot>/<slug> across all declared agent dirs, then delete the
// source directory. External entries are never touched.
export function deleteSource(slug) {
  validateSkillIdentity(slug, "slug");
  const root = repoRoot();
  const sourceDir = path.join(root, slug);
  if (!isDirectory(sourceDir)) {
    throw codedError(404, "NOT_FOUND", `Skill source not found: ${slug}`);
  }
  const baseKey = comparisonKey(sourceDir);
  for (const project of projectService.listProjects()) {
    const agentTypes = Array.isArray(project.agentTypes) ? project.agentTypes : [];
    if (agentTypes.length === 0 || !project.localPath) continue;
    forEachAgentSkillsDir(project, agentTypes, (dirPath) => {
      removeLinksInto(dirPath, baseKey);
    });
  }
  fs.rmSync(sourceDir, { recursive: true, force: true });
  return { deleted: slug };
}
