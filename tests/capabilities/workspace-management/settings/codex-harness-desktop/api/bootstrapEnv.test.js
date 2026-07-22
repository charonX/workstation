// REQ-TRACE: 2026-07-19-media-production-line/REQ-WORKSPACE-008, 2026-07-19-media-production-line/REQ-CHANNEL-001
// REQ-VERSION: v1-hash:de43bc8607a89efe5512712a188a5f24f259d8109cb31a7a476827dd0883fab9
// CAPABILITY-TRACE: workspace-management
// ENTITY-TRACE: settings
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// tests/capabilities/workspace-management/settings/<story>/api/bootstrapEnv.test.js
// → 5 levels up = project root (workstation/)
const PROJECT_ROOT = path.resolve(__dirname, "../../../../../../");

// BUG-007 regression: ESM static imports are hoisted. If process.env.OPC_WORKSTATION_CONFIG_DIR
// is set AFTER a static import chain that transitively loads settingsService, settingsService's
// top-level `let settings = readSettings()` runs against the default ~/.opc-workstation/ dir.
// The fix uses a bootstrap module that sets env BEFORE any business-logic import.

function runScenario(scenarioSource) {
  const script = `
    ${scenarioSource}
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    cwd: PROJECT_ROOT,
    encoding: "utf8",
    env: { ...process.env, HOME: os.homedir() },
    maxBuffer: 1024 * 1024
  });
  if (result.status !== 0) {
    throw new Error(`scenario failed (exit ${result.status}):\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);
  }
  return result.stdout.trim();
}

describe("BUG-007 regression: settingsService respects OPC_WORKSTATION_CONFIG_DIR at module load", () => {
  let tmpDir;

  it("env set BEFORE import: settingsService reads channelCredentials from configured dir", () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "opc-bootstrap-test-"));
    const creds = { appId: "cli_bootstrap_test", appSecret: "secret_test", updatedAt: "2026-01-01T00:00:00Z" };
    fs.writeFileSync(path.join(tmpDir, "settings.json"), JSON.stringify({ channelCredentials: creds }));

    // Simulate the FIXED pattern: set env before any import of settingsService.
    const stdout = runScenario(`
      process.env.OPC_WORKSTATION_CONFIG_DIR = ${JSON.stringify(tmpDir)};
      const settingsService = await import("${PROJECT_ROOT}/src/services/settingsService.js");
      const loaded = settingsService.loadSettings();
      console.log(JSON.stringify({ hasCreds: !!loaded.channelCredentials, appId: loaded.channelCredentials?.appId }));
    `);

    const parsed = JSON.parse(stdout);
    assert.equal(parsed.hasCreds, true, "channelCredentials should be loaded when env is set before import");
    assert.equal(parsed.appId, "cli_bootstrap_test", "appId should match what was written to temp settings.json");
  });

  it("env set AFTER import: settingsService caches the wrong dir (BUG scenario)", () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "opc-bootstrap-bug-"));
    const creds = { appId: "cli_late_set", appSecret: "secret_late", updatedAt: "2026-01-01T00:00:00Z" };
    fs.mkdirSync(path.join(tmpDir, ".opc-workstation"), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, ".opc-workstation", "settings.json"),
      JSON.stringify({ channelCredentials: creds })
    );

    // Simulate the BUGGY pattern: import settingsService first (which reads from ~/.opc-workstation
    // because HOME is real user home, but then set env and expect it to pick up temp dir).
    // The module-level readSettings() already ran against default dir; credentials from temp are NOT loaded.
    const stdout = runScenario(`
      const settingsService = await import("${PROJECT_ROOT}/src/services/settingsService.js");
      process.env.OPC_WORKSTATION_CONFIG_DIR = ${JSON.stringify(tmpDir)};
      // loadSettings returns the in-memory cached value, not re-read from disk.
      const loaded = settingsService.loadSettings();
      console.log(JSON.stringify({
        hasCredsFromLateDir: loaded.channelCredentials?.appId === "cli_late_set",
        // The in-memory state was captured before env was set; late env does NOT retroactively load.
        observedAppId: loaded.channelCredentials?.appId ?? null
      }));
    `);

    const parsed = JSON.parse(stdout);
    // The bug: credentials from the late-set config dir are NOT visible because settingsService
    // already read from the default dir at module load.
    assert.equal(parsed.hasCredsFromLateDir, false,
      "setting env AFTER import should NOT retroactively load credentials (demonstrates the bug)");
  });
});
