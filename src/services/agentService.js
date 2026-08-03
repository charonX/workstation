// src/services/agentService.js
// agent 子进程生命周期的主进程侧服务（tech-design「agentService（主进程）」）。
//
// 双形态（signoff 实现者测试缝契约）：
// 1. 真实子进程形态（REQ-AGENT-005/006 集成）：createAgentService({ cwd, sessionDir })
//    → start()/stop()/kill()/on("ready")/isAlive()/childPid/logs；
//    spawn agent 子进程（H1：开发 = node <源码入口>；打包 = process.execPath +
//    ELECTRON_RUN_AS_NODE=1 + asar 内 bundle），自建 stdio JSONL IPC + 心跳看门狗；
//    子进程崩溃（exit/心跳超时）→ 自动重启，会话按 agent_sessions 引用 + JSONL
//    恢复（SessionManager.open，只丢半条流式消息）；重启期间 prompt 返回
//    session-error { code: "restarting" }，就绪后重投（REQ-AGENT-005 标准 4）。
// 2. 内存版快速路径（REQ-AGENT-006/007 单元 seam）：createAgentService({ inMemory: true })
//    → provider 注入 { respond() } 驱动对话内核（fauxProvider 等价脚本化响应），
//    同空间排队串行 / 跨空间并行 / 流式增量按序 / 工具事件 / 重试语义 /
//    错误结构化 / 256KB 截断——不 spawn 真进程。
// 3. 内存版 IPC 快速路径（Slice 1，REQ-AGENT-003/004）：createAgentService({ ipc })
//    → 出站消息进 ipc.sent，config-ack 回执进 ipc.acks（模拟子进程回执）。
//
// GAP 补全（tech-design 数据流 7，2026-08-03 登记）：
// broadcastConfigUpdate({ identity, provider, apiKey })——identity 变更 → 存量会话
// 热更新 systemPrompt（不重建，REQ-AGENT-004 标准 2）；provider/key 变更 → 会话
// 上下文重建（sessionRef 换代）+ 新 key 一次性注入（子进程重建，config-ack）。
//
// secret 约束（签核决策 5）：key 明文仅持内存（keySecrets），经 session-config
// 一次性注入子进程，不落日志（sendToChild 只记消息类型）、不进 JSONL。
// ADR-009：惰性初始化，无顶层 env/磁盘读取；模块级仅持有活跃服务引用。

import { EventEmitter } from "node:events";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import * as settingsService from "./settingsService.js";
import { buildSystemPrompt } from "./agentSystemPrompt.js";

// provider → 默认模型（对齐 pi-ai provider 模型名；faux 供测试 seam 使用）。
const DEFAULT_MODELS = {
  deepseek: "deepseek-chat",
  moonshotai: "kimi-latest",
  "moonshotai-cn": "kimi-latest",
  faux: "faux-1",
};

// 单条 IPC 消息上限（签核决策 15：≤ 256KB）。
const MAX_IPC_BYTES = 256 * 1024;

// 心跳看门狗（REQ-AGENT-005 标准 2：心跳超时或 exit → 重启）。
const HEARTBEAT_INTERVAL_MS = 2000;
const HEARTBEAT_TIMEOUT_MS = 6000;
const RESTART_DELAY_MS = 150;
const MAX_CONSECUTIVE_RESTARTS = 5;

// LLM 重试语义（REQ-AGENT-007 标准 2：408/409/429/5xx 重试，尊重 retry-after；
// 耗尽后进入错误消息路径）。
const RETRY_STATUSES = new Set([408, 409, 429]);
const MAX_LLM_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 50;
const RETRY_MAX_DELAY_MS = 300;

// 活跃服务实例：HTTP 路由层经广播函数热更新存量会话（REQ-AGENT-004 / 数据流 7）。
let activeService = null;

export function getActiveService() {
  return activeService;
}

// —— 共享工具 ——

function restartingError() {
  return Object.assign(new Error("agent 子进程重启中，请稍后重试"), { code: "restarting" });
}

function noSessionError() {
  return Object.assign(new Error("会话不存在"), { code: "E-AGENT-NO-SESSION" });
}

// 单条 session-event ≤ 256KB：超限截断文本载体 + truncated 标记（REQ-AGENT-006 标准 5）。
function enforceSizeLimit(event) {
  const size = JSON.stringify(event).length;
  if (size <= MAX_IPC_BYTES) return event;
  const out = { ...event };
  if (typeof out.content === "string") {
    out.content = out.content.slice(0, MAX_IPC_BYTES - 256);
    out.truncated = true;
  } else if (typeof out.delta === "string") {
    out.delta = out.delta.slice(0, MAX_IPC_BYTES - 256);
    out.truncated = true;
  } else {
    return { type: event.type, truncated: true };
  }
  return out;
}

// 会话句柄：EventEmitter（on("session-event")）+ 会话元数据。
// keyRef → 明文 key 仅持内存（一次性注入语义，不落盘/不落日志/不进 JSONL）。
function createSessionHandle(fields) {
  const handle = new EventEmitter();
  Object.assign(handle, fields);
  return handle;
}

// JSONL 会话引用（REQ-AGENT-008 接口契约：sessionRef = JSONL 路径）。
// 按空间 key 稳定生成；generation 仅在 provider/key 变更重建时递增
// （tech-design 数据流 7；REQ-AGENT-004 标准 2：未变不重建）。
function sessionRefFor(sessionDir, spaceKey, generation = 1) {
  const safeKey = String(spaceKey).replace(/[^a-zA-Z0-9_-]/g, "_");
  const suffix = generation > 1 ? `.${generation}` : "";
  return path.join(sessionDir, `${safeKey}${suffix}.jsonl`);
}

function defaultSessionDir() {
  return path.join(settingsService.configDir(), "agent-sessions");
}

// —— 内存版对话内核（REQ-AGENT-006/007 单元 seam，不 spawn 真进程）——
// provider = { respond() }：脚本化响应（等价 pi-ai fauxProvider，H3 seam）。
// 对话内核实现契约行为：排队串行/跨空间并行/流式按序/工具事件/重试/错误结构化/截断。
function createInMemoryAgentService(options = {}) {
  const sessionDir = options.sessionDir ?? defaultSessionDir();
  const sessions = new Map(); // spaceKey → 会话句柄
  const queues = new Map(); // spaceKey → promise 链（排队串行）

  function emitError(session, err = {}) {
    const code =
      typeof err.code === "string" && err.code.startsWith("E-AGENT-") ? err.code : "E-AGENT-LLM-FAIL";
    const reason = err.reason ?? err.message ?? "未知原因";
    session.emit(
      "session-event",
      enforceSizeLimit({
        type: "error",
        code,
        reason,
        status: err.status,
        // 用户可展示文案与内部错误码区分（REQ-AGENT-007 标准 3）。
        userMessage: `LLM 调用失败：${reason}`,
      })
    );
  }

  async function runTurn(session, text) {
    for (let attempt = 1; attempt <= MAX_LLM_ATTEMPTS; attempt++) {
      let result;
      try {
        result = await session.provider.respond(text);
      } catch (err) {
        result = { error: { code: "E-AGENT-LLM-FAIL", reason: err?.message ?? String(err) } };
      }
      if (!result || result.error) {
        const err = result?.error ?? {};
        const status = Number(err.status ?? 0);
        const retryable = RETRY_STATUSES.has(status) || (status >= 500 && status <= 599);
        if (retryable && attempt < MAX_LLM_ATTEMPTS) {
          const retryAfter = Number(err.retryAfter ?? NaN);
          const delay = Number.isFinite(retryAfter)
            ? Math.min(retryAfter, RETRY_MAX_DELAY_MS)
            : RETRY_BASE_DELAY_MS;
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }
        emitError(session, err);
        return;
      }
      for (const ev of result) {
        session.emit("session-event", enforceSizeLimit(ev));
      }
      return;
    }
  }

  function enqueue(spaceKey, fn) {
    const prev = queues.get(spaceKey) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    queues.set(spaceKey, next.catch(() => {}));
    return next;
  }

  const service = {
    createSession({ spaceKey, provider, identity }) {
      const existing = sessions.get(spaceKey);
      if (existing) return existing;
      const session = createSessionHandle({
        spaceKey,
        provider,
        identity: typeof identity === "string" ? identity : undefined,
        sessionRef: sessionRefFor(sessionDir, spaceKey),
        model: "in-memory",
      });
      sessions.set(spaceKey, session);
      return session;
    },
    getSession(spaceKey) {
      return sessions.get(spaceKey);
    },
    prompt(spaceKey, text) {
      const session = sessions.get(spaceKey);
      if (!session) return Promise.reject(noSessionError());
      return enqueue(spaceKey, async () => {
        await runTurn(session, text);
        return { ok: true, sessionKey: spaceKey };
      });
    },
    broadcastConfigUpdate({ identity }) {
      if (typeof identity !== "string") return;
      for (const session of sessions.values()) {
        session.identity = identity;
      }
    },
    start() {},
    stop() {},
    kill() {},
    isAlive() {
      return true;
    },
  };

  activeService = service;
  return service;
}

// —— 真实子进程形态（REQ-AGENT-005/006 集成 seam）——
// 支持两种传输：真实 spawn（默认）/ Slice 1 内存版 IPC fake（{ ipc: { sent, acks } }）。
function createProcessAgentService(options = {}) {
  const fakeIpc = !!(options.ipc && Array.isArray(options.ipc.sent));
  const sessionDir = options.sessionDir ?? defaultSessionDir();
  const cwd = options.cwd ?? process.cwd();
  const inElectron = typeof process.versions?.electron === "string";
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  // H1：打包 = ELECTRON_RUN_AS_NODE + asar 内 bundle；开发/测试 = node <源码入口>。
  const entry =
    options.entry ??
    (inElectron ? path.join(__dirname, "agent-worker.js") : path.join(__dirname, "../agent/worker.js"));

  const emitter = new EventEmitter();
  const sessions = new Map(); // spaceKey → 会话句柄
  const keySecrets = new Map(); // keyRef → 明文 key（内存仅持）
  const generation = new Map(); // spaceKey → JSONL 世代（provider/key 变更重建）
  const pendingPrompts = new Map(); // prompt id → { resolve, reject }
  const logs = [];

  let child = null;
  let state = fakeIpc ? "ready" : "stopped"; // stopped | starting | ready | restarting
  let stopping = false;
  let restartTimer = null;
  let heartbeatTimer = null;
  let lastPongAt = 0;
  let readyCount = 0;
  let nextPromptId = 1;
  let consecutiveRestarts = 0;

  function log(line) {
    logs.push(String(line));
  }

  // 日志红线：出站消息只记类型与 sessionKey，绝不含 key 值（签核决策 5）。
  function logSend(msg) {
    log(`→ ${msg.type}${msg.sessionKey ? ` session=${msg.sessionKey}` : ""}`);
  }

  function sendToChild(msg) {
    if (fakeIpc) {
      options.ipc.sent.push(msg);
      // 内存版快速路径：模拟子进程 config-ack 回执（真实回执来自子进程）。
      if (Array.isArray(options.ipc.acks)) {
        options.ipc.acks.push({ type: "config-ack" });
      }
      return;
    }
    if (child?.stdin?.writable) {
      try {
        child.stdin.write(`${JSON.stringify(msg)}\n`);
        logSend(msg);
      } catch (err) {
        log(`发送失败 type=${msg.type} err=${err?.message ?? String(err)}`);
      }
    }
  }

  function sendPing() {
    if (state !== "ready" || !child) return;
    if (Date.now() - lastPongAt > HEARTBEAT_TIMEOUT_MS) {
      // 心跳超时 → 判定崩溃（REQ-AGENT-005 标准 2）。
      log("心跳超时：判定子进程崩溃，强制重启");
      try {
        child.kill("SIGKILL");
      } catch {
        // 已退出则交由 exit 事件处理。
      }
      return;
    }
    sendToChild({ type: "ping" });
  }

  function rejectPendingPrompts(error) {
    for (const [, pending] of pendingPrompts) {
      pending.reject(error);
    }
    pendingPrompts.clear();
  }

  function handleChildExit(exitInfo) {
    if (stopping) return;
    // 只处理当前子进程的 exit（避免旧子进程晚到的事件误伤新子进程）。
    if (exitInfo.child !== child) return;
    state = "restarting";
    child = null;
    rejectPendingPrompts(restartingError());
    consecutiveRestarts += 1;
    if (consecutiveRestarts > MAX_CONSECUTIVE_RESTARTS) {
      log(`看门狗放弃：连续重启 ${consecutiveRestarts} 次仍失败，停止自动重启`);
      state = "stopped";
      emitter.emit("spawn-error", Object.assign(new Error("agent 子进程反复崩溃"), { code: "E-AGENT-RUNTIME" }));
      return;
    }
    log(`子进程退出（连续重启 ${consecutiveRestarts} 次），${RESTART_DELAY_MS}ms 后重启`);
    restartTimer = setTimeout(spawnChild, RESTART_DELAY_MS);
  }

  function spawnChild() {
    if (stopping || fakeIpc) return;
    state = "starting";
    const env = { ...process.env };
    env.OPC_AGENT_SESSION_DIR = sessionDir;
    env.OPC_AGENT_HOME = path.join(cwd, ".agent-home");
    env.OPC_AGENT_CWD = cwd;
    // 测试 seam（H3）：fauxProvider 注入，零网络（生产不设置）。
    if (process.env.NODE_ENV === "test") env.OPC_AGENT_FAUX = "1";
    if (inElectron) env.ELECTRON_RUN_AS_NODE = "1";
    const spawned = spawn(process.execPath, [entry], {
      env,
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
    });
    child = spawned;
    spawned.on("error", (err) => {
      log(`spawn 失败：${err?.message ?? String(err)}`);
      emitter.emit("spawn-error", err);
    });
    // 绑定被 spawn 的实例（避免旧子进程晚到的事件误判为新子进程 exit）。
    spawned.on("exit", () => handleChildExit({ child: spawned }));
    spawned.stderr.setEncoding("utf8");
    spawned.stderr.on("data", (chunk) => {
      // 子进程 stderr 进主进程日志（REQ-AGENT-005 标准 5；子进程侧已 redact key）。
      for (const line of chunk.split("\n")) {
        if (line.trim()) log(line);
      }
    });
    const rl = createInterface({ input: spawned.stdout, crlfDelay: Infinity });
    rl.on("line", (line) => {
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        log(`子进程非法消息行：${String(line).slice(0, 200)}`);
        return;
      }
      handleChildMessage(msg);
    });
  }

  function handleChildMessage(msg) {
    switch (msg.type) {
      case "ready":
        state = "ready";
        readyCount += 1;
        consecutiveRestarts = 0;
        lastPongAt = Date.now();
        log(`子进程就绪（第 ${readyCount} 次）pid=${msg.pid}`);
        emitter.emit("ready");
        // 重启后：存量会话按注册表重新下发 session-config（子进程按
        // agent_sessions 引用 + JSONL 恢复，REQ-AGENT-005 标准 3）。
        for (const [spaceKey, session] of sessions) {
          sendToChild(buildConfigMessage(spaceKey, session));
        }
        break;
      case "pong":
        lastPongAt = Date.now();
        break;
      case "config-ack":
        log(`config-ack session=${msg.sessionKey}`);
        break;
      case "session-event": {
        const session = sessions.get(msg.sessionKey);
        if (session) session.emit("session-event", enforceSizeLimit(msg.event));
        break;
      }
      case "session-error": {
        const session = sessions.get(msg.sessionKey);
        if (session) {
          session.emit(
            "session-event",
            enforceSizeLimit({
              type: "error",
              code: msg.code,
              reason: msg.reason,
              userMessage: msg.userMessage ?? `操作失败：${msg.code}`,
            })
          );
        }
        break;
      }
      case "prompt-result": {
        const pending = pendingPrompts.get(msg.id);
        if (!pending) break;
        pendingPrompts.delete(msg.id);
        if (msg.ok) {
          pending.resolve({ ok: true, sessionKey: msg.sessionKey });
        } else {
          // LLM 失败等：错误已以 error 事件回传，prompt 侧 resolve 保持
          // 与内存版一致的「事件即结果」语义（会话存活可继续，REQ-AGENT-007 标准 1）。
          pending.resolve({ ok: false, sessionKey: msg.sessionKey, error: msg.error });
        }
        break;
      }
      case "log":
        log(`[agent] ${msg.message}`);
        break;
      default:
        log(`未知子进程消息 type=${msg.type}`);
    }
  }

  function buildConfigMessage(spaceKey, session) {
    return {
      type: "session-config",
      sessionKey: spaceKey,
      provider: session.provider,
      model: session.model,
      keyRef: session.keyRef,
      sessionRef: session.sessionRef,
      // 一次性注入：key 明文经 IPC 下发子进程（仅内存，不落日志/JSONL）。
      apiKey: keySecrets.get(session.keyRef),
      systemPrompt: buildSystemPrompt(session.identity),
    };
  }

  function startHeartbeat() {
    clearInterval(heartbeatTimer);
    heartbeatTimer = setInterval(sendPing, HEARTBEAT_INTERVAL_MS);
  }

  const service = {
    on(event, listener) {
      emitter.on(event, listener);
      return service;
    },
    // 创建/复用空间会话。已有空间返回同一会话句柄（不重复下发）。
    createSession({ spaceKey, provider, apiKey, identity }) {
      const existing = sessions.get(spaceKey);
      if (existing) return existing;
      const keyRef = `key:${provider}:${generation.get(spaceKey) ?? 1}`;
      if (apiKey) keySecrets.set(keyRef, apiKey);
      const session = createSessionHandle({
        spaceKey,
        provider,
        model: DEFAULT_MODELS[provider] ?? provider,
        keyRef,
        identity: identity ?? settingsService.loadAgentConfig().identity,
        sessionRef: sessionRefFor(sessionDir, spaceKey, generation.get(spaceKey) ?? 1),
      });
      sessions.set(spaceKey, session);
      sendToChild(buildConfigMessage(spaceKey, session));
      return session;
    },
    getSession(spaceKey) {
      return sessions.get(spaceKey);
    },
    prompt(spaceKey, text) {
      return new Promise((resolve, reject) => {
        if (state !== "ready") {
          // 重启期间到达的 prompt → session-error { code: "restarting" }
          // （主进程缓存语义由调用方重投，REQ-AGENT-005 标准 4）。
          reject(restartingError());
          return;
        }
        const session = sessions.get(spaceKey);
        if (!session) {
          reject(noSessionError());
          return;
        }
        const id = `p${nextPromptId++}`;
        pendingPrompts.set(id, { resolve, reject });
        sendToChild({ type: "prompt", id, sessionKey: spaceKey, text });
      });
    },
    // 配置变更广播（GAP 补全，tech-design 数据流 7）：
    // - identity 变更（仅）→ 存量会话热更新 systemPrompt，不重建（REQ-AGENT-004 标准 2）；
    // - provider/key 变更 → 会话上下文重建（sessionRef 换代）+ 新 key 一次性注入。
    broadcastConfigUpdate({ identity, provider, apiKey }) {
      const identityChanged = typeof identity === "string";
      const credsChanged = typeof provider === "string" || typeof apiKey === "string";
      for (const [spaceKey, session] of sessions) {
        if (identityChanged) session.identity = identity;
        if (credsChanged) {
          const newProvider = typeof provider === "string" ? provider : session.provider;
          const newKey = typeof apiKey === "string" ? apiKey : keySecrets.get(session.keyRef);
          const oldKeyRef = session.keyRef;
          const gen = (generation.get(spaceKey) ?? 1) + 1;
          generation.set(spaceKey, gen);
          session.provider = newProvider;
          session.model = DEFAULT_MODELS[newProvider] ?? newProvider;
          session.keyRef = `key:${newProvider}:${gen}`;
          session.sessionRef = sessionRefFor(sessionDir, spaceKey, gen);
          if (newKey !== undefined) keySecrets.set(session.keyRef, newKey);
          keySecrets.delete(oldKeyRef);
          session.rebuilt = true;
        }
        sendToChild(buildConfigMessage(spaceKey, session));
      }
    },
    start() {
      if (fakeIpc) {
        // Slice 1 内存版 IPC：无真实子进程，直接就绪。
        state = "ready";
        return Promise.resolve(service);
      }
      fs.mkdirSync(sessionDir, { recursive: true });
      // await start() = 等待首个 ready（REQ-AGENT-005 标准 1：就绪后回 ready）。
      return new Promise((resolve, reject) => {
        let settled = false;
        const onReady = () => {
          if (settled) return;
          settled = true;
          emitter.off("spawn-error", onSpawnError);
          resolve(service);
        };
        const onSpawnError = (err) => {
          if (settled) return;
          settled = true;
          emitter.off("ready", onReady);
          reject(err);
        };
        emitter.once("ready", onReady);
        emitter.once("spawn-error", onSpawnError);
        spawnChild();
        startHeartbeat();
      });
    },
    stop() {
      stopping = true;
      clearInterval(heartbeatTimer);
      clearTimeout(restartTimer);
      rejectPendingPrompts(restartingError());
      if (child && child.exitCode === null) {
        try {
          child.kill("SIGTERM");
        } catch {
          // 已退出。
        }
      }
      child = null;
      state = "stopped";
    },
    kill() {
      // 模拟崩溃（任意退出码）→ 看门狗重启（REQ-AGENT-005 标准 2/3/4）。
      state = "restarting";
      rejectPendingPrompts(restartingError());
      if (child && child.exitCode === null) {
        try {
          child.kill("SIGKILL");
        } catch {
          // 已退出则交由 exit 事件处理。
        }
      }
    },
    isAlive() {
      return state === "ready" && !!child && child.exitCode === null;
    },
    logs,
  };

  Object.defineProperty(service, "childPid", {
    get() {
      return child?.pid ?? null;
    },
  });

  activeService = service;
  return service;
}

// 服务工厂：内存版快速路径（单元 seam）/ 真实子进程 + 内存版 IPC（集成/回归）。
export function createAgentService(options = {}) {
  if (options.inMemory) {
    return createInMemoryAgentService(options);
  }
  return createProcessAgentService(options);
}

// 供 HTTP 路由（PUT /api/settings/agent 保存后）热更新存量会话。
// GAP 补全：provider/key 变更 → 重建；identity 变更 → 热更新（数据流 7）。
export function broadcastAgentConfigChange({ identity, provider, apiKey }) {
  if (activeService) {
    activeService.broadcastConfigUpdate({ identity, provider, apiKey });
  }
}

// 兼容包装：仅身份变更（Slice 1 行为，REQ-AGENT-004 标准 2）。
export function broadcastIdentityChange({ identity }) {
  if (activeService) {
    activeService.broadcastConfigUpdate({ identity });
  }
}
