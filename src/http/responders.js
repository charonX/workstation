// src/http/responders.js
// REQ-WORKSPACE-020: 统一 HTTP 响应助手与错误映射收敛

export function ok(res, data, statusCode = 200) {
  res.writeHead(statusCode, { "Content-Type": "application/json" });
  return res.end(JSON.stringify(data));
}

export function noContent(res) {
  res.writeHead(204);
  return res.end();
}

export function badRequest(res, message, code = "VALIDATION_ERROR") {
  res.writeHead(400, { "Content-Type": "application/json" });
  return res.end(JSON.stringify({ error: code, message }));
}

export function notFound(res, message = "Not found") {
  res.writeHead(404, { "Content-Type": "application/json" });
  return res.end(JSON.stringify({ error: "NOT_FOUND", message }));
}

export function forbidden(res, message = "Forbidden") {
  res.writeHead(403, { "Content-Type": "application/json" });
  return res.end(JSON.stringify({ error: "FORBIDDEN", message }));
}

export function mapError(res, err, defaultStatus = 400) {
  const status = err?.status || defaultStatus;
  const body = {
    error: err?.code || (status === 500 ? "INTERNAL_ERROR" : "VALIDATION_ERROR"),
    message: err?.message
  };
  if (err?.invalidAgents) body.invalidAgents = err.invalidAgents;
  if (err?.issues) body.issues = err.issues;
  if (err?.existing) body.existing = err.existing;
  res.writeHead(status, { "Content-Type": "application/json" });
  return res.end(JSON.stringify(body));
}

export function decodeParam(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function normalizeBool(value) {
  return value === true || value === "true";
}
