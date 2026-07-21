import * as templateService from "../../services/templateService.js";

export function handleTemplates(req, res, body, pathParts) {
  if (pathParts.length === 0) {
    if (req.method === "GET") {
      return ok(res, templateService.listTemplates());
    }
    return notFound(res);
  }

  const templateId = pathParts[0];

  if (pathParts.length === 2 && pathParts[1] === "instantiate" && req.method === "POST") {
    try {
      const result = templateService.instantiateTemplate({
        templateId,
        projectId: body.projectId,
        overrides: body.overrides,
        force: body.force === true || body.force === "true"
      });
      return created(res, result);
    } catch (err) {
      return sendTemplateError(res, err);
    }
  }

  return notFound(res);
}

function sendTemplateError(res, err) {
  if (err.code === "E-TPL-NOT-FOUND") {
    return notFound(res, err.message, err.code);
  }
  if (err.code === "E-TPL-PROJECT-INVALID") {
    return badRequest(res, err.message, err.code);
  }
  if (err.code === "E-BINDING-EXISTS") {
    return conflict(res, err.message, err.code);
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

function badRequest(res, message, code = "VALIDATION_ERROR") {
  return sendJson(res, 400, { error: code, message });
}

function conflict(res, message, code = "CONFLICT") {
  return sendJson(res, 409, { error: code, message });
}

function notFound(res, message = "Not found", code = "NOT_FOUND") {
  return sendJson(res, 404, { error: code, message });
}

function internalError(res, message) {
  return sendJson(res, 500, { error: "INTERNAL_ERROR", message });
}
