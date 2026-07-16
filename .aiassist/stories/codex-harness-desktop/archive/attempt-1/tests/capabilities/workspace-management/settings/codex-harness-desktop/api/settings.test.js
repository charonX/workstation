// REQ-TRACE: codex-harness-desktop/REQ-001, codex-harness-desktop/REQ-002, codex-harness-desktop/REQ-025
// REQ-VERSION: v1-hash:2c79015bd970c381f96e90dfa5950a839b3fdf9b90606fadf73c07c381cbaad8
// CAPABILITY-TRACE: workspace-management
// ENTITY-TRACE: settings
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: false

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { loadSettings, saveSettings } from "../../../../../../src/settingsService.js";

describe("Settings", () => {
  beforeEach(() => {
    saveSettings({
      workspaceRoot: "~/codex-harness-workspace",
      skillRepoPath: "~/.codex-harness/skills",
      theme: "dark"
    });
  });

  it("REQ-001: persists workspace root directory", () => {
    const updated = saveSettings({ workspaceRoot: "~/opc-workspace" });
    assert.equal(updated.workspaceRoot, "~/opc-workspace");
    assert.equal(loadSettings().workspaceRoot, "~/opc-workspace");
  });

  it("REQ-001: rejects empty workspace root", () => {
    assert.throws(() => saveSettings({ workspaceRoot: "" }), /Workspace root is required/);
  });

  it("REQ-002: persists skill repository path", () => {
    const updated = saveSettings({ skillRepoPath: "~/skills" });
    assert.equal(updated.skillRepoPath, "~/skills");
    assert.equal(loadSettings().skillRepoPath, "~/skills");
  });

  it("REQ-025: persists density preference", () => {
    const updated = saveSettings({ density: "comfortable" });
    assert.equal(updated.density, "comfortable");
    assert.equal(loadSettings().density, "comfortable");
  });

  it("REQ-025: density has a default value", () => {
    const settings = loadSettings();
    assert.ok(settings.density === "compact" || settings.density === "comfortable");
  });
});
