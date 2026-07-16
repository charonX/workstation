import { ensureServer } from "../server.js";

export async function run(flags) {
  const server = await ensureServer();
  const res = await fetch(`${server.baseUrl}/api/executions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ projectId: flags["project-id"], flowId: flags["flow-id"], trigger: flags.trigger || "manual" })
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
