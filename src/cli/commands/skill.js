import { ensureServer } from "../server.js";

export async function list() {
  const server = await ensureServer();
  const res = await fetch(`${server.baseUrl}/api/skills`);
  return handleResponse(res);
}

export async function get(flags) {
  const server = await ensureServer();
  const res = await fetch(`${server.baseUrl}/api/skills/${flags.id}`);
  return handleResponse(res);
}

export async function install(flags) {
  const server = await ensureServer();
  const res = await fetch(`${server.baseUrl}/api/skills/install`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ source: flags.source, identifier: flags.identifier })
  });
  return handleResponse(res, 201);
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
