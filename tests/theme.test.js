// REQ-TRACE: REQ-016
// REQ-VERSION: v1-hash:588f13f5f81efdd54b064c8c8467098f11550d3f3dbe7e1785738c9177d47254
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
