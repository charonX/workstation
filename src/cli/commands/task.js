import { ensureServer } from "../server.js";

export async function run(flags) {
  const server = await ensureServer();
  const body = { projectId: flags["project-id"], flowId: flags["flow-id"], trigger: flags.trigger || "manual" };
  // GAP 1（Slice 8）：工具面 task run 经 variables 记录 originating spaceKey
  // （执行变量 → 任务卡片路由）；CLI 手动路径不传。
  if (flags.variables !== undefined && flags.variables !== null) {
    body.variables = flags.variables;
  }
  const res = await fetch(`${server.baseUrl}/api/executions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  return handleResponse(res, 201);
}

export async function listExecutions() {
  const server = await ensureServer();
  const res = await fetch(`${server.baseUrl}/api/executions`);
  return handleResponse(res);
}

export async function getExecution(flags) {
  const server = await ensureServer();
  const res = await fetch(`${server.baseUrl}/api/executions/${flags.id}`);
  return handleResponse(res);
}

// Alias for CLI `opc-workstation task get --id <id>`.
export { getExecution as get };

async function handleResponse(res, expectedStatus) {
  const data = await res.json();
  if (!res.ok || (expectedStatus && res.status !== expectedStatus)) {
    const err = new Error(data.message || "Request failed");
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}
