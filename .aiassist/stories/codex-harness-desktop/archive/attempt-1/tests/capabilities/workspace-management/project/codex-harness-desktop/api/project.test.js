// REQ-TRACE: codex-harness-desktop/REQ-003, codex-harness-desktop/REQ-004, codex-harness-desktop/REQ-005, codex-harness-desktop/REQ-021
// REQ-VERSION: v1-hash:2c79015bd970c381f96e90dfa5950a839b3fdf9b90606fadf73c07c381cbaad8
// CAPABILITY-TRACE: workspace-management
// ENTITY-TRACE: project
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: false

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  resetProjects,
  createLocalProject,
  createGitProject,
  listProjects,
  filterProjects
} from "../../../../../../src/projectService.js";
import * as projectService from "../../../../../../src/projectService.js";
import { resetSkills, listSkills, linkSkill } from "../../../../../../src/skillService.js";
import * as skillService from "../../../../../../src/skillService.js";

describe("Projects", () => {
  beforeEach(() => {
    resetProjects();
  });

  it("REQ-003: creates a local project", () => {
    const project = createLocalProject({
      name: "Hot News",
      description: "Daily news scraper",
      localPath: "~/opc-workspace/hot-news"
    });
    assert.equal(project.name, "Hot News");
    assert.equal(project.sourceType, "local");
    assert.equal(listProjects().length, 1);
  });

  it("REQ-003: rejects local project without name", () => {
    assert.throws(() => createLocalProject({ localPath: "/tmp" }), /required/);
  });

  it("REQ-004: creates a project from git checkout", () => {
    const project = createGitProject({
      name: "Hot News Git",
      repoUrl: "https://github.com/user/hot-news.git",
      branch: "main",
      localPath: "~/opc-workspace/hot-news-git"
    });
    assert.equal(project.sourceType, "git");
    assert.equal(project.repoUrl, "https://github.com/user/hot-news.git");
    assert.equal(project.branch, "main");
  });

  it("REQ-004: uses default branch when not provided", () => {
    const project = createGitProject({
      name: "No Branch",
      repoUrl: "https://github.com/user/repo.git"
    });
    assert.equal(project.branch, "main");
  });

  it("REQ-004: rejects git project without repository URL", () => {
    assert.throws(
      () => createGitProject({ name: "Bad" }),
      /Repository URL is required/
    );
  });

  it("REQ-005: filters projects by name case-insensitively", () => {
    createLocalProject({ name: "Hot News", localPath: "/a" });
    createLocalProject({ name: "TikTok Stars", localPath: "/b" });
    const filtered = filterProjects(listProjects(), "hot");
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0].name, "Hot News");
  });

  it("REQ-005: returns all projects when filter is empty", () => {
    createLocalProject({ name: "A", localPath: "/a" });
    createLocalProject({ name: "B", localPath: "/b" });
    assert.equal(filterProjects(listProjects(), "").length, 2);
  });

  it("REQ-021: project detail exposes overview metadata", () => {
    const project = createLocalProject({
      name: "Hot News",
      description: "Daily news scraper",
      localPath: "~/opc-workspace/hot-news"
    });
    assert.equal(typeof projectService.getProjectDetail, "function");
    const detail = projectService.getProjectDetail(project.id);
    assert.equal(detail.name, "Hot News");
    assert.equal(detail.localPath, "~/opc-workspace/hot-news");
    assert.ok(detail.updatedAt);
    assert.ok(Object.prototype.hasOwnProperty.call(detail, "flowsCount"));
    assert.ok(Object.prototype.hasOwnProperty.call(detail, "runsCount"));
  });

  it("REQ-021: skills tab lists available skills and linked state", () => {
    resetSkills([
      {
        id: "s1",
        name: "news-fetcher",
        repoPath: "~/.opc-workstation/skills/news-fetcher",
        version: "1.2.0",
        category: "Data"
      }
    ]);
    const project = createLocalProject({
      name: "Hot News",
      localPath: "~/opc-workspace/hot-news"
    });
    const skill = listSkills()[0];
    assert.equal(typeof skillService.getLinkedSkills, "function");
    assert.deepEqual(skillService.getLinkedSkills(project.id), []);
    linkSkill(skill.id, project.id);
    assert.deepEqual(skillService.getLinkedSkills(project.id), [skill.id]);
  });

  it("REQ-021: toggling skill association is idempotent", () => {
    resetSkills([
      {
        id: "s1",
        name: "news-fetcher",
        repoPath: "~/.opc-workstation/skills/news-fetcher",
        version: "1.2.0"
      }
    ]);
    const project = createLocalProject({
      name: "Hot News",
      localPath: "~/opc-workspace/hot-news"
    });
    const skill = listSkills()[0];
    assert.equal(typeof skillService.getLinkedSkills, "function");
    linkSkill(skill.id, project.id);
    linkSkill(skill.id, project.id);
    assert.deepEqual(skillService.getLinkedSkills(project.id), [skill.id]);
  });
});
