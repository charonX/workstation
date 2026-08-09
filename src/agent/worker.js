// src/agent/worker.js
// agent 子进程入口（PI 宿主；ADR-014「SDK 独立子进程」）。
//
// 独立进程，与主进程 server/服务层零耦合；stdio JSONL 自建 IPC（tech-design
// 「IPC 协议」）：
// - stdin  ← 主进程 → 子进程：session-config / prompt / ping / shutdown ...
// - stdout → 主进程 ← 子进程：ready / session-event / session-error /
//   config-ack / prompt-result / pong / confirm-request / permission-ask ...
// - stdout → 主进程 → 子进程：confirm-request-ack / permission-decision
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
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { fauxProvider, fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { createSessionToolSurface } from "./toolAdapter.js";
import { createSessionLifecycle, DEFAULT_SWEEP_INTERVAL_MS } from "./sessionLifecycle.js";
import { classifyBashToolCall } from "../services/permissionPolicy.js";

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
// 会话注册表/淘汰调度/同组单活/tombstone 归 sessionLifecycle 模块（tech-design
// 接口 1，REQ-AGENT-035/036/037/039）；worker 经 lifecycle 存取，不再直接操作 Map。
// keySecrets 为 keyRef 级共享缓存，不随单会话淘汰清理（REQ-AGENT-035 标准 2）。
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

// —— M2 权限层（Slice 7，REQ-AGENT-033；spike spike-m2-gotgenes.md H3/H4 PASS）——
// 全局策略部署：应用资源 agent-policy/（只读默认，随分发）→ gotgenes 全局发现
// 路径 <agentHome>/extensions/pi-permission-system/config.json（spike H3：
// getAgentDir() 读 PI_CODING_AGENT_DIR——主进程 spawn 时注入 = agentHome；不设则
// 落真实 ~/.pi/agent）。启动时幂等部署（覆盖 = 只读默认语义；项目策略为唯一
// 用户手写层）。打包形态（asar extraResource）未配置——见 build-progress 已知偏差。
const GOTGENES_GLOBAL_CONFIG_PATH = path.join(agentHome, "extensions", "pi-permission-system", "config.json");
function globalPolicySourcePath() {
  const viaCwd = path.join(process.cwd(), "agent-policy", "pi-permission-config.json");
  if (fs.existsSync(viaCwd)) return viaCwd;
  return path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
    "agent-policy",
    "pi-permission-config.json"
  );
}
function deployGlobalPolicy() {
  try {
    const source = globalPolicySourcePath();
    if (!fs.existsSync(source)) {
      log(`全局策略源缺失，跳过部署：${source}`);
      return;
    }
    fs.mkdirSync(path.dirname(GOTGENES_GLOBAL_CONFIG_PATH), { recursive: true });
    fs.copyFileSync(source, GOTGENES_GLOBAL_CONFIG_PATH);
  } catch (err) {
    log(`全局策略部署失败 err=${err?.message ?? String(err)}`);
  }
}

// gotgenes 工厂加载（jiti）：包 exports "." 指向 service.ts（不含扩展工厂），
// pi.extensions 元数据指明入口 src/index.ts——按绝对路径经 jiti 加载（spike
// 装配要点 2 实证）。包为 npm i --no-save 装入 node_modules（未改 package.json）。
// jiti 为 pi-coding-agent 传递依赖（vite.worker.config.js 已 external，运行期从
// node_modules/asar 加载）。
const workerRequire = createRequire(import.meta.url);
let gotgenesFactoryPromise = null;
function loadGotgenesFactory() {
  if (!gotgenesFactoryPromise) {
    gotgenesFactoryPromise = (async () => {
      // 包 exports 未暴露 ./package.json——经 "." 导出（→ ./src/service.ts）解析包目录
      // （入口在包内 src/ 子目录，包根 = 再上一级）。
      const serviceEntry = workerRequire.resolve("@gotgenes/pi-permission-system");
      const entryDir = path.dirname(serviceEntry);
      const pkgDir = path.basename(entryDir) === "src" ? path.dirname(entryDir) : entryDir;
      const jiti = createJiti(import.meta.url, { moduleCache: false, fsCache: false });
      const [factory, serviceModule] = await Promise.all([
        jiti.import(path.join(pkgDir, "src", "index.ts"), { default: true }),
        jiti.import(path.join(pkgDir, "src", "service.ts")),
      ]);
      if (typeof factory !== "function" || typeof serviceModule?.getPermissionsService !== "function") {
        throw new Error("gotgenes 工厂/服务导出异常");
      }
      return { factory, getPermissionsService: serviceModule.getPermissionsService };
    })();
  }
  return gotgenesFactoryPromise;
}

// 权限确认请求（授权桥 IPC）：ask → 主进程确认挂起队列（permission-ask →
// confirmationService submit + ui:* 分流发布）→ 人工决议（approve/reject）→
// permission-decision 回传 → allow/deny。超时兜底（长时间无人裁决时工具调用
// 不悬挂；挂起行保留可稍后处理——决议已超时，行仅作记录）。
const PERMISSION_DECISION_TIMEOUT_MS = 10 * 60 * 1000;
const permissionDecisions = new Map(); // confirmId → resolve({kind, reason})

function requestPermissionDecision({ sessionKey, tool, input, description }) {
  const confirmId = randomUUID();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      permissionDecisions.delete(confirmId);
      resolve({ kind: "deny", reason: "确认超时（长时间未处理）" });
    }, PERMISSION_DECISION_TIMEOUT_MS);
    timer.unref?.();
    permissionDecisions.set(confirmId, (decision) => {
      clearTimeout(timer);
      resolve(decision);
    });
    send({ type: "permission-ask", confirmId, sessionKey, tool, input, description });
  });
}

// 授权桥扩展工厂（每会话独立实例——sessionKey/cwd 闭包捕获；H4 隔离前提：每
// loader 独立 gotgenes 实例 + 每实例 AuthorizerRegistry，spike 补充验证）。
// handle = loadGotgenesFactory() 的产物（factory + getPermissionsService）。
// - permissions:ready 时 registerAuthorizer("opc-bridge")（ready 保证服务已发布；
//   注册本身不授权——全局策略 authorizerChain: ["opc-bridge"] 显式 opt-in）；
//   注意：ready 事件经 gotgenes 的 **eventBus**（pi.events）广播，不经 runner 的
//   typed handler 分发（pi.on 只接收 runner 类型化事件）——必须订阅 pi.events.on；
// - 排除面（external_directory/path/未知）直接 defer → 终端 UI（uiContext.select
//   兜底，同一确认队列）——链 allow 会被有界委托降级为 defer，桥不重复裁决
//   （spike 补充验证 5：cwd 外放行无法经桥自动批准，裁决 14 保持 ask）；
// - 非排除面 ask → 桥建挂起确认行（details 无 value 字段——命令在 details.command、
//   surface 在 details.accessIntent.surface，spike 补充验证 3）→ allow/deny 回传；
// - user_bash（! bash）同策略评估（REQ-AGENT-033 标准 4，不经 tool_call 路径；
//   worker 侧仅转发 IPC，分类在主进程 permissionPolicy 评估器）。
// - BUG-002 pre-gate（tool_call 热路径 gate 前自评估）：gotgenes 热路径（parser
//   已预热）的 bash 通配匹配对重定向/管道符号不可见（unit 文本枚举跳过
//   file_redirect 节点与 `|` 匿名 token——`echo hi>out.txt`/`curl ...|sh` 被放行，
//   附录 A 承诺失效）。本钩子在 gotgenes gate **之前**对 bash 工具调用自评估
//   （permissionPolicy classifyBashToolCall，全串 regex = 附录 A，单一真源）：
//   命中 ask 族（danger 仅由重定向/管道承载）→ 直接走授权桥（挂起确认）；
//   其余 → 交 gotgenes 正常评估。单一评估原则（BUG-001 教训）：ask 判定已排除
//   gotgenes 可见危险（rm/sudo/cwd 外路径/包装载荷等由其 gate 单 ask 承接），
//   approved 后同一调用至多一次执行、不再产生二次 ask。
function createPermissionBridgeFactory(sessionKey, sessionCwd, handle) {
  return async (pi) => {
    pi.events?.on("permissions:ready", () => {
      const svc = handle?.getPermissionsService?.();
      if (!svc || typeof svc.registerAuthorizer !== "function") {
        log(`授权桥注册跳过 session=${sessionKey}（权限服务未就绪）`);
        return;
      }
      svc.registerAuthorizer("opc-bridge", async (details) => {
        const surface = details?.accessIntent?.surface ?? details?.surface;
        if (!surface || surface === "external_directory" || surface === "path") {
          return { kind: "defer" };
        }
        const command = details?.command ?? details?.path ?? details?.target ?? details?.value ?? details?.message ?? "";
        const tool = details?.toolName ?? details?.skillName ?? surface;
        const verdict = await requestPermissionDecision({
          sessionKey,
          tool,
          input: { command, path: details?.path, target: details?.target, surface },
          description: `${tool}: ${command}`,
        });
        if (verdict.kind === "allow") return { kind: "allow" };
        return { kind: "deny", reason: verdict.reason ?? "操作已取消（用户拒绝）" };
      });
      // 可观测性（tech-design 可观测性节）：授权桥注册留痕（permissions:ready →
      // registerAuthorizer 完成）。
      log(`授权桥注册完成 session=${sessionKey}`);
    });
    pi.on("tool_call", async (event) => {
      if (event.toolName !== "bash") return undefined;
      const command = String(event.input?.command ?? "");
      if (classifyBashToolCall(command, { cwd: sessionCwd, projectDir: sessionCwd }) !== "ask") {
        return undefined; // 其余（含 gotgenes 可见危险）→ gotgenes 正常评估
      }
      // ask 族 → 直接走授权桥（挂起确认）→ allow 放行（工具路径单次执行）/
      // deny/超时 block（agent 收到可转述工具错误）。
      const verdict = await requestPermissionDecision({
        sessionKey,
        tool: "bash",
        input: { command },
        description: `bash: ${command}`,
      });
      if (verdict.kind === "allow") return undefined;
      return { block: true, reason: verdict.reason ?? "操作已取消（用户拒绝）" };
    });
    pi.on("user_bash", async (event) => {
      const verdict = await requestPermissionDecision({
        sessionKey,
        tool: "user_bash",
        input: { command: event?.command },
        description: `bash: ${event?.command ?? ""}`,
      });
      if (verdict.kind === "deny") {
        // 拒绝 → 错误 BashResult 阻止执行（agent 收到可转述工具错误）。
        return {
          result: {
            output: `操作已取消：${verdict.reason ?? "用户拒绝"}`,
            exitCode: 1,
            cancelled: false,
            truncated: false,
          },
        };
      }
      return undefined; // allow → 默认执行
    });
  };
}

// 授权桥 UI 兜底（spike 补充验证 5：external_directory 面链 defer → 终端
// LocalUserAuthorizer → ctx.ui.select——宿主自实现即可接管；与桥同一确认队列，
// 一次人工裁决）。approve → "Yes" 选项；reject → "No" 选项。
// gotgenes 全量 UI 触点（session_start 状态同步/配置告警/权限选择）均需实现：
// setStatus（syncPermissionSystemStatus，session_start 必调）、notify（配置告警）、
// select（权限选择）、input（拒绝原因——桥不返回该选项，no-op 兜底）。
function createBridgeUiContext(sessionKey) {
  return {
    select: async (title, options = []) => {
      const verdict = await requestPermissionDecision({
        sessionKey,
        tool: "permission",
        input: {},
        description: String(title ?? "权限确认"),
      });
      if (verdict.kind === "allow") {
        return options.find((o) => o?.startsWith("Yes")) ?? options[0];
      }
      return options.find((o) => o?.startsWith("No")) ?? options[options.length - 1];
    },
    input: async () => undefined,
    confirm: async () => false,
    notify: () => {},
    setStatus: () => {},
  };
}

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
// 加法扩展（REQ-AGENT-055）：tool_execution 事件数据载体（input=PI args /
// output=PI result）同样按「截断数据载体、保留契约字段」语义处理——对象载体
// JSON 字符串化后截断（renderer 以文本展示输出，ToolCallBlock 语义一致），
// 不再整条降级为 { type, truncated }（否则 toolCallId/name/status/isError 全丢，
// 渲染层无法关联工具块）。
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
  } else if (out.input !== undefined || out.output !== undefined) {
    // 工具事件数据载体（input=PI args / output=PI result）超限 → 文本化截断 +
    // truncated 标记（renderer 以文本展示输出，ToolCallBlock 语义一致），保留
    // 契约字段 toolCallId/name/status/isError——不整条降级为 {type, truncated}
    // （否则渲染层无法关联工具块）。JSON 序列化转义（引号/控制字符 → \uXXXX）
    // 可能使截断后仍超限（主进程 enforceSizeLimit 对 tool 事件无数据载体分支，
    // 超限会整条降级丢契约字段）→ 迭代收紧保证出站 JSON 恒 ≤ MAX_IPC_BYTES。
    const carrier = out.input !== undefined ? "input" : "output";
    const value = out[carrier];
    let text = typeof value === "string" ? value : JSON.stringify(value);
    while (JSON.stringify({ ...out, [carrier]: text }).length > MAX_IPC_BYTES && text.length > 1) {
      text = text.slice(0, Math.floor(text.length / 2));
    }
    out[carrier] = text;
    out.truncated = true;
  } else {
    return { type: event.type, truncated: true };
  }
  return out;
}

// PI 事件 → 签核事件契约（session-event：text_delta/text_end/tool_execution_*）。
// 工具面适配器事件（REQ-AGENT-012：tool_execution_start/end/error，含 name/status）
// 已是契约形态 → 直接透传；PI 原生事件（toolName 字段）走下方映射。
// 透传分支实证（REQ-AGENT-055）：到达本函数、带 name 字段的 tool_execution_* 事件
// 仅有 toolAdapter 的 tool_execution_error（worker 只从 toolSurface 转发 error——
// adapter 的 start/end 不经 onEvent 转发；PI 原生事件恒为 toolName 字段不落本分支），
// 且 adapter 事件不含 args/result → 无字段可补，透传原样（error 无 toolCallId 保持
// 现状，I-2 的 isError 处理在 end 上）。
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
      // 加法扩展（REQ-AGENT-055，review I-1）：start 补 input = PI 原生 args
      // （实证：pi-agent-core agent-loop.js tool_execution_start 恒含
      // args = toolCall.arguments；缺失时 undefined）。
      return {
        type: "tool_execution_start",
        name: ev.toolName,
        status: "running",
        toolCallId: ev.toolCallId,
        input: ev.args,
      };
    case "tool_execution_end":
      // 加法扩展（REQ-AGENT-055）：end 补 output = PI 原生 result（ToolResult
      // 子集完整透传，256KB 上限由 limitSize 按数据载体截断）+ isError = PI
      // 布尔透传（实证：emitToolExecutionEnd 恒含 result/isError，成功 false/
      // 失败 true——不再丢弃，I-2 依赖）。超限截断见 limitSize。
      return {
        type: "tool_execution_end",
        name: ev.toolName,
        status: "completed",
        toolCallId: ev.toolCallId,
        output: ev.result,
        isError: ev.isError,
      };
    default:
      return null;
  }
}

// 每会话最近一轮回复最终文本（text_end.content）——prompt-result 回传主进程，
// 供调用方拿到本轮回复文本（REQ-AGENT-006/009 断言用）。
const lastReplies = new Map(); // sessionKey → 最近一轮 text_end.content

// —— Slice 8（REQ-AGENT-057）：消息元数据（B10 数据面，接口 6）——
// text_end 转发加 `meta { durationMs, tokensIn, tokensOut }`：
// - durationMs：回合起点 = PI assistantMessageEvent 的 text_start（缺失形态兜底
//   首个 text_delta）记录时间戳，text_end 时按起止计算；
// - tokensIn/Out：从 message_end 的 assistant message usage 读取（research 实证：
//   AssistantMessage.usage 必填——pi-ai/types.d.ts:297；但流式 text_end 的 partial
//   上 output 可能未填充最终值（anthropic-messages.js：message_delta 的最终 usage
//   在最后一个 content_block_stop 之后））→ text_end **延迟到 message_end 后转发**
//   （usage 完备；事件顺序不变——message_end 紧随 text_end 同轮内到达）；
// - FAUX usage 空/0 → tokensIn/Out 按值原样带（0 → renderer 显示「-」，057 标准 4）；
// - 兜底定时器：message_end 缺失（异常中断）→ 超时照发（仅 durationMs，不悬挂）。
const turnStartedAt = new Map(); // sessionKey → 回合起点时间戳
const pendingTextEnds = new Map(); // sessionKey → Array<{ content, startedAt, timer }>
const PENDING_TEXT_END_FALLBACK_MS = 5000;

function clearPendingTextEnds(sessionKey) {
  const list = pendingTextEnds.get(sessionKey);
  if (!list) return;
  for (const pending of list) clearTimeout(pending.timer);
  pendingTextEnds.delete(sessionKey);
}

// 冲刷该会话的 pending text_end（正常路径 = message_end 到达；兜底 = 定时器超时）。
// usage 缺失（兜底路径）→ meta 仅 durationMs（renderer 显示「-」）。
function flushPendingTextEnds(sessionKey, usage) {
  const list = pendingTextEnds.get(sessionKey);
  if (!list || list.length === 0) return;
  pendingTextEnds.delete(sessionKey);
  turnStartedAt.delete(sessionKey);
  for (const pending of list) {
    clearTimeout(pending.timer);
    const meta = {};
    if (pending.startedAt !== undefined) meta.durationMs = Math.max(0, Date.now() - pending.startedAt);
    if (usage?.input !== undefined) meta.tokensIn = usage.input;
    if (usage?.output !== undefined) meta.tokensOut = usage.output;
    const event = { type: "text_end", content: pending.content };
    if (Object.keys(meta).length > 0) event.meta = meta;
    lastReplies.set(sessionKey, event.content);
    send({ type: "session-event", sessionKey, event: limitSize(event) });
  }
}

function forwardEvent(sessionKey, ev) {
  // 消息元数据（REQ-AGENT-057）：回合起点记录 + text_end 延迟转发（message_end
  // 冲刷时统一转发，事件顺序与既有契约一致——text_delta 后 text_end）。
  if (ev?.type === "message_update" && ev.assistantMessageEvent) {
    const a = ev.assistantMessageEvent;
    if ((a.type === "text_start" || a.type === "text_delta") && !turnStartedAt.has(sessionKey)) {
      turnStartedAt.set(sessionKey, Date.now());
    }
    if (a.type === "text_end") {
      const timer = setTimeout(() => flushPendingTextEnds(sessionKey, undefined), PENDING_TEXT_END_FALLBACK_MS);
      timer.unref?.();
      const list = pendingTextEnds.get(sessionKey) ?? [];
      list.push({ content: a.content, startedAt: turnStartedAt.get(sessionKey), timer });
      pendingTextEnds.set(sessionKey, list);
      return; // 不在此处转发（message_end 冲刷时统一转发）
    }
  }
  if (ev?.type === "message_end") {
    // message_end 携带完整 assistant message（usage 必填——research 实证）→ 冲刷。
    flushPendingTextEnds(sessionKey, ev.message?.usage);
  }
  const mapped = mapToContractEvent(ev);
  if (!mapped) return;
  // 流式/工具事件 = 会话自身活动（REQ-AGENT-035 标准 1）：刷新 lastActiveAt。
  // clearPending:false（PRD 对齐修复 M1）：会话自身事件不清组冷却的延迟淘汰标记
  // ——pending 窗口内流式 touch 若清掉标记，流结束不再淘汰，组内双热并存（违反
  // F3 恒 ≤1 与 REQ-AGENT-037 标准 3）；「用户回来了」才由 handlePrompt/session-config
  // 的 touch（默认 clearPending=true）清除。
  // 未知 sessionKey → 模块内静默 no-op（消息乱序容忍，接口 1 业务错误行）。
  lifecycle.touch(sessionKey, { clearPending: false });
  if (mapped.type === "text_end") lastReplies.set(sessionKey, mapped.content);
  send({ type: "session-event", sessionKey, event: limitSize(mapped) });
}

// 会话生命周期（REQ-AGENT-035/036/037/039；tech-design 接口 1）：
// - 三触发淘汰调度：TTL 1h / LRU 50 / 同组单活，sweep 每 60s；流式/队列豁免
//   （F2/E1：进行中的回复不掐断；流结束回归候选集合）；
// - onEvict：淘汰副作用回调——dispose + 辅助 Map×3（toolContexts/sessionQueues/
//   lastReplies）清理 + 发 session-evicted IPC（接口 2，{ type:"session-evicted",
//   sessionKey }；主进程丢句柄、store 行保留、keySecrets 保留——Slice 3 接主进程侧）；
// - tombstone 由模块内部记录（tombstonedKeys；接口 3 判别依据，Slice 3 接 evicted
//   重投）；keySecrets 不动（keyRef 级共享缓存，035 标准 2）；confirmAcks/
//   permissionDecisions 不随淘汰清理（035 标准 7，随 30s/10min 超时兜底释放）。
// 淘汰副作用（onEvict 回调，worker 侧）：dispose + 辅助 Map×3（toolContexts/
// sessionQueues/lastReplies）清理 + 发 session-evicted IPC（接口 2）。
function handleSessionEvicted(key, entry) {
  if (entry) disposeSession(entry);
  toolContexts.delete(key);
  sessionQueues.delete(key);
  lastReplies.delete(key);
  // Slice 8（REQ-AGENT-057）：消息元数据状态随淘汰清理（pending text_end 不悬挂——
  // 定时器已 clear，不再对已淘汰会话补发 text_end）。
  turnStartedAt.delete(key);
  clearPendingTextEnds(key);
  send({ type: "session-evicted", sessionKey: key });
  log(`会话淘汰 session=${key}（JSONL 保留，下次活动懒恢复）`);
}

const lifecycle = createSessionLifecycle({
  onWarn: (m) => log(m), // E5（LRU 让位）/E1（流式中豁免延迟）诊断生产可见（PRD 对齐修复 M2）
  onEvict: handleSessionEvicted,
});

// sweep 周期（signoff 裁决 2：60s 语义）；unref：不阻塞进程退出。
const sweepTimer = setInterval(() => {
  try {
    lifecycle.sweep();
  } catch (err) {
    log(`sweep 异常 err=${err?.message ?? String(err)}`);
  }
}, DEFAULT_SWEEP_INTERVAL_MS);
sweepTimer.unref?.();

// —— Slice 8（REQ-AGENT-058）：stats 周期推送（周期可注入——测试缩短；unref 定时器）——
// 每周期对每活跃会话调 session.getContextUsage()（pi SDK 实证：agent-session.d.ts:623
// 进程内直调，返回 ContextUsage | undefined）→ session-stats IPC → 主进程缓存 +
// SSE 转发 renderer（StatusBar 上下文仪表）。FAUX provider usage 空/0 → contextUsage
// 原样推送（renderer 显示占位不崩——REQ-AGENT-056 标准 5 / 058 标准 3）；无活跃会话
// → 空态帧（周期语义保持 + 主进程服务级事件可断言；renderer 按空态隐藏/占位）。
const DEFAULT_STATS_INTERVAL_MS = 5000;
const statsIntervalMs = (() => {
  const v = Number(process.env.OPC_AGENT_STATS_INTERVAL_MS);
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_STATS_INTERVAL_MS;
})();

function pushSessionStats() {
  const entries = lifecycle.entries();
  if (entries.length === 0) {
    send({ type: "session-stats", sessionKey: null, contextUsage: null });
    return;
  }
  for (const [sessionKey, entry] of entries) {
    let contextUsage = null;
    try {
      contextUsage = entry.agentSession.getContextUsage() ?? null;
    } catch (err) {
      log(`stats 获取失败 session=${sessionKey} err=${err?.message ?? String(err)}`);
    }
    send({ type: "session-stats", sessionKey, contextUsage });
  }
}

const statsTimer = setInterval(() => {
  try {
    pushSessionStats();
  } catch (err) {
    log(`stats 推送异常 err=${err?.message ?? String(err)}`);
  }
}, statsIntervalMs);
statsTimer.unref?.();

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

// —— 可编程工具调用注入缝（REQ-AGENT-043/044 T-7/T-9 E2E 测试 seam，FAUX 专属）——
// OPC_FAUX_TOOL_SEQUENCE：JSON 数组 [{ tool, args }]（如 write/bash confirm 级工具）。
// worker 每次 prompt 处理（FAUX 回声路径）按序列发起工具调用：FAUX 模型响应里
// 携带 fauxToolCall 块 → pi 模型循环经工具面**真实执行**（生产路径：gotgenes
// gate / pre-gate / 授权桥 / confirm-request → 确认卡 → 批准 → 执行 → 结果注入
// 会话 → 回声回投，零短路），序列耗尽后回落确定性回声。生产（非 FAUX）零影响
// ——仅 FAUX_MODE 分支引用本状态。若放 toolAdapter 也可，但工具调用起源在模型
// 循环，worker 响应队列处注入最贴近「agent 主动发起」（build-progress Slice 6 记录）。
let fauxToolSequence = null; // 惰性解析（FAUX 首次 prompt 时）；耗尽后置空数组
function getFauxToolSequence() {
  if (fauxToolSequence === null) {
    if (!FAUX_MODE) {
      fauxToolSequence = [];
    } else {
      const raw = process.env.OPC_FAUX_TOOL_SEQUENCE;
      try {
        const parsed = raw ? JSON.parse(raw) : [];
        fauxToolSequence = Array.isArray(parsed)
          ? parsed.filter((s) => s && typeof s.tool === "string")
          : [];
        if (raw && fauxToolSequence.length === 0) log(`OPC_FAUX_TOOL_SEQUENCE 解析为空，回落确定性回声`);
      } catch (err) {
        fauxToolSequence = [];
        log(`OPC_FAUX_TOOL_SEQUENCE 解析失败，回落确定性回声 err=${err?.message ?? String(err)}`);
      }
    }
  }
  return fauxToolSequence;
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
  // 同组单活（REQ-AGENT-037 标准 2/5）：session-config 到达 = 本空间有活动 →
  // 冷却同组其他会话（组内流式中 → 模块标记延迟淘汰，流结束立即执行）。
  lifecycle.evictGroupPeers(sessionKey);
  // session-config 到达 = 用户新活动（PRD 对齐修复 M1）：touch 默认 clearPending=true
  // 清本会话自身的延迟淘汰标记（用户回来了不再被组冷却追偿）。新会话路径为
  // 静默 no-op（未知 key），注册时 register 本就会清 pending。
  lifecycle.touch(sessionKey);
  // 工具上下文（Slice 8 G1）：随 session-config 更新（新会话与热更新共用；
  // toolSurface 经 getDefaultTarget 惰性读取，无需重建 PI 会话）。
  if (toolContext && typeof toolContext === "object") {
    toolContexts.set(sessionKey, toolContext);
  } else {
    toolContexts.delete(sessionKey);
  }
  const existing = lifecycle.get(sessionKey);

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
    lifecycle.remove(sessionKey); // 显式重建路径：不触发 onEvict，清 tombstone（旧世代不复活）
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

  // M2 权限层装配（Slice 7，REQ-AGENT-033）：permissionProfile="project" →
  // gotgenes 工厂 + 授权桥扩展（每会话独立 loader ⇒ 独立 gotgenes 实例，H4/H5
  // 隔离前提）+ bindExtensions（mode rpc + uiContext——hasUI 判定 = uiContext 非
  // noOp，注入即视为有 UI，spike 装配要点 5）；"default" → 不装配（分级硬边界）。
  // 失败回退（fail-safe）：gotgenes 加载/装配异常 → 保持既有工具面确认拦截与
  // cwd 边界硬拦截（无权限层时不下放）。
  let gotgenesExtensions = [];
  let bindBridgeUi = false;
  let gotgenesAssembled = false;
  if (permissionProfile === "project") {
    try {
      const handle = await loadGotgenesFactory();
      // BUG-002 pre-gate：授权桥扩展排在 gotgenes **之前**——扩展 runner 按
      // extensionFactories 顺序分发 tool_call 处理器（emitToolCall 顺序遍历，
      // 首个 block 短路），pre-gate 自评估须先于 gotgenes gate 执行
      // （「worker 扩展层 gate 前自评估」，修复方向 A）。
      gotgenesExtensions = [createPermissionBridgeFactory(sessionKey, sessionCwd, handle), handle.factory];
      bindBridgeUi = true;
      gotgenesAssembled = true;
    } catch (err) {
      log(`gotgenes 装配失败，回退默认工具面确认拦截 session=${sessionKey} err=${err?.message ?? String(err)}`);
    }
  }

  // 每会话独立 DefaultResourceLoader（H5 已证多 loader 共存隔离）：项目空间按
  // session-config 装配会话 cwd 与 additionalSkillPaths（渐进披露段互不污染）；
  // 通用/飞书维持现状装配（noSkills: true 隔离默认发现，不注入任何项目 skills）。
  // noExtensions: true 保留——内联工厂不受其影响，文件系统扩展发现保持关闭
  // （spike 装配要点 2）。
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
    ...(gotgenesExtensions.length > 0 ? { extensionFactories: gotgenesExtensions } : {}),
  });
  await resourceLoader.reload();

  // 工具面（REQ-AGENT-012 标准 1：除 release 外全量 CLI 命令作为 PI 工具注入；
  // C2：进程内 import 命令模块 → ensureServer 发现主进程 server → HTTP API）。
  // M2 按空间分级（REQ-AGENT-032）：permissionProfile="project" → CLI + read/
  // write/bash（cwd 限定项目目录）；"default" → CLI 基线。
  // Slice 8：确认接线（onConfirmRequest）+ G1/GAP 1（sessionKey/getDefaultTarget）。
  // Slice 7（REQ-AGENT-033）：gotgenes 装配成功时 CLI 高危由 gotgenes 策略闸门
  // 拦截（ask → 授权桥 → 确认队列）——工具面自身 confirm 拦截停用（单一闸门，
  // 避免双重 ask）；未装配（default 空间/装配失败回退）维持既有拦截。cwd 边界
  // 同理：gotgenes 已裁决（external_directory ask → 人工批准）时工具面不再二次
  // 硬拦截（boundaryAuthorized）；未装配时保持 fail-closed（E-AGENT-BOUNDARY）。
  const toolSurface = createSessionToolSurface({
    profile: permissionProfile,
    cwd: sessionCwd,
    sessionKey,
    getDefaultTarget: () => toolContexts.get(sessionKey)?.defaultTarget ?? null,
    boundaryAuthorized: gotgenesAssembled,
    ...(gotgenesAssembled
      ? {}
      : {
          onConfirmRequest: async ({ tool, args, riskLevel }) => {
            const confirmId = randomUUID();
            send({ type: "confirm-request", confirmId, sessionKey, command: tool, args, riskLevel });
            const ack = await confirmAck(confirmId);
            if (ack?.ok === true) return { pending: true, reply: ack.reply };
            return { pending: false, error: ack?.error ?? "确认请求失败" };
          },
        }),
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
    // 工具面激活（Slice 6 T-7/T-9 E2E 实证修复）：原 noTools:"all" 在 SDK 0.83.0
    // 语义下 allowedToolNames=[]（空数组 truthy → 空 Set）→ isAllowedTool 全部
    // 过滤 → agent 模型永远拿不到任何工具（tool_call 永不发生，模型循环回
    // "Tool bash not found"）——agent 主动发起 confirm 级工具调用的生产链整体
    // 失效（REQ-AGENT-012/032/033 契约要求工具面真实可调）。改经 tools:<自定义
    // 工具名清单> 显式激活：语义与 noTools:"all" 意图一致（只暴露本 worker 自定义
    // 工具面，builtin read/bash/edit/write 中同名项被自定义定义覆盖、未列名的
    // builtin（如 edit）不激活）。
    tools: toolSurface.toPiToolDefinitions().map((t) => t.name),
    customTools: toolSurface.toPiToolDefinitions(),
  });

  // M2 权限层激活（Slice 7，REQ-AGENT-033）：bindExtensions 触发 session_start →
  // gotgenes 生命周期激活（config 两级加载 + 服务发布 + permissions:ready →
  // 授权桥注册；spike 装配要点 4/5）。uiContext 注入即 hasUI=true——external_directory
  // 等排除面 ask 落终端 LocalUserAuthorizer → select → 同一确认队列（裁决 14）。
  if (bindBridgeUi) {
    await agentSession.bindExtensions({ mode: "rpc", uiContext: createBridgeUiContext(sessionKey) });
  }

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
  // 经生命周期模块注册（tech-design 接口 1）：覆盖注册（懒恢复/重建）清 tombstone，
  // 并刷新活跃时间；LRU 上限由模块在注册时执行（REQ-AGENT-036）。
  lifecycle.register(sessionKey, entry);
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
// BUG-001：setRuntimeApiKey 必须显式传 { allowNetwork: false }——SDK 第三参
// refreshOptions 缺省时，内部 refresh({}) 的 allowNetwork 回退 modelNetworkEnabled
// （= PI_OFFLINE 未设 → true），对持凭证 provider 发起 pi.dev 远程目录刷新
// （无 signal/超时兜底）；pi.dev 不可达时靠 undici headersTimeout 300s 解脱，
// session-config 阻塞 5 分钟。create 时 allowModelNetwork:false 只管首次 refresh，
// 与本注入路径互不覆盖——两处语义必须一致：本 worker 模型解析纯本地（内建 catalog）。
async function resolveModel(runtime, provider, model, apiKey) {
  if (FAUX_MODE) return fauxHandle.getModel();
  if (apiKey) await runtime.setRuntimeApiKey(provider, apiKey, { allowNetwork: false });
  const modelObj = runtime.getModel(provider, model);
  if (!modelObj) {
    throw new Error(`E-AGENT-MODEL: provider=${provider} model=${model} 不可用`);
  }
  return modelObj;
}

// 无法投递 prompt 的统一失败回包（session-error + prompt-result 双发；tombstone
// 判别 evicted 与既有 E-AGENT-NO-SESSION 共用同一发送形态）。
function sendPromptError(id, sessionKey, error, userMessage) {
  send({ type: "session-error", sessionKey, ...error, userMessage });
  send({ type: "prompt-result", id, sessionKey, ok: false, error });
}

async function handlePrompt(msg) {
  const { id, sessionKey, text } = msg;
  const entry = lifecycle.get(sessionKey);
  // 诊断：worker 收到 prompt。
  log(`prompt 进入 session=${sessionKey} id=${id} session存在=${!!entry} text=${String(text ?? "").slice(0, 60)}`);
  if (!entry) {
    // tombstone 判别（tech-design 接口 3；REQ-AGENT-035 标准 6 worker 侧，U1 裁决落地）：
    // - tombstoned key（本运行亲手淘汰、JSONL 在盘可懒恢复）→ session-error
    //   {code:"evicted"}——主进程收到后重发 session-config + 重投该 prompt 一次
    //   （重投编排归 Slice 3 主进程侧，本处只负责判别与回错）；
    // - 非 tombstone 未知 key → 保持既有 E-AGENT-NO-SESSION（孤儿/旧世代不复活）。
    if (lifecycle.tombstonedKeys().includes(sessionKey)) {
      sendPromptError(id, sessionKey, { code: "evicted", reason: "会话刚被淘汰，等待自动恢复" }, "会话正在恢复，请重试");
      return;
    }
    sendPromptError(id, sessionKey, { code: "E-AGENT-NO-SESSION", reason: "会话不存在" }, "会话不存在，请重试");
    return;
  }
  // prompt 到达 = 用户新活动（REQ-AGENT-035 标准 1：刷新 lastActiveAt + 清延迟淘汰
  // 标记——用户回来了不再被组冷却追偿）+ 同组单活（REQ-AGENT-037 标准 2：冷却同组
  // 其他会话）。touch 默认 clearPending=true（PRD 对齐修复 M1）。
  lifecycle.touch(sessionKey);
  lifecycle.evictGroupPeers(sessionKey);
  entry.queued = true; // 排队中豁免（F2：TTL/LRU/组冷却不淘汰排队中的会话）
  await enqueueSession(sessionKey, async () => {
    entry.queued = false;
    entry.streaming = true; // 流式保护（F2/E1：进行中的回复不掐断）
    try {
      // FAUX 测试 seam（H3）：每轮排队一个确定性响应。可编程工具调用注入缝
      // （REQ-AGENT-043/044，OPC_FAUX_TOOL_SEQUENCE）：序列未耗尽 → 本轮 FAUX
      // 模型「主动发起」序列中下一个工具调用（fauxToolCall 经模型循环走生产
      // 工具执行路径——confirm/授权桥链，零短路），随后回声响应收尾（工具
      // 执行结果已入上下文，回声回投）；序列耗尽 → 回落确定性上下文回声。
      if (FAUX_MODE) {
        const seq = getFauxToolSequence();
        if (seq.length > 0) {
          const next = seq.shift();
          fauxHandle.appendResponses([
            fauxAssistantMessage([fauxToolCall(next.tool, next.args ?? {})]),
            fauxEchoFor,
          ]);
        } else {
          fauxHandle.appendResponses([fauxEchoFor]);
        }
      }
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
    } finally {
      entry.streaming = false; // 流结束：回归可淘汰集合（TTL/LRU 候选；组冷却延迟即淘汰）
    }
  });
}

// notify-result（REQ-AGENT-016 标准 2 / tech-design IPC）：确认执行结果注入 agent
// 会话 → agent 生成自然语言回投（W-2：保持对话连贯性）。经会话串行队列排队
// （与 prompt 同队列，同空间不交错）；回投文本经 session-event 流式回传（回复卡片）。
async function handleNotifyResult(msg) {
  const { sessionKey, result } = msg;
  const entry = lifecycle.get(sessionKey);
  if (!entry) {
    log(`notify-result 跳过 session=${sessionKey}（会话不存在）`);
    return;
  }
  entry.queued = true;
  await enqueueSession(sessionKey, async () => {
    entry.queued = false;
    entry.streaming = true; // 流式保护（F2）：回投生成期间不淘汰
    try {
      if (FAUX_MODE) fauxHandle.appendResponses([fauxEchoFor]);
      const text = `执行结果已就绪，请用自然语言向用户简要汇报执行结果：${JSON.stringify(result ?? {})}`;
      await entry.agentSession.prompt(text, { streamingBehavior: "followUp" });
    } catch (err) {
      log(`notify-result prompt 失败 session=${sessionKey} err=${err?.message ?? String(err)}`);
    } finally {
      entry.streaming = false;
    }
  });
}

async function shutdownAll() {
  for (const [key, entry] of lifecycle.entries()) {
    await disposeSession(entry);
    lifecycle.remove(key);
  }
  clearInterval(sweepTimer);
  clearInterval(statsTimer);
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
  // 确认/授权桥回执带外响应（Slice 6 T-7/T-9 E2E 实证修复）：confirm-request-ack
  // 与 permission-decision 是**纯 promise resolve**（同步、不触会话状态），而
  // agent turn 正 await 该回执（confirm 级工具调用挂起等人工决议）——若排队，
  // 队列被在途 prompt 占住 → 回执永不处理 → 确认链死锁（工具调用永久悬挂，
  // 卡片已决议但执行永不发生）。与 ping 同型：事件循环能读行即能 resolve。
  if (msg.type === "confirm-request-ack" || msg.type === "permission-decision") {
    handleMessage(msg);
    return;
  }
  messageQueue.enqueue(() => handleMessage(msg));
});

// /reset（REQ-AGENT-010）：dispose 并释放当前空间会话；主进程随后以下发的
// 新 sessionRef（世代 +1）重新 session-config → 新建空上下文会话。
// 经 lifecycle.remove（显式路径，不触发 onEvict 淘汰链）。
async function handleResetSession(msg) {
  const entry = lifecycle.get(msg.sessionKey);
  if (entry) {
    await disposeSession(entry);
    lifecycle.remove(msg.sessionKey);
    lastReplies.delete(msg.sessionKey);
    // Slice 8（REQ-AGENT-057）：消息元数据状态随 reset 清理（pending text_end 不悬挂）。
    turnStartedAt.delete(msg.sessionKey);
    clearPendingTextEnds(msg.sessionKey);
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
    case "permission-decision": {
      // 授权桥决议回传（Slice 7，REQ-AGENT-033）：主进程确认行决议 →
      // permission-decision → resolve 桥等待（allow/deny → gate 放行/拒绝）。
      const resolve = permissionDecisions.get(msg.confirmId);
      if (resolve) {
        permissionDecisions.delete(msg.confirmId);
        resolve({ kind: msg.kind === "allow" ? "allow" : "deny", reason: msg.reason });
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
deployGlobalPolicy();
send({ type: "ready", pid: process.pid });
