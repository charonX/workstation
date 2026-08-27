import * as contentSourceService from "../../services/contentSourceService.js";
import * as feedFetcherService from "../../services/feedFetcherService.js";
import { ok, noContent, notFound, mapError, badRequest } from "../responders.js";

export async function handleContentSources(req, res, body, pathParts) {
  if (pathParts.length === 0) {
    return handleRoot(req, res, body);
  }

  if (pathParts.length === 1) {
    return handleById(req, res, body, pathParts[0]);
  }

  if (pathParts.length === 2 && pathParts[1] === "fetch" && req.method === "POST") {
    try {
      const result = await feedFetcherService.fetchContentSource(pathParts[0]);
      return ok(res, result);
    } catch (err) {
      return handleServiceError(res, err);
    }
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
      return ok(res, source, 201);
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
  const code = err.code || "VALIDATION_ERROR";
  if (code === "E-SRC-DUP") {
    res.writeHead(409, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ error: code, code, message: err.message }));
  }
  if (code === "E-SRC-NOT-FOUND") {
    return notFound(res, err.message);
  }
  if (["E-SRC-NAME", "E-SRC-TYPE", "E-SRC-TAG", "E-SRC-CONFIG", "E-FEED-PARSE-FAILED", "E-FEED-URL-INVALID", "E-RSSHUB-NOT-CONFIGURED"].includes(code)) {
    res.writeHead(400, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ error: code, code, message: err.message }));
  }
  const status = err.status || 500;
  if (status >= 400 && status < 500) {
    res.writeHead(status, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ error: code, code, message: err.message }));
  }
  return mapError(res, err, 500);
}
