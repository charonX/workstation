import * as flowService from "../../services/flowService.js";
import * as projectService from "../../services/projectService.js";
import * as taskService from "../../services/taskService.js";

export async function handleFlows(req, res, body, pathParts) {
  if (pathParts.length === 0) {
    if (req.method === "GET") {
      const flows = flowService.listFlows().map(toListView);
      return ok(res, flows);
    }

    if (req.method === "POST") {
      try {
        const flow = flowService.createFlow(body);
        res.writeHead(201, { "Content-Type": "application/json" });
        return res.end(JSON.stringify(toListView(flow)));
      } catch (err) {
        return badRequest(res, err.message, err.details);
      }
    }

    return notFound(res);
  }

  const flowId = pathParts[0];

  if (pathParts.length === 1 && flowId === "import") {
    if (req.method === "POST") {
      return handleFlowImport(req, res, body);
    }
    return notFound(res);
  }

  if (pathParts.length === 1) {
    if (req.method === "GET") {
      const flow = flowService.getFlow(flowId);
      if (!flow) return notFound(res, "Flow not found");
      return ok(res, flow);
    }

    if (req.method === "PATCH") {
      try {
        const flow = flowService.updateFlow(flowId, body);
        if (!flow) return notFound(res, "Flow not found");
        return ok(res, flow);
      } catch (err) {
        return badRequest(res, err.message, err.details);
      }
    }

    if (req.method === "DELETE") {
      const deleted = flowService.deleteFlow(flowId);
      if (!deleted) return notFound(res, "Flow not found");
      return noContent(res);
    }

    return notFound(res);
  }

  if (pathParts.length === 2 && pathParts[1] === "export") {
    if (req.method === "GET") {
      const flow = flowService.exportFlow(flowId);
      if (!flow) return notFound(res, "Flow not found");
      return ok(res, flow);
    }
    return notFound(res);
  }

  if (pathParts.length === 1 && req.url.endsWith("/import")) {
    // handled at length 0 via url check in server
  }

  if (pathParts.length === 2 && pathParts[1] === "debug") {
    if (req.method === "POST") {
      try {
        const result = await taskService.debugFlow(flowId, body);
        if (!result) return notFound(res, "Flow not found");
        return ok(res, result);
      } catch (err) {
        return badRequest(res, err.message);
      }
    }
    return notFound(res);
  }

  return notFound(res);
}

export function handleFlowImport(req, res, body) {
  try {
    const flow = flowService.importFlow(body);
    res.writeHead(201, { "Content-Type": "application/json" });
    return res.end(JSON.stringify(toListView(flow)));
  } catch (err) {
    return badRequest(res, err.message, err.details);
  }
}

function toListView(flow) {
  const project = projectService.getProjectDetail(flow.projectId);
  return {
    id: flow.id,
    name: flow.name,
    projectId: flow.projectId,
    projectName: project?.name || null,
    nodeCount: flow.nodeList?.length ?? flow.nodes ?? 0,
    scheduleEnabled: flow.scheduleEnabled,
    status: flow.status || "draft",
    publishedAt: flow.publishedAt || null,
    updatedAt: flow.updatedAt,
    nodes: flow.nodeList || [],
    edges: flow.edges || []
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

function badRequest(res, message, details) {
  res.writeHead(400, { "Content-Type": "application/json" });
  const body = { error: "VALIDATION_ERROR", message };
  if (Array.isArray(details)) body.details = details;
  res.end(JSON.stringify(body));
}

function notFound(res, message = "Not found") {
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "NOT_FOUND", message }));
}
