import { ensureServer } from "../server.js";

export async function stats() {
  const server = await ensureServer();
  const res = await fetch(`${server.baseUrl}/api/dashboard`);
  return handleResponse(res);
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
