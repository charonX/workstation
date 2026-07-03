// Temporary stub for test compilation.
// Real implementation will be provided by the implementer agent.

let settings = {
  workspaceRoot: "~/codex-harness-workspace",
  skillRepoPath: "~/.codex-harness/skills",
  theme: "dark"
};

export function loadSettings() {
  return { ...settings };
}

export function saveSettings(partial) {
  if (partial && Object.prototype.hasOwnProperty.call(partial, "workspaceRoot") && partial.workspaceRoot === "") {
    throw new Error("Workspace root is required");
  }
  settings = { ...settings, ...partial };
  return loadSettings();
}
