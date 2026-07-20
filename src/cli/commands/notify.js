import { ensureServer } from "../server.js";

export async function list(flags) {
  const server = await ensureServer();
  const query = flags.unread ? "?unreadOnly=1" : "";
  const res = await fetch(`${server.baseUrl}/api/notifications${query}`);
  return handleResponse(res);
}

export async function read(flags) {
  const server = await ensureServer();
  if (flags.all) {
    const res = await fetch(`${server.baseUrl}/api/notifications/read-all`, { method: "POST" });
    return handleResponse(res);
  }
  if (flags.id) {
    const res = await fetch(`${server.baseUrl}/api/notifications/${flags.id}/read`, { method: "POST" });
    return handleResponse(res);
  }
  const err = new Error("Missing --id or --all");
  err.status = 400;
  throw err;
}

async function handleResponse(res) {
  const data = await res.json();
  if (!res.ok) {
    const err = new Error(data.message || "Request failed");
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}
