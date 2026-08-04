import http from "node:http";
import cron from "node-cron";
import os from "node:os";
import path from "node:path";
import { resetDb, getDb, closeDb } from "../db.js";
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
import { handleAgentConfirmations } from "./routes/agentConfirmations.js";
import { createImRouter } from "../services/channels/imRouter.js";
import * as channelManager from "../services/channelManager.js";
import { createAgentRouter } from "../services/agentRouter.js";
import { createAgentService } from "../services/agentService.js";
import { createSessionStore } from "../services/sessionStore.js";
import { createCardRenderer } from "../services/cardRenderer.js";
import { createConfirmationService } from "../services/confirmationService.js";
import { executeToolCommand } from "../agent/toolAdapter.js";

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
  } else if (options.dbPath) {
    // reset:false with an explicit dbPath (e.g. legacy-DB migration runs):
    // propagate the path so the lazily-opened getDb() lands on the requested
    // file — opening it runs initSchema + migrateSchema (REQ-WORKSPACE-011
    // AC5 legacy migration).
    dbPath = options.dbPath;
    process.env.DB_PATH = dbPath;
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
      // agent 优先路由（REQ-AGENT-017，REQ-CHANNEL-002 接替）：IM 消息全量进
      // agentRouter（绑定检查 → 命令识别 → 会话分发），绑定不再直接 createTask。
      // agentService 惰性接线（ADR-009）：首次对话消息才创建并 start()——不启动即
      // 不 spawn 子进程；测试环境无对话消息到达 → 零副作用。会话库落应用配置目录
      // （Electron = userData；headless = OPC_WORKSTATION_CONFIG_DIR）——Slice 3
      // concern 的生产态 store 注入（默认 store 库路径 = 应用库，非 cwd/.agent-home）。
      // Slice 6：sessionStore 与 baseUrl 注入 agentRouter——/reset 命令（REQ-AGENT-010）
      // 与命令执行层直连（C2 路径：命令模块 → 本地 HTTP API → services，U2）。
      const configDir = settingsService.configDir();
      let sharedSessionStore = null;
      const getSessionStore = () => {
        if (!sharedSessionStore) {
          sharedSessionStore = createSessionStore({
            dbPath: path.join(configDir, "agent-sessions.db"),
            sessionDir: path.join(configDir, "agent-sessions")
          });
        }
        return sharedSessionStore;
      };
      const agentRouter = createAgentRouter({
        settings: () => settingsService.loadSettings(),
        sessionStore: getSessionStore,
        baseUrl: `http://127.0.0.1:${port}`
      });
      // 绑定状态经 HTTP 暴露（Settings Agent 区：开始绑定/取消/解绑/状态查询，
      // REQ-AGENT-014）——handleRequest 经 server 引用取路由实例。
      server._opcAgentRouter = agentRouter;
      // Slice 8：确认服务（REQ-AGENT-016，b 解耦）——惰性创建（ADR-009：首次
      // confirm-request / 确认回调才开库）。挂起队列与 agent_sessions 同库
      // （tech-design 模块图：SQLite：agent_sessions / agent_confirmations）。
      // - execute：确认回调驱动**同一命令模块**执行（C2 路径，executeToolCommand
      //   与工具路径共用 TOOL_DEFS 注册表，一处实现两端生效；baseUrl 显式注入本
      //   server 避免注册表发现歧义）；
      // - notifyResult：结果经 notify-result IPC 注入 agent 会话 → 自然语言回投
      //   （W-2，不经过 agent turn——解耦执行）；
      // - sendCard：确认卡片经通道适配器发送（F1：channelManager 唯一入口）。
      let serverConfirmationService = null;
      const getConfirmationService = () => {
        if (!serverConfirmationService) {
          serverConfirmationService = createConfirmationService({
            dbPath: path.join(configDir, "agent-sessions.db"),
            execute: async (command, args) => executeToolCommand(command, args, { baseUrl: `http://127.0.0.1:${port}` }),
            notifyResult: async ({ sessionKey, result }) => {
              const svc = await getAgentService();
              svc.notifyResult(sessionKey, result);
            },
            sendCard: (payload) => channelManager.sendCard("feishu", payload),
          });
        }
        return serverConfirmationService;
      };
      // 确认回调 HTTP 端点（/api/agent/confirmations/...）经 server 引用取惰性工厂。
      server._opcConfirmationServiceFactory = getConfirmationService;
      let serverAgentService = null;
      const getAgentService = async () => {
        if (!serverAgentService) {
          serverAgentService = createAgentService({
            cwd: process.cwd(),
            sessionDir: path.join(configDir, "agent-sessions"),
            sessionStore: getSessionStore(),
            // Slice 8 确认接线（REQ-AGENT-016 标准 1）：worker 工具面 confirm 级
            // 工具 → IPC confirm-request → 确认服务入队（pending + 确认卡片）。
            onConfirmRequest: (req) => getConfirmationService().submit(req),
          });
          await serverAgentService.start();
          server._opcAgentService = serverAgentService;
        }
        return serverAgentService;
      };
      // Slice 7：会话卡片渲染器（REQ-AGENT-019~020）——惰性创建（ADR-009）：
      // 首次流式/执行事件才实例化；adapter 经 channelManager 解析当前飞书通道。
      // 任务卡片（REQ-AGENT-020）由 eventBus 执行事件驱动；sessionKey 从执行
      // 上下文解析（对话下发的执行需记录 originating spaceKey——GAP：工具面
      // task run 未记录 spaceKey，非对话执行（手动/定时）无会话 → 不发送任务卡片；
      // 接线点已就绪，随 Slice 8 或后续补全映射）。
      let serverCardRenderer = null;
      // Slice 7 补（缺口 3）：会话句柄注册表（REQ-AGENT-020 标准 3 执行结果回投）——
      // imRouter 创建会话时登记句柄（句柄挂 onExecutionResult 回投钩子），渲染器
      // 终态事件经 sessions[sessionKey].onExecutionResult 驱动 agent 生成执行摘要，
      // 摘要回复经流式事件回投（回复卡片，同一渲染器实例）。修复前 createCardRenderer
      // 未传 sessions → 生产路径回投永不触发。
      const sessionRegistry = {};
      const getCardRenderer = () => {
        if (!serverCardRenderer) {
          serverCardRenderer = createCardRenderer({
            adapter: {
              sendCard: (payload) => channelManager.sendCard("feishu", payload),
              updateCardStream: (payload) => channelManager.updateCardStream("feishu", payload),
              send: (payload) => channelManager.send("feishu", payload)
            },
            sessions: sessionRegistry
          });
        }
        return serverCardRenderer;
      };
      createImRouter({
        channelManager,
        baseUrl: `http://127.0.0.1:${port}`,
        agentRouter,
        agentService: getAgentService,
        // Slice 7：agent 流式事件 → 回复卡片流式（REQ-AGENT-019）。
        onSessionEvent: (spaceKey, ev) => {
          getCardRenderer().handleStreamEvent({ sessionKey: spaceKey, ...ev });
        },
        // Slice 7 补（缺口 3）：会话句柄登记 + 执行结果回投钩子（REQ-AGENT-020
        // 标准 3：执行完成 → agent 生成摘要 → 摘要经流式事件回投 → 回复卡片）。
        onSessionCreated: (spaceKey, session) => {
          if (!session || typeof session !== "object") return;
          if (typeof session.onExecutionResult !== "function") {
            session.onExecutionResult = (result) => {
              const summaryPrompt = `请用不超过 200 字总结本次执行结果，直接输出总结：${JSON.stringify(result ?? {})}`;
              return getAgentService()
                .then((svc) => {
                  // 摘要回投是新一轮对话：先经会话事件通道宣告 stream_start（轮次
                  // 边界，REQ-AGENT-019 每轮各一张回复卡片），否则上一轮 final 状态
                  // 会把摘要流式事件全部丢弃（code-defect 1 同机制）。
                  if (typeof session.emit === "function") {
                    session.emit("session-event", { type: "stream_start" });
                  }
                  return svc.prompt(spaceKey, summaryPrompt);
                })
                .catch(() => undefined);
            };
          }
          sessionRegistry[spaceKey] = session;
        }
      });
      // Slice 7 补（缺口 5）：执行事件订阅移出渲染器惰性创建（修复前订阅在首次
      // 流式事件触发 getCardRenderer 时才注册 → 先于惰性创建的执行事件丢失，任务
      // 卡片缺头——execution:started 未达即无卡）。订阅在启动路径立即注册，渲染器
      // 仍按事件到达惰性创建（ADR-009）；无会话的执行（非对话下发）→ sessionKey
      // 解析为空 → 渲染器不动作。
      const resolveSessionKey = (executionEvent) => executionEvent?.variables?.spaceKey ?? undefined;
      // 执行事件 → 任务卡片（REQ-AGENT-020）：事件字段共性（executionId/status）外，
      // 各事件带专属字段（flowId/log/output/artifacts）经 extra 透传。
      const dispatchExecutionEvent = (event, type, extra = {}) => {
        getCardRenderer().handleExecutionEvent({
          sessionKey: resolveSessionKey(event),
          type,
          executionId: event.executionId,
          status: event.status,
          ...extra,
        });
      };
      eventBus.subscribe("execution:started", (e) => dispatchExecutionEvent(e, "started", { flowId: e.flowId }));
      eventBus.subscribe("execution:progress", (e) => dispatchExecutionEvent(e, "progress", { log: e.log }));
      eventBus.subscribe("execution:completed", (e) => dispatchExecutionEvent(e, "completed", { output: e.output, artifacts: e.artifacts }));
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
    // Close the cached DB handle: a stopped server must not leak a stale
    // handle into the next server's lifecycle (the file may be gone or a
    // different DB_PATH may be in effect by then).
    try {
      closeDb();
    } catch {
      // ignore
    }
    try {
      await channelManager.stop();
    } catch {
      // ignore
    }
    // Stop the lazily-created agent service (child process + heartbeat watchdog):
    // prevents leaked subprocesses across tests and on production shutdown.
    if (server._opcAgentService) {
      try {
        server._opcAgentService.stop();
      } catch {
        // ignore
      }
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
      return handleSettings(req, res, body, subPath, { agentRouter: server._opcAgentRouter });
    case "agent":
      // 确认回调（REQ-AGENT-016）：确认卡片按钮动作 → approve/reject（回调驱动执行，
      // b 解耦）；挂起队列可见（M2 移动块基础）。卡片按钮 value 携带 confirmId +
      // decision，飞书卡片动作桥接（WS 事件 → 本端点）待 QA。
      return handleAgentConfirmations(req, res, body, subPath, {
        getConfirmationService: () => server._opcConfirmationServiceFactory?.(),
      });
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
    // DELETE may carry a JSON body for bulk operations
    // (REQ-SKILL-011 AC5); only GET is always bodyless.
    if (req.method === "GET") return resolve({});

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
