import * as skillService from "../../services/skillService.js";

export function handleSkills(req, res, body, pathParts) {
  if (pathParts.length === 0) {
    if (req.method === "GET") {
      const skills = skillService.listSkills();
      return ok(res, skills);
    }

    if (req.method === "POST") {
      try {
        const skill = skillService.createSkill(body);
        res.writeHead(201, { "Content-Type": "application/json" });
        return res.end(JSON.stringify(skill));
      } catch (err) {
        return badRequest(res, err.message);
      }
    }

    return notFound(res);
  }

  const skillId = pathParts[0];

  if (pathParts.length === 1 && skillId === "install") {
    if (req.method === "POST") {
      try {
        const { jobId } = skillService.startInstallJob(body);
        res.writeHead(202, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ jobId }));
      } catch (err) {
        const status = err.status || 500;
        res.writeHead(status, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ error: status === 400 ? "VALIDATION_ERROR" : "INTERNAL_ERROR", message: err.message }));
      }
    }
    return notFound(res);
  }

  if (pathParts.length === 3 && skillId === "install" && pathParts[2] === "stream" && req.method === "GET") {
    const jobId = pathParts[1];
    const job = skillService.getInstallJob(jobId);
    if (!job) return notFound(res, "Install job not found");

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive"
    });

    for (const text of job.logs) {
      res.write(`data: ${JSON.stringify({ type: "log", text })}\n\n`);
    }

    if (job.status === "success") {
      res.write(`data: ${JSON.stringify({ type: "success", skill: job.skill })}\n\n`);
      return res.end();
    }

    if (job.status === "error") {
      res.write(`data: ${JSON.stringify({ type: "error", message: job.errorMessage })}\n\n`);
      return res.end();
    }

    const listener = (event) => {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
      if (event.type === "success" || event.type === "error") {
        res.end();
      }
    };

    const unsubscribe = skillService.subscribeInstallJob(jobId, listener);
    req.on("close", () => {
      unsubscribe?.();
    });
    return;
  }

  if (pathParts.length === 1) {
    if (req.method === "GET") {
      const skill = skillService.getSkillDetail(skillId);
      if (!skill) return notFound(res, "Skill not found");
      return ok(res, skill);
    }

    if (req.method === "DELETE") {
      const result = skillService.deleteSkill(skillId);
      if (!result.deleted) {
        if (result.reason === "not_found") return notFound(res, "Skill not found");
        if (result.reason === "linked") return badRequest(res, "Skill is linked to one or more projects");
        return badRequest(res, "Cannot delete skill");
      }
      return noContent(res);
    }

    return notFound(res);
  }

  return notFound(res);
}

function ok(res, data) {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

function badRequest(res, message) {
  res.writeHead(400, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "VALIDATION_ERROR", message }));
}

function noContent(res) {
  res.writeHead(204);
  res.end();
}

function notFound(res, message = "Not found") {
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "NOT_FOUND", message }));
}
