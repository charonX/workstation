// src/agent/worker.js
// agent 子进程入口（PI 宿主；ADR-014「SDK 独立子进程」）。
//
// 独立进程，与主进程 server/服务层零耦合；stdio JSONL 自建 IPC（tech-design
// 「IPC 协议」）：
// - stdin  ← 主进程 → 子进程：session-config / prompt / ping / shutdown ...
// - stdout → 主进程 ← 子进程：ready / session-event / session-error /
//   config-ack / prompt-result / pong ...
// - stderr → 子进程日志（主进程 agentService 收集；绝不含 key 值）。
//
// 关键纪律（signoff 实现者测试缝契约 + spike 结论）：
// - stdout 只写协议 JSON 行，禁止任何 console.log（会污染 IPC 流）。
// - `session.prompt()` 返回 void——回复文本从 message_update 事件提取：
//   assistantMessageEvent.text_delta.delta / text_end.content。
// - 流式中 prompt 必须带 streamingBehavior: "followUp"。
// - ModelRuntime.create 为 async；authPath 重定向（防 ~/.pi 污染，H2）。
// - secret 约束：key 经 session-config 一次性注入后仅持内存（keySecrets），
//   不落日志（stderr 经 redact）、不进 JSONL 会话文件。
// - 单条 session-event ≤ 256KB（签核决策 15），超限截断 + truncated 标记。
// - 测试 seam（H3）：OPC_AGENT_FAUX=1 时注册 fauxProvider，零网络。

import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { randomUUID } from "node:crypto";
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { fauxProvider, fauxAssistantMessage } from "@earendil-works/pi-ai";
import { createSessionToolSurface } from "./toolAdapter.js";

// —— 环境契约（主进程 spawn 时注入；无则回退默认值，便于手工调试）——
const sessionDir = process.env.OPC_AGENT_SESSION_DIR ?? path.join(process.cwd(), "agent-sessions");
const agentHome = process.env.OPC_AGENT_HOME ?? path.join(process.cwd(), ".agent-home");
const cwd = process.env.OPC_AGENT_CWD ?? process.cwd();
const FAUX_MODE = process.env.OPC_AGENT_FAUX === "1";

// 单条 IPC 消息上限（签核决策 15：≤ 256KB，先行约束来自飞书文本消息 150KB 上限）。
const MAX_IPC_BYTES = 256 * 1024;

fs.mkdirSync(sessionDir, { recursive: true });
fs.mkdirSync(agentHome, { recursive: true });

// 活跃会话：sessionKey → { agentSession, sessionManager, modelRuntime, resourceLoader,
// config, sessionRef, provider, model, keyRef }。
// keyRef → 明文 key 仅持内存（一次性注入语义，不落盘/不落日志/不进 JSONL）。
const sessions = new Map();
const keySecrets = new Map();

// 会话工具上下文（Slice 8 G1 接线）：sessionKey → { defaultTarget }（绑定默认目标
// 候选，来自主进程 buildToolContext → session-config toolContext）。独立于会话句柄
// 惰性读取（toolSurface 按 execute 时取值，session-config 热更新即时生效）。
const toolContexts = new Map(); // sessionKey → { defaultTarget: { flowId, projectId } | null }

// confirm-request 回执等待（Slice 8 确认接线）：confirmId → resolve(ack)。
// 主进程确认服务入队（agent_confirmations pending + 确认卡片）后回 confirm-request-ack，
// 工具侧据此返回待确认（E-CONFIRM-PENDING）——执行由确认回调驱动（b 解耦）。
const confirmAcks = new Map(); // confirmId → resolve(msg)
// 确认请求超时兜底（主进程不可达时不悬挂工具调用；PI 自身亦有 tool timeout 兜底）。
const CONFIRM_TIMEOUT_MS = 30000;

// 串行队列工厂（排队串行，tech-design W-6）：
// - 每 session 一条队列 → 同 sessionKey 排队串行、跨 session 并行；
// - 全局消息队列 → session-config 等异步处理先于后续 prompt 完成。
// enqueue 返回本次任务的原始 promise（调用方自行处理拒绝）；链上异常经
// onError 处理（默认吞掉，队列不断）。
function createSerialQueue(onError = () => {}) {
  let chain = Promise.resolve();
  return {
    enqueue(fn) {
      const next = chain.then(fn, fn);
      chain = next.catch(onError);
      return next;
    },
    // 队尾 promise（异常已消化）：用于等待队列清空。
    drained() {
      return chain;
    },
  };
}

// 每 session 的 prompt 串行队列（IPC 排队串行，tech-design W-6）。
const sessionQueues = new Map(); // sessionKey → createSerialQueue()
function enqueueSession(sessionKey, fn) {
  if (!sessionQueues.has(sessionKey)) sessionQueues.set(sessionKey, createSerialQueue());
  return sessionQueues.get(sessionKey).enqueue(fn);
}

let runtimePromise = null;
let fauxHandle = null;

function safeKeyFor(sessionKey) {
  return String(sessionKey).replace(/[^a-zA-Z0-9_-]/g, "_");
}

// JSONL 世代解析/命名（与主进程 sessionStore 规范一致：<safeKey>[.N].jsonl；
// 子进程零耦合不 import 主进程模块，本处为镜像实现）。
function generationFromRef(sessionRef) {
  const m = /\.(\d+)\.jsonl$/.exec(sessionRef ?? "");
  return m ? Number(m[1]) : 1;
}
function sessionRefFor(sessionDir, sessionKey, generation = 1) {
  const safeKey = safeKeyFor(sessionKey);
  const suffix = generation > 1 ? `.${generation}` : "";
  return path.join(sessionDir, `${safeKey}${suffix}.jsonl`);
}

// stderr 日志红线：任何 key 值不进入日志（签核决策 5 / REQ-AGENT-005 标准 5）。
function redact(text) {
  let out = String(text);
  for (const secret of keySecrets.values()) {
    if (secret) out = out.split(secret).join("[REDACTED]");
  }
  return out;
}

function log(line) {
  process.stderr.write(`${redact(line)}\n`);
}

// 协议出站：只写 stdout JSON 行。
function send(msg) {
  process.stdout.write(`${JSON.stringify(msg)}\n`);
}

// 单条事件 ≤ 256KB：超限截断文本载体 + truncated 标记（REQ-AGENT-006 标准 5）。
function limitSize(event) {
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

// PI 事件 → 签核事件契约（session-event：text_delta/text_end/tool_execution_*）。
// 工具面适配器事件（REQ-AGENT-012：tool_execution_start/end/error，含 name/status）
// 已是契约形态 → 直接透传；PI 原生事件（toolName 字段）走下方映射。
function mapToContractEvent(ev) {
  if (
    typeof ev?.type === "string" &&
    ev.type.startsWith("tool_execution") &&
    typeof ev.name === "string"
  ) {
    return ev;
  }
  switch (ev.type) {
    case "message_update": {
      const a = ev.assistantMessageEvent;
      if (!a) return null;
      if (a.type === "text_delta") return { type: "text_delta", delta: a.delta };
      if (a.type === "text_end") return { type: "text_end", content: a.content };
      return null;
    }
    case "tool_execution_start":
      return { type: "tool_execution_start", name: ev.toolName, status: "running", toolCallId: ev.toolCallId };
    case "tool_execution_end":
      return { type: "tool_execution_end", name: ev.toolName, status: "completed", toolCallId: ev.toolCallId };
    default:
      return null;
  }
}

// 每会话最近一轮回复最终文本（text_end.content）——prompt-result 回传主进程，
// 供调用方拿到本轮回复文本（REQ-AGENT-006/009 断言用）。
const lastReplies = new Map(); // sessionKey → 最近一轮 text_end.content

function forwardEvent(sessionKey, ev) {
  const mapped = mapToContractEvent(ev);
  if (!mapped) return;
  if (mapped.type === "text_end") lastReplies.set(sessionKey, mapped.content);
  send({ type: "session-event", sessionKey, event: limitSize(mapped) });
}

// FAUX 测试 seam（H3）的确定性回复：上下文回声——把本次模型可见的
// system prompt 与全部消息序列化回传。零网络且可断言「回复引用了恢复前
// 上下文」（REQ-AGENT-009 恢复语义的对话侧验证）。
function fauxEchoFor(context) {
  const parts = [];
  if (context.systemPrompt) parts.push(`system:${context.systemPrompt}`);
  for (const m of context.messages) {
    const content = m.content;
    if (typeof content === "string") {
      parts.push(`${m.role}:${content}`);
    } else if (Array.isArray(content)) {
      parts.push(`${m.role}:${content.map((b) => (b.type === "text" ? b.text : `[${b.type}]`)).join("")}`);
    } else {
      parts.push(`${m.role}:`);
    }
  }
  return fauxAssistantMessage(parts.join("\n"));
}

// ModelRuntime 单例：authPath 重定向（防 ~/.pi 污染，H2）；faux 注册（H3 seam）。
function getModelRuntime() {
  if (!runtimePromise) {
    runtimePromise = (async () => {
      const runtime = await ModelRuntime.create({
        allowModelNetwork: false,
        modelsPath: null,
        authPath: path.join(agentHome, "auth.json"),
      });
      if (FAUX_MODE) {
        // 测试 seam：OPC_AGENT_FAUX_TPS 调慢 faux 流式（模拟长生成，覆盖心跳超时窗口）。
        const tps = Number(process.env.OPC_AGENT_FAUX_TPS);
        fauxHandle = fauxProvider({ tokensPerSecond: tps > 0 ? tps : 1000 });
        runtime.registerNativeProvider(fauxHandle.provider);
      }
      return runtime;
    })();
  }
  return runtimePromise;
}

async function disposeSession(entry) {
  try {
    entry.agentSession.dispose();
  } catch (err) {
    log(`dispose 失败 session=${entry.sessionRef} err=${err?.message ?? String(err)}`);
  }
}

// 会话创建/配置（IPC session-config）：
// - 新 sessionKey → 创建 PI AgentSession（JSONL 按 sessionRef 路径落盘；
//   SessionManager.open 恢复已存在文件——重启恢复路径，REQ-AGENT-005 标准 3）；
// - 已存在 + provider/model/sessionRef 未变 → 仅 systemPrompt 热更新（config-ack，
//   不重建上下文，REQ-AGENT-004 标准 2）；
// - 已存在 + provider/key/sessionRef 变更 → 重建会话（新 key 注入，
//   tech-design 数据流 7 GAP 补全）。
// M2 按空间装配（REQ-AGENT-031/032）：session-config 扩展字段 cwd / skillPaths /
// permissionProfile（tech-design IPC 契约节）——
// - cwd：项目空间 = 项目目录（DefaultResourceLoader / createAgentSession 均以
//   会话 cwd 装配；通用/飞书 = 主进程现状默认）；
// - skillPaths：项目空间 = 项目关联 skills 技能库绝对路径 → additionalSkillPaths
//   （H5 已证：多会话各持独立 loader，available_skills 渐进披露段互不污染）；
// - permissionProfile："project" → 工具面 = CLI + read/write/bash（cwd 边界判定
//   在 toolAdapter）；"default" → CLI 基线（分级硬边界）。
// 工具事件（REQ-AGENT-012 标准 4）：start/end 由 PI 原生 tool_execution_* 事件承载；
// 本适配器仅补充 PI 不产生的 tool_execution_error（含工具名与状态，错误回传对话）。

// confirm-request 回执等待（超时兜底 resolve，防工具调用悬挂）。
function confirmAck(confirmId) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      confirmAcks.delete(confirmId);
      resolve({ ok: false, error: "确认请求超时" });
    }, CONFIRM_TIMEOUT_MS);
    timer.unref?.();
    confirmAcks.set(confirmId, (msg) => {
      clearTimeout(timer);
      resolve(msg);
    });
  });
}

async function handleSessionConfig(msg) {
  const {
    sessionKey,
    provider,
    model,
    keyRef,
    sessionRef,
    systemPrompt,
    apiKey,
    toolContext,
  } = msg;
  // 诊断：worker 收到 session-config。
  log(`session-config 进入 session=${sessionKey} provider=${provider} model=${model} hasKey=${!!apiKey}`);
  // 工具上下文（Slice 8 G1）：随 session-config 更新（新会话与热更新共用；
  // toolSurface 经 getDefaultTarget 惰性读取，无需重建 PI 会话）。
  if (toolContext && typeof toolContext === "object") {
    toolContexts.set(sessionKey, toolContext);
  } else {
    toolContexts.delete(sessionKey);
  }
  const existing = sessions.get(sessionKey);

  if (existing) {
    if (apiKey) keySecrets.set(keyRef ?? existing.keyRef, apiKey);
    const credsChanged =
      existing.provider !== provider ||
      existing.model !== model ||
      existing.sessionRef !== sessionRef;
    if (!credsChanged) {
      await hotUpdateSystemPrompt(existing, systemPrompt);
      send({ type: "config-ack", sessionKey });
      return;
    }
    // provider/key 变更 → 重建：旧会话释放，走下方新建路径（新 JSONL 引用）。
    await disposeSession(existing);
    sessions.delete(sessionKey);
  }

  await createSessionEntry(msg);
}

// 热更新：仅刷新 config.systemPrompt（resourceLoader.reload() 重算 override），
// 不重建上下文（REQ-AGENT-004 标准 2）。
async function hotUpdateSystemPrompt(entry, systemPrompt) {
  entry.config.systemPrompt = systemPrompt ?? "";
  await entry.resourceLoader.reload();
}

// 新建 PI SessionManager 并绑定 JSONL 引用（首建与 JSONL 损坏换代重建共用）。
function createFreshSessionManager(ref) {
  const sm = SessionManager.create(cwd, sessionDir);
  sm.setSessionFile(ref);
  return sm;
}

// 新建会话（含 provider/key 变更后的重建路径）：PI AgentSession 创建 + 订阅 + 注册。
async function createSessionEntry(msg) {
  const { sessionKey, provider, model, keyRef, sessionRef, systemPrompt, apiKey } = msg;
  // M2 按空间装配：cwd/skillPaths/permissionProfile 来自主进程 session-config
  // （REQ-AGENT-031/032 IPC 契约）；缺省（旧主进程/直接调试）回落现状默认。
  const sessionCwd = typeof msg.cwd === "string" && msg.cwd ? msg.cwd : cwd;
  const skillPaths = Array.isArray(msg.skillPaths) ? msg.skillPaths : [];
  const permissionProfile = msg.permissionProfile === "project" ? "project" : "default";
  const runtime = await getModelRuntime();
  const modelObj = await resolveModel(runtime, provider, model, apiKey);

  const settingsManager = SettingsManager.inMemory();
  const finalRef = sessionRef ?? sessionRefFor(sessionDir, sessionKey);
  let effectiveRef = finalRef;
  let rebuilt = false;
  let sessionManager;
  if (fs.existsSync(finalRef) && fs.statSync(finalRef).size > 0) {
    try {
      // 重启恢复：SessionManager.open 续上下文（H2；只丢崩溃时流式中的半条）。
      sessionManager = SessionManager.open(finalRef, sessionDir);
    } catch (err) {
      // JSONL 损坏（存在但不可解析）→ 换代重建 + 提示不可恢复（REQ-AGENT-009 标准 2
      // 损坏分支；缺失分支由主进程 getOrCreate 处理，此处只管 open 失败）。
      effectiveRef = sessionRefFor(sessionDir, sessionKey, generationFromRef(finalRef) + 1);
      rebuilt = true;
      log(`JSONL 损坏，换代重建 session=${sessionKey} ref=${finalRef} -> ${effectiveRef} err=${err?.message ?? String(err)}`);
      sessionManager = createFreshSessionManager(effectiveRef);
    }
  } else {
    sessionManager = createFreshSessionManager(finalRef);
  }

  const config = { systemPrompt: systemPrompt ?? "" };
  // 每会话独立 DefaultResourceLoader（H5 已证多 loader 共存隔离）：项目空间按
  // session-config 装配会话 cwd 与 additionalSkillPaths（渐进披露段互不污染）；
  // 通用/飞书维持现状装配（noSkills: true 隔离默认发现，不注入任何项目 skills）。
  const resourceLoader = new DefaultResourceLoader({
    cwd: sessionCwd,
    agentDir: agentHome,
    settingsManager,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    systemPromptOverride: (base) => config.systemPrompt || base,
    ...(skillPaths.length > 0 ? { additionalSkillPaths: skillPaths } : {}),
  });
  await resourceLoader.reload();

  // 工具面（REQ-AGENT-012 标准 1：除 release 外全量 CLI 命令作为 PI 工具注入；
  // C2：进程内 import 命令模块 → ensureServer 发现主进程 server → HTTP API）。
  // M2 按空间分级（REQ-AGENT-032）：permissionProfile="project" → CLI + read/
  // write/bash（cwd 限定项目目录，边界判定在 toolAdapter）；"default" → CLI 基线。
  // Slice 8：确认接线（onConfirmRequest）+ G1/GAP 1（sessionKey/getDefaultTarget）。
  const toolSurface = createSessionToolSurface({
    profile: permissionProfile,
    cwd: sessionCwd,
    sessionKey,
    getDefaultTarget: () => toolContexts.get(sessionKey)?.defaultTarget ?? null,
    onConfirmRequest: async ({ tool, args, riskLevel }) => {
      const confirmId = randomUUID();
      send({ type: "confirm-request", confirmId, sessionKey, command: tool, args, riskLevel });
      const ack = await confirmAck(confirmId);
      if (ack?.ok === true) return { pending: true, reply: ack.reply };
      return { pending: false, error: ack?.error ?? "确认请求失败" };
    },
  });
  toolSurface.onEvent((ev) => {
    if (ev.type === "tool_execution_error") forwardEvent(sessionKey, ev);
  });

  const { session: agentSession } = await createAgentSession({
    cwd: sessionCwd,
    agentDir: agentHome,
    sessionManager,
    settingsManager,
    modelRuntime: runtime,
    model: modelObj,
    resourceLoader,
    noTools: "all",
    customTools: toolSurface.toPiToolDefinitions(),
  });

  const entry = {
    agentSession,
    sessionManager,
    modelRuntime: runtime,
    resourceLoader,
    config,
    sessionRef: effectiveRef,
    provider,
    model,
    keyRef: keyRef ?? `key:${provider}`,
  };
  agentSession.subscribe((ev) => forwardEvent(sessionKey, ev));
  sessions.set(sessionKey, entry);
  // 可观测性（tech-design 可观测性节）：会话创建装配（spaceKey→cwd/skills/profile）。
  log(`session-config 完成 session=${sessionKey} ref=${effectiveRef} profile=${permissionProfile} skills=${skillPaths.length}`);
  if (rebuilt) {
    // 通知主进程换代重建（REQ-AGENT-009 标准 2 损坏分支）：主进程同步
    // agent_sessions 行（SQLite 为真相）与会话句柄，并挂历史不可恢复提示。
    send({
      type: "session-rebuilt",
      sessionKey,
      sessionRef: effectiveRef,
      hint: "历史会话不可恢复，已新建会话",
    });
  }
  send({ type: "config-ack", sessionKey });
}

// 模型解析（H3 seam）：faux 模式直取 faux 模型（零网络）；否则注入 key 并取
// provider/model，不可用则抛 E-AGENT-MODEL。
async function resolveModel(runtime, provider, model, apiKey) {
  if (FAUX_MODE) return fauxHandle.getModel();
  if (apiKey) await runtime.setRuntimeApiKey(provider, apiKey);
  const modelObj = runtime.getModel(provider, model);
  if (!modelObj) {
    throw new Error(`E-AGENT-MODEL: provider=${provider} model=${model} 不可用`);
  }
  return modelObj;
}

async function handlePrompt(msg) {
  const { id, sessionKey, text } = msg;
  const entry = sessions.get(sessionKey);
  // 诊断：worker 收到 prompt。
  log(`prompt 进入 session=${sessionKey} id=${id} session存在=${!!entry} text=${String(text ?? "").slice(0, 60)}`);
  if (!entry) {
    const error = { code: "E-AGENT-NO-SESSION", reason: "会话不存在" };
    send({ type: "session-error", sessionKey, ...error, userMessage: "会话不存在，请重试" });
    send({ type: "prompt-result", id, sessionKey, ok: false, error });
    return;
  }
  await enqueueSession(sessionKey, async () => {
    try {
      // FAUX 测试 seam：每轮排队一个上下文回声响应（确定性、零网络）。
      if (FAUX_MODE) fauxHandle.appendResponses([fauxEchoFor]);
      // 回复文本经 message_update 事件回传（session.prompt 返回 void，spike H3）。
      await entry.agentSession.prompt(text, { streamingBehavior: "followUp" });
      const reply = lastReplies.get(sessionKey);
      send({
        type: "prompt-result",
        id,
        sessionKey,
        ok: true,
        ...(reply !== undefined ? { reply } : {}),
      });
    } catch (err) {
      // REQ-AGENT-007：供应商失败/超时/限流 → 结构化错误消息，进程不崩、会话存活。
      const reason = err?.message ?? String(err);
      const error = { code: "E-AGENT-LLM-FAIL", reason };
      log(`prompt 失败 session=${sessionKey} code=${error.code}`);
      send({ type: "session-error", sessionKey, ...error, userMessage: `LLM 调用失败：${reason}` });
      send({ type: "prompt-result", id, sessionKey, ok: false, error });
    }
  });
}

// notify-result（REQ-AGENT-016 标准 2 / tech-design IPC）：确认执行结果注入 agent
// 会话 → agent 生成自然语言回投（W-2：保持对话连贯性）。经会话串行队列排队
// （与 prompt 同队列，同空间不交错）；回投文本经 session-event 流式回传（回复卡片）。
async function handleNotifyResult(msg) {
  const { sessionKey, result } = msg;
  const entry = sessions.get(sessionKey);
  if (!entry) {
    log(`notify-result 跳过 session=${sessionKey}（会话不存在）`);
    return;
  }
  await enqueueSession(sessionKey, async () => {
    try {
      if (FAUX_MODE) fauxHandle.appendResponses([fauxEchoFor]);
      const text = `执行结果已就绪，请用自然语言向用户简要汇报执行结果：${JSON.stringify(result ?? {})}`;
      await entry.agentSession.prompt(text, { streamingBehavior: "followUp" });
    } catch (err) {
      log(`notify-result prompt 失败 session=${sessionKey} err=${err?.message ?? String(err)}`);
    }
  });
}

async function shutdownAll() {
  for (const entry of sessions.values()) {
    await disposeSession(entry);
  }
  sessions.clear();
}

// 全局消息串行队列：session-config 等异步处理必须先于后续 prompt 完成
// （IPC 语义：同 sessionKey 排队串行，且配置先于对话）。
const messageQueue = createSerialQueue((err) => {
  log(`消息处理异常 err=${err?.message ?? String(err)}`);
});

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });

rl.on("line", (line) => {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    log(`收到非法 IPC 行，忽略`);
    return;
  }
  // 心跳带外响应（BUG-008）：ping 不进串行队列。长 prompt 期间队列被
  // await 的生成占住，ping 若排队 → 主进程 6s 收不到 pong → 看门狗误杀
  // 健康忙碌的进程（REQ-AGENT-005 标准 2 的意图是检测真崩溃）。事件循环
  // 能读行就能回 pong；真崩溃（事件循环卡死/进程退出）才答不出。
  if (msg.type === "ping") {
    send({ type: "pong" });
    return;
  }
  messageQueue.enqueue(() => handleMessage(msg));
});

// /reset（REQ-AGENT-010）：dispose 并释放当前空间会话；主进程随后以下发的
// 新 sessionRef（世代 +1）重新 session-config → 新建空上下文会话。
async function handleResetSession(msg) {
  const entry = sessions.get(msg.sessionKey);
  if (entry) {
    await disposeSession(entry);
    sessions.delete(msg.sessionKey);
    lastReplies.delete(msg.sessionKey);
    log(`reset-session session=${msg.sessionKey}`);
  }
}

async function handleMessage(msg) {
  switch (msg.type) {
    case "session-config":
      try {
        await handleSessionConfig(msg);
      } catch (err) {
        const reason = err?.message ?? String(err);
        log(`session-config 失败 session=${msg.sessionKey} reason=${reason}`);
        send({
          type: "session-error",
          sessionKey: msg.sessionKey,
          code: "E-AGENT-RUNTIME",
          reason,
          userMessage: "agent 会话初始化失败，请稍后重试",
        });
      }
      break;
    case "prompt":
      await handlePrompt(msg);
      break;
    case "reset-session":
      await handleResetSession(msg);
      break;
    case "confirm-request-ack": {
      // 主进程确认服务入队回执（Slice 8）：resolve 工具侧等待（待确认/失败）。
      const resolve = confirmAcks.get(msg.confirmId);
      if (resolve) {
        confirmAcks.delete(msg.confirmId);
        resolve(msg);
      }
      break;
    }
    case "notify-result":
      await handleNotifyResult(msg);
      break;
    case "shutdown":
      await shutdownAll();
      process.exit(0);
      break;
    default:
      log(`未知消息类型 type=${msg.type}`);
  }
}

// 主进程消失（stdin 关闭）→ 清理退出，不留孤儿进程。
// 先等消息链清空（EOF 不打断进行中的 session-config/prompt），再退出；
// 兜底超时防止进程残留。
rl.on("close", () => {
  const timer = setTimeout(() => process.exit(0), 2000);
  timer.unref?.();
  const exitNow = () => {
    clearTimeout(timer);
    process.exit(0);
  };
  messageQueue.drained().then(exitNow, exitNow);
});

// 就绪即回 ready（REQ-AGENT-005 标准 1；看门狗以 ready 判定存活起点）。
send({ type: "ready", pid: process.pid });
