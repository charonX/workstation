import http from "node:http";
import cron from "node-cron";
import os from "node:os";
import path from "node:path";
import { resetDb, getDb } from "../db.js";
import * as settingsService from "../services/settingsService.js";
import * as taskService from "../services/taskService.js";
import * as schedulerService from "../services/schedulerService.js";
import { recoverInterruptedExecutions } from "../services/executionQueue.js";
import * as eventBus from "../services/eventBus.js";
import { registerServerRecord, unregisterServerRecord } from "../serverRegistry.js";
import { handleProjects } from "./routes/projects.js";
import { handleFlows, handleFlowImport } from "./routes/flows.js";
import { handleSchedules } from "./routes/schedules.js";
import { handleExecutions } from "./routes/executions.js";
import { handleSkills } from "./routes/skills.js";
import { handleAgents } from "./routes/agents.js";
import { handleSettings } from "./routes/settings.js";
import { handleDashboard } from "./routes/dashboard.js";
import { handleNotifications } from "./routes/notifications.js";
import { handleContentSources } from "./routes/contentSources.js";
import { handleChannel } from "./routes/channel.js";
import { createImRouter } from "../services/channels/imRouter.js";
import * as channelManager from "../services/channelManager.js";

const activeServers = new Set();

async function startFeishuChannel() {
  const result = await channelManager.start();
  taskService.setChannelAdapter(channelManager.getAdapter("feishu"));
  return result;
}
// 每个 server 实例的每日清理定时任务（server -> ScheduledTask），stopServer 时销毁。
const purgeTasks = new Map();

// 每日清理 cron 表达式：03:17（避开整点整刻的调度尖峰）。
const PURGE_CRON_SCHEDULE = "17 3 * * *";

// REQ-FLOW-028 AC4/AC5 / tech-design §7：执行日志 7 天滚动清理。
// 触发点 A：startServer 启动时执行一次（Electron main 与 headless CLI 均经过 startServer）。
// 触发点 B：node-cron 每日定时任务（PURGE_CRON_SCHEDULE），覆盖常驻实例。
// 清理失败不得影响 server 启动/运行（safe default），仅记录日志。
function runExecutionLogPurge() {
  try {
    const result = taskService.purgeExpiredExecutions(getDb());
    console.log(
      `Execution log purge done: ${result.executions} executions, ${result.executionNodes} execution_nodes, ${result.logs} logs removed`
    );
  } catch (err) {
    console.error("Execution log purge failed:", err.message);
  }
}

export function startServer(options = {}) {
  const shouldReset = options.reset !== false;
  let dbPath;
  if (shouldReset) {
    // Use an isolated per-process temp DB by default so concurrent test
    // subprocesses do not share state. The path is propagated via DB_PATH so
    // CLI/headless fallbacks spawned from the same process share the same DB.
    // Production callers pass reset:false (or an explicit dbPath) and keep the
    // persistent file DB at DB_PATH / defaultDbPath().
    dbPath = options.dbPath || process.env.DB_PATH;
    if (!dbPath) {
      dbPath = path.join(os.tmpdir(), `opc-workstation-test-${process.pid}-${Date.now()}.db`);
      process.env.DB_PATH = dbPath;
    }
    resetDb(dbPath);
    // Isolate settings.json as well: tests must not overwrite the user's real
    // ~/.opc-workstation/settings.json. Only set a temp config dir if the caller
    // has not already configured one.
    if (!process.env.OPC_WORKSTATION_CONFIG_DIR) {
      process.env.OPC_WORKSTATION_CONFIG_DIR = path.join(
        os.tmpdir(),
        `opc-workstation-test-config-${process.pid}-${Date.now()}`
      );
    }
    settingsService.resetSettings();
    // Isolate the skill library path in test/reset mode so library scans never
    // touch the user's real ~/.opc-workstation/skills directory.
    const tempSkillRepoPath = path.join(
      os.tmpdir(),
      `opc-workstation-test-skills-${process.pid}-${Date.now()}`
    );
    settingsService.saveSettings({ skillRepoPath: tempSkillRepoPath });
  }

  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      handleRequest(req, res, server).catch((err) => {
        console.error("HTTP handler error:", err);
        if (!res.headersSent) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "INTERNAL_ERROR", message: err.message }));
        }
      });
    });

    server.listen(0, "127.0.0.1", async () => {
      const { port } = server.address();
      activeServers.add(server);
      if (dbPath) server._opcDbPath = dbPath;
      const owner = String(options.owner ?? process.pid);
      server._opcOwner = owner;
      try {
        registerServerRecord(port, process.pid, owner);
      } catch {
        // Ignore registry failures in restricted environments.
      }
      // 触发点 A：启动即清理一次。
      runExecutionLogPurge();
      // 触发点 B：每日定时清理。
      purgeTasks.set(server, cron.schedule(PURGE_CRON_SCHEDULE, runExecutionLogPurge));
      async function runStartupStep(label, fn) {
        try {
          await fn();
        } catch (err) {
          console.error(label, err.message);
        }
      }

      // REQ-SCHEDULE-007：恢复孤儿执行；REQ-SCHEDULE-005：加载 enabled schedules。
      await runStartupStep("Failed to recover interrupted executions:", () => recoverInterruptedExecutions(getDb()));
      await runStartupStep("Failed to load schedules:", () => schedulerService.loadAll());
      // REQ-SCHEDULE-005/006：生产环境必须订阅 schedule:triggered，否则 cron 到点只 publish 事件而不创建执行。
      await runStartupStep("Failed to subscribe to schedule triggers:", () => taskService.subscribeToScheduleTriggers());
      // REQ-CHANNEL-001/002：凭据存在时自动启动飞书通道与 IM 路由。
      await runStartupStep("Failed to start Feishu channel adapter:", () => startFeishuChannel());
      createImRouter({ channelManager, baseUrl: `http://127.0.0.1:${port}` });
      resolve({ server, baseUrl: `http://127.0.0.1:${port}`, owner });
    });
  });
}

export function stopServer({ server }) {
  return new Promise(async (resolve) => {
    activeServers.delete(server);
    // Clear pending executions and schedules so server shutdown doesn't leak
    // async work into the next test's lifecycle.
    try {
      schedulerService.removeAll();
    } catch {
      // ignore
    }
    try {
      eventBus.clearSubscribers();
    } catch {
      // ignore
    }
    try {
      await taskService.clearExecutionQueue();
    } catch {
      // ignore
    }
    try {
      await channelManager.stop();
    } catch {
      // ignore
    }
    const purgeTask = purgeTasks.get(server);
    if (purgeTask) {
      purgeTasks.delete(server);
      try {
        purgeTask.destroy();
      } catch {
        // Ignore teardown failures.
      }
    }
    try {
      const address = server.address();
      if (address) {
        unregisterServerRecord(server._opcOwner ?? process.pid);
      }
    } catch {
      // Ignore registry failures.
    }

    server.close(resolve);
  });
}

async function handleRequest(req, res, server) {
  // CORS: allow renderer loaded from Vite dev server to call the local API.
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
    case "agents":
      return handleAgents(req, res);
    case "dashboard":
      return handleDashboard(req, res);
    case "notifications":
      return handleNotifications(req, res, body, subPath);
    case "content-sources":
      return handleContentSources(req, res, body, subPath);
    case "channel":
      return handleChannel(req, res, body, subPath);
    case "server":
      return handleServer(req, res, server, subPath);
    default:
      return notFound(res);
  }
}

function handleServer(req, res, server, subPath) {
  const action = subPath[0];
  if (req.method === "POST" && action === "shutdown") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    // Graceful shutdown after the response has been flushed.
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
