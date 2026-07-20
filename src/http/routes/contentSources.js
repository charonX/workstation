import * as contentSourceService from "../../services/contentSourceService.js";

export function handleContentSources(req, res, body, pathParts) {
  if (pathParts.length === 0) {
    return handleRoot(req, res, body);
  }

  if (pathParts.length === 1) {
    return handleById(req, res, body, pathParts[0]);
  }

  return notFound(res);
}

function handleRoot(req, res, body) {
  if (req.method === "GET") {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const tag = url.searchParams.get("tag");
    const enabledOnly = url.searchParams.get("enabled") === "1";
    const items = tag
      ? contentSourceService.listByTag({ tag, enabledOnly })
      : contentSourceService.list();
    return ok(res, items);
  }

  if (req.method === "POST") {
    try {
      const source = contentSourceService.create(body);
      return created(res, source);
    } catch (err) {
      return handleServiceError(res, err);
    }
  }

  return notFound(res);
}

function handleById(req, res, body, sourceId) {
  if (req.method === "GET") {
    const source = contentSourceService.get(sourceId);
    if (!source) return notFound(res, "Content source not found");
    return ok(res, source);
  }

  if (req.method === "PATCH") {
    try {
      const updated =
        Object.keys(body || {}).length === 0
          ? contentSourceService.toggle(sourceId)
          : contentSourceService.update(sourceId, body);
      if (!updated) return notFound(res, "Content source not found");
      return ok(res, updated);
    } catch (err) {
      return handleServiceError(res, err);
    }
  }

  if (req.method === "DELETE") {
    const deleted = contentSourceService.deleteSource(sourceId);
    if (!deleted) return notFound(res, "Content source not found");
    return noContent(res);
  }

  return notFound(res);
}

function handleServiceError(res, err) {
  const code = err.code;
  if (code === "E-SRC-DUP") {
    return conflict(res, err.message, code);
  }
  if (["E-SRC-NAME", "E-SRC-TYPE", "E-SRC-TAG", "E-SRC-CONFIG"].includes(code)) {
    return badRequest(res, err.message, code);
  }
  return internalError(res, err.message);
}

function sendJson(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

function ok(res, data) {
  return sendJson(res, 200, data);
}

function created(res, data) {
  return sendJson(res, 201, data);
}

function noContent(res) {
  res.writeHead(204);
  res.end();
}

function badRequest(res, message, code = "VALIDATION_ERROR") {
  return sendJson(res, 400, { error: code, message });
}

function conflict(res, message, code = "CONFLICT") {
  return sendJson(res, 409, { error: code, message });
}

function notFound(res, message = "Not found") {
  return sendJson(res, 404, { error: "NOT_FOUND", message });
}

function internalError(res, message) {
  return sendJson(res, 500, { error: "INTERNAL_ERROR", message });
}
