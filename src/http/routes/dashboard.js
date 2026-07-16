import * as projectService from "../../services/projectService.js";
import * as taskService from "../../services/taskService.js";
import * as flowService from "../../services/flowService.js";

export function handleDashboard(req, res) {
  if (req.method !== "GET") return notFound(res);

  const projects = projectService.listProjects();
  const schedules = taskService.listSchedules();
  const executions = taskService.listExecutions();

  const projectCount = projects.length;
  const activeScheduleCount = schedules.filter(s => s.enabled).length;
  const recentRunCount = executions.length;
  const successCount = executions.filter(e => e.status === "success").length;
  const successRate = recentRunCount === 0 ? 0 : successCount / recentRunCount;

  const recentExecutions = executions.slice(0, 5).map(e => {
    const project = projects.find(p => p.id === e.projectId);
    const flow = flowService.getFlow(e.flowId);
    return {
      flowName: flow?.name || null,
      projectName: project?.name || null,
      status: e.status,
      time: e.startedAt
    };
  });

  const quickProjectLinks = projects.slice(0, 5).map(p => ({
    id: p.id,
    name: p.name
  }));

  return ok(res, {
    projectCount,
    activeScheduleCount,
    recentRunCount,
    successRate,
    recentExecutions,
    quickProjectLinks
  });
}

function ok(res, data) {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

function notFound(res, message = "Not found") {
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "NOT_FOUND", message }));
}
