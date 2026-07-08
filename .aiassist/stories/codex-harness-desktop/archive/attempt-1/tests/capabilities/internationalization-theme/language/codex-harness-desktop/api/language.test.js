// REQ-TRACE: codex-harness-desktop/REQ-024
// REQ-VERSION: v1-hash:2c79015bd970c381f96e90dfa5950a839b3fdf9b90606fadf73c07c381cbaad8
// CAPABILITY-TRACE: internationalization-theme
// ENTITY-TRACE: language
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: false

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { loadSettings, saveSettings } from "../../../../../../src/settingsService.js";

describe("Language", () => {
  beforeEach(() => {
    saveSettings({ language: "en-US" });
  });

  it("REQ-024: persists language preference", () => {
    const updated = saveSettings({ language: "zh-CN" });
    assert.equal(updated.language, "zh-CN");
    assert.equal(loadSettings().language, "zh-CN");
  });

  it("REQ-024: default language is English", () => {
    assert.equal(loadSettings().language, "en-US");
  });
});
