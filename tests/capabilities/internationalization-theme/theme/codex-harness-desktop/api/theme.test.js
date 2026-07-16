// REQ-TRACE: codex-harness-desktop/REQ-I18N-001
// REQ-VERSION: v1-hash:762b9b7ff4d4891a26d57bdd0dd7ead507d8e0b23271665ae1ff317e3cfa9493
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
