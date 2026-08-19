import * as skillService from "../../services/skillService.js";
import { ok, notFound, mapError } from "../responders.js";

// Skills routes (ADR-011 model):
//   GET    /api/skills                  grouped live scan of the skill library
//   POST   /api/skills/install          {sourceType: "git"|"local", identifier, force?} -> 202 {jobId}
//   GET    /api/skills/jobs/:jobId      job polling {id, status, error:{code,message}}
//   POST   /api/skills/:slug/update     git pull --ff-only -> 202 {jobId} (local -> 400)
//   DELETE /api/skills/:slug            cascade link removal + delete source dir -> 200 {deleted}
// The legacy SSE install stream and the npm/plugin sources are gone.
export async function handleSkills(req, res, body, pathParts) {
  if (pathParts.length === 0) {
    if (req.method === "GET") {
      return ok(res, skillService.listSkillGroups());
    }
    return notFound(res);
  }

  if (pathParts.length === 1 && pathParts[0] === "install") {
    if (req.method === "POST") {
      try {
        const { jobId } = await skillService.startInstall(body);
        res.writeHead(202, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ jobId }));
      } catch (err) {
        return mapError(res, err);
      }
    }
    return notFound(res);
  }

  if (pathParts.length === 2 && pathParts[0] === "jobs" && req.method === "GET") {
    const job = skillService.getJob(pathParts[1]);
    if (!job) return notFound(res, "Job not found");
    return ok(res, job);
  }

  const slug = pathParts[0];

  if (pathParts.length === 2 && pathParts[1] === "update" && req.method === "POST") {
    try {
      const { jobId } = await skillService.requestSourceUpdate(slug);
      res.writeHead(202, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ jobId }));
    } catch (err) {
      return mapError(res, err);
    }
  }

  if (pathParts.length === 1 && req.method === "DELETE") {
    try {
      return ok(res, skillService.deleteSource(slug));
    } catch (err) {
      return mapError(res, err);
    }
  }

  return notFound(res);
}


