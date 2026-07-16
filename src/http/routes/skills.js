import * as skillService from "../../services/skillService.js";

export function handleSkills(req, res, body, pathParts) {
  if (pathParts.length === 0) {
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
      res.write(`data: ${JSON.stringify({ type: "success", repo: job.result.repo, skills: job.result.skills })}\n\n`);
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

    return notFound(res);
  }

  return notFound(res);
}

function ok(res, data) {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

function notFound(res, message = "Not found") {
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "NOT_FOUND", message }));
}
