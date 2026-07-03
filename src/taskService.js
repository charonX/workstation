let executions = [];
let schedules = [];

export function resetTasks(seed = { executions: [], schedules: [] }) {
  executions = (seed.executions || []).map(e => ({ ...e }));
  schedules = (seed.schedules || []).map(s => ({ ...s }));
}

function nextExecutionId() {
  return "e" + (executions.length + 1);
}

function nextScheduleId() {
  return "sch" + (schedules.length + 1);
}

function timestamp() {
  return new Date().toISOString();
}

export function createTask({ projectId, flowId, trigger }) {
  if (!projectId) throw new Error("Project is required");
  const execution = {
    id: nextExecutionId(),
    projectId,
    flowId,
    trigger: trigger || "manual",
    status: "running",
    startedAt: timestamp(),
    endedAt: null,
    duration: null,
    nodesRun: 0,
    logs: [],
    variables: {},
    output: null
  };
  executions.unshift(execution);
  return { ...execution };
}

export function createSchedule({ projectId, flowId, cron }) {
  if (!projectId) throw new Error("Project is required");
  if (!cron) throw new Error("Cron expression is required");
  const schedule = {
    id: nextScheduleId(),
    projectId,
    flowId,
    cron,
    enabled: true
  };
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

export function getExecution(id) {
  const execution = executions.find(e => e.id === id);
  return execution ? { ...execution } : undefined;
}

export function completeExecution(id, { duration, nodesRun, output }) {
  const execution = executions.find(e => e.id === id);
  if (!execution) return undefined;
  execution.status = "success";
  execution.endedAt = timestamp();
  execution.duration = duration;
  execution.nodesRun = nodesRun;
  if (output !== undefined) execution.output = output;
  return { ...execution };
}

export function addExecutionLog(id, { node, status, message }) {
  const execution = executions.find(e => e.id === id);
  if (!execution) return undefined;
  execution.logs.push({ at: timestamp(), node, status, message });
  return { ...execution };
}

export function setExecutionVariables(id, variables) {
  const execution = executions.find(e => e.id === id);
  if (!execution) return undefined;
  execution.variables = { ...execution.variables, ...variables };
  return { ...execution };
}

export function getExecutionDetailTabs() {
  return ["logs", "variables", "output"];
}

export function getDefaultDetailTab() {
  return "logs";
}
