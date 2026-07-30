import path from "node:path";
import { ensureServer } from "../server.js";

// REQ-CLI-002: skill command group, aligned with the ADR-011 HTTP API:
//   skill list                                             -> GET /api/skills
//   skill install --source git|local --identifier <> [--force] -> POST /api/skills/install (+ job poll)
//   skill update <slug>                                    -> POST /api/skills/:slug/update (+ job poll)
//   skill remove <slug>                                    -> DELETE /api/skills/:slug
//   skill agents                                           -> GET /api/agents
// The legacy /api/skill-repos calls and the SSE install stream are gone.

const VALID_SOURCES = ["git", "local"];
const JOB_POLL_INTERVAL_MS = 100;
const JOB_TIMEOUT_MS = 30000;

export async function list() {
  const server = await ensureServer();
  const res = await fetch(`${server.baseUrl}/api/skills`);
  return handleResponse(res);
}

export async function install(flags) {
  const source = flags.source;
  const identifier = flags.identifier;

  // CLI-side guard (REQ-SKILL-009): only git/local exist; the API 400 is the backstop.
  if (!VALID_SOURCES.includes(source)) {
    throw codedCliError(
      400,
      "SKILL_SOURCE_INVALID",
      `Unsupported skill source: ${source ?? "(missing)"} (expected "git" or "local")`
    );
  }
  if (typeof identifier !== "string" || identifier.trim() === "") {
    throw codedCliError(400, "SKILL_SOURCE_INVALID", "--identifier is required");
  }

  const server = await ensureServer();
  // Git slugs derive from the URL server-side (with collision suffixes); a
  // before/after diff of the library listing is the drift-free way for the
  // CLI to learn which group the install created.
  const beforeSlugs =
    source === "git" ? new Set((await fetchGroups(server.baseUrl)).map((g) => g.slug)) : null;

  const body = { sourceType: source, identifier };
  if (flags.force === true || flags.force === "true") body.force = true;
  const startRes = await fetch(`${server.baseUrl}/api/skills/install`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const { jobId } = await handleResponse(startRes);
  await waitForJob(server.baseUrl, jobId);

  // Signed-off output: {slug, sourceType, skills[]} of the installed source.
  const groups = await fetchGroups(server.baseUrl);
  let group;
  if (source === "local") {
    // Local slugs are deterministic: basename of the source directory.
    group = groups.find((g) => g.slug === path.basename(identifier.trim()));
  }
  if (!group && beforeSlugs) {
    group = groups.find((g) => !beforeSlugs.has(g.slug));
  }
  if (!group) {
    throw codedCliError(500, "INTERNAL_ERROR", "Installed source did not appear in the skill library listing");
  }
  return { slug: group.slug, sourceType: group.sourceType, skills: group.skills };
}

export async function update(flags, positional = []) {
  const slug = positional[0];
  if (!slug) throw usageError("Usage: skill update <slug>");
  const server = await ensureServer();
  const res = await fetch(`${server.baseUrl}/api/skills/${encodeURIComponent(slug)}/update`, {
    method: "POST"
  });
  const { jobId } = await handleResponse(res);
  return waitForJob(server.baseUrl, jobId);
}

export async function remove(flags, positional = []) {
  const slug = positional[0];
  if (!slug) throw usageError("Usage: skill remove <slug>");
  const server = await ensureServer();
  const res = await fetch(`${server.baseUrl}/api/skills/${encodeURIComponent(slug)}`, { method: "DELETE" });
  return handleResponse(res);
}

export async function agents() {
  const server = await ensureServer();
  const res = await fetch(`${server.baseUrl}/api/agents`);
  return handleResponse(res);
}

async function fetchGroups(baseUrl) {
  const res = await fetch(`${baseUrl}/api/skills`);
  return handleResponse(res);
}

// Poll GET /api/skills/jobs/:jobId to a terminal state. Job errors surface
// with the API error code ({error: CODE}) so stderr carries E1/E2/... codes.
async function waitForJob(baseUrl, jobId) {
  const deadline = Date.now() + JOB_TIMEOUT_MS;
  for (;;) {
    const res = await fetch(`${baseUrl}/api/skills/jobs/${jobId}`);
    const job = await handleResponse(res);
    if (job.status === "success") return job;
    if (job.status === "error") {
      throw codedCliError(
        500,
        job.error?.code || "SKILL_JOB_FAILED",
        job.error?.message || "Skill job failed"
      );
    }
    if (Date.now() > deadline) {
      throw codedCliError(500, "SKILL_JOB_TIMEOUT", "Timed out waiting for the skill job to finish");
    }
    await new Promise((resolve) => setTimeout(resolve, JOB_POLL_INTERVAL_MS));
  }
}

function usageError(message) {
  return codedCliError(400, "USAGE_ERROR", message);
}

function codedCliError(status, code, message) {
  const err = new Error(message);
  err.status = status;
  err.data = { error: code, message };
  return err;
}

async function handleResponse(res) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.message || `Request failed with status ${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}
