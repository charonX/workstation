// Temporary stub for test compilation.

let executions = [];
let schedules = [];

export function resetTasks(seed = { executions: [], schedules: [] }) {
  executions = (seed.executions || []).map(e => ({ ...e }));
  schedules = (seed.schedules || []).map(s => ({ ...s }));
}

export function createTask({ projectId, flowId, trigger }) {
  if (!projectId) throw new Error("Project is required");
  const id = "e" + (executions.length + 1);
  const execution = {
    id,
    projectId,
    flowId,
    trigger: trigger || "manual",
    status: "running",
    startedAt: new Date().toISOString(),
    endedAt: null,
    duration: null,
    nodesRun: 0
  };
  executions.unshift(execution);
  return { ...execution };
}

export function createSchedule({ projectId, flowId, cron }) {
  if (!projectId) throw new Error("Project is required");
  if (!cron) throw new Error("Cron expression is required");
  const id = "sch" + (schedules.length + 1);
  const schedule = { id, projectId, flowId, cron, enabled: true };
  schedules.push(schedule);
  return { ...schedule };
}

export function toggleSchedule(id) {
  const schedule = schedules.find(s => s.id === id);
  if (schedule) schedule.enabled = !schedule.enabled;
  return schedule ? { ...schedule } : undefined;
}

export function listSchedules() {
  return schedules.map(s => ({ ...s }));
}

export function listExecutions() {
  return executions.map(e => ({ ...e }));
}

export function completeExecution(id, { duration, nodesRun }) {
  const execution = executions.find(e => e.id === id);
  if (!execution) return undefined;
  execution.status = "success";
  execution.endedAt = new Date().toISOString();
  execution.duration = duration;
  execution.nodesRun = nodesRun;
  return { ...execution };
}
