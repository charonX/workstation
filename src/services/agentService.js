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
// 上下文重建（sessionRef 换代）+ 新 key 一次性注入（子进程重建，config-ack）；
// 变更判定按各会话当前值比较（PRD 对齐缺口 3）：provider/apiKey 未实际变化
// （客户端原样保存）→ 不重建。
//
// secret 约束（签核决策 5）：key 明文仅持内存（keySecrets），经 session-config
// 一次性注入子进程，不落日志（sendToChild 只记消息类型）、不进 JSONL。
// ADR-009：惰性初始化，无顶层 env/磁盘读取；模块级仅持有活跃服务引用。
//
// Slice 3（REQ-AGENT-008~011）：会话存储与恢复——
// - sessionStore（SQLite agent_sessions）为真相，本服务注册表仅为活跃句柄缓存；
//   未显式注入 sessionStore 时按 cwd 派生默认库（测试隔离：随 cwd 临时目录）；
// - 内存内核维护每空间上下文（getContext）、JSONL 轻量记录（平台自持、非 PI 可恢复
//   格式，仅注入 store 时落盘）、滚动摘要压缩（compressionThreshold + summarize 可注入，
//   REQ-AGENT-011）；
// - 进程形态：start 就绪后按 agent_sessions 行水合会话（SessionManager.open
//   恢复，JSONL 缺失 → 新建 + recoveryHint，REQ-AGENT-009）；/reset 经
//   store.onReset 通知 → IPC reset-session + sessionRef 换代（REQ-AGENT-010）。

import { EventEmitter } from "node:events";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import * as settingsService from "./settingsService.js";
import { buildSystemPrompt } from "./agentSystemPrompt.js";
import { createSessionStore, generationFromRef, sessionRefFor, degradePersistFailure } from "./sessionStore.js";

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

// 滚动摘要压缩（REQ-AGENT-011）：上下文消息数超过阈值 → 旧消息折叠为摘要注入
// （平台侧驱动，PI 无原生摘要；实现常量可注入断言——签核决策 17）。
const DEFAULT_COMPRESSION_THRESHOLD = 30;

// 默认摘要器（确定性截断，无注入 summarize 时的兜底；关键信息保留前 500 字符）。
function defaultSummarize(folded) {
  const text = folded
    .map((m) => (typeof m?.content === "string" ? m.content : ""))
    .filter(Boolean)
    .join(" | ");
  return `[摘要] 较早的 ${folded.length} 条消息已折叠：${text.slice(0, 500)}`;
}

// 平台自持轻量记录（非 PI 可恢复格式，缺口 4 修正 2026-08-04）：仅含 message 行、
// 无 type:"session" 头——PI SessionManager.open 会静默恢复为空，内存内核不接线恢复
// （重启恢复走真实子进程 PI 原生 JSONL，本记录仅内存内核 seam 落盘）。消息行沿用
// PI message 结构；平台侧不复制全文（B1），仅转发文本。
function appendJsonlMessage(ref, { role, content }) {
  const line = JSON.stringify({
    type: "message",
    id: randomUUID(),
    parentId: null,
    timestamp: new Date().toISOString(),
    message: { role, content: [{ type: "text", text: content }], timestamp: Date.now() },
  });
  try {
    fs.appendFileSync(ref, `${line}\n`);
  } catch (err) {
    // E-SESSION-PERSIST（PRD §8）：JSONL 追加失败 → 告警日志 + 内存态继续
    // （对话可用，仅重启不恢复）；非持久化异常（无 err.code）仍抛出。
    degradePersistFailure("JSONL 追加", err);
  }
}

// 对话消息入上下文 + JSONL 轻量记录（REQ-AGENT-008 标准 4：消息落盘；仅注入
// store 时落盘——无 store 的单元 seam 不写盘）。
function pushContextMessage(session, role, content) {
  session.context.push({ role, content });
  if (session.persistJsonl) appendJsonlMessage(session.sessionRef, { role, content });
}

// 恢复失败提示（REQ-AGENT-009 标准 2）：JSONL 缺失/损坏重建后挂用户可见提示。
function applyRecoveryHint(session, hint) {
  if (hint) session.recoveryHint = hint;
}

// prompt 结果附带本轮回复文本（text_end.content；无文本时缺省，「事件即结果」）。
function withReply(base, reply) {
  return reply !== undefined ? { ...base, reply } : base;
}

// notify-result 注入提示词（REQ-AGENT-016 标准 2 / W-2）：确认执行结果 → agent
// 生成自然语言回投（worker 与内存内核共用同一文案，回投文本基于执行结果）。
function notifyPromptText(result) {
  return `执行结果已就绪，请用自然语言向用户简要汇报执行结果：${JSON.stringify(result ?? {})}`;
}

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

// 结构化错误事件（REQ-AGENT-007 标准 3：用户可展示文案与内部错误码区分）。
// 内存版内核与子进程 session-error 回执共用；status 缺省 → 事件不带该字段。
function emitErrorEvent(session, { code, reason, status, userMessage }) {
  session.emit(
    "session-event",
    enforceSizeLimit({
      type: "error",
      code,
      reason,
      status,
      userMessage: userMessage ?? `LLM 调用失败：${reason}`,
    })
  );
}

// 会话句柄：EventEmitter（on("session-event")）+ 会话元数据。
// keyRef → 明文 key 仅持内存（一次性注入语义，不落盘/不落日志/不进 JSONL）。
function createSessionHandle(fields) {
  const handle = new EventEmitter();
  Object.assign(handle, fields);
  return handle;
}

// JSONL 会话引用（REQ-AGENT-008 接口契约：sessionRef = JSONL 路径）。
// 命名规范与 sessionStore 共用（sessionStore.js 导出）：按空间 key 稳定生成；
// generation 仅在 provider/key 变更重建或 /reset 时递增
// （tech-design 数据流 7；REQ-AGENT-004 标准 2：未变不重建）。

// keyRef 命名（provider + JSONL 世代）：key 明文按 keyRef 索引仅持内存
// （一次性注入语义，不落盘/不落日志/不进 JSONL）。
function keyRefFor(provider, generation) {
  return `key:${provider}:${generation}`;
}

function defaultSessionDir() {
  return path.join(settingsService.configDir(), "agent-sessions");
}

// —— 内存版对话内核（REQ-AGENT-006/007/008/010/011 单元 seam，不 spawn 真进程）——
// provider = { respond() }：脚本化响应（等价 pi-ai fauxProvider，H3 seam）。
// 对话内核实现契约行为：排队串行/跨空间并行/流式按序/工具事件/重试/错误结构化/截断
// + 每空间上下文（getContext，REQ-AGENT-008 标准 3 隔离）+ JSONL 轻量记录（B1，
// 平台自持非 PI 可恢复格式，仅当注入 sessionStore）+ 滚动摘要压缩（REQ-AGENT-011，
// threshold/summarize 可注入）
// + /reset 监听（REQ-AGENT-010，store.reset → 清当前空间上下文）。
function createInMemoryAgentService(options = {}) {
  const sessionDir = options.sessionDir ?? defaultSessionDir();
  const sessions = new Map(); // spaceKey → 会话句柄
  const queues = new Map(); // spaceKey → promise 链（排队串行）
  const store = options.sessionStore;
  const compressionThreshold = Number.isFinite(Number(options.compressionThreshold))
    ? Number(options.compressionThreshold)
    : DEFAULT_COMPRESSION_THRESHOLD;

  // store.reset(spaceKey) → 清当前空间会话上下文（REQ-AGENT-010 标准 1/2：
  // 仅当前空间，其他空间行/上下文不受影响）。
  if (store?.onReset) {
    store.onReset((spaceKey, info) => {
      const session = sessions.get(spaceKey);
      if (!session) return;
      session.context = [];
      session.summaryRef = undefined;
      if (info?.sessionRef) session.sessionRef = info.sessionRef;
    });
  }

  function emitError(session, err = {}) {
    const code =
      typeof err.code === "string" && err.code.startsWith("E-AGENT-") ? err.code : "E-AGENT-LLM-FAIL";
    const reason = err.reason ?? err.message ?? "未知原因";
    emitErrorEvent(session, { code, reason, status: err.status });
  }

  async function runTurn(session, text) {
    // 上下文追加 + JSONL 轻量记录（REQ-AGENT-008 标准 4：消息落盘；平台侧不复制
    // 全文——SQLite 行无消息列；记录格式非 PI 可恢复，缺口 4 修正）。
    pushContextMessage(session, "user", text);
    let finalText;
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
        return undefined;
      }
      for (const ev of result) {
        if (ev.type === "text_end" && typeof ev.content === "string") finalText = ev.content;
        session.emit("session-event", enforceSizeLimit(ev));
      }
      break;
    }
    if (finalText !== undefined) {
      pushContextMessage(session, "assistant", finalText);
    }
    compressIfNeeded(session);
    return finalText;
  }

  // 滚动摘要压缩（REQ-AGENT-011）：上下文消息数超过阈值 → 旧消息折叠为摘要注入
  // 后续 prompt（summarize 注入断言，默认确定性截断）；摘要索引写 agent_sessions
  // summaryRef；压缩对用户无感（对话不打断）。
  function compressIfNeeded(session) {
    if (compressionThreshold <= 0 || session.context.length <= compressionThreshold) return;
    const folded = session.context.slice(0, session.context.length - compressionThreshold);
    const summaryText = session.summarize(folded);
    session.context = [{ role: "summary", content: summaryText }, ...session.context.slice(-compressionThreshold)];
    if (store?.updateSummaryRef) {
      store.updateSummaryRef(session.spaceKey, `summary:${folded.length}:${session.context.length}`);
    }
  }

  function enqueue(spaceKey, fn) {
    const prev = queues.get(spaceKey) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    queues.set(spaceKey, next.catch(() => {}));
    return next;
  }

  const service = {
    createSession({ spaceKey, provider, identity, summarize, toolContext }) {
      const existing = sessions.get(spaceKey);
      if (existing) return existing;
      const info = store?.getOrCreate ? store.getOrCreate(spaceKey, { sessionDir }) : null;
      const session = createSessionHandle({
        spaceKey,
        provider,
        identity: typeof identity === "string" ? identity : undefined,
        sessionRef: info?.sessionRef ?? sessionRefFor(sessionDir, spaceKey),
        model: "in-memory",
        context: [],
        // 工具上下文（Slice 8 G1）：绑定默认目标候选（内存内核无工具面消费，随
        // 句柄携带以保持与服务形态字段一致；生产消费在 worker 工具面）。
        toolContext,
        summarize: typeof summarize === "function" ? summarize : defaultSummarize,
        // 仅注入 sessionStore 时持久化 JSONL（无 store 的单元 seam 不落盘）。
        persistJsonl: !!info,
      });
      applyRecoveryHint(session, info?.recoveryHint);
      // 会话上下文（REQ-AGENT-008 标准 3 隔离断言 / REQ-AGENT-010 / REQ-AGENT-011）。
      session.getContext = () => session.context;
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
        const reply = await runTurn(session, text);
        return withReply({ ok: true, sessionKey: spaceKey }, reply);
      });
    },
    // notify-result（REQ-AGENT-016 标准 2 / W-2）：确认执行结果注入会话 → agent
    // 生成自然语言回投（内存内核：经 provider.respond 跑一轮，事件即结果）。
    notifyResult(spaceKey, result) {
      const session = sessions.get(spaceKey);
      if (!session) return Promise.reject(noSessionError());
      return enqueue(spaceKey, () => runTurn(session, notifyPromptText(result)));
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
  // 显式传入的 entry 路径不存在（测试 seam 常见：仅占位路径）→ 回退内置 worker 入口。
  const defaultEntry = inElectron
    ? path.join(__dirname, "agent-worker.js")
    : path.join(__dirname, "../agent/worker.js");
  const entry = options.entry
    ? (fs.existsSync(options.entry) ? options.entry : defaultEntry)
    : defaultEntry;

  const emitter = new EventEmitter();
  const sessions = new Map(); // spaceKey → 会话句柄
  const keySecrets = new Map(); // keyRef → 明文 key（内存仅持）
  const generation = new Map(); // spaceKey → JSONL 世代（provider/key 变更重建）
  const pendingPrompts = new Map(); // prompt id → { resolve, reject }
  const logs = [];

  // 会话存储（REQ-AGENT-008/009）：SQLite agent_sessions 为真相（W-3），本服务
  // 注册表仅为活跃句柄缓存。未显式注入时按 cwd 派生默认库（随工作目录隔离，
  // 测试不污染 ~/.opc-workstation/data.db；生产接线由主进程注入应用库——Slice 5）。
  // ADR-009：惰性创建——仅首次真正需要（createSession/ready 水合/重建）时开库。
  let defaultStore = null;
  let resetListenerRegistered = false;

  // 换代后同步本地句柄：sessionRef 世代 → generation map + 句柄引用更新。
  // handleReset 与 worker session-rebuilt（JSONL 损坏重建）共用。
  function adoptSessionRef(session, ref) {
    const gen = generationFromRef(ref);
    generation.set(session.spaceKey, gen);
    session.sessionRef = ref;
    return gen;
  }

  function handleReset(spaceKey, info) {
    // /reset（REQ-AGENT-010）：store 换代后 → IPC reset-session（worker dispose）+
    // 本地句柄换代 + 重新下发 session-config（新 JSONL，空上下文）。
    const session = sessions.get(spaceKey);
    if (!session || !info?.sessionRef) return;
    sendToChild({ type: "reset-session", sessionKey: spaceKey });
    const gen = adoptSessionRef(session, info.sessionRef);
    // keyRef 按新世代轮换（key 明文不动，仅按新 keyRef 重索引——一次注入语义）。
    const newKeyRef = keyRefFor(session.provider, gen);
    const oldKey = keySecrets.get(session.keyRef);
    keySecrets.delete(session.keyRef);
    session.keyRef = newKeyRef;
    if (oldKey !== undefined) keySecrets.set(newKeyRef, oldKey);
    delete session.recoveryHint;
    sendToChild(buildConfigMessage(spaceKey, session));
  }

  // store 的 /reset 通知 → 本服务 handleReset（注入 store 与默认 store 共用，
  // 每实例只注册一次）。
  function registerResetListener(store) {
    if (resetListenerRegistered || !store?.onReset) return;
    store.onReset(handleReset);
    resetListenerRegistered = true;
  }

  function getStore() {
    if (options.sessionStore) {
      registerResetListener(options.sessionStore);
      return options.sessionStore;
    }
    if (fakeIpc) return null; // 内存版 IPC（Slice 1 单元 seam）：无真实会话存储。
    if (!defaultStore) {
      defaultStore = createSessionStore({
        dbPath: path.join(cwd, ".agent-home", "agent-sessions.db"),
        sessionDir,
      });
      registerResetListener(defaultStore);
    }
    return defaultStore;
  }

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

  // 终止当前子进程：已退出则跳过（exit 事件接管后续看门狗逻辑）。
  function killChild(signal) {
    if (child && child.exitCode === null) {
      try {
        child.kill(signal);
      } catch {
        // 已退出则交由 exit 事件处理。
      }
    }
  }

  function sendPing() {
    if (state !== "ready" || !child) return;
    if (Date.now() - lastPongAt > HEARTBEAT_TIMEOUT_MS) {
      // 心跳超时 → 判定崩溃（REQ-AGENT-005 标准 2）。
      log("心跳超时：判定子进程崩溃，强制重启");
      killChild("SIGKILL");
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
        // 应用/子进程重启后：按 SQLite agent_sessions 行水合会话（SQLite 为真相，
        // W-3；REQ-AGENT-009 标准 1：SessionManager.open 恢复上下文）。JSONL
        // 缺失/损坏 → getOrCreate 换代新建 + recoveryHint（REQ-AGENT-009 标准 2）。
        {
          const store = getStore();
          if (store) {
            const agentConfig = settingsService.loadAgentConfig();
            for (const row of store.list()) {
              if (sessions.has(row.spaceKey)) continue;
              const info = store.getOrCreate(row.spaceKey, { sessionDir });
              const gen = generationFromRef(info.sessionRef);
              generation.set(info.spaceKey, gen);
              const provider = agentConfig.provider || "deepseek";
              const session = createSessionHandle({
                spaceKey: info.spaceKey,
                provider,
                model: DEFAULT_MODELS[provider] ?? provider,
                keyRef: keyRefFor(provider, gen),
                identity: agentConfig.identity,
                sessionRef: info.sessionRef,
              });
              applyRecoveryHint(session, info.recoveryHint);
              sessions.set(info.spaceKey, session);
              sendToChild(buildConfigMessage(info.spaceKey, session));
            }
          }
        }
        break;
      case "pong":
        lastPongAt = Date.now();
        break;
      case "config-ack":
        log(`config-ack session=${msg.sessionKey}`);
        break;
      case "session-rebuilt": {
        // JSONL 损坏 → worker 换代重建（REQ-AGENT-009 标准 2 损坏分支）：同步
        // SQLite 行（真相）与本地句柄，提示历史不可恢复（与缺失分支 recoveryHint
        // 语义一致）。keyRef 不动（worker 侧 keySecrets 仍按原 keyRef 持有 key）。
        const session = sessions.get(msg.sessionKey);
        if (!session) break;
        adoptSessionRef(session, msg.sessionRef);
        if (typeof msg.hint === "string") session.recoveryHint = msg.hint;
        const store = getStore();
        if (store?.updateSessionRef) store.updateSessionRef(msg.sessionKey, msg.sessionRef);
        log(`会话换代重建（JSONL 损坏）session=${msg.sessionKey} ref=${msg.sessionRef}`);
        break;
      }
      case "session-event": {
        const session = sessions.get(msg.sessionKey);
        if (session) session.emit("session-event", enforceSizeLimit(msg.event));
        break;
      }
      case "session-error": {
        const session = sessions.get(msg.sessionKey);
        if (session) {
          emitErrorEvent(session, {
            code: msg.code,
            reason: msg.reason,
            userMessage: msg.userMessage ?? `操作失败：${msg.code}`,
          });
        }
        break;
      }
      case "prompt-result": {
        const pending = pendingPrompts.get(msg.id);
        if (!pending) break;
        pendingPrompts.delete(msg.id);
        if (msg.ok) {
          // reply = 本轮回复最终文本（text_end.content，worker 侧收集）；
          // 无文本（静默失败等）时缺省，与内存版「事件即结果」语义一致。
          pending.resolve(withReply({ ok: true, sessionKey: msg.sessionKey }, msg.reply));
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
      case "confirm-request": {
        // Slice 8 确认接线（REQ-AGENT-016 标准 1）：worker 工具面拦截 confirm 级
        // 工具 → IPC confirm-request → 主进程确认服务入队（agent_confirmations
        // pending + 确认卡片）→ confirm-request-ack 回执（工具侧返回待确认，
        // 不执行——执行由确认回调驱动，b 解耦）。onConfirmRequest 由生产接线
        // （server.js）注入，指向 confirmationService.submit。
        const { confirmId, sessionKey, command, args, riskLevel } = msg;
        const handler = options.onConfirmRequest;
        Promise.resolve(typeof handler === "function" ? handler({ confirmId, sessionKey, command, args, riskLevel }) : undefined)
          .then((result) => {
            sendToChild({
              type: "confirm-request-ack",
              confirmId,
              ok: true,
              ...(result?.replyText ? { reply: result.replyText } : {}),
            });
          })
          .catch((err) => {
            log(`confirm-request 处理失败 session=${sessionKey} err=${err?.message ?? String(err)}`);
            sendToChild({ type: "confirm-request-ack", confirmId, ok: false, error: err?.message ?? String(err) });
          });
        break;
      }
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
      // 工具上下文（Slice 8 G1 接线）：绑定默认目标候选 → worker 工具面消费。
      ...(session.toolContext ? { toolContext: session.toolContext } : {}),
    };
  }

  // 会话上下文重建（tech-design 数据流 7）：sessionRef 换代 + 新 key 一次性注入
  // （旧 keyRef 明文从内存注销；下轮 session-config 由主进程重新下发）。
  // SQLite 为真相：换代同步更新 agent_sessions.sessionRef（store 存在时）。
  function rebuildSession(spaceKey, session, newProvider, newKey) {
    const oldKeyRef = session.keyRef;
    const gen = (generation.get(spaceKey) ?? 1) + 1;
    generation.set(spaceKey, gen);
    session.provider = newProvider;
    session.model = DEFAULT_MODELS[newProvider] ?? newProvider;
    session.keyRef = keyRefFor(newProvider, gen);
    session.sessionRef = sessionRefFor(sessionDir, spaceKey, gen);
    if (newKey !== undefined) keySecrets.set(session.keyRef, newKey);
    keySecrets.delete(oldKeyRef);
    session.rebuilt = true;
    const store = getStore();
    if (store?.updateSessionRef) store.updateSessionRef(spaceKey, session.sessionRef);
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
    // SQLite 为真相：首次对话经 store.getOrCreate 建行 + JSONL 占位
    // （REQ-AGENT-008 标准 2）；sessionRef 以表行为准。
    createSession({ spaceKey, provider, apiKey, identity, toolContext }) {
      const existing = sessions.get(spaceKey);
      if (existing) {
        // 工具上下文变更（Slice 8 G1：绑定默认目标候选）→ 更新句柄 + 重发
        // session-config（worker 经 toolContexts 惰性读取，热更新即时生效）。
        if (toolContext && JSON.stringify(toolContext) !== JSON.stringify(existing.toolContext)) {
          existing.toolContext = toolContext;
          sendToChild(buildConfigMessage(spaceKey, existing));
        }
        return existing;
      }
      const store = getStore();
      const info = store ? store.getOrCreate(spaceKey, { sessionDir }) : null;
      const gen = info ? generationFromRef(info.sessionRef) : (generation.get(spaceKey) ?? 1);
      generation.set(spaceKey, gen);
      const keyRef = keyRefFor(provider, gen);
      if (apiKey) keySecrets.set(keyRef, apiKey);
      const session = createSessionHandle({
        spaceKey,
        provider,
        model: DEFAULT_MODELS[provider] ?? provider,
        keyRef,
        identity: identity ?? settingsService.loadAgentConfig().identity,
        sessionRef: info?.sessionRef ?? sessionRefFor(sessionDir, spaceKey, gen),
        toolContext,
      });
      applyRecoveryHint(session, info?.recoveryHint);
      sessions.set(spaceKey, session);
      sendToChild(buildConfigMessage(spaceKey, session));
      return session;
    },
    getSession(spaceKey) {
      return sessions.get(spaceKey);
    },
    // notify-result（REQ-AGENT-016 标准 2 / W-2）：确认执行结果经 IPC 注入子进程，
    // worker 侧以会话 prompt 驱动 agent 生成自然语言回投（流式事件回传）。
    notifyResult(sessionKey, result) {
      if (state !== "ready") {
        log(`notify-result 跳过 session=${sessionKey}（子进程未就绪）`);
        return Promise.resolve({ ok: false, reason: "restarting" });
      }
      if (!sessions.has(sessionKey)) {
        log(`notify-result 跳过 session=${sessionKey}（会话不存在）`);
        return Promise.resolve({ ok: false, reason: "E-AGENT-NO-SESSION" });
      }
      sendToChild({ type: "notify-result", sessionKey, result });
      return Promise.resolve({ ok: true });
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
    // - provider/key 变更 → 会话上下文重建（sessionRef 换代）+ 新 key 一次性注入；
    // - provider/apiKey 与各会话当前生效值逐一比较：值相同（客户端原样保存）→
    //   不重建（PRD 对齐缺口 3 / REQ-AGENT-004 AC2「provider/key 未变则不重建」）。
    broadcastConfigUpdate({ identity, provider, apiKey }) {
      const identityChanged = typeof identity === "string";
      for (const [spaceKey, session] of sessions) {
        if (identityChanged) session.identity = identity;
        // 变更检测基准 = 会话当前值（provider + 内存明文 key）：均相同才视为未变。
        const credsChanged =
          (typeof provider === "string" && provider !== session.provider) ||
          (typeof apiKey === "string" && apiKey !== keySecrets.get(session.keyRef));
        if (credsChanged) {
          const newProvider = typeof provider === "string" ? provider : session.provider;
          const newKey = typeof apiKey === "string" ? apiKey : keySecrets.get(session.keyRef);
          rebuildSession(spaceKey, session, newProvider, newKey);
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
      killChild("SIGTERM");
      child = null;
      state = "stopped";
    },
    kill() {
      // 模拟崩溃（任意退出码）→ 看门狗重启（REQ-AGENT-005 标准 2/3/4）。
      state = "restarting";
      rejectPendingPrompts(restartingError());
      killChild("SIGKILL");
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
