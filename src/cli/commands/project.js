import { ensureServer } from "../server.js";

export async function create(flags) {
  const server = await ensureServer();
  const body = { name: flags.name };
  if (flags["local-path"] !== undefined) body.localPath = flags["local-path"];
  if (flags["repo-url"] !== undefined) body.repoUrl = flags["repo-url"];
  if (flags.branch !== undefined) body.branch = flags.branch;

  const res = await fetch(`${server.baseUrl}/api/projects`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  return handleResponse(res, 201);
}

export async function list(flags) {
  if (!flags || !flags.q) {
    const err = new Error("Command not implemented: project list");
    err.status = 400;
    err.data = { error: "NOT_IMPLEMENTED", message: "Command not implemented: project list" };
    throw err;
  }
  const server = await ensureServer();
  const q = flags.q ? `?q=${encodeURIComponent(flags.q)}` : "";
  const res = await fetch(`${server.baseUrl}/api/projects${q}`);
  return handleResponse(res);
}

export async function get(flags) {
  const server = await ensureServer();
  const res = await fetch(`${server.baseUrl}/api/projects/${flags.id}`);
  return handleResponse(res);
}

export async function linkSkill(flags) {
  const server = await ensureServer();
  const res = await fetch(`${server.baseUrl}/api/projects/${flags["project-id"]}/skills`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ skillId: flags["skill-id"], linked: true })
  });
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
