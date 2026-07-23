// REQ-TRACE: 2026-07-19-media-production-line/REQ-WORKSPACE-008, REQ-CHANNEL-001
// CAPABILITY-TRACE: workspace-management
// ENTITY-TRACE: settings
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

describe("BUG-009 regression: settingsService lazy init (resilient to ESM import hoisting)", () => {
  it("loadSettings() reads settings from OPC_WORKSTATION_CONFIG_DIR even if env is set AFTER module import", async () => {
    // Simulate the production scenario caused by ESM static-import hoisting:
    // settingsService is imported during module load, but the electron main
    // process sets process.env.OPC_WORKSTATION_CONFIG_DIR only after import
    // (because the bootstrap-env inline code in the vite bundle appears AFTER
    // the hoisted imports of other chunks).
    // The lazy init fix ensures readSettings() runs on the FIRST loadSettings()
    // call, not at module top-level, so env is already set by then.
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "opc-lazy-"));
    const creds = { appId: "cli_lazy_regression", appSecret: "s", updatedAt: new Date().toISOString() };
    fs.writeFileSync(path.join(tmpDir, "settings.json"), JSON.stringify({ channelCredentials: creds }));

    // Import FIRST (like ESM hoisting of static imports)
    const settingsService = await import("../../../../../../src/services/settingsService.js");

    // Set env AFTER import (simulating bootstrap-env running later in the bundle)
    const prev = process.env.OPC_WORKSTATION_CONFIG_DIR;
    process.env.OPC_WORKSTATION_CONFIG_DIR = tmpDir;
    try {
      const loaded = settingsService.loadSettings();
      assert.equal(loaded.channelCredentials?.appId, "cli_lazy_regression",
        "loadSettings() must read from OPC_WORKSTATION_CONFIG_DIR even when env is set after module import");
    } finally {
      if (prev === undefined) delete process.env.OPC_WORKSTATION_CONFIG_DIR;
      else process.env.OPC_WORKSTATION_CONFIG_DIR = prev;
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("saveChannelCredentials writes to the dir set at call time, not module-load time", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "opc-lazy-write-"));
    const prev = process.env.OPC_WORKSTATION_CONFIG_DIR;
    process.env.OPC_WORKSTATION_CONFIG_DIR = tmpDir;
    try {
      const settingsService = await import("../../../../../../src/services/settingsService.js");
      settingsService.saveChannelCredentials({ appId: "cli_write_test", appSecret: "secret" });
      const onDisk = JSON.parse(fs.readFileSync(path.join(tmpDir, "settings.json"), "utf8"));
      assert.equal(onDisk.channelCredentials?.appId, "cli_write_test",
        "saveChannelCredentials must write to the currently-configured dir");
      const loaded = settingsService.loadSettings();
      assert.equal(loaded.channelCredentials?.appId, "cli_write_test");
    } finally {
      if (prev === undefined) delete process.env.OPC_WORKSTATION_CONFIG_DIR;
      else process.env.OPC_WORKSTATION_CONFIG_DIR = prev;
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
