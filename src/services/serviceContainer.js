import cron from "node-cron";
import path from "node:path";
import { getDb, closeDb } from "../db.js";
import * as settingsService from "./settingsService.js";
import * as taskService from "./taskService.js";
import * as runner from "./executionRunner.js";
import * as schedulerService from "./schedulerService.js";
import * as eventBus from "./eventBus.js";
import { createImRouter } from "./channels/imRouter.js";
import * as channelManager from "./channelManager.js";
import { createAgentRouter } from "./agentRouter.js";
import { createAgentService } from "./agentService.js";
import { createSessionStore } from "./sessionStore.js";
import { createCardRenderer } from "./cardRenderer.js";
import { createConfirmationService } from "./confirmationService.js";
import { createPermissionBridge } from "./permissionBridge.js";
import { createModeService } from "./modeService.js";
import { buildSessionConfig } from "./sessionDomain.js";
import { createSseSubscriptionRegistry } from "./sessionSseRegistry.js";
import { executeToolCommand } from "../agent/toolAdapter.js";

export const PURGE_CRON_SCHEDULE = "17 3 * * *";

function runExecutionLogPurge() {
  try {
    const db = getDb();
    if (!db) return;
    const result = taskService.purgeExpiredExecutions(db);
    console.log(
      `Execution log purge done: ${result.executions} executions, ${result.executionNodes} execution_nodes, ${result.logs} logs removed`
    );
  } catch (err) {
    console.error("Execution log purge failed:", err.message);
  }
}

export function createServiceContainer(options = {}) {
  const port = options.port;
  const configDir = options.configDir || settingsService.configDir();
  const baseUrl = options.baseUrl || (port !== undefined && port !== null ? `http://127.0.0.1:${port}` : "http://127.0.0.1:0");
  const owner = String(options.owner ?? process.pid);

  let purgeTask = null;
  let imRouterInstance = null;
  const sessionRegistry = {};

  // Singletons
  let sharedSessionStore = null;
  let agentRouterInstance = null;
  let serverSseRegistry = null;
  let serverConfirmationService = null;
  let serverPermissionBridge = null;
  let serverModeService = null;
  let serverAgentService = null;
  let serverCardRenderer = null;

  // Lazy factories (can be overridden via setters or server._opcXxx proxies)
  let sessionStoreFactory = () => {
    if (!sharedSessionStore) {
      sharedSessionStore = createSessionStore({
        dbPath: path.join(configDir, "agent-sessions.db"),
        sessionDir: path.join(configDir, "agent-sessions"),
      });
    }
    return sharedSessionStore;
  };

  let agentRouterFactory = () => {
    if (!agentRouterInstance) {
      agentRouterInstance = createAgentRouter({
        settings: () => settingsService.loadSettings(),
        sessionStore: () => container.getSessionStore(),
        baseUrl,
      });
    }
    return agentRouterInstance;
  };

  let sseRegistryFactory = () => {
    if (!serverSseRegistry) {
      serverSseRegistry = createSseSubscriptionRegistry();
    }
    return serverSseRegistry;
  };

  let confirmationServiceFactory = () => {
    if (!serverConfirmationService) {
      serverConfirmationService = createConfirmationService({
        dbPath: path.join(configDir, "agent-sessions.db"),
        execute: async (command, args) => executeToolCommand(command, args, { baseUrl }),
        notifyResult: async ({ sessionKey, result }) => {
          const svc = await container.getAgentService();
          if (!svc.getSession(sessionKey)) {
            const cfg = buildSessionConfig(sessionKey, container.getSessionStore());
            svc.createSession({
              spaceKey: sessionKey,
              provider: cfg.provider,
              model: cfg.model,
              apiKey: cfg.apiKey,
              identity: cfg.identity,
            });
          }
          container.getSseRegistry().attachPending(sessionKey, svc);
          svc.notifyResult(sessionKey, result);
        },
        sendCard: (payload) => channelManager.sendCard("feishu", payload),
      });
    }
    return serverConfirmationService;
  };

  let permissionBridgeFactory = () => {
    if (!serverPermissionBridge) {
      serverPermissionBridge = createPermissionBridge({
        adjudicator: container.getConfirmationService(),
        modeService: container.getModeService(),
      });
    }
    return serverPermissionBridge;
  };

  let modeServiceFactory = () => {
    if (!serverModeService) {
      serverModeService = createModeService();
    }
    return serverModeService;
  };

  let agentServiceFactory = async () => {
    if (!serverAgentService) {
      serverAgentService = createAgentService({
        cwd: process.cwd(),
        sessionDir: path.join(configDir, "agent-sessions"),
        sessionStore: container.getSessionStore(),
        agentServerBaseUrl: baseUrl,
        modeService: container.getModeService(),
        onConfirmRequest: (req) => container.getConfirmationService().submit(req),
        onPermissionAsk: (payload) => container.getPermissionBridge().handlePermissionAsk(payload),
      });
      await serverAgentService.start();
    }
    return serverAgentService;
  };

  let cardRendererFactory = () => {
    if (!serverCardRenderer) {
      serverCardRenderer = createCardRenderer({
        adapter: {
          sendCard: (payload) => channelManager.sendCard("feishu", payload),
          updateCardStream: (payload) => channelManager.updateCardStream("feishu", payload),
          finalizeCard: (payload) => channelManager.finalizeCard("feishu", payload),
          send: (payload) => channelManager.send("feishu", payload),
        },
        sessions: sessionRegistry,
      });
    }
    return serverCardRenderer;
  };

  async function start() {
    runExecutionLogPurge();

    try {
      purgeTask = cron.schedule(PURGE_CRON_SCHEDULE, runExecutionLogPurge);
    } catch (err) {
      console.error("Failed to schedule purge cron:", err.message);
    }

    async function runStartupStep(label, fn) {
      try {
        await fn();
      } catch (err) {
        console.error(label, err.message);
      }
    }

    await runStartupStep("Failed to recover interrupted executions:", () => {
      const db = getDb();
      if (db) return runner.recoverInterruptedExecutions(db);
    });
    await runStartupStep("Failed to load schedules:", () => schedulerService.loadAll());
    await runStartupStep("Failed to start Feishu channel adapter:", () => channelManager.start());

    try {
      imRouterInstance = createImRouter({
        channelManager,
        baseUrl,
        agentRouter: container.getAgentRouter(),
        agentService: container.getAgentService,
        sessionStore: () => container.getSessionStore(),
        onSessionEvent: (spaceKey, ev) => {
          container.getCardRenderer().handleStreamEvent({ sessionKey: spaceKey, ...ev });
        },
        onSessionCreated: (spaceKey, session) => {
          if (!session || typeof session !== "object") return;
          container
            .getAgentService()
            .then((svc) => container.getSseRegistry().attachPending(spaceKey, svc))
            .catch(() => undefined);
          if (typeof session.onExecutionResult !== "function") {
            session.onExecutionResult = (result) => {
              const summaryPrompt = `请用不超过 200 字总结本次执行结果，直接输出总结：${JSON.stringify(result ?? {})}`;
              return container
                .getAgentService()
                .then((svc) => {
                  if (typeof session.emit === "function") {
                    session.emit("session-event", { type: "stream_start" });
                  }
                  return svc.prompt(spaceKey, summaryPrompt);
                })
                .catch(() => undefined);
            };
          }
          sessionRegistry[spaceKey] = session;
        },
      });
    } catch (err) {
      console.error("Failed to register IM router:", err.message);
    }

    const resolveSessionKey = (executionEvent) => executionEvent?.variables?.spaceKey ?? undefined;
    const dispatchExecutionEvent = (event, type, extra = {}) => {
      container.getCardRenderer().handleExecutionEvent({
        sessionKey: resolveSessionKey(event),
        type,
        executionId: event.executionId,
        status: event.status,
        ...extra,
      });
    };

    eventBus.subscribe("execution:started", (e) => dispatchExecutionEvent(e, "started", { flowId: e.flowId }));
    eventBus.subscribe("execution:progress", (e) => dispatchExecutionEvent(e, "progress", { log: e.log }));
    eventBus.subscribe("execution:completed", (e) =>
      dispatchExecutionEvent(e, "completed", { output: e.output, artifacts: e.artifacts })
    );
  }

  async function dispose() {
    if (imRouterInstance && typeof imRouterInstance.stop === "function") {
      try {
        imRouterInstance.stop();
      } catch {
        // ignore
      }
    }

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
      await runner.reset();
    } catch {
      // ignore
    }

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

    if (serverAgentService) {
      try {
        await serverAgentService.stop();
      } catch {
        // ignore
      }
    }

    if (purgeTask) {
      const task = purgeTask;
      purgeTask = null;
      try {
        task.destroy();
      } catch {
        // ignore
      }
    }
  }

  const container = {
    // 8 Lazy Service Getters
    getSessionStore: () => sessionStoreFactory(),
    getAgentRouter: () => agentRouterFactory(),
    getSseRegistry: () => sseRegistryFactory(),
    getConfirmationService: () => confirmationServiceFactory(),
    getPermissionBridge: () => permissionBridgeFactory(),
    getModeService: () => modeServiceFactory(),
    getAgentService: async () => agentServiceFactory(),
    getCardRenderer: () => cardRendererFactory(),

    // State peek
    peekAgentService: () => serverAgentService ?? null,
    getPurgeTask: () => purgeTask,

    // Lifecycle
    start,
    dispose,

    // Extensible factory getters/setters (for testing and server._opcXxx backward compatibility)
    getSessionStoreFactory: () => sessionStoreFactory,
    setSessionStoreFactory: (fn) => { sessionStoreFactory = fn; },
    getAgentRouterFactory: () => agentRouterFactory,
    setAgentRouterFactory: (fn) => { agentRouterFactory = fn; },
    getSseRegistryFactory: () => sseRegistryFactory,
    setSseRegistryFactory: (fn) => { sseRegistryFactory = fn; },
    getConfirmationServiceFactory: () => confirmationServiceFactory,
    setConfirmationServiceFactory: (fn) => { confirmationServiceFactory = fn; },
    getPermissionBridgeFactory: () => permissionBridgeFactory,
    setPermissionBridgeFactory: (fn) => { permissionBridgeFactory = fn; },
    getModeServiceFactory: () => modeServiceFactory,
    setModeServiceFactory: (fn) => { modeServiceFactory = fn; },
    getAgentServiceFactory: () => agentServiceFactory,
    setAgentServiceFactory: (fn) => { agentServiceFactory = fn; },
    getCardRendererFactory: () => cardRendererFactory,
    setCardRendererFactory: (fn) => { cardRendererFactory = fn; },
    setAgentService: (svc) => { serverAgentService = svc; },
  };

  return container;
}
