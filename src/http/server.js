import http from "node:http";
import os from "node:os";
import path from "node:path";
import { resetDb } from "../db.js";
import * as settingsService from "../services/settingsService.js";
import * as schedulerService from "../services/schedulerService.js";
import { registerServerRecord, unregisterServerRecord } from "../serverRegistry.js";
import { createServiceContainer } from "../services/serviceContainer.js";
import { handleProjects } from "./routes/projects.js";
import { handleFlows, handleFlowImport } from "./routes/flows.js";
import { handleSchedules } from "./routes/schedules.js";
import { handleExecutions } from "./routes/executions.js";
import { handleSkills } from "./routes/skills.js";
import { handlePlugins } from "./routes/plugins.js";
import { handleMcp } from "./routes/mcp.js";
import { handleAgents } from "./routes/agents.js";
import { handleSettings } from "./routes/settings.js";
import { handleDashboard } from "./routes/dashboard.js";
import { handleNotifications } from "./routes/notifications.js";
import { handleContentSources } from "./routes/contentSources.js";
import { handleChannel } from "./routes/channel.js";
import { handleAgentConfirmations } from "./routes/agentConfirmations.js";
import { handleBrowser } from "./routes/browser.js";
import { handleAgentSessions, handleAgentLastMode } from "./routes/agentSessions.js";
import { handleAgentFiles } from "./routes/agentFiles.js";

const activeServers = new Set();

/**
 * @deprecated 挂载 _opcXxx 兼容代理层仅用于既有测试平滑过渡；禁止新代码依赖。
 * server.services 为唯一正规 DI seam。
 * @param {http.Server} server
 * @param {import('../services/serviceContainer.js').ServiceContainer} container
 */
function attachLegacyOpcProxies(server, container) {
  const proxies = {
    _opcAgentRouter: { get: () => container.getAgentRouter(), set: (v) => container.setAgentRouterFactory(() => v) },
    _opcSessionStoreFactory: { get: () => container.getSessionStoreFactory(), set: (fn) => container.setSessionStoreFactory(fn) },
    _opcSseRegistryFactory: { get: () => container.getSseRegistryFactory(), set: (fn) => container.setSseRegistryFactory(fn) },
    _opcConfirmationServiceFactory: { get: () => container.getConfirmationServiceFactory(), set: (fn) => container.setConfirmationServiceFactory(fn) },
    _opcPermissionBridgeFactory: { get: () => container.getPermissionBridgeFactory(), set: (fn) => container.setPermissionBridgeFactory(fn) },
    _opcModeServiceFactory: { get: () => container.getModeServiceFactory(), set: (fn) => container.setModeServiceFactory(fn) },
    _opcAgentService: { get: () => container.peekAgentService(), set: (svc) => container.setAgentService(svc) },
    _opcAgentServiceFactory: { get: () => container.getAgentServiceFactory(), set: (fn) => container.setAgentServiceFactory(fn) },
    _opcCardRendererFactory: { get: () => container.getCardRendererFactory(), set: (fn) => container.setCardRendererFactory(fn) },
  };
  for (const [prop, descriptor] of Object.entries(proxies)) {
    Object.defineProperty(server, prop, { ...descriptor, configurable: true, enumerable: true });
  }
}

export function startServer(options = {}) {
  const shouldReset = options.reset !== false;
  let dbPath;
  if (shouldReset) {
    dbPath = options.dbPath || process.env.DB_PATH;
    if (!dbPath) {
      dbPath = path.join(os.tmpdir(), `opc-workstation-test-${process.pid}-${Date.now()}.db`);
      process.env.DB_PATH = dbPath;
    }
    resetDb(dbPath);
    if (!process.env.OPC_WORKSTATION_CONFIG_DIR) {
      process.env.OPC_WORKSTATION_CONFIG_DIR = path.join(os.tmpdir(), `opc-workstation-test-config-${process.pid}-${Date.now()}`);
    }
    settingsService.resetSettings();
    const tempSkillRepoPath = path.join(os.tmpdir(), `opc-workstation-test-skills-${process.pid}-${Date.now()}`);
    settingsService.saveSettings({ skillRepoPath: tempSkillRepoPath });
  } else if (options.dbPath) {
    dbPath = options.dbPath;
    process.env.DB_PATH = dbPath;
  }

  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      handleRequest(req, res, server).catch((err) => {
        console.error("HTTP handler error:", err);
        if (!res.headersSent) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "INTERNAL_ERROR", message: err.message }));
        }
      });
    });

    const preferredPort = Number.isInteger(options.port) && options.port > 0 ? options.port : 0;
    let usingPreferredPort = preferredPort > 0;

    const onListening = async () => {
      const { port } = server.address();
      activeServers.add(server);
      if (dbPath) server._opcDbPath = dbPath;
      const owner = String(options.owner ?? process.pid);
      server._opcOwner = owner;
      try { registerServerRecord(port, process.pid, owner); } catch {}

      const container = createServiceContainer({
        port,
        configDir: process.env.OPC_WORKSTATION_CONFIG_DIR || settingsService.configDir(),
        baseUrl: `http://127.0.0.1:${port}`,
        owner,
      });
      server.services = container;
      attachLegacyOpcProxies(server, container);
      await container.start();

      resolve({ server, baseUrl: `http://127.0.0.1:${port}`, owner });
    };

    server.on("error", (err) => {
      if (err?.code === "EADDRINUSE" && usingPreferredPort) {
        usingPreferredPort = false;
        server.listen(0, "127.0.0.1", onListening);
        return;
      }
      reject(err);
    });
    server.listen(preferredPort, "127.0.0.1", onListening);
  });
}

export function stopServer({ server }) {
  return new Promise(async (resolve) => {
    activeServers.delete(server);
    if (server.services) {
      try { await server.services.dispose(); } catch {}
    }
    try {
      const address = server.address();
      if (address) unregisterServerRecord(server._opcOwner ?? process.pid);
    } catch {}
    server.close(resolve);
  });
}

async function handleRequest(req, res, server) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    return res.end();
  }

  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathParts = url.pathname.replace(/^\/api\//, "").split("/").filter(Boolean);
  const resource = pathParts[0];
  const subPath = pathParts.slice(1);

  let body;
  try {
    body = await parseBody(req);
  } catch (err) {
    if (resource === "projects" && subPath.length === 2 && subPath[1] === "permission" && req.method === "PUT") {
      const message = err?.message ?? "Invalid JSON body";
      res.writeHead(400, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ code: "E-PERMISSION-INVALID", message, issues: [{ path: "(root)", message }] }));
    }
    throw err;
  }

  res.setHeader("Content-Type", "application/json");
  const services = server.services;

  switch (resource) {
    case "settings":
      return handleSettings(req, res, body, subPath, { agentRouter: services?.getAgentRouter() });
    case "agent":
      if (subPath[0] === "sessions") {
        return handleAgentSessions(req, res, body, subPath, {
          getSessionStore: () => services?.getSessionStore(),
          getAgentService: () => services?.getAgentService(),
          peekAgentService: () => services?.peekAgentService() ?? null,
          getModeService: () => services?.getModeService(),
          getSseRegistry: () => services?.getSseRegistry(),
        });
      }
      if (subPath[0] === "mode" && subPath[1] === "last") {
        return handleAgentLastMode(req, res, body, { getModeService: () => services?.getModeService() });
      }
      if (subPath[0] === "files") return handleAgentFiles(req, res, subPath.slice(1));
      return handleAgentConfirmations(req, res, body, subPath, {
        getConfirmationService: () => services?.getConfirmationService(),
      });
    case "projects": return handleProjects(req, res, body, subPath);
    case "flows":
      if (subPath.length === 1 && subPath[0] === "import") return handleFlowImport(req, res, body);
      return handleFlows(req, res, body, subPath);
    case "schedules": return handleSchedules(req, res, body, subPath);
    case "executions": return handleExecutions(req, res, body, subPath);
    case "skills": return handleSkills(req, res, body, subPath);
    case "plugins": return handlePlugins(req, res, body, subPath);
    case "mcp": return handleMcp(req, res, body, subPath);
    case "agents": return handleAgents(req, res);
    case "dashboard": return handleDashboard(req, res);
    case "notifications": return handleNotifications(req, res, body, subPath);
    case "content-sources": return handleContentSources(req, res, body, subPath);
    case "channel": return handleChannel(req, res, body, subPath);
    case "browser":
      return handleBrowser(req, res, body, subPath, {
        getBrowserViewManager: () => services?.getBrowserViewManager(),
      });
    case "server": return handleServer(req, res, server, subPath);
    default: return notFound(res);
  }
}

function handleServer(req, res, server, subPath) {
  const action = subPath[0];
  if (req.method === "POST" && action === "shutdown") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    setTimeout(() => stopServer({ server }), 0);
    return;
  }
  if (req.method === "GET" && action === "status") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ schedulerRegistered: schedulerService.getTaskCount() > 0 }));
    return;
  }
  return notFound(res);
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    if (req.method === "GET") return resolve({});
    let data = "";
    req.on("data", (chunk) => { data += chunk; });
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
