// REQ-TRACE: REQ-001, REQ-002
// REQ-VERSION: v1-hash:588f13f5f81efdd54b064c8c8467098f11550d3f3dbe7e1785738c9177d47254
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
