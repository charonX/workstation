// REQ-TRACE: codex-harness-desktop/REQ-I18N-001
// REQ-VERSION: v1-hash:53fcb918ad26820e6760c66ac610791ceca2a11a981737c76234a70ea8f36569
// CAPABILITY-TRACE: internationalization-theme
// ENTITY-TRACE: theme
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: false

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { startServer, stopServer } from "../../../../../../src/http/server.js";

const CLI = "node src/cli/opc-workstation.js";

describe("Theme", () => {
  let serverCtx;

  beforeEach(async () => {
    serverCtx = await startServer();
  });

  afterEach(async () => {
    await stopServer(serverCtx);
  });

  it("REQ-I18N-001: toggles theme via settings API", async () => {
    const light = await (await fetch(`${serverCtx.baseUrl}/api/settings`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ theme: "light" })
    })).json();
    assert.equal(light.theme, "light");
    const dark = await (await fetch(`${serverCtx.baseUrl}/api/settings`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ theme: "dark" })
    })).json();
    assert.equal(dark.theme, "dark");
  });

  it("REQ-I18N-001: CLI sets theme", () => {
    const out = execSync(`${CLI} settings set --theme dark`, { encoding: "utf-8" });
    const data = JSON.parse(out);
    assert.equal(data.theme, "dark");
  });
});
