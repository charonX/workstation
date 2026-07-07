import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const configDir = path.join(os.homedir(), ".opc-workstation");
const settingsFile = path.join(configDir, "settings.json");

const defaults = {
  workspaceRoot: "~/codex-harness-workspace",
  skillRepoPath: "~/.codex-harness/skills",
  theme: "dark",
  language: "en-US",
  density: "comfortable"
};

function readSettings() {
  try {
    const data = fs.readFileSync(settingsFile, "utf8");
    return { ...defaults, ...JSON.parse(data) };
  } catch {
    return { ...defaults };
  }
}

function writeSettings(settings) {
  try {
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2));
  } catch {
    // Ignore persistence failures in restricted environments (tests, CI).
  }
}

let settings = readSettings();

export function loadSettings() {
  return { ...settings };
}

export function saveSettings(partial) {
  if (partial && Object.prototype.hasOwnProperty.call(partial, "workspaceRoot") && partial.workspaceRoot === "") {
    throw new Error("Workspace root is required");
  }
  settings = { ...settings, ...partial };
  writeSettings(settings);
  return loadSettings();
}
