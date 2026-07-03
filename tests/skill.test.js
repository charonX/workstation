// REQ-TRACE: REQ-014, REQ-015
// REQ-VERSION: v1-hash:588f13f5f81efdd54b064c8c8467098f11550d3f3dbe7e1785738c9177d47254
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  resetSkills,
  listSkills,
  linkSkill,
  unlinkSkill,
  getLinkedProjects
} from "../src/skillService.js";

describe("Skills", () => {
  beforeEach(() => {
    resetSkills([
      {
        id: "s1",
        name: "news-fetcher",
        description: "Fetch news",
        repoPath: "~/.opc-workstation/skills/news-fetcher",
        version: "1.2.0",
        dependencies: ["http-client"]
      }
    ]);
  });

  it("REQ-014: lists skills with name, repo path and link status", () => {
    const skills = listSkills();
    assert.equal(skills.length, 1);
    assert.equal(skills[0].name, "news-fetcher");
    assert.ok(skills[0].repoPath);
  });

  it("REQ-015: skill detail exposes metadata", () => {
    const skill = listSkills()[0];
    assert.equal(skill.version, "1.2.0");
    assert.deepEqual(skill.dependencies, ["http-client"]);
  });

  it("REQ-015: links a skill to a project", () => {
    linkSkill("s1", "p1");
    assert.deepEqual(getLinkedProjects("s1"), ["p1"]);
  });

  it("REQ-015: unlinks a skill from a project", () => {
    linkSkill("s1", "p1");
    linkSkill("s1", "p2");
    unlinkSkill("s1", "p1");
    assert.deepEqual(getLinkedProjects("s1"), ["p2"]);
  });

  it("REQ-015: linking same project twice is idempotent", () => {
    linkSkill("s1", "p1");
    linkSkill("s1", "p1");
    assert.deepEqual(getLinkedProjects("s1"), ["p1"]);
  });
});
