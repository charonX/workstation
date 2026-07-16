import * as taskService from "../../services/taskService.js";

export function handleSchedules(req, res, body, pathParts) {
  if (pathParts.length === 0) {
    if (req.method === "GET") {
      const schedules = taskService.listSchedules().map(toListView);
      return ok(res, schedules);
    }

    if (req.method === "POST") {
      try {
        const schedule = taskService.createSchedule(body);
        res.writeHead(201, { "Content-Type": "application/json" });
        return res.end(JSON.stringify(toListView(schedule)));
      } catch (err) {
        return badRequest(res, err.message);
      }
    }

    return notFound(res);
  }

  const scheduleId = pathParts[0];

  if (pathParts.length === 1) {
    if (req.method === "PATCH") {
      let updated;
      if (body && typeof body.enabled === "boolean") {
        updated = taskService.setScheduleEnabled(scheduleId, body.enabled);
      } else {
        updated = taskService.toggleSchedule(scheduleId);
      }
      if (!updated) return notFound(res, "Schedule not found");
      return ok(res, toListView(updated));
    }

    if (req.method === "DELETE") {
      const deleted = taskService.deleteSchedule(scheduleId);
      if (!deleted) return notFound(res, "Schedule not found");
      return noContent(res);
    }

    return notFound(res);
  }

  return notFound(res);
}

function toListView(schedule) {
  return {
    id: schedule.id,
    projectId: schedule.projectId,
    flowId: schedule.flowId,
    cron: schedule.cron,
    enabled: schedule.enabled,
    cronDescription: taskService.getCronDescription(schedule.cron)
  };
}

function ok(res, data) {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

function noContent(res) {
  res.writeHead(204);
  res.end();
}

function badRequest(res, message) {
  res.writeHead(400, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "VALIDATION_ERROR", message }));
}

function notFound(res, message = "Not found") {
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "NOT_FOUND", message }));
}
