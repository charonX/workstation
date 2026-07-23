import fs from "node:fs";
import path from "node:path";
import os from "node:os";

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

const defaults = {
  workspaceRoot: "~/codex-harness-workspace",
  skillRepoPath: "~/.codex-harness/skills",
  theme: "dark",
  language: "en-US",
  density: "comfortable"
};

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
    workspaceRoot: normalizePath(settings.workspaceRoot),
    skillRepoPath: normalizePath(settings.skillRepoPath)
  };
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
    return { ...defaults, ...JSON.parse(data) };
  } catch {
    return { ...defaults };
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
  settings = { ...defaults };
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
