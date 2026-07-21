import { ensureServer } from "../server.js";

export async function list(flags = {}) {
  const server = await ensureServer();
  const res = await fetch(`${server.baseUrl}/api/templates`);
  return handleResponse(res);
}

export async function instantiate(flags = {}) {
  const server = await ensureServer();
  const id = flags.id;
  const projectId = flags["project-id"];
  if (!id || !projectId) {
    throw Object.assign(new Error("--id and --project-id are required"), {
      status: 400,
      data: { error: "VALIDATION_ERROR", message: "--id and --project-id are required" }
    });
  }
  const res = await fetch(`${server.baseUrl}/api/templates/${id}/instantiate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      projectId,
      force: flags.force === true || flags.force === "true"
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
