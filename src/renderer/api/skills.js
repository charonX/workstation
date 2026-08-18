import { get, post, del } from "./client.js";

// ADR-011 skill API (replaces legacy /api/skill-repos + SSE stream).
//   GET  /api/skills                 grouped live scan: [{slug, sourceType, sourceUrl, skills:[{skillName,...}]}]
//   POST /api/skills/install         {sourceType, identifier, force?} -> {jobId}
//   GET  /api/skills/jobs/:jobId     {id, status, error:{code,message}|null}
//   POST /api/skills/:slug/update    -> {jobId} (git only; local -> 400)
//   DELETE /api/skills/:slug         -> {deleted}

export function listSkillGroups() {
  return get("/api/skills");
}

export function startInstall(body) {
  return post("/api/skills/install", body);
}

export function getJob(jobId) {
  return get(`/api/skills/jobs/${encodeURIComponent(jobId)}`);
}

export function requestSourceUpdate(slug) {
  return post(`/api/skills/${encodeURIComponent(slug)}/update`);
}

export function deleteSource(slug) {
  return del(`/api/skills/${encodeURIComponent(slug)}`);
}

// Poll GET /api/skills/jobs/:jobId until the job reaches a terminal state.
// Returns the final success job; throws with error.code/message on failure.
export async function waitForJob(jobId, { pollIntervalMs = 200, timeoutMs = 30000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const job = await getJob(jobId);
    if (job.status === "success") return job;
    if (job.status === "error") {
      const err = new Error(job.error?.message || "Skill job failed");
      err.code = job.error?.code;
      err.log = job.log ?? null; // REQ-021 AC3: carry the raw git output for UI display
      throw err;
    }
    if (Date.now() > deadline) {
      const err = new Error("Timed out waiting for skill job to finish");
      err.code = "SKILL_JOB_TIMEOUT";
      throw err;
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
}
