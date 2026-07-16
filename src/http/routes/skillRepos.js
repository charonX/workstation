import * as skillService from "../../services/skillService.js";

export function handleSkillRepos(req, res, body, pathParts) {
  if (pathParts.length === 0) {
    if (req.method === "GET") {
      const repos = skillService.listSkillRepos();
      return ok(res, repos);
    }
    return notFound(res);
  }

  const repoId = pathParts[0];

  if (pathParts.length === 1 && req.method === "DELETE") {
    const result = skillService.deleteSkillRepo(repoId);
    if (!result.deleted) {
      if (result.reason === "not_found") return notFound(res, "Skill repo not found");
      return badRequest(res, "Cannot delete skill repo");
    }
    return noContent(res);
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
