import * as channelBindingService from "../../services/channelBindingService.js";
import * as settingsService from "../../services/settingsService.js";

let channelAdapter = null;

export function setChannelAdapter(adapter) {
  channelAdapter = adapter;
}

export function handleChannel(req, res, body, pathParts) {
  if (pathParts.length === 0) {
    return notFound(res);
  }

  const resource = pathParts[0];

  if (resource === "binding") {
    return handleBinding(req, res, body);
  }

  if (resource === "status") {
    return handleStatus(req, res);
  }

  if (resource === "credentials") {
    return handleCredentials(req, res, body);
  }

  return notFound(res);
}

function handleBinding(req, res, body) {
  if (req.method === "GET") {
    const binding = channelBindingService.getBinding("feishu");
    if (!binding) {
      return notFound(res, "No channel binding found");
    }
    return ok(res, binding);
  }

  if (req.method === "POST") {
    const { flowId, projectId, force } = body || {};
    if (!flowId || !projectId) {
      return badRequest(res, "flowId and projectId are required");
    }
    try {
      const binding = channelBindingService.createBinding({
        channelType: "feishu",
        flowId,
        projectId,
        force: force === true || force === "true"
      });
      return created(res, binding);
    } catch (err) {
      if (err.code === "E-BINDING-EXISTS") {
        return conflict(res, err.message, err.code);
      }
      return internalError(res, err.message);
    }
  }

  if (req.method === "DELETE") {
    const deleted = channelBindingService.deleteBinding("feishu");
    if (!deleted) {
      return notFound(res, "No channel binding found");
    }
    return noContent(res);
  }

  return notFound(res);
}

function handleStatus(req, res) {
  if (req.method !== "GET") return notFound(res);
  const status = channelAdapter?.getStatus ? channelAdapter.getStatus() : "offline";
  return ok(res, { status });
}

function handleCredentials(req, res, body) {
  if (req.method !== "POST") return notFound(res);
  const { appId, appSecret } = body || {};
  if (!appId || !appSecret) {
    return badRequest(res, "appId and appSecret are required", "E-CHANNEL-CRED");
  }
  try {
    const result = settingsService.saveChannelCredentials({ appId, appSecret });
    return created(res, result);
  } catch (err) {
    return badRequest(res, err.message, "E-CHANNEL-CRED");
  }
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
