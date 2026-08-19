import * as taskService from "../../services/taskService.js";
import * as schedulerService from "../../services/schedulerService.js";

export function handleSchedules(req, res, body, pathParts) {
  if (pathParts.length === 0) {
    if (req.method === "GET") {
      const schedules = taskService.listSchedules().map(toListView);
      return ok(res, schedules);
    }

    if (req.method === "POST") {
      try {
        // cron 合法性校验（E-SCHED-CRON 400 契约）由 schedulerService.validateCron
        // 承担（taskService 不 import schedulerService——模块图无环）。
        if (body?.cron) schedulerService.validateCron(body.cron);
        const schedule = taskService.createSchedule(body);
        try {
          schedulerService.upsert(schedule);
        } catch (upsertErr) {
          // Log and continue: schedule is persisted; cron registration failure is non-blocking.
          console.error("[scheduler] upsert failed after create:", upsertErr.message);
        }
        res.writeHead(201, { "Content-Type": "application/json" });
        return res.end(JSON.stringify(toListView(schedule)));
      } catch (err) {
        if (err.code === "E-SCHED-CRON") {
          return badRequest(res, err.message, "E-SCHED-CRON");
        }
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
      if (updated.enabled) {
        schedulerService.upsert(updated);
      } else {
        schedulerService.remove(updated.id);
      }
      return ok(res, toListView(updated));
    }

    if (req.method === "DELETE") {
      const deleted = taskService.deleteSchedule(scheduleId);
      if (!deleted) return notFound(res, "Schedule not found");
      schedulerService.remove(scheduleId);
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
    variables: schedule.variables,
    error: schedule.error,
    cronDescription: schedulerService.getCronDescription(schedule.cron)
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

function badRequest(res, message, code = "VALIDATION_ERROR") {
  res.writeHead(400, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: code, message }));
}

function notFound(res, message = "Not found") {
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "NOT_FOUND", message }));
}
