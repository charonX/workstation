import * as notificationService from "../../services/notificationService.js";

export function handleNotifications(req, res, body, pathParts) {
  if (pathParts.length === 0) {
    if (req.method === "GET") {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const unreadOnly = url.searchParams.get("unreadOnly") === "1";
      const items = notificationService.list({ unreadOnly });
      const unreadCount = notificationService.list({ unreadOnly: true }).length;
      return ok(res, { items, unreadCount });
    }
    return notFound(res);
  }

  if (req.method === "POST" && pathParts[0] === "read-all") {
    notificationService.markRead({ all: true });
    return ok(res, { success: true });
  }

  if (pathParts.length === 2 && req.method === "POST" && pathParts[1] === "read") {
    const id = pathParts[0];
    notificationService.markRead({ ids: [id] });
    return ok(res, { success: true });
  }

  return notFound(res);
}

function ok(res, data) {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

function notFound(res, message = "Not found") {
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "NOT_FOUND", message }));
}
