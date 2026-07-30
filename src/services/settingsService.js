import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import * as agentRegistryService from "./agentRegistryService.js";

function resolveConfigDir() {
  if (process.env.OPC_WORKSTATION_CONFIG_DIR) {
    return process.env.OPC_WORKSTATION_CONFIG_DIR;
  }
  return path.join(os.homedir(), ".opc-workstation");
}

function configDir() {
  return resolveConfigDir();
}

function settingsFile() {
  return path.join(configDir(), "settings.json");
}

// REQ-SKILL-005 AC1: the default skill library path is ~/.opc-workstation/skills
// (renamed from the legacy ~/.codex-harness/skills; old content is not migrated).
// Computed lazily (ADR-009): os.homedir() must not run at module load time.
function getDefaults() {
  return {
    workspaceRoot: "~/codex-harness-workspace",
    skillRepoPath: path.join(os.homedir(), ".opc-workstation", "skills"),
    theme: "dark",
    language: "en-US",
    density: "comfortable"
  };
}

function normalizePath(value) {
  if (typeof value !== "string") return value;
  const home = os.homedir();
  if (value.startsWith(home + path.sep)) {
    return "~" + value.slice(home.length);
  }
  return value;
}

function normalizeSettings(settings) {
  return {
    ...settings,
    workspaceRoot: normalizePath(settings.workspaceRoot)
    // skillRepoPath is intentionally NOT tilde-normalized: loadSettings must
    // return the stored/default value verbatim (REQ-SKILL-005 AC1 expects the
    // absolute default; a user-supplied "~/..." value round-trips unchanged).
  };
}

function expandTilde(inputPath) {
  if (typeof inputPath !== "string") return inputPath;
  if (inputPath === "~") return os.homedir();
  if (inputPath === "~/" || inputPath.startsWith("~/")) {
    return path.join(os.homedir(), inputPath.slice(2));
  }
  return inputPath;
}

// E11 comparison helper: resolve symlinks as far as possible even when the
// path (or its tail) does not exist yet (e.g. ~/.agents/skills on a fresh
// machine). /tmp-style symlinked prefixes (macOS /var -> /private/var) must
// not defeat the prefix check.
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

function normalizeForConflictCheck(inputPath) {
  const expanded = expandTilde(inputPath);
  if (!expanded || typeof expanded !== "string") return null;
  const resolved = realpathBestEffort(path.resolve(expanded));
  const trimmed = resolved.endsWith(path.sep) ? resolved.slice(0, -1) : resolved;
  return trimmed.toLowerCase();
}

function isPrefixEitherWay(a, b) {
  return a === b || a.startsWith(b + path.sep) || b.startsWith(a + path.sep);
}

// REQ-SKILL-005 AC2 (E11): the skill library must never coincide with — or
// nest inside, or contain — any agent's global scan dir (tech-design D3/E11:
// bidirectional prefix containment after ~ expansion, realpath and case
// normalization). Returns the conflicting agent keys.
export function findSkillRepoPathConflicts(candidatePath) {
  const candidate = normalizeForConflictCheck(candidatePath);
  if (!candidate) return [];
  const conflicts = [];
  for (const agent of agentRegistryService.listAgents()) {
    const globalDir = agentRegistryService.getGlobalSkillsDir(agent.name);
    if (!globalDir) continue;
    const scanDir = normalizeForConflictCheck(globalDir);
    if (!scanDir) continue;
    if (isPrefixEitherWay(candidate, scanDir)) {
      conflicts.push(agent.name);
    }
  }
  return conflicts.sort();
}

function readSettings() {
  // BUG-009 fix: readSettings is now called lazily on first access (not at module
  // top-level), so OPC_WORKSTATION_CONFIG_DIR is guaranteed to be set by the time
  // any caller invokes loadSettings/saveSettings. This makes settingsService
  // resilient to ESM import hoisting and bundler reordering (vite/rollup may place
  // import statements before inline bootstrap code in the output bundle).
  const file = settingsFile();
  try {
    const data = fs.readFileSync(file, "utf8");
    return { ...getDefaults(), ...JSON.parse(data) };
  } catch {
    return { ...getDefaults() };
  }
}

function writeSettings(settings) {
  const dir = configDir();
  const file = settingsFile();
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(settings, null, 2));
  } catch {
    // Ignore persistence failures in restricted environments (tests, CI).
  }
}

// BUG-009: lazy init — null sentinel; populated on first loadSettings()/saveSettings().
// Previously this was `let settings = readSettings()` which ran at module load time,
// before the Electron main process had a chance to set OPC_WORKSTATION_CONFIG_DIR
// (ESM imports are hoisted, and vite bundles the bootstrap-env inline AFTER other
// static imports, so env was unset when readSettings ran).
let settings = null;

function ensureLoaded() {
  if (settings === null) {
    settings = readSettings();
  }
}

export function resetSettings() {
  settings = { ...getDefaults() };
  writeSettings(settings);
  return loadSettings();
}

export function loadSettings() {
  ensureLoaded();
  return normalizeSettings({ ...settings });
}

export function saveSettings(partial) {
  ensureLoaded();
  if (partial && Object.prototype.hasOwnProperty.call(partial, "workspaceRoot") && partial.workspaceRoot === "") {
    throw new Error("Workspace root is required");
  }
  if (partial && Object.prototype.hasOwnProperty.call(partial, "skillRepoPath")) {
    if (typeof partial.skillRepoPath !== "string" || partial.skillRepoPath.trim() === "") {
      throw new Error("Skill repository path is required");
    }
    // REQ-SKILL-005 AC2 (E11): reject library paths conflicting with any
    // agent's global scan dir; the error body carries the conflicting agents.
    const conflicts = findSkillRepoPathConflicts(partial.skillRepoPath);
    if (conflicts.length > 0) {
      const err = new Error(
        `Skill repository path conflicts with agent global skills directories: ${conflicts.join(", ")}`
      );
      err.status = 400;
      err.code = "SKILL_REPO_PATH_CONFLICT";
      err.conflicts = conflicts;
      throw err;
    }
  }
  settings = { ...settings, ...partial };
  writeSettings(settings);
  return loadSettings();
}

export function saveChannelCredentials({ appId, appSecret } = {}) {
  ensureLoaded();
  if (!appId || !appSecret) {
    throw new Error("E-CHANNEL-CRED: App ID and App Secret are required");
  }
  settings = {
    ...settings,
    channelCredentials: { appId, appSecret, updatedAt: new Date().toISOString() }
  };
  writeSettings(settings);
  try {
    fs.chmodSync(settingsFile(), 0o600);
  } catch {
    // Ignore permission failures in restricted environments (tests, CI).
  }
  return { appId, updatedAt: settings.channelCredentials.updatedAt };
}
