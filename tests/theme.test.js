// REQ-TRACE: REQ-016
// REQ-VERSION: v1-hash:2ac6ee56bb4da537ba3e109f9a72e2aa36febb15beac6bdda04cbc2f9be68045
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { toggleTheme, applyTheme } from "../src/theme.js";

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
