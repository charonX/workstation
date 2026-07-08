import cron from "node-cron";
import { getDb } from "./db.js";
import * as eventBus from "./eventBus.js";
import * as taskService from "./taskService.js";

const jobs = new Map();

export function start() {
  stop();
  const schedules = taskService.listSchedules().filter(s => s.enabled);
  for (const schedule of schedules) {
    registerJob(schedule);
  }
}

export function stop() {
  for (const job of jobs.values()) {
    job.stop();
  }
  jobs.clear();
}

export function createSchedule(input) {
  const schedule = taskService.createSchedule(input);
  if (schedule.enabled) {
    registerJob(schedule);
  }
  return schedule;
}

export function toggleSchedule(id) {
  const schedule = taskService.toggleSchedule(id);
  if (!schedule) return undefined;
  // Re-register if enabled, stop if disabled.
  if (jobs.has(id)) {
    jobs.get(id).stop();
    jobs.delete(id);
  }
  if (schedule.enabled) {
    registerJob(schedule);
  }
  return schedule;
}

export function deleteSchedule(id) {
  if (jobs.has(id)) {
    jobs.get(id).stop();
    jobs.delete(id);
  }
  const db = getDb();
  const result = db.prepare("DELETE FROM schedules WHERE id = ?").run(id);
  return result.changes > 0;
}

function registerJob(schedule) {
  if (!cron.validate(schedule.cron)) return;
  const job = cron.schedule(schedule.cron, () => {
    eventBus.publish("schedule:triggered", {
      scheduleId: schedule.id,
      projectId: schedule.projectId,
      flowId: schedule.flowId
    });
  }, { scheduled: true });
  jobs.set(schedule.id, job);
}
