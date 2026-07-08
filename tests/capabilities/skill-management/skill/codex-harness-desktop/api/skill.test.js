// REQ-TRACE: codex-harness-desktop/REQ-014, codex-harness-desktop/REQ-015, codex-harness-desktop/REQ-022
// REQ-VERSION: v1-hash:2c79015bd970c381f96e90dfa5950a839b3fdf9b90606fadf73c07c381cbaad8
// CAPABILITY-TRACE: skill-management
// ENTITY-TRACE: skill
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: false

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { resetSkills, listSkills } from "../../../../../../src/skillService.js";
import * as skillService from "../../../../../../src/skillService.js";

describe("Skills", () => {
  beforeEach(() => {
    resetSkills([
      {
        id: "s1",
        name: "news-fetcher",
        description: "Fetch news headlines",
        repoPath: "~/.opc-workstation/skills/news-fetcher",
        version: "1.2.0",
        category: "Data",
        author: "OPC",
        tags: ["news", "http"],
        parameters: [{ name: "url", type: "string", required: true }],
        examples: ["news-fetcher --url https://example.com"],
        readme: "# news-fetcher\nFetch news."
      }
    ]);
  });

  it("REQ-014: lists skills without linked projects column", () => {
    const skills = listSkills();
    assert.equal(skills.length, 1);
    const skill = skills[0];
    assert.equal(skill.name, "news-fetcher");
    assert.equal(skill.repoPath, "~/.opc-workstation/skills/news-fetcher");
    assert.equal(skill.version, "1.2.0");
    assert.equal(skill.category, "Data");
    assert.equal(skill.linkedProjects, undefined);
  });

  it("REQ-014: skill row exposes a detail entry point", () => {
    const skill = listSkills()[0];
    assert.ok(skill.id);
  });

  it("REQ-015: skill detail exposes overview metadata", () => {
    assert.equal(typeof skillService.getSkillDetail, "function");
    const detail = skillService.getSkillDetail("s1");
    assert.equal(detail.name, "news-fetcher");
    assert.equal(detail.description, "Fetch news headlines");
    assert.ok(Array.isArray(detail.tags));
    assert.ok(detail.author);
  });

  it("REQ-015: skill detail provides Overview / Parameters / Examples / README tabs", () => {
    assert.equal(typeof skillService.getSkillDetail, "function");
    const detail = skillService.getSkillDetail("s1");
    assert.deepEqual(detail.tabs, ["Overview", "Parameters", "Examples", "README"]);
  });

  it("REQ-015: skill detail does not expose project link controls", () => {
    assert.equal(typeof skillService.getSkillDetail, "function");
    const detail = skillService.getSkillDetail("s1");
    assert.equal(detail.canLinkProjects, undefined);
    assert.equal(detail.canUnlinkProjects, undefined);
  });

  it("REQ-022: supports npm/npx skill install", () => {
    assert.equal(typeof skillService.installSkill, "function");
    const installed = skillService.installSkill({ source: "npm", identifier: "some-skill" });
    assert.equal(installed.installSource, "npm");
    assert.equal(installed.name, "some-skill");
    assert.ok(listSkills().some(s => s.id === installed.id));
  });

  it("REQ-022: supports Claude Plugin skill install", () => {
    assert.equal(typeof skillService.installSkill, "function");
    const installed = skillService.installSkill({ source: "plugin", identifier: "claude-plugin-id" });
    assert.equal(installed.installSource, "plugin");
  });

  it("REQ-022: supports Local Files skill install", () => {
    assert.equal(typeof skillService.installSkill, "function");
    const installed = skillService.installSkill({ source: "local", identifier: "~/my-skills/local-skill" });
    assert.equal(installed.installSource, "local");
  });
});
