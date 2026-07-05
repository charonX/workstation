// REQ-TRACE: REQ-003, REQ-004, REQ-005
// REQ-VERSION: v1-hash:2ac6ee56bb4da537ba3e109f9a72e2aa36febb15beac6bdda04cbc2f9be68045
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  resetProjects,
  createLocalProject,
  createGitProject,
  listProjects,
  filterProjects
} from "../src/projectService.js";

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
});
