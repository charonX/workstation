import * as taskService from "../../services/taskService.js";
import * as flowService from "../../services/flowService.js";

export function handleExecutions(req, res, body, pathParts) {
  if (pathParts.length === 0) {
    if (req.method === "GET") {
      const executions = taskService.listExecutions();
      return ok(res, executions);
    }

    if (req.method === "POST") {
      try {
        const execution = taskService.createTask(body);
        res.writeHead(201, { "Content-Type": "application/json" });
        return res.end(JSON.stringify(execution));
      } catch (err) {
        return badRequest(res, err.message);
      }
    }

    return notFound(res);
  }

  const executionId = pathParts[0];

  if (pathParts.length === 1) {
    if (req.method === "GET") {
      const execution = taskService.getExecution(executionId);
      if (!execution) return notFound(res, "Execution not found");
      // REQ-FLOW-028 AC6：既有字段不变，新增节点级执行记录（关联 execution_nodes）。
      const nodes = taskService.listExecutionNodes(executionId);
      return ok(res, { ...execution, nodes });
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

function notFound(res, message = "Not found") {
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "NOT_FOUND", message }));
}
