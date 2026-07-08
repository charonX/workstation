import { ensureServer } from "../server.js";

export async function create(flags) {
  const server = await ensureServer();
  const res = await fetch(`${server.baseUrl}/api/schedules`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ projectId: flags["project-id"], flowId: flags["flow-id"], cron: flags.cron })
  });
  return handleResponse(res, 201);
}

export async function toggle(flags) {
  const server = await ensureServer();
  const res = await fetch(`${server.baseUrl}/api/schedules/${flags.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({})
  });
  return handleResponse(res);
}

export async function list() {
  const server = await ensureServer();
  const res = await fetch(`${server.baseUrl}/api/schedules`);
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
