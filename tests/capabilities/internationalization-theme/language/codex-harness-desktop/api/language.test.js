// REQ-TRACE: codex-harness-desktop/REQ-I18N-002
// REQ-VERSION: v1-hash:53fcb918ad26820e6760c66ac610791ceca2a11a981737c76234a70ea8f36569
// CAPABILITY-TRACE: internationalization-theme
// ENTITY-TRACE: language
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: false

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { startServer, stopServer } from "../../../../../../src/http/server.js";

const CLI = "node src/cli/opc-workstation.js";

describe("Language", () => {
  let serverCtx;

  beforeEach(async () => {
    serverCtx = await startServer();
  });

  afterEach(async () => {
    await stopServer(serverCtx);
  });

  it("REQ-I18N-002: default language is English", async () => {
    const res = await fetch(`${serverCtx.baseUrl}/api/settings`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.language, "en-US");
  });

  it("REQ-I18N-002: persists language preference", async () => {
    const res = await fetch(`${serverCtx.baseUrl}/api/settings`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ language: "zh-CN" })
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.language, "zh-CN");
  });

  it("REQ-I18N-002: CLI sets language", () => {
    const out = execSync(`${CLI} settings set --language zh-CN`, { encoding: "utf-8" });
    const data = JSON.parse(out);
    assert.equal(data.language, "zh-CN");
  });
});
