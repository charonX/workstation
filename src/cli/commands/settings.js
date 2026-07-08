import { ensureServer } from "../server.js";

export async function get() {
  const server = await ensureServer();
  const res = await fetch(`${server.baseUrl}/api/settings`);
  return handleResponse(res);
}

export async function set(flags) {
  const server = await ensureServer();
  const body = {};
  if (flags["workspace-root"] !== undefined) body.workspaceRoot = flags["workspace-root"];
  if (flags["skill-repo-path"] !== undefined) body.skillRepoPath = flags["skill-repo-path"];
  if (flags.density !== undefined) body.density = flags.density;
  if (flags.language !== undefined) body.language = flags.language;
  if (flags.theme !== undefined) body.theme = flags.theme;

  const res = await fetch(`${server.baseUrl}/api/settings`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
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
