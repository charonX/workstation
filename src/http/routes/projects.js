import * as projectService from "../../services/projectService.js";
import * as skillService from "../../services/skillService.js";
import * as permissionConfigService from "../../services/permissionConfigService.js";
import { ok, noContent, notFound, mapError, decodeParam } from "../responders.js";

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
        const existing = projectService.getProjectDetail(projectId);
        if (!existing) return notFound(res, "Project not found");
        const updated = projectService.updateProject(projectId, body || {});
        if (!updated) return notFound(res, "Project not found");
        // F3: agentTypes in the body triggers synchronous convergence (link
        // migration across the before/after declared dirs); other partial
        // updates leave the linked state alone.
        let convergence = { agents: [] };
        if (Object.prototype.hasOwnProperty.call(body || {}, "agentTypes")) {
          convergence = skillService.convergeProjectSkills(updated, existing.agentTypes, updated.agentTypes);
        }
        return ok(res, { ...updated, convergence });
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
        // Bulk body {skills:[...]} (REQ-SKILL-010 AC8); single object falls
        // through to the legacy per-agent result shape for backward compat.
        if (Array.isArray(body?.skills)) {
          return ok(res, skillService.linkSkillsToProject(project, body));
        }
        return ok(res, skillService.linkSkillToProject(project, body));
      } catch (err) {
        return mapError(res, err);
      }
    }
    if (req.method === "GET") {
      try {
        return ok(res, skillService.listProjectSkills(project));
      } catch (err) {
        return mapError(res, err);
      }
    }
    if (req.method === "DELETE") {
      // Bulk unlink with JSON body {skills:[...]} (REQ-SKILL-011 AC5).
      try {
        return ok(res, skillService.unlinkSkillsFromProject(project, body));
      } catch (err) {
        return mapError(res, err);
      }
    }
    return notFound(res);
  }

  if (pathParts.length === 2 && pathParts[1] === "permission") {
    // PI 权限配置（REQ-AGENT-059~068，2026-08-10-pi-permission-config-ui Slice 2）。
    // 契约（tech-design §3.1/3.2）：GET → {global, project, merged, rules[]}；
    // PUT body=项目 JSON → {saved, mtime}。错误响应带 `code` 字段（既有 mapError
    // 输出 `error` 字段，形态不符——分支内显式构造，最小侵入不改 mapError 既有行为）。
    if (req.method === "GET") {
      return handlePermissionRequest(res, () => permissionConfigService.getPermissionView(projectId));
    }
    if (req.method === "PUT") {
      return handlePermissionRequest(res, () => permissionConfigService.savePermission(projectId, body));
    }
    return notFound(res);
  }

  if (pathParts.length === 3 && pathParts[1] === "skills" && pathParts[2] === "resync") {
    if (req.method !== "POST") return notFound(res);
    const project = projectService.getProjectDetail(projectId);
    if (!project) return notFound(res, "Project not found");
    try {
      return ok(res, skillService.resyncProjectSkills(project));
    } catch (err) {
      return mapError(res, err);
    }
  }

  if (pathParts.length === 4 && pathParts[1] === "skills") {
    if (req.method !== "DELETE") return notFound(res);
    const project = projectService.getProjectDetail(projectId);
    if (!project) return notFound(res, "Project not found");
    try {
      return ok(
        res,
        skillService.unlinkSkillFromProject(project, {
          slug: decodeParam(pathParts[2]),
          skillName: decodeParam(pathParts[3])
        })
      );
    } catch (err) {
      return mapError(res, err);
    }
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
    // Flat fields at the top level (agentTypes reads, REQ-WORKSPACE-011);
    // the overview envelope is kept for the renderer's existing consumers.
    ...project,
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
    // Project skill view: live scan of the declared agent dirs (REQ-SKILL-012).
    skills: skillService.listProjectSkills(project)
  };
}



// 权限端点统一错误映射（契约形态，tech-design §3.1/3.2）：E-PROJECT-NOT-FOUND →
// 404；E-PERMISSION-INVALID → 400 + issues 透传（PUT）；E-PERMISSION-WRITE → 500；
// 其余按既有 mapError（error 字段形态）。GET 路径只会抛 E-PROJECT-NOT-FOUND 与
// 未知错误，映射表全量覆盖两路。
function handlePermissionRequest(res, fn) {
  try {
    return ok(res, fn());
  } catch (err) {
    if (err.code === "E-PERMISSION-INVALID") {
      return permissionError(res, 400, err.code, err.message, { issues: err.issues });
    }
    if (err.code === "E-PROJECT-NOT-FOUND") return permissionError(res, 404, err.code, err.message);
    if (err.code === "E-PERMISSION-WRITE") return permissionError(res, 500, err.code, err.message);
    return mapError(res, err);
  }
}

// 权限配置端点错误响应（契约形态：顶层 `code` 字段；E-PERMISSION-INVALID 经
// extra 透传 issues:[{path, message}]，tech-design §3.2）。
function permissionError(res, status, code, message, extra) {
  res.writeHead(status, { "Content-Type": "application/json" });
  return res.end(JSON.stringify({ code, message, ...extra }));
}


