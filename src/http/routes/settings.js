import * as settingsService from "../../services/settingsService.js";

export function handleSettings(req, res, body) {
  if (req.method === "GET") {
    return ok(res, settingsService.loadSettings());
  }

  if (req.method === "PATCH") {
    try {
      const updated = settingsService.saveSettings(body);
      return ok(res, updated);
    } catch (err) {
      return badRequest(res, err.message);
    }
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

function notFound(res) {
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "NOT_FOUND", message: "Not found" }));
}
