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

async function deleteProject(flags) {
  const server = await ensureServer();
  const res = await fetch(`${server.baseUrl}/api/projects/${flags.id}`, { method: "DELETE" });
  if (!res.ok) {
    const data = await res.json().catch(() => ({ message: "Request failed" }));
    const err = new Error(data.message || "Request failed");
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return { success: true };
}

export { deleteProject as delete };

// REQ-CLI-002 AC3: `project update <id> --agents a,b,c` is the CLI form of
// PUT /api/projects/:id {agentTypes}. The response (updated project +
// convergence result) is printed as-is.
export async function update(flags, positional = []) {
  const id = positional[0];
  if (!id) throw usageError("Usage: project update <id> --agents <a,b,c>");
  const body = {};
  if (flags.agents !== undefined) {
    body.agentTypes = String(flags.agents)
      .split(",")
      .map((key) => key.trim())
      .filter(Boolean);
  }
  const server = await ensureServer();
  const res = await fetch(`${server.baseUrl}/api/projects/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  return handleResponse(res);
}

// REQ-CLI-002 AC2: `project skill <action>` third-level subcommand (CONTEXT.md
// naming convention extension), mapped to the project-skills endpoints:
//   project skill list <id>                      -> GET /api/projects/:id/skills
//   project skill link <id> <slug> <skillName>   -> POST /api/projects/:id/skills
//   project skill unlink <id> <slug> <skillName> -> DELETE /api/projects/:id/skills/:slug/:skillName
//   project skill resync <id>                    -> POST /api/projects/:id/skills/resync
export async function skill(flags, positional = []) {
  const [action, id, slug, skillName] = positional;
  const server = await ensureServer();
  const base = `${server.baseUrl}/api/projects/${encodeURIComponent(id ?? "")}/skills`;

  switch (action) {
    case "list": {
      if (!id) throw usageError("Usage: project skill list <id>");
      return handleResponse(await fetch(base));
    }
    case "link": {
      if (!id || !slug || !skillName) {
        throw usageError("Usage: project skill link <id> <slug> <skillName>");
      }
      return handleResponse(
        await fetch(base, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ slug, skillName })
        })
      );
    }
    case "unlink": {
      if (!id || !slug || !skillName) {
        throw usageError("Usage: project skill unlink <id> <slug> <skillName>");
      }
      const url = `${base}/${encodeURIComponent(slug)}/${encodeURIComponent(skillName)}`;
      return handleResponse(await fetch(url, { method: "DELETE" }));
    }
    case "resync": {
      if (!id) throw usageError("Usage: project skill resync <id>");
      return handleResponse(await fetch(`${base}/resync`, { method: "POST" }));
    }
    default:
      throw usageError(`Unknown project skill action: ${action || "(none)"} (expected list|link|unlink|resync)`);
  }
}

function usageError(message) {
  const err = new Error(message);
  err.status = 400;
  err.data = { error: "USAGE_ERROR", message };
  return err;
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
