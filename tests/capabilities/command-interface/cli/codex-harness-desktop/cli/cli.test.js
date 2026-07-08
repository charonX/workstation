// REQ-TRACE: codex-harness-desktop/REQ-CLI-001
// REQ-VERSION: v1-hash:71624856165d7ccd8e88041a8f92ec3a2c552457e9e514f29ef3eb747ccf1685
// CAPABILITY-TRACE: command-interface
// ENTITY-TRACE: cli
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: false

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";

const CLI = "node src/cli/opc-workstation.js";

describe("CLI", () => {
  it("REQ-CLI-001: --help shows usage and entities", () => {
    const out = execSync(`${CLI} --help`, { encoding: "utf-8" });
    const data = JSON.parse(out);
    assert.ok(data.usage);
    assert.ok(Array.isArray(data.entities));
    assert.ok(data.entities.includes("project"));
  });

  it("REQ-CLI-001: global --pretty outputs pretty JSON", () => {
    const out = execSync(`${CLI} --help --pretty`, { encoding: "utf-8" });
    // Should be multi-line formatted JSON
    assert.ok(out.includes("\n"));
  });

  it("REQ-CLI-001: unimplemented command exits with code 1", () => {
    try {
      execSync(`${CLI} project list`, { encoding: "utf-8" });
      assert.fail("should throw");
    } catch (error) {
      assert.equal(error.status, 1);
      const data = JSON.parse(error.stderr);
      assert.equal(data.error, "NOT_IMPLEMENTED");
    }
  });
});
