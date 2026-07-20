import { ensureServer } from "../server.js";

function parseTags(raw) {
  if (!raw) return undefined;
  return String(raw)
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

export async function create(flags) {
  const server = await ensureServer();
  const tags = parseTags(flags.tags);
  const res = await fetch(`${server.baseUrl}/api/content-sources`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: flags.name,
      type: flags.type,
      config: flags.config,
      tags
    })
  });
  return handleResponse(res, 201);
}

export async function list(flags = {}) {
  const server = await ensureServer();
  const params = new URLSearchParams();
  if (flags.tag) params.set("tag", flags.tag);
  if (flags.enabled) params.set("enabled", "1");
  const query = params.toString() ? `?${params.toString()}` : "";
  const res = await fetch(`${server.baseUrl}/api/content-sources${query}`);
  return handleResponse(res);
}

export async function update(flags) {
  const server = await ensureServer();
  const body = {};
  if (flags.name !== undefined) body.name = flags.name;
  if (flags.type !== undefined) body.type = flags.type;
  if (flags.config !== undefined) body.config = flags.config;
  if (flags.tags !== undefined) body.tags = parseTags(flags.tags);
  if (flags.enabled !== undefined) {
    body.enabled = flags.enabled === "false" ? false : Boolean(flags.enabled);
  }

  const res = await fetch(`${server.baseUrl}/api/content-sources/${flags.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  return handleResponse(res);
}

export async function toggle(flags) {
  const server = await ensureServer();
  const res = await fetch(`${server.baseUrl}/api/content-sources/${flags.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({})
  });
  return handleResponse(res);
}

async function deleteSource(flags) {
  const server = await ensureServer();
  const res = await fetch(`${server.baseUrl}/api/content-sources/${flags.id}`, { method: "DELETE" });
  if (!res.ok) {
    const data = await res.json().catch(() => ({ message: "Request failed" }));
    const err = new Error(data.message || "Request failed");
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return { success: true };
}

export { deleteSource as delete };

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
