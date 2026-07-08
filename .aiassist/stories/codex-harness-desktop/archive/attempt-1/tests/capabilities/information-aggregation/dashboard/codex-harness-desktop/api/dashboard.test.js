// REQ-TRACE: codex-harness-desktop/REQ-023
// REQ-VERSION: v1-hash:2c79015bd970c381f96e90dfa5950a839b3fdf9b90606fadf73c07c381cbaad8
// CAPABILITY-TRACE: information-aggregation
// ENTITY-TRACE: dashboard
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: false

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { resetProjects, createLocalProject, listProjects } from "../../../../../../src/projectService.js";
import { createFlow, listFlows } from "../../../../../../src/flowService.js";
import { createSchedule, listSchedules, createTask, listExecutions, completeExecution } from "../../../../../../src/taskService.js";

function getDashboardStats() {
  const projects = listProjects();
  const flows = listFlows();
  const schedules = listSchedules();
  const executions = listExecutions();
  const successCount = executions.filter(e => e.status === "success").length;
  const projectById = Object.fromEntries(projects.map(p => [p.id, p]));
  const flowById = Object.fromEntries(flows.map(f => [f.id, f]));
  return {
    projectCount: projects.length,
    activeScheduleCount: schedules.filter(s => s.enabled).length,
    recentRunCount: executions.length,
    successRate: executions.length ? successCount / executions.length : 0,
    recentExecutions: executions.slice(0, 5).map(e => ({
      flowName: flowById[e.flowId]?.name ?? e.flowId,
      projectName: projectById[e.projectId]?.name ?? e.projectId,
      status: e.status,
      time: e.startedAt
    })),
    quickProjectLinks: projects.map(p => ({ id: p.id, name: p.name }))
  };
}

describe("Dashboard", () => {
  beforeEach(() => {
    resetProjects();
  });

  it("REQ-023: exposes key metric cards", () => {
    const project = createLocalProject({ name: "Hot News", localPath: "~/opc-workspace/hot-news" });
    createFlow({ name: "Fetch", projectId: project.id, description: "" });
    createSchedule({ projectId: project.id, flowId: "f1", cron: "0 8 * * *" });
    const execution = createTask({ projectId: project.id, flowId: "f1" });
    completeExecution(execution.id, { duration: "5s", nodesRun: 3 });

    const stats = getDashboardStats();
    assert.equal(stats.projectCount, 1);
    assert.equal(stats.activeScheduleCount, 1);
    assert.equal(stats.recentRunCount, 1);
    assert.equal(stats.successRate, 1);
  });

  it("REQ-023: lists recent executions with flow, project, status and time", () => {
    const project = createLocalProject({ name: "Hot News", localPath: "~/opc-workspace/hot-news" });
    const execution = createTask({ projectId: project.id, flowId: "f1" });
    completeExecution(execution.id, { duration: "5s", nodesRun: 3 });

    const recent = getDashboardStats().recentExecutions;
    assert.equal(recent.length, 1);
    assert.equal(recent[0].projectName, project.name);
    assert.equal(recent[0].status, "success");
    assert.ok(recent[0].time);
  });

  it("REQ-023: provides quick project links", () => {
    createLocalProject({ name: "Hot News", localPath: "~/opc-workspace/hot-news" });
    createLocalProject({ name: "TikTok Stars", localPath: "~/opc-workspace/tiktok" });

    const links = getDashboardStats().quickProjectLinks;
    assert.equal(links.length, 2);
    assert.ok(links.find(l => l.name === "Hot News"));
  });
});
