// REQ-TRACE: REQ-001, REQ-002
// REQ-VERSION: v1-hash:2ac6ee56bb4da537ba3e109f9a72e2aa36febb15beac6bdda04cbc2f9be68045
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { loadSettings, saveSettings } from "../src/settingsService.js";

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
});
