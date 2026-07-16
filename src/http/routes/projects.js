import * as projectService from "../../services/projectService.js";
import * as skillService from "../../services/skillService.js";

export async function handleProjects(req, res, body, pathParts) {
  if (pathParts.length === 0) {
    if (req.method === "GET") {
      const q = new URL(req.url, `http://${req.headers.host}`).searchParams.get("q") || "";
      const projects = projectService.filterProjects(projectService.listProjects(), q);
      return ok(res, projects);
    }

    if (req.method === "POST") {
      try {
        const project = await createProject(body);
        res.writeHead(201, { "Content-Type": "application/json" });
        return res.end(JSON.stringify(project));
      } catch (err) {
        return badRequest(res, err.message);
      }
    }

    return notFound(res);
  }

  const projectId = pathParts[0];

  if (pathParts.length === 1) {
    if (req.method === "GET") {
      const detail = buildProjectDetail(projectId);
      if (!detail) return notFound(res, "Project not found");
      return ok(res, detail);
    }

    if (req.method === "DELETE") {
      const deleted = projectService.deleteProject(projectId);
      if (!deleted) return notFound(res, "Project not found");
      return noContent(res);
    }

    return notFound(res);
  }

  if (pathParts.length === 2 && pathParts[1] === "skills") {
    if (req.method === "PATCH") {
      const { skillId, linked } = body || {};
      if (!skillId) return badRequest(res, "skillId is required");
      if (linked) {
        skillService.linkSkill(skillId, projectId);
      } else {
        skillService.unlinkSkill(skillId, projectId);
      }
      const detail = buildProjectDetail(projectId);
      return ok(res, detail);
    }
    return notFound(res);
  }

  return notFound(res);
}

async function createProject(body) {
  if (body.sourceType === "git" || body.repoUrl) {
    if (!body.repoUrl) throw new Error("Repository URL is required");
    return projectService.createGitProject({
      name: body.name,
      description: body.description,
      repoUrl: body.repoUrl,
      branch: body.branch,
      cloneDirectory: body.cloneDirectory
    });
  }
  return projectService.createLocalProject({
    name: body.name,
    description: body.description,
    localPath: body.localPath
  });
}

function buildProjectDetail(projectId) {
  const project = projectService.getProjectDetail(projectId);
  if (!project) return null;
  const linkedSkillIds = skillService.getLinkedSkills(projectId);
  const allSkills = skillService.listLinkableSkills();
  const skillMap = new Map(allSkills.map(s => [s.id, s]));
  const skills = [];
  for (const skill of allSkills) {
    skills.push({ ...skill, linked: linkedSkillIds.includes(skill.id) });
  }
  for (const id of linkedSkillIds) {
    if (!skillMap.has(id)) {
      skills.push({ id, linked: true });
    }
  }
  return {
    overview: {
      name: project.name,
      description: project.description,
      sourceType: project.sourceType,
      repoUrl: project.repoUrl,
      branch: project.branch,
      localPath: project.localPath,
      flowsCount: project.flowsCount,
      runsCount: project.runsCount,
      updatedAt: project.updatedAt
    },
    skills
  };
}

function ok(res, data) {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

function noContent(res) {
  res.writeHead(204);
  res.end();
}

function badRequest(res, message) {
  res.writeHead(400, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "VALIDATION_ERROR", message }));
}

function notFound(res, message = "Not found") {
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "NOT_FOUND", message }));
}
