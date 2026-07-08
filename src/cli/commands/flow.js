import { ensureServer } from "../server.js";

export async function create(flags) {
  const server = await ensureServer();
  const res = await fetch(`${server.baseUrl}/api/flows`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: flags.name, projectId: flags["project-id"], description: flags.description })
  });
  return handleResponse(res, 201);
}

export async function list() {
  const server = await ensureServer();
  const res = await fetch(`${server.baseUrl}/api/flows`);
  return handleResponse(res);
}

export async function get(flags) {
  const server = await ensureServer();
  const res = await fetch(`${server.baseUrl}/api/flows/${flags.id}`);
  return handleResponse(res);
}

export async function importFlow(flags) {
  const server = await ensureServer();
  const fs = await import("node:fs");
  const content = fs.readFileSync(flags.file, "utf8");
  const body = JSON.parse(content);
  body.projectId = flags["project-id"];
  const res = await fetch(`${server.baseUrl}/api/flows/import`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  return handleResponse(res, 201);
}

export async function exportFlow(flags) {
  const server = await ensureServer();
  const res = await fetch(`${server.baseUrl}/api/flows/${flags.id}/export`);
  const data = await handleResponse(res);
  if (flags.file) {
    const fs = await import("node:fs");
    fs.writeFileSync(flags.file, JSON.stringify(data, null, 2));
  }
  return data;
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
