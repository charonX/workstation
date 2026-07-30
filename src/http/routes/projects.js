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
        return mapError(res, err);
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

    if (req.method === "PUT") {
      try {
        const updated = projectService.updateProject(projectId, body || {});
        if (!updated) return notFound(res, "Project not found");
        // Convergence (link migration across changed agent dirs) is wired in a
        // later slice; the response already carries the field per the contract.
        return ok(res, { ...updated, convergence: { agents: [] } });
      } catch (err) {
        return mapError(res, err);
      }
    }

    if (req.method === "DELETE") {
      const deleted = projectService.deleteProject(projectId);
      if (!deleted) return notFound(res, "Project not found");
      return noContent(res);
    }

    return notFound(res);
  }

  if (pathParts.length === 2 && pathParts[1] === "skills") {
    const project = projectService.getProjectDetail(projectId);
    if (!project) return notFound(res, "Project not found");
    if (req.method === "POST") {
      try {
        return ok(res, skillService.linkSkillToProject(project, body));
      } catch (err) {
        return mapError(res, err);
      }
    }
    // GET project skill view is implemented with the sync slice.
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
      cloneDirectory: body.cloneDirectory,
      agentTypes: body.agentTypes
    });
  }
  return projectService.createLocalProject({
    name: body.name,
    description: body.description,
    localPath: body.localPath,
    agentTypes: body.agentTypes
  });
}

function buildProjectDetail(projectId) {
  const project = projectService.getProjectDetail(projectId);
  if (!project) return null;
  return {
    overview: {
      name: project.name,
      description: project.description,
      sourceType: project.sourceType,
      repoUrl: project.repoUrl,
      branch: project.branch,
      localPath: project.localPath,
      agentTypes: project.agentTypes,
      flowsCount: project.flowsCount,
      runsCount: project.runsCount,
      updatedAt: project.updatedAt
    },
    // Project skill view (scan of declared agent dirs) lands with the sync slice.
    skills: []
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

function mapError(res, err) {
  const status = err.status || 400;
  const body = { error: err.code || "VALIDATION_ERROR", message: err.message };
  if (err.invalidAgents) body.invalidAgents = err.invalidAgents;
  res.writeHead(status, { "Content-Type": "application/json" });
  return res.end(JSON.stringify(body));
}

function notFound(res, message = "Not found") {
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "NOT_FOUND", message }));
}
