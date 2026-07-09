import http from "node:http";
import { resetDb, getDb } from "../db.js";
import * as settingsService from "../services/settingsService.js";
import { handleProjects } from "./routes/projects.js";
import { handleFlows, handleFlowImport } from "./routes/flows.js";
import { handleSchedules } from "./routes/schedules.js";
import { handleExecutions } from "./routes/executions.js";
import { handleSkills } from "./routes/skills.js";
import { handleSettings } from "./routes/settings.js";
import { handleDashboard } from "./routes/dashboard.js";

const activeServers = new Set();

export function startServer(options = {}) {
  const shouldReset = options.reset !== false;
  if (shouldReset) {
    resetDb();
    settingsService.resetSettings();
  }

  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      handleRequest(req, res).catch((err) => {
        console.error("HTTP handler error:", err);
        if (!res.headersSent) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "INTERNAL_ERROR", message: err.message }));
        }
      });
    });

    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      activeServers.add(server);
      resolve({ server, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

export function stopServer({ server }) {
  return new Promise((resolve) => {
    activeServers.delete(server);
    server.close(resolve);
  });
}

async function handleRequest(req, res) {
  // CORS: allow renderer loaded from Vite dev server to call the local API.
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    return res.end();
  }

  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathParts = url.pathname.replace(/^\/api\//, "").split("/").filter(Boolean);
  const resource = pathParts[0];
  const subPath = pathParts.slice(1);

  const body = await parseBody(req);

  res.setHeader("Content-Type", "application/json");

  switch (resource) {
    case "settings":
      return handleSettings(req, res, body);
    case "projects":
      return handleProjects(req, res, body, subPath);
    case "flows":
      if (subPath.length === 1 && subPath[0] === "import") {
        return handleFlowImport(req, res, body);
      }
      return handleFlows(req, res, body, subPath);
    case "schedules":
      return handleSchedules(req, res, body, subPath);
    case "executions":
      return handleExecutions(req, res, body, subPath);
    case "skills":
      return handleSkills(req, res, body, subPath);
    case "dashboard":
      return handleDashboard(req, res);
    default:
      return notFound(res);
  }
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    if (req.method === "GET" || req.method === "DELETE") return resolve({});

    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
    });
    req.on("end", () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch (err) {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

function notFound(res) {
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "NOT_FOUND", message: "Not found" }));
}
