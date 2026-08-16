import * as taskService from "../../services/taskService.js";
import * as runner from "../../services/executionRunner.js";

export function handleExecutions(req, res, body, pathParts) {
  if (pathParts.length === 0) {
    if (req.method === "GET") {
      // REQ-FLOW-040 AC5: 支持 ?parentExecutionId=:id 过滤直接子 execution。
      const url = new URL(req.url, `http://${req.headers.host}`);
      const parentExecutionId = url.searchParams.get("parentExecutionId") ?? undefined;
      const executions = taskService.listExecutions({ parentExecutionId });
      return ok(res, executions);
    }

    if (req.method === "POST") {
      try {
        // REQ-FLOW-049：manual 触发入口直调 runner.submit（taskService.createTask
        // 转发别名保持导出，行为等价——E-QUEUE-FULL 同步拒绝语义保持）。
        const result = runner.submit(body);
        res.writeHead(201, { "Content-Type": "application/json" });
        return res.end(JSON.stringify(result));
      } catch (err) {
        if (err.code === "E-QUEUE-FULL") {
          res.writeHead(503, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({ error: "E-QUEUE-FULL", message: "队列已满，稍后再发" }));
        }
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
