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
import { fauxProvider, fauxAssistantMessage, fauxToolCall, contentText } from "@earendil-works/pi-ai";
import { createSessionToolSurface, toPiToolName } from "./toolAdapter.js";
import { createSessionLifecycle, DEFAULT_SWEEP_INTERVAL_MS } from "./sessionLifecycle.js";
import { createTurnEventPipeline } from "./turnEventPipeline.js";
import { classifyBashToolCall } from "../services/permissionPolicy.js";
import { listMcpPermissionDefaults, mergeMcpDefaultsIntoPolicy } from "../services/mcpPermissionDefaults.js";
import { createAutoJudgeLink } from "./autoJudgeLink.js";
import { assembleSessionExtensions } from "./sessionAssembly.js";
import { createMcpBrokerLink } from "./mcpBrokerLink.js";
import { setServerBaseUrlOverride } from "../cli/server.js";
import { createTrajectoryRecorder } from "./trajectoryRecorder.js";

// —— 环境契约（主进程 spawn 时注入；无则回退默认值，便于手工调试）——
const sessionDir = process.env.OPC_AGENT_SESSION_DIR ?? path.join(process.cwd(), "agent-sessions");
const agentHome = process.env.OPC_AGENT_HOME ?? path.join(process.cwd(), ".agent-home");
const cwd = process.env.OPC_AGENT_CWD ?? process.cwd();
const FAUX_MODE = process.env.OPC_AGENT_FAUX === "1";

// BUG-007：主进程 server baseUrl 注入（OPC_AGENT_SERVER_BASE_URL）→ 启动即
// override——CLI 工具的 ensureServer 短路直连主进程 server，注册表发现/headless/
// in-process 兜底整体旁路（兜底曾在启动窗口期于 worker 内 boot 第二个完整
// server：stdout 污染 IPC + 重复飞书连接）。工具面另经 createSessionToolSurface
// 的 baseUrl 选项逐会话接线（invokeCommandHandler 的 override 恢复语义兜底）。
if (process.env.OPC_AGENT_SERVER_BASE_URL) {
  setServerBaseUrlOverride(process.env.OPC_AGENT_SERVER_BASE_URL);
}

// 单条 IPC 消息上限（签核决策 15：≤ 256KB）由 turnEventPipeline 导出
// （MAX_IPC_BYTES=262144，ADR-029 截断单真源）——worker 不再持有。
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

// —— Slice 3（REQ-AGENT-070）：会话模式（strict/standard/auto）——
// session-config 携带初始模式（主进程 modeService.getMode——显式会话值/lastMode）；
// mode-change IPC 热更新（切换生效于下一个评估，PRD §6.2：当前操作不受影响）；
// 熔断降级（REQ-AGENT-075）worker 侧同步置 standard（与主进程模式服务双写一致）。
// 随淘汰/reset 清理（模式是会话级状态，懒恢复经 session-config 重新注入）。
const sessionModes = new Map(); // sessionKey → "strict" | "standard" | "auto"
function getSessionMode(sessionKey) {
  // 未携带（旧主进程/手工调试）→ 首次默认 auto（对齐 REQ-AGENT-072 标准 3）。
  return sessionModes.get(sessionKey) ?? "auto";
}
const AGENT_MODES_SET = new Set(["strict", "standard", "auto"]);

// BUG-002 诊断 4 计数筛选（§10.4 接口 4b：agent_start / agent_end / turn_start /
// turn_end / message_update——subscribe 回调仅对命中类型调 recordSdkEvent）。
const SDK_COUNTED_EVENT_TYPES = new Set(["agent_start", "agent_end", "turn_start", "turn_end", "message_update"]);

// —— Slice 3（REQ-AGENT-096，B5）：auto judge 独立 modelObj 数据面 ——
// defaultJudge（session-config 携带 / judge-config IPC 广播热更新）→ 每会话独立的
// judge modelObj（judgeModels 表：sessionKey → { provider, model, modelObj }）。
// 与会话 modelObj 分离——B5 解耦：auto 判断不随会话模型漂移。decide 每次调用经
// getter 取当前值（judge-config 广播即时生效，无滞后窗口）。缺 defaultJudge /
// 解析失败 → 条目置空（auto 档 fail-safe defer，REQ-AGENT-073 标准 4 延续，不静默
// 放行）。随淘汰/reset 清理（judge 是会话级装配——懒恢复经 session-config 重新注入）。
const judgeModels = new Map(); // sessionKey → { provider, model, modelObj }

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
    // BUG-014（REQ-AGENT-087 默认层）：用户级默认权限 merge 进部署 JSON 的
    // permission.mcp——出厂 "*" 保持首位（gotgenes 同层 last-match-wins，具体
    // pattern 必须后于 "*" 才生效）；默认层变更 = 新会话生效（对齐 REQ-AGENT-085
    // 标准 3）。DB 读/合并失败 → 回退静态源拷贝（不阻断会话）。
    try {
      const defaults = listMcpPermissionDefaults();
      if (Object.keys(defaults).length === 0) {
        fs.copyFileSync(source, GOTGENES_GLOBAL_CONFIG_PATH);
      } else {
        const policy = JSON.parse(fs.readFileSync(source, "utf8"));
        fs.writeFileSync(
          GOTGENES_GLOBAL_CONFIG_PATH,
          `${JSON.stringify(mergeMcpDefaultsIntoPolicy(policy, defaults), null, 2)}\n`
        );
      }
    } catch (mergeErr) {
      log(`默认权限层合并失败，回退静态拷贝 err=${mergeErr?.message ?? String(mergeErr)}`);
      fs.copyFileSync(source, GOTGENES_GLOBAL_CONFIG_PATH);
    }
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
//
// —— Slice 3（REQ-AGENT-070/073/075）mode 参数（可选）——
// mode = { getMode, autoJudge }（缺省 = 无模式接线，行为与现状完全一致）：
// - getMode：会话模式读取（每评估实时取值——模式切换生效于下一个评估）；
// - autoJudge：S2 auto-judge link 实例（{ authorize }），permissions:ready 时注册
//   "auto-judge" 到 authorizerChain（链序 ["auto-judge", "opc-bridge"] 由全局策略
//   配置承载）。**模式门控**：非 auto 模式下 auto-judge 立即 defer（不调 decide、
//   不写 review log、不动熔断计数）——净效果 = 标准/严格档链 = 现状 ["opc-bridge"]，
//   auto 档链 = ["auto-judge", "opc-bridge"]（动态链可行性实证见 build-progress
//   Slice 3：gotgenes getAuthorizerChain 每次 ask live 读 configStore 内存快照，但
//   configStore 不对外暴露、唯一变更路径 = 写盘 + refresh，违反 REQ-AGENT-077
//   （模式不改 .pi 持久配置）→ 实现面 = worker 侧模式门控过滤）；
// - strict 全确认（REQ-AGENT-070 标准 1）：tool_call pre-gate 按 gate 等价查询
//   （svc.checkPermission，PermissionQuery——链 link 同源 seam）分类——gotgenes
//   会 ask/deny 的操作交 gotgenes 单卡/拦截（不双 ask），gotgenes 会 allow 的
//   （含热路径盲区重定向/管道——BUG-002 同源）→ pre-gate 弹卡（挂起确认）。
function createPermissionBridgeFactory(sessionKey, sessionCwd, handle, mode = {}) {
  const { getMode = () => "auto", autoJudge = null } = mode;
  // 权限服务句柄（permissions:ready 捕获）：strict pre-gate 的 gate 等价查询 +
  // opc-bridge/auto-judge 注册共用。
  let bridgeService = null;

  // MCP 权限 broker 接线（REQ-AGENT-086，B6）：pi-mcp-adapter 每次未缓存 MCP 调用
  // 发 `pi-mcp-adapter:tool-approval-request` → 本 link 恒以 ("mcp", "server:tool")
  // 调 gotgenes checkPermission → allow_once/deny/确认卡（auto 先过模型 link）。
  // 依赖注入（checkPermission/askConfirmation/mode/decide/reviewLog）——纯逻辑 seam。
  // checkPermission 惰性读 bridgeService（permissions:ready 后才就绪——MCP 调用必然
  // 发生在会话启动后，已就绪）。
  const mcpBrokerLink = createMcpBrokerLink({
    checkPermission: (surface, value) => {
      const svc = bridgeService;
      if (svc && typeof svc.checkPermission === "function") {
        try {
          return svc.checkPermission(surface, value)?.state ?? "ask";
        } catch {
          return "ask"; // gotgenes 对未知面/异常 → fail-safe ask（默认确认）
        }
      }
      return "ask";
    },
    askConfirmation: async (payload) => {
      const verdict = await requestPermissionDecision({
        sessionKey,
        tool: `${payload?.serverName}:${payload?.originalToolName}`,
        input: payload?.args ?? {},
        description: `MCP ${payload?.serverName}:${payload?.originalToolName}(${JSON.stringify(payload?.args ?? {}).slice(0, 120)})`,
      });
      return verdict.kind === "allow" ? "allow" : "deny";
    },
    // mode 实时求值（模式切换生效于下一个评估——与 gotgenes 链同一语义）。
    mode: () => getSessionMode(sessionKey),
    ...(autoJudge
      ? {
          // auto 档：模型 link（createAutoJudgeLink.authorize——deny-first + 熔断 +
          // auto-judge review log 与 gotgenes 链共用同一实例）。details 按 gotgenes
          // 原生形态（accessIntent.surface / toolName / input）。
          decide: async (payload) =>
            autoJudge.authorize(
              {
                accessIntent: { surface: "mcp" },
                toolName: `${payload?.serverName}:${payload?.originalToolName}`,
                input: payload?.args ?? {},
              },
              null,
              null
            ),
        }
      : {}),
    reviewLog: (record) => {
      log(`MCP 权限裁决 session=${sessionKey} server=${record.serverName} tool=${record.tool} verdict=${record.verdict}`);
    },
  });

  return async (pi) => {
    pi.events?.on("pi-mcp-adapter:tool-approval-request", (payload) => {
      // claim 契约 = 处理器函数（桥 broker：claim(handler) → await handler() 得裁决）。
      // handleApproval 内部以 `claim(() => decision)` 形态收裁决——claim 函数必须
      // 执行 thunk 并回传 decision 值（测试 harness 同语义）。
      payload.claim(() => mcpBrokerLink.handleApproval(payload, (thunk) => thunk()));
    });
    pi.events?.on("permissions:ready", () => {
      const svc = handle?.getPermissionsService?.();
      if (!svc || typeof svc.registerAuthorizer !== "function") {
        log(`授权桥注册跳过 session=${sessionKey}（权限服务未就绪）`);
        return;
      }
      bridgeService = svc;
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
      // Slice 3（REQ-AGENT-073）：auto-judge 注册（模式门控——非 auto 立即 defer，
      // 链序生效面 = auto 档 ["auto-judge", "opc-bridge"]；标准/严格档净效果
      // ["opc-bridge"]，与现状一致）。
      if (autoJudge) {
        svc.registerAuthorizer("auto-judge", async (details, query, log) => {
          if (getMode() !== "auto") return { kind: "defer" };
          return autoJudge.authorize(details, query, log);
        });
      }
      // 可观测性（tech-design 可观测性节）：授权桥注册留痕（permissions:ready →
      // registerAuthorizer 完成）。
      log(`授权桥注册完成 session=${sessionKey}`);
    });
    pi.on("tool_call", async (event) => {
      // Slice 3（REQ-AGENT-070 标准 1）：strict 全确认——所有操作弹卡（含配置
      // allow 的 read/ls/查询类）。实现面：gotgenes 会 ask/deny 的交 gotgenes
      // 单卡/拦截（单一评估原则：不双 ask），gotgenes 会 allow 的 → pre-gate 弹卡。
      // 本分支 return 提前——strict 下 BUG-002 bash pre-gate 不重复执行（allow 类
      // 已在本分支弹卡，重定向/管道危险同源覆盖）。
      if (getMode() === "strict") {
        const svc = bridgeService;
        if (svc && typeof svc.checkPermission === "function") {
          const surface = event.toolName === "bash" ? "bash" : event.toolName;
          const value = event.toolName === "bash" ? String(event.input?.command ?? "") : undefined;
          const state = svc.checkPermission(surface, value)?.state; // "allow" | "ask" | "deny"
          if (state === "ask" || state === "deny") return undefined; // gotgenes 单卡/拦截
        }
        // allow（或权限服务未就绪 → fail-closed 弹卡兜底）→ 授权桥挂起确认。
        const command = String(event.input?.command ?? "");
        const description = command
          ? `${event.toolName}: ${command}`
          : `${event.toolName}: ${JSON.stringify(event.input ?? {}).slice(0, 120) || "(无参数)"}`;
        const verdict = await requestPermissionDecision({
          sessionKey,
          tool: event.toolName,
          input: event.input ?? {},
          description,
        });
        if (verdict.kind === "allow") return undefined;
        return { block: true, reason: verdict.reason ?? "操作已取消（用户拒绝）" };
      }
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

// 会话生命周期（REQ-AGENT-035/036/037/039；tech-design 接口 1）：
// - 三触发淘汰调度：TTL 1h / LRU 50 / 同组单活，sweep 每 60s；流式/队列豁免
//   （F2/E1：进行中的回复不掐断；流结束回归候选集合）；
// - onEvict：淘汰副作用回调——dispose + turnPipeline.clearSessionState（装配态
//   4 Map 登记 + 回合态自登记，注册表一条路径清全部——ADR-029 决策 2，修两份
//   手抄清单抄岔）+ 发 session-evicted IPC（接口 2，{ type:"session-evicted",
//   sessionKey }；主进程丢句柄、store 行保留、keySecrets 保留——Slice 3 接主进程侧）；
// - tombstone 由模块内部记录（tombstonedKeys；接口 3 判别依据，Slice 3 接 evicted
//   重投）；keySecrets 不动（keyRef 级共享缓存，035 标准 2）；confirmAcks/
//   permissionDecisions 不随淘汰清理（035 标准 7，随 30s/10min 超时兜底释放）。
// 淘汰副作用（onEvict 回调，worker 侧）：dispose + clearSessionState + 发
// session-evicted IPC（接口 2）。
function handleSessionEvicted(key, entry, reason) {
  if (entry) disposeSession(entry);
  turnPipeline.clearSessionState(key);
  send({ type: "session-evicted", sessionKey: key });
  // BUG-002 诊断（2026-08-09）：淘汰日志带来源与 entry 状态——区分
  // sweep-ttl / sweep-pending / lru / group-cool 四触发，定位误淘汰。
  log(
    `会话淘汰 session=${key} reason=${reason ?? "unknown"} streaming=${entry?.streaming ?? "-"} queued=${entry?.queued ?? "-"} idleMs=${entry ? (Date.now() - (entry.lastActiveAt ?? Date.now())) : "-"}（JSONL 保留，下次活动懒恢复）`
  );
}

const lifecycle = createSessionLifecycle({
  onWarn: (m) => log(m), // E5（LRU 让位）/E1（流式中豁免延迟）诊断生产可见（PRD 对齐修复 M2）
  onEvict: handleSessionEvicted,
});

// 回合事件管线（ADR-029；story 2026-08-16-deepen-turn-event-pipeline slice 2）：
// 转发/映射/截断/延迟收尾/abort 合成/回合状态 Map 收进模块；worker 只留 IPC +
// 装配 + lifecycle 接线。touch 注入：仅当事件实际映射出站时由管线调用；
// clearPending:false 语义保持（流式事件不清组冷却延迟淘汰标记——REQ-AGENT-037
// M1，review B2）。
const turnPipeline = createTurnEventPipeline({
  send,
  log,
  touch: (sessionKey) => lifecycle.touch(sessionKey, { clearPending: false }),
  setTimeout,
  clearTimeout,
  now: Date.now,
});
// 轨迹记录器（REQ-AGENT-127 第一现场落盘与 IPC 出站）
const trajectoryRecorder = createTrajectoryRecorder({
  sessionDir,
  send,
  log,
  now: Date.now,
});
// 装配态 Map 登记（worker 持有、管线统一清理——淘汰/重置一条路径，修手抄清单抄岔）。
turnPipeline.registerSessionScopedMap(toolContexts);
turnPipeline.registerSessionScopedMap(sessionQueues);
turnPipeline.registerSessionScopedMap(sessionModes);
turnPipeline.registerSessionScopedMap(judgeModels);
turnPipeline.registerSessionCleanup((sessionKey) => trajectoryRecorder.clearSessionState(sessionKey));

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

// —— Slice 3（REQ-AGENT-073）：auto-judge 可编程判定注入口（FAUX 专属测试 seam）——
// OPC_FAUX_JUDGE_RESULT：JSON 单判定或判定数组（{ kind: "allow"|"deny"|"defer",
// reason? }；裸字符串 "allow"/"deny"/"defer" 兼容）。每次 decide 取一个（数组逐次
// 弹出）→ 驱动 auto 判定链路（allow 直执行 / deny 拦截 / defer 弹卡 / 连续 deny
// 熔断），零网络。生产（非 FAUX）零影响——仅 FAUX_MODE 分支引用本状态；FAUX 未
// 注入 → 显式 defer（decide-deferred，不调 FAUX 回声模型——回声非 verdict 且避免
// 消费模型响应队列，fail-safe 弹卡语义与标准一致）。
const FAUX_JUDGE_KINDS = new Set(["allow", "deny", "defer"]);
let fauxJudgeResults = null; // 惰性解析；耗尽 → 空数组
function takeFauxJudgeResult() {
  if (fauxJudgeResults === null) {
    fauxJudgeResults = [];
    if (FAUX_MODE) {
      const raw = process.env.OPC_FAUX_JUDGE_RESULT;
      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            fauxJudgeResults = parsed.filter((v) => v && FAUX_JUDGE_KINDS.has(v.kind));
          } else if (parsed && FAUX_JUDGE_KINDS.has(parsed.kind)) {
            fauxJudgeResults = [parsed];
          } else if (FAUX_JUDGE_KINDS.has(raw)) {
            fauxJudgeResults = [{ kind: raw }];
          }
        } catch {
          if (FAUX_JUDGE_KINDS.has(raw)) fauxJudgeResults = [{ kind: raw }];
        }
      }
      if (fauxJudgeResults.length === 0 && raw) log(`OPC_FAUX_JUDGE_RESULT 解析为空，回落 decide-deferred`);
    }
  }
  return fauxJudgeResults.length > 0 ? fauxJudgeResults.shift() : null;
}

// —— Slice 3（REQ-AGENT-073 默认 decide 接真实模型）——
// auto-judge 判断 prompt（PRD §10.4 decide 契约面：surface/toolName/input/cwd；
// deny-first：不确定一律 defer，模型只 deny 不主动放行 excluded 面——envelope 兜底）。
const AUTO_JUDGE_SYSTEM_PROMPT = [
  "你是 PI agent 的权限判断器（auto 模式）。对一次工具操作判断是否安全直接执行。",
  '只输出一个 JSON（不要任何其他文字/代码围栏）：{"kind":"allow"} 或 {"kind":"deny","reason":"<简短原因>"} 或 {"kind":"defer","reason":"model-unresolved"}。',
  "- allow：操作明显安全（常见构建/测试/只读命令，如 npm test、git status、ls），直接放行；",
  "- deny：操作危险/明显违规（删除、覆盖、外发、提权、跨项目访问等），拦截并给出简短原因；",
  "- defer：无法确定/信息不足/无法评估，交人工确认（deny-first：不确定一律 defer）。",
  "判断规则：写操作（写文件/删除/覆盖）默认保守；rm/sudo 等危险模式一律 deny；项目目录外的路径访问一律 defer；只读与常规命令可 allow。",
].join("\n");
// 模型调用超时兜底（provider 级，早于 link 的 decideTimeoutMs 5s——超时即错误，
// link 映射 call-failed defer）。
const AUTO_JUDGE_CALL_TIMEOUT_MS = 4500;
// 熔断降级提示文案（PRD F3 / REQ-AGENT-075 标准 2：「auto 暂停：模型频繁拒绝，
// 已回标准模式」；经 mode-tripped IPC → 主进程模式服务降级 + session-event 呈现）。
const AUTO_TRIP_REASON = "auto 暂停：模型频繁拒绝，已回标准模式";

// verdict 解析：容忍代码围栏/前后杂文本；提取首个 {…} JSON 并校验 kind；
// 不可解析/非法 kind → { kind: "defer", reason: "model-unresolved" }（fail-safe）。
function parseVerdict(text) {
  if (typeof text !== "string" || text.trim() === "") {
    return { kind: "defer", reason: "model-unresolved" };
  }
  let s = text.trim().replace(/^```[a-zA-Z]*\s*/i, "").replace(/\s*```$/i, "");
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      const parsed = JSON.parse(s.slice(start, end + 1));
      const kind = parsed?.kind;
      if (kind === "allow") return { kind: "allow" };
      if (kind === "deny") {
        return {
          kind: "deny",
          ...(typeof parsed.reason === "string" && parsed.reason.length > 0
            ? { reason: parsed.reason.slice(0, 200) }
            : {}),
        };
      }
      if (kind === "defer") return { kind: "defer", reason: "model-unresolved" };
    } catch {
      // 回落下方 fail-safe
    }
  }
  return { kind: "defer", reason: "model-unresolved" };
}

// 判断 prompt 组装（details = gotgenes 原生形态——accessIntent.surface / toolName /
// command|path|target 双形态兼容，对齐 autoJudgeLink surfaceOf/inputOf）。
function buildJudgePrompt(details, sessionCwd) {
  const surface = details?.accessIntent?.surface ?? details?.surface ?? null;
  const input = details?.input ?? details?.command ?? details?.path ?? details?.target ?? null;
  const parts = [
    `操作 surface: ${surface ?? "unknown"}`,
    `工具: ${details?.toolName ?? details?.skillName ?? "unknown"}`,
    `工作目录: ${sessionCwd ?? "unknown"}`,
  ];
  if (input !== null && input !== undefined && String(input) !== "") {
    parts.push(`操作内容: ${String(input).slice(0, 500)}`);
  }
  return parts.join("\n");
}

// 会话级 decide（每会话独立实例——熔断计数会话级，对齐 permissionBridge H4）：
// FAUX 注入口（可编程判定）→ 真实模型调用（runtime.complete 复用会话 provider/
// key 运行时——resolveModel 已注入）→ 解析 verdict。模型失败/超时 → throw（link
// 映射 call-failed/timeout defer，S2 已保证）；回复不可解析 → defer（model-unresolved）。
// Slice 3（REQ-AGENT-096，B5）：judge modelObj 来源 = defaultJudge 解析的独立数据面
//（getJudgeModel 每次调用取当前值——judge-config 广播热更新即时生效，无滞后窗口；
// 与会话 modelObj 分离，decide 不随会话模型漂移）。缺 defaultJudge（未配置）→
// throw E-AUTO-JUDGE-NO-PROVIDER（link 映射 call-failed defer——REQ-AGENT-073
// 标准 4 延续：auto 不可用不静默放行）。
function createSessionDecide(runtime, getJudgeModel, sessionKey, sessionCwd) {
  return async function decide(details) {
    if (FAUX_MODE) {
      const programmed = takeFauxJudgeResult();
      if (programmed) return programmed;
      return { kind: "defer", reason: "decide-deferred" };
    }
    const judgeModel = getJudgeModel();
    if (!judgeModel) {
      throw new Error("E-AUTO-JUDGE-NO-PROVIDER: auto 判断不可用——defaultJudge 未配置");
    }
    const message = await runtime.complete(
      judgeModel.modelObj,
      {
        systemPrompt: AUTO_JUDGE_SYSTEM_PROMPT,
        messages: [{ role: "user", content: buildJudgePrompt(details, sessionCwd) }],
      },
      { maxTokens: 200, timeoutMs: AUTO_JUDGE_CALL_TIMEOUT_MS }
    );
    if (message?.stopReason === "error") {
      throw new Error(
        `E-AUTO-JUDGE-CALL-FAIL: ${message.errorMessage ?? "模型调用失败"}`
      );
    }
    const text = message?.content ? contentText(message.content) : "";
    if (!text) log(`auto-judge 空回复 session=${sessionKey}（回落 model-unresolved defer）`);
    return parseVerdict(text);
  };
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
  // BUG-003（2026-08-09）：水合（source:"hydration"）是系统恢复不是用户活动——
  // 不触发冷却（否则重启时同组两会话互相踢：后水合者冷却刚水合的 idleMs=1）。
  if (msg.source !== "hydration") {
    lifecycle.evictGroupPeers(sessionKey);
  }
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
  // Slice 3（REQ-AGENT-070）：会话模式随 session-config 注入（初始模式 = 主进程
  // modeService.getMode——显式会话值/lastMode；热更新时同样刷新，mode-change IPC
  // 与其等价）。
  if (typeof msg.mode === "string" && AGENT_MODES_SET.has(msg.mode)) {
    sessionModes.set(sessionKey, msg.mode);
  }
  // Slice 3（REQ-AGENT-096，B5）：defaultJudge 随 session-config 刷新（新建/热更新/
  // 懒恢复/evicted 重投共用——judge 数据面与会话模型解耦；主进程每次装配磁盘最新
  // 默认，懒恢复会话自然带新值）。judge-config 广播另有独立更新通道（handleMessage）。
  await refreshJudgeModel(sessionKey, msg);
  const existing = lifecycle.get(sessionKey);

  if (existing) {
    setSessionSecret(keyRef, apiKey, existing.keyRef);
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

  // ---- 装配层（B1，REQ-AGENT-082/085/089）：本项目有效插件集 + 固定序 factories + 诊断 ----
  // 缺包（settings 声明但磁盘缺失）→ 抛错 → session-config 失败（session-error，
  // E1 变体：不发网络安装——onMissing="error" 语义）。
  let asm;
  try {
    asm = await assembleSessionExtensions({
      cwd: sessionCwd,
      agentDir: agentHome,
      ...(msg.mcpSnapshot !== undefined ? { mcpSnapshot: msg.mcpSnapshot } : {}),
    });
  } catch (err) {
    throw new Error(`会话装配失败（插件缺失或异常）: ${err?.message ?? String(err)}`);
  }
  for (const d of asm.diagnostics ?? []) {
    log(`装配诊断 session=${sessionKey} ${typeof d === "string" ? d : (d?.message ?? JSON.stringify(d))}`);
  }
  // B1 worker 实际加载：只种子本项目启用的插件（scope==="project"）到 SettingsManager
  // inMemory——保证 worker 只加载本项目启用的插件；官方 loader 负责发现/加载/错误隔离。
  // 用 inMemory 而非 create+setExtensionPaths：官方 loader 内部 reload 会 flush
  // writeQueue，setExtensionPaths 会把过滤后的清单误写回全局 settings.json（side effect）。
  const settingsManager = SettingsManager.inMemory({
    extensions: (asm.resolved ?? [])
      .filter((r) => r.scope === "project")
      .map((r) => r.source ?? r.path),
  });
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
      const handle = asm.handle ?? (await loadGotgenesFactory());
      // Slice 3（REQ-AGENT-073/075）：auto-judge link 实例（每会话独立——熔断计数
      // 会话级，对齐 permissionBridge H4）。decide = 会话级模型判断（FAUX 注入口
      // OPC_FAUX_JUDGE_RESULT / 真实 runtime.complete）；onTripped → 熔断降级：
      // worker 侧会话模式同步置 standard（下一评估即生效）+ mode-tripped IPC →
      // 主进程模式服务降级 standard + 用户可见提示（REQ-AGENT-075 标准 2，S4 呈现）。
      // 熔断阈值可注入（测试 seam）：OPC_AGENT_JUDGE_DENY_THRESHOLD（REQ-AGENT-075
      // 标准 1「N 可注入」；缺省 link 默认 5）。
      let judgeDenyThreshold = null;
      const thresholdRaw = process.env.OPC_AGENT_JUDGE_DENY_THRESHOLD;
      if (thresholdRaw) {
        const v = Number(thresholdRaw);
        if (Number.isInteger(v) && v > 0) judgeDenyThreshold = v;
      }
      const autoJudge = createAutoJudgeLink({
        // Slice 3（REQ-AGENT-096，B5）：judge modelObj 独立数据面——createSessionDecide
        // 经 getter 取 judgeModels 当前值（defaultJudge 解析，与会话 modelObj 分离；
        // judge-config 广播热更新即时生效）。缺失 → decide 抛 E-AUTO-JUDGE-NO-PROVIDER
        // → link 映射 call-failed defer（REQ-AGENT-073 标准 4 延续，不静默放行）。
        decide: createSessionDecide(
          runtime,
          () => judgeModels.get(sessionKey) ?? null,
          sessionKey,
          sessionCwd
        ),
        ...(judgeDenyThreshold !== null ? { denyThreshold: judgeDenyThreshold } : {}),
        onTripped: () => {
          sessionModes.set(sessionKey, "standard");
          send({ type: "mode-tripped", sessionKey, reason: AUTO_TRIP_REASON });
          log(`auto 熔断降级 session=${sessionKey} → standard（模型频繁拒绝）`);
        },
      });
      // BUG-002 pre-gate：授权桥扩展排在 gotgenes **之前**——扩展 runner 按
      // extensionFactories 顺序分发 tool_call 处理器（emitToolCall 顺序遍历，
      // 首个 block 短路），pre-gate 自评估须先于 gotgenes gate 执行
      // （「worker 扩展层 gate 前自评估」，修复方向 A）。
      // MCP 桥（REQ-AGENT-085/086，B5/B6）：排在 gotgenes 之后（装配缝 slot 2，
      // 固定序 [授权桥, gotgenes, MCP桥]）；broker 事件由授权桥 factory 内接线。
      gotgenesExtensions = [
        createPermissionBridgeFactory(sessionKey, sessionCwd, handle, {
          getMode: () => getSessionMode(sessionKey),
          autoJudge,
        }),
        handle.factory,
        ...asm.factories.filter((f) => f.name === "pi-mcp-adapter"),
      ];
      bindBridgeUi = true;
      gotgenesAssembled = true;
    } catch (err) {
      log(`gotgenes 装配失败，回退默认工具面确认拦截 session=${sessionKey} err=${err?.message ?? String(err)}`);
    }
  }

  // 每会话独立 DefaultResourceLoader（H5 已证多 loader 共存隔离）：项目空间按
  // session-config 装配会话 cwd 与 additionalSkillPaths（渐进披露段互不污染）；
  // 通用/飞书维持现状装配（noSkills: true 隔离默认发现，不注入任何项目 skills）。
  // noExtensions: false——装配缝已把本项目启用插件种子进 settingsManager，官方 loader
  // 负责发现/加载/错误隔离（B1 worker 实际加载）；内联工厂（授权桥/gotgenes/MCP桥）
  // 不受其影响。
  const resourceLoader = new DefaultResourceLoader({
    cwd: sessionCwd,
    agentDir: agentHome,
    settingsManager,
    noExtensions: false,
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
    // BUG-007：主进程注入的 baseUrl 逐会话接线（工具命令直连主进程 server；
    // 缺省回退注册表发现——仅手工调试/旧主进程形态，守卫见 cli/server.js）。
    ...(process.env.OPC_AGENT_SERVER_BASE_URL ? { baseUrl: process.env.OPC_AGENT_SERVER_BASE_URL } : {}),
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
    if (ev.type === "tool_execution_error") {
      turnPipeline.onSessionEvent(sessionKey, ev);
      trajectoryRecorder.onToolError({
        sessionKey,
        safeKey: safeKeyFor(sessionKey),
        toolCallId: ev.toolCallId,
        toolName: ev.name,
        errorCode: ev.errorCode,
        errorMessage: ev.errorMessage,
        sessionRef: effectiveRef,
      });
    }
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
    // "mcp"：pi-mcp-adapter 的代理网关工具（REQ-AGENT-085，B5）——allowedToolNames
    // 是硬 allowlist，未列入的扩展工具会被 isAllowedTool 过滤（模型拿不到）。
    // MCP 桥装配时 adapter 注册 `mcp` 工具；未装配时该名字无对应注册，allowlist 多
    // 一条无副作用。
    tools: [...toolSurface.toPiToolDefinitions().map((t) => t.name), "mcp"],
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
  agentSession.subscribe((ev) => {
    // BUG-002 诊断 4（2026-08-09）：SDK 事件到达观测——subscribe 是否收到事件
    //（区分「SDK 层未产生事件」vs「worker 过滤丢弃」）。计数写入管线
    //（recordSdkEvent——sdkEventCounts 归管线存/取/清，slice 2 接线）。
    const t = ev?.type ?? ev?.assistantMessageEvent?.type ?? "?";
    if (SDK_COUNTED_EVENT_TYPES.has(t)) turnPipeline.recordSdkEvent(sessionKey, t);
    turnPipeline.onSessionEvent(sessionKey, ev);

    // REQ-AGENT-127 轨迹落盘接线
    const safeKey = safeKeyFor(sessionKey);
    if (ev?.type === "message_update") {
      const a = ev.assistantMessageEvent;
      if (a?.type === "text_delta" || a?.type === "text_start") {
        trajectoryRecorder.onFirstTextDelta({
          sessionKey,
          safeKey,
          textPreview: a.delta || a.content,
          sessionRef: entry.sessionRef,
        });
      }
    } else if (ev?.type === "message_end") {
      // 必须严格校验 role === "assistant"！
      // SDK 的 message_end 会在 user 消息及每个 toolResult 消息入库时均触发，
      // 若不判断 role，会导致每次工具返回甚至用户发消息时都被误当成一条 assistant_span 写入。
      if (ev.message?.role === "assistant") {
        const textContent = Array.isArray(ev.message?.content)
          ? ev.message.content
              .filter((c) => c?.type === "text")
              .map((c) => c.text ?? "")
              .join(" ")
              .trim()
          : (typeof ev.message?.content === "string" ? ev.message.content.trim() : "");
        trajectoryRecorder.onAssistantMessageEnd({
          sessionKey,
          safeKey,
          usage: ev.message?.usage,
          textPreview: textContent || undefined,
          sessionRef: entry.sessionRef,
        });
      }
    } else if (ev?.type === "tool_execution_start") {
      trajectoryRecorder.onToolStart({
        sessionKey,
        safeKey,
        toolCallId: ev.toolCallId,
        toolName: ev.toolName,
        args: ev.args,
        sessionRef: entry.sessionRef,
      });
    } else if (ev?.type === "tool_execution_end") {
      trajectoryRecorder.onToolEnd({
        sessionKey,
        safeKey,
        toolCallId: ev.toolCallId,
        toolName: ev.toolName,
        result: ev.result,
        isError: ev.isError,
        sessionRef: entry.sessionRef,
      });
    } else if (ev?.type === "compaction_start") {
      trajectoryRecorder.onCompactionStart({
        sessionKey,
        safeKey,
        reason: ev.reason,
        sessionRef: entry.sessionRef,
      });
    } else if (ev?.type === "compaction_end") {
      trajectoryRecorder.onCompactionEnd({
        sessionKey,
        safeKey,
        reason: ev.reason,
        sessionRef: entry.sessionRef,
      });
    }
  });
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
// BUG-001 迁移（pi 0.84.1）：setRuntimeApiKey 第三参已从 refreshOptions 改为
// AuthOperationOptions（仅 signal），且不再触发模型目录刷新——旧 0.83 隐式
// `refresh({})`（allowNetwork 回退 modelNetworkEnabled → 对持凭证 provider 发起
// pi.dev 远程刷新、可阻塞 5 分钟）的路径已随签名变更移除。纯本地解析（内建
// catalog）由 API 自身保证，无需传 allowNetwork；create 时 allowModelNetwork:false
// 只管 create-time 刷新，与本注入路径互不覆盖。
async function resolveModel(runtime, provider, model, apiKey) {
  if (FAUX_MODE) return fauxHandle.getModel();
  if (apiKey) await runtime.setRuntimeApiKey(provider, apiKey);
  const modelObj = runtime.getModel(provider, model);
  if (!modelObj) {
    throw new Error(`E-AGENT-MODEL: provider=${provider} model=${model} 不可用`);
  }
  return modelObj;
}

// key 一次注入仅内存（keySecrets 按 keyRef 索引共享缓存，REQ-AGENT-035 标准 2）；
// keyRef 缺省 → 兜底既有引用。session-config 与 provider-change 共用同一注入语义。
function setSessionSecret(keyRef, apiKey, fallbackKeyRef) {
  if (apiKey) keySecrets.set(keyRef ?? fallbackKeyRef, apiKey);
}

// —— Slice 3（REQ-AGENT-096，B5）：defaultJudge → judge 独立 modelObj 数据面 ——
// msg.defaultJudge = {provider, model, keyRef, apiKey}（session-config 携带 / judge-config
// 广播载荷）。key 一次注入仅内存（keySecrets 按 keyRef 索引，同 session-config 安全
// 语义——不落日志/JSONL；日志只记 provider/model）。解析失败（模型不可用）→ 置空
//（auto 档 fail-safe defer，不静默放行）。FAUX 下 resolveModel 直取 faux 模型
//（decide 另有 FAUX 注入口短路，本解析仅保证数据面形态一致）。
async function refreshJudgeModel(sessionKey, msg) {
  const dj = msg?.defaultJudge;
  if (!dj || typeof dj.provider !== "string" || typeof dj.model !== "string") {
    judgeModels.delete(sessionKey);
    return;
  }
  setSessionSecret(dj.keyRef, dj.apiKey);
  const runtime = await getModelRuntime();
  try {
    const modelObj = await resolveModel(runtime, dj.provider, dj.model, dj.apiKey);
    judgeModels.set(sessionKey, { provider: dj.provider, model: dj.model, modelObj });
    log(`defaultJudge 解析 session=${sessionKey} provider=${dj.provider} model=${dj.model}`);
  } catch (err) {
    judgeModels.delete(sessionKey);
    log(`defaultJudge 解析失败 session=${sessionKey} provider=${dj.provider} model=${dj.model}（auto 档 fail-safe defer）err=${err?.message ?? String(err)}`);
  }
}

// —— Slice 2（REQ-AGENT-093，ADR-026）：provider-change 热更新 ——
// 会话级模型切换：resolveModel 替换该会话 modelObj（AgentSession.setModel——
// 下一轮 prompt 生效），sessionRef 不换代（JSONL 历史保留）。key 一次注入仅内存
//（keySecrets 按 keyRef 索引；resolveModel 内部 setRuntimeApiKey，不落日志/JSONL）。
// 会话不存在（被淘汰/未水合）→ 跳过：主进程已回写 agent_sessions 行，下次
// session-config 按行值装配（懒恢复路径）。
async function handleProviderChange(msg) {
  const { sessionKey, provider, model, keyRef, apiKey } = msg;
  const entry = lifecycle.get(sessionKey);
  if (!entry) {
    log(`provider-change 跳过 session=${sessionKey}（会话不存在，懒恢复按行装配）`);
    return;
  }
  setSessionSecret(keyRef, apiKey, entry.keyRef);
  const modelObj = await resolveModel(entry.modelRuntime, provider, model, apiKey);
  await entry.agentSession.setModel(modelObj);
  entry.provider = provider;
  entry.model = model;
  entry.keyRef = keyRef ?? entry.keyRef;
  log(`provider-change session=${sessionKey} provider=${provider} model=${model}（下一条 prompt 生效，sessionRef 不换代）`);
}

// 无法投递 prompt 的统一失败回包（session-error + prompt-result 双发；tombstone
// 判别 evicted 与既有 E-AGENT-NO-SESSION 共用同一发送形态）。
function sendPromptError(id, sessionKey, error, userMessage) {
  send({ type: "session-error", sessionKey, ...error, userMessage });
  send({ type: "prompt-result", id, sessionKey, ok: false, error });
}

// 附件读图（REQ-AGENT-097，B6，§10.2 worker 职责）：按 path 读文件 → base64 →
// image content block（pi-ai 原生形态 {type:"image", data, mimeType}；附带 name
// 供历史投影显示附件名——SDK API 序列化只取 type/data/mimeType，name 零副作用）。
// 无附件 → []。任一读取失败（存在但不可读：权限/TCC）→ attachment-error 会话
// 事件回 UI（E8「文件读取失败」，消息不静默丢弃）+ prompt-result 失败回执
// （主进程 pending promise 必须结算）→ 返回 undefined（调用方中止本轮，消息
// 不发送——REQ-AGENT-097 标准 5）。路由层已校验 path 存在性，此处只管读。
function readAttachmentImages(attachments, sessionKey, id) {
  if (!Array.isArray(attachments) || attachments.length === 0) return [];
  const images = [];
  for (const att of attachments) {
    const filePath = typeof att?.path === "string" ? att.path : "";
    try {
      const buf = fs.readFileSync(filePath);
      images.push({
        type: "image",
        data: buf.toString("base64"),
        mimeType: typeof att?.mimeType === "string" ? att.mimeType : "image/png",
        ...(typeof att?.name === "string" && att.name !== "" ? { name: att.name } : {}),
      });
    } catch (err) {
      const label = att?.name ?? filePath;
      log(`附件读取失败 session=${sessionKey} name=${label} err=${err?.message ?? String(err)}`);
      send({
        type: "session-event",
        sessionKey,
        event: { type: "attachment-error", name: label, message: "文件读取失败" },
      });
      send({
        type: "prompt-result",
        id,
        sessionKey,
        ok: false,
        error: { code: "E-ATTACH-READ", reason: err?.message ?? String(err) },
      });
      return undefined;
    }
  }
  return images;
}

// —— SDK 消息读取 helpers（handlePrompt 诊断块共用）——
// agentSession.messages 是诊断数据面（读取可能抛——调用方 try/catch 兜底，stderr
// 红线不崩）；lastErrorText 提取「消息可转述错误」公共形态（errorMessage 优先、
// 文本段兜底——LLM error 感知与末条消息诊断共用同一表达式，避免两份抄写漂移）。
function sessionMessages(entry) {
  return entry.agentSession.messages ?? [];
}
function lastMessageOf(entry) {
  const msgs = sessionMessages(entry);
  return msgs[msgs.length - 1];
}
function lastErrorText(msg) {
  return msg?.errorMessage || (msg?.content ?? []).find((c) => c.type === "text")?.text;
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
    turnPipeline.beginTurn(sessionKey); // 幂等清两诊断计数（人拍板 B：失败轮残留不混轮）
    const safeKey = safeKeyFor(sessionKey);
    trajectoryRecorder.onTurnStart({ sessionKey, safeKey, sessionRef: entry.sessionRef });
    trajectoryRecorder.onUserMessage({ sessionKey, safeKey, text, sessionRef: entry.sessionRef });
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
            // BUG-002：工具名清洗与 SDK 注册名一致（toPiToolName——FAUX 注入缝
            // 的原始名 "task list" 在 SDK 侧是 "task_list"，不匹配则工具执行失败）。
            fauxAssistantMessage([fauxToolCall(toPiToolName(next.tool), next.args ?? {})]),
            fauxEchoFor,
          ]);
        } else {
          fauxHandle.appendResponses([fauxEchoFor]);
        }
      }
      // 图片附件（REQ-AGENT-097，B6）：读图语义见 readAttachmentImages 头注释；
      // 本处要点 = 读取失败已发 attachment-error + prompt-result 失败回执 → 返回
      // undefined → 本轮消息不发送（不静默丢弃，E8 语义）。
      const images = readAttachmentImages(msg.attachments, sessionKey, id);
      if (images === undefined) return; // 附件读取失败：事件已发，消息不发送
      // 回复文本经 message_update 事件回传（session.prompt 返回 void，spike H3）。
      // BUG-002 诊断（2026-08-09）：LLM 调用起止日志——区分「请求未发出 / 已发出
      // 无响应 / 流式进行中」；配合淘汰 reason 日志定位误淘汰链条。
      log(`LLM 调用开始 session=${sessionKey} id=${id}`);
      // BUG-002 诊断 3（2026-08-09）：上下文状态（消息数/末条类型）——区分
      // 「恢复上下文异常导致模型空转」vs「provider 空返回」。
      try {
        const msgs = sessionMessages(entry);
        const last = msgs[msgs.length - 1];
        log(`上下文诊断 session=${sessionKey} 消息数=${msgs.length} 末条=${last ? `${last.role}:${(last.content ?? []).map((c) => c.type).join(",")}` : "无"}`);
      } catch (err) {
        log(`上下文诊断失败 session=${sessionKey} err=${err?.message ?? String(err)}`);
      }
      await entry.agentSession.prompt(text, {
        streamingBehavior: "followUp",
        // pi-ai 原生图片注入（prompt options.images → user message content blocks；
        // 持久化 = SessionManager 原生序列化，零自定义——JSONL 快照进历史，重放可见）。
        ...(images.length > 0 ? { images } : {}),
      });
      log(`LLM 调用结束 session=${sessionKey} id=${id}`);
      // BUG-002 修复（2026-08-09）：LLM error 感知——SDK 吞错（请求失败 →
      // stopReason=error，agent-loop 不抛、prompt resolve）→ worker 曾静默
      // ok:true 无回复（对话空转）。检查末条消息 errorMessage → 回 session-error
      //（E-AGENT-LLM-FAIL，renderer 可见错误，不再静默）。
      let llmError = null;
      try {
        const last = lastMessageOf(entry);
        if (last?.stopReason === "error") {
          llmError = lastErrorText(last) || "LLM 调用失败（无错误详情）";
        }
      } catch (err) {
        log(`error 检查失败 session=${sessionKey} err=${err?.message ?? String(err)}`);
      }
      if (llmError) {
        const error = { code: "E-AGENT-LLM-FAIL", reason: llmError };
        log(`prompt 失败（LLM error 消息）session=${sessionKey} code=${error.code} reason=${String(llmError).slice(0, 200)}`);
        sendPromptError(id, sessionKey, error, `LLM 调用失败：${llmError}`);
        return;
      }
      // BUG-002 诊断 5（2026-08-09）：LLM 调用后读 SDK 末条消息（error 消息的
      // errorMessage）——直接暴露请求失败原因（401/404/网络/参数——SDK 吞错）。
      try {
        const last = lastMessageOf(entry);
        const lastErr = lastErrorText(last);
        log(`末条消息 session=${sessionKey} role=${last?.role} stopReason=${last?.stopReason ?? "-"} err=${lastErr ? String(lastErr).slice(0, 200) : "无"}`);
      } catch (err) {
        log(`末条消息读取失败 session=${sessionKey} err=${err?.message ?? String(err)}`);
      }
      const reply = turnPipeline.takeLastReply(sessionKey);
      // BUG-002 诊断（2026-08-09）：reply 有无 + 本轮事件计数——实锤「LLM 生成了
      // 但事件链断」vs「模型空转无输出」。诊断计数经管线接口取出即删（人拍板 B）。
      const diag = turnPipeline.takeTurnDiagnostics(sessionKey);
      log(`prompt-result session=${sessionKey} id=${id} reply=${reply !== undefined ? "有" : "无"} 事件=${JSON.stringify(diag.turnStats)} sdk事件=${JSON.stringify(diag.sdkStats)}`);
      send({
        type: "prompt-result",
        id,
        sessionKey,
        ok: true,
        ...(reply !== undefined ? { reply } : {}),
      });
    } catch (err) {
      // REQ-AGENT-007：供应商失败/超时/限流 → 结构化错误消息，进程不崩、会话存活。
      trajectoryRecorder.onTurnAbort({
        sessionKey,
        safeKey,
        reason: "error",
        sessionRef: entry.sessionRef,
      });
      const reason = err?.message ?? String(err);
      const error = { code: "E-AGENT-LLM-FAIL", reason };
      log(`prompt 失败 session=${sessionKey} code=${error.code}`);
      sendPromptError(id, sessionKey, error, `LLM 调用失败：${reason}`);
    } finally {
      trajectoryRecorder.onTurnEnd({
        sessionKey,
        safeKey,
        sessionRef: entry.sessionRef,
      });
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
  // 停止带外响应（REQ-AGENT-091，BUG-010）：stop-session 若进串行队列，排在在途
  // 长 prompt 之后永不执行 → 停止完全失效（与 ping/确认回执同型坑）。abort()
  // 调用同步发起、返回 promise 不 await——事件循环能读行即能中断当前生成。
  if (msg.type === "stop-session") {
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
    // 注册表统一清理（ADR-029 决策 2/3，人拍板 A）：清全部登记 Map——装配态
    // （toolContexts/sessionQueues/sessionModes/judgeModels）+ 回合态（lastReplies/
    // 计数/turnStartedAt/pendingTextEnds，pending 定时器经 cleanup 钩子先 clear）。
    // 修重置版手抄清单抄岔（漏 toolContexts/sessionQueues）与计数泄漏。
    turnPipeline.clearSessionState(msg.sessionKey);
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
    case "stop-session": {
      // REQ-AGENT-091（BUG-010）：手动停止当前生成。SDK abort() 中断进行中 turn
      //（中断消息 stopReason=aborted 照常走 message_end/text_end 事件链收尾，
      // prompt-result ok:true + 部分回复文本——已生成内容保留）。fire-and-forget：
      // abort promise 不 await（其语义为「等到 idle」，等待无必要且不阻塞消息面）。
      const entry = lifecycle.get(msg.sessionKey);
      if (!entry) {
        // 未知/已淘汰 key → 静默 no-op（REQ-091 标准 3：停止非用户错误，
        // 不发 session-error——用户感知的「已停止」本就是目标状态）。
        log(`stop-session 未知 key 静默 no-op session=${msg.sessionKey}`);
        break;
      }
      log(`stop-session 中断 session=${msg.sessionKey} streaming=${!!entry.streaming}`);
      trajectoryRecorder.onTurnAbort({
        sessionKey: msg.sessionKey,
        safeKey: safeKeyFor(msg.sessionKey),
        reason: "stop",
        sessionRef: entry.sessionRef,
      });
      entry.agentSession.abort().catch((err) =>
        log(`abort 失败 session=${msg.sessionKey} err=${err?.message ?? String(err)}`)
      );
      break;
    }
    case "mode-change": {
      // Slice 3（REQ-AGENT-070）：会话模式热更新（S4 切换入口 → 主进程模式服务
      // → IPC mode-change）。生效于下一个评估（PRD §6.2：当前操作不受影响）。
      if (typeof msg.mode === "string" && AGENT_MODES_SET.has(msg.mode)) {
        sessionModes.set(msg.sessionKey, msg.mode);
        log(`mode-change session=${msg.sessionKey} mode=${msg.mode}`);
      } else {
        log(`mode-change 非法模式忽略 session=${msg.sessionKey} mode=${String(msg.mode ?? "")}`);
      }
      break;
    }
    case "provider-change": {
      // Slice 2（REQ-AGENT-093，ADR-026）：会话级 provider 热更新（工具栏切换 →
      // 主进程回写 agent_sessions 行 → IPC provider-change）。resolveModel 替换该
      // 会话 modelObj（AgentSession.setModel），下一条 prompt 生效；进行中操作不受
      // 影响；sessionRef 不换代（JSONL 历史保留）；key 一次注入仅内存（keySecrets）。
      // 会话不存在（被淘汰/未水合）→ 跳过：行已回写，下次 session-config 按行值装配。
      try {
        await handleProviderChange(msg);
      } catch (err) {
        const reason = err?.message ?? String(err);
        log(`provider-change 失败 session=${msg.sessionKey} reason=${reason}`);
        send({
          type: "session-error",
          sessionKey: msg.sessionKey,
          code: "E-AGENT-RUNTIME",
          reason,
          userMessage: "模型切换失败，请重试",
        });
      }
      break;
    }
    case "judge-config": {
      // Slice 3（REQ-AGENT-096，B5，§10.4 接口契约 3）：默认组合变更广播 →
      // 全部活跃会话 judge 数据面热更新（decide 每次调用经 getter 取当前值——
      // 无滞后窗口）。defaultJudge null（默认被清）→ 置空（auto 档 fail-safe
      // defer）。日志只记 provider/model，key 绝不落日志（对齐 session-config 语义）。
      log(
        `judge-config 广播到达 defaultJudge=${msg.defaultJudge ? `${msg.defaultJudge.provider}/${msg.defaultJudge.model}` : "null"}`
      );
      for (const [sessionKey] of lifecycle.entries()) {
        await refreshJudgeModel(sessionKey, msg);
      }
      break;
    }
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
