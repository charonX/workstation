import { ensureServer } from "../server.js";

export async function binding(flags = {}) {
  const server = await ensureServer();
  const res = await fetch(`${server.baseUrl}/api/channel/binding`);
  return handleResponse(res);
}

export async function bind(flags = {}) {
  const server = await ensureServer();
  const res = await fetch(`${server.baseUrl}/api/channel/binding`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      flowId: flags["flow-id"],
      projectId: flags["project-id"],
      force: flags.force === true || flags.force === "true"
    })
  });
  return handleResponse(res, 201);
}

export async function credentials(flags = {}) {
  const server = await ensureServer();
  const res = await fetch(`${server.baseUrl}/api/channel/credentials`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      appId: flags["app-id"],
      appSecret: flags["app-secret"]
    })
  });
  return handleResponse(res, 201);
}

async function handleResponse(res, expectedStatus) {
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok || (expectedStatus && res.status !== expectedStatus)) {
    const err = new Error(data.message || "Request failed");
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}
