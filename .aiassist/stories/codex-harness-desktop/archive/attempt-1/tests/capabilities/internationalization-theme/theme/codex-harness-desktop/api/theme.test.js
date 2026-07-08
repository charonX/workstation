// REQ-TRACE: codex-harness-desktop/REQ-016
// REQ-VERSION: v1-hash:2c79015bd970c381f96e90dfa5950a839b3fdf9b90606fadf73c07c381cbaad8
// CAPABILITY-TRACE: internationalization-theme
// ENTITY-TRACE: theme
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: false

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { toggleTheme, applyTheme } from "../../../../../../src/theme.js";

describe("Theme", () => {
  it("REQ-016: toggles from dark to light", () => {
    assert.equal(toggleTheme("dark"), "light");
  });

  it("REQ-016: toggles from light to dark", () => {
    assert.equal(toggleTheme("light"), "dark");
  });

  it("REQ-016: applyTheme returns the applied theme", () => {
    const target = {
      setAttribute: (name, value) => {
        target[name] = value;
      }
    };
    assert.equal(applyTheme("light", target), "light");
    assert.equal(target["data-theme"], "light");
    assert.equal(applyTheme("dark"), "dark");
  });
});
