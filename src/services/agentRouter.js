// src/services/agentRouter.js
// agent 优先路由的主进程路由层（tech-design「agentRouter（三纯函数）」：
// ①绑定检查 ②命令识别 ③会话分发，D1）。
//
// 覆盖 REQ：
// - REQ-AGENT-002（Slice 1）：命令识别先于 key 检查——斜杠命令未配 key 照常可用
//   （签核决策 7）；未配 key 且尚无绑定的对话 → reject + E-AGENT-NO-KEY 引导。
// - REQ-AGENT-014/015（Slice 8 完整状态机，E3 + W-1）：绑定状态持久化于 settings
//   JSON——`boundOpenId`（open_id 字段）与 `pendingBind: { createdAt, expiresAt }`
//   （一次性 + 10 分钟有效期，签核修订②；createdAt/expiresAt 为 epoch ms，now 时钟
//   可注入断言）。路由顺序：①绑定检查 → ②命令识别 → ③key 检查 → ④会话分发。
//   - beginBinding() arming（Settings「开始绑定」入口，置 pendingBind）→ 下一条
//     未绑定消息绑定发送者（E3「发消息即绑定」，一次性：绑定后清除 pendingBind）；
//   - 已有绑定 → 非绑定者一切消息拒绝（E-AUTH-NOT-BOUND，先于命令识别，签核决策 8）；
//   - **无绑定态未绑定用户一切消息（含查询与命令）→ E-AUTH-NOT-BOUND 拒绝**
//     （REQ-AGENT-015 全量拒绝语义，2026-08-03 拍板；先于命令识别与会话分发，
//     不创建会话行）——agentConfig.test.js REQ-AGENT-002 与 imRouting AC6 的
//     无绑定态 E-AGENT-NO-KEY 断言由本语义接替（Slice 8 裁决：绑定检查先于 key）；
//   - 已绑定用户未配 key → 对话（非命令）回复 E-AGENT-NO-KEY 引导（REQ-AGENT-002，
//     签核文案「请在设置中配置 Agent API key」），不启动 agent 会话；命令直通
//     未配 key 照常可用（签核决策 7）；
//   - unbind()（Settings 解绑）/ cancelBinding()（取消 arming）→ 回未绑定态可重走
//     引导（签核决策 10）。
// - REQ-AGENT-017（agent 优先路由，REQ-CHANNEL-002 接替）：会话分发输出
//   { action: "reject" | "command" | "dialogue", payload }；绑定数据仍可读，
//   buildToolContext 把绑定 flow 作为 agent 下发任务的默认目标候选（不再直接触发）。
// - REQ-AGENT-018（会话分发与群聊语义）：spaceKey = feishu:<chatId>（单聊/群聊
//   各自独立）；首次对话附带 session-config（供应商/key/身份）。
// - REQ-AGENT-021/022（Slice 6 命令直通）：斜杠命令 /status /list /reset /help——
//   主进程路由层直接调命令模块（不经 LLM/agent 进程，签核决策 7）；参数校验（签核
//   决策 6：/status <UUID>、/list [projectId|flowId] 可选过滤、/reset /help 无参）
//   → 非法 E-CMD-INVALID 用法提示；未配 key 可用（REQ-AGENT-002 标准 2 回归）；
//   /reset 复用 REQ-AGENT-010 语义（sessionStore.reset，仅当前空间，签核决策 17）；
//   /help 返回命令集与用法。
//
// 命令执行（U2：生产路径命令不再静默）：commands 为命令模块执行层注入
// （test seam：{ execute(name, args) }；生产缺省 = createCommandExecutor(baseUrl)——
// C2 路径：进程内 import 命令模块 → HTTP API（ADR-001）→ services，与 toolAdapter
// 同形态）。execute 返回 { output, notFound?, errorCode?, errorMessage? }（同步值或
// Promise）。route() 同步返回决策：同步结果 → 格式化回复进 payload.reply；异步结果
// → payload.reply = 受理提示 + payload.commandReply = 执行完成后的真实格式化回复
// （imRouter 经 channel reply 回投——命令直通不占 LLM/agent turn）。
//
// U1（Slice 6 顺手统一）：session-config 同源重建——路由层 buildSessionConfig 与
// agentService 均从**同一 identity 值**构建 systemPrompt：sessionConfig 携带
// identity（agentCfg.identity），imRouter 透传 agentService.createSession →
// buildConfigMessage 重建 systemPrompt（行为不变，消除链路上 identity 丢失导致的
// 双源设置读取）。
//
// 纯函数、无副作用（绑定状态机经 settings 持久化；route 决策本身无副作用）。注入：
// createAgentRouter({ settings, bindings, commands?, sessionStore?, baseUrl?, now? })
// ——settings 为配置对象或返回配置的函数（生产传 () => settingsService.loadSettings()
// 保持实时；缺省按 ADR-009 惰性读 settingsService）；bindings 为绑定读取服务（缺省
// 真实 channelBindingService）；commands 为命令执行层（缺省 = createCommandExecutor
// (baseUrl)，C2 路径）；sessionStore 为会话存储对象或惰性工厂（/reset 用，
// REQ-AGENT-010）；baseUrl 为本地 HTTP API（命令执行层直连 seam，生产由 server.js
// 注入）；now 为时钟注入（pendingBind 有效期断言，缺省 Date.now()）。

import * as settingsService from "./settingsService.js";
import { getBinding } from "./channelBindingService.js";
import { decryptSecret } from "./secretStore.js";
import { buildSystemPrompt } from "./agentSystemPrompt.js";
import * as taskCommand from "../cli/commands/task.js";
import { setServerBaseUrlOverride, getServerBaseUrlOverride } from "../cli/server.js";

// 命令集（REQ-AGENT-021/022；/run /cancel 明确不做，PRD §12）。
const SLASH_COMMANDS = new Set(["status", "list", "reset", "help"]);

// 缺省供应商（未配置时 session-config 的兜底；对齐 agentService DEFAULT_MODELS）。
const DEFAULT_PROVIDER = "deepseek";
// 未配置 key 时 session-config 的 apiKey 占位（保证「首次对话附带 session-config」
// 契约恒成立；真实 key 仅在配置后注入——REQ-AGENT-018 标准 3 断言要求 apiKey 恒真值）。
const UNCONFIGURED_API_KEY = "NOT_CONFIGURED";
// 绑定成功回执（E3「发消息即绑定」，payload.reply 由 imRouter 直接回复，不进 agent turn）。
const BINDING_SUCCESS_REPLY = "绑定成功：已绑定为操作者，可以开始对话了";
// 未绑定用户拒绝回执（REQ-AGENT-015 全量拒绝：一切消息含查询与命令，先于命令识别；
// 引导文案指向 Settings——「请先在设置中绑定操作者」，签核决策 8）。
const UNBOUND_REJECT_REPLY =
  "请先在设置中绑定操作者，再使用 agent 对话（E-AUTH-NOT-BOUND）";

// 执行 id 格式（签核决策 6）：execution.id = crypto.randomUUID()（非整数）。
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// /help 命令集与用法（REQ-AGENT-022 标准 2）。
const HELP_TEXT = [
  "可用命令：",
  "/status <executionId> — 查询执行状态（executionId 为 UUID）",
  "/list [projectId|flowId] — 列出执行记录（可选过滤参数）",
  "/reset — 重置当前对话空间会话",
  "/help — 显示本帮助",
].join("\n");

function parseSlashCommand(message) {
  const trimmed = String(message ?? "").trim();
  if (!trimmed.startsWith("/")) return null;
  const [name, ...args] = trimmed.slice(1).split(/\s+/);
  if (!SLASH_COMMANDS.has(name)) return null;
  return { name, args };
}

// key 已加密存储（非空密文）——路由 key 检查与 session-config 解密的共同前置条件。
function hasEncryptedApiKey(agentCfg) {
  return typeof agentCfg.apiKeyEncrypted === "string" && agentCfg.apiKeyEncrypted.length > 0;
}

// 完整已配置判定（REQ-AGENT-001 configured 标记 + 非空密文）。
function hasConfiguredKey(agentCfg) {
  return agentCfg.configured === true && hasEncryptedApiKey(agentCfg);
}

// session-config（REQ-AGENT-018 标准 3：供应商/key/身份，一次性注入语义——
// key 明文仅经本函数解密进入内存，不落盘/不落日志，签核决策 5）。
// U1：携带 identity（agentCfg.identity）——agentService 与路由层从同一 identity
// 重建 systemPrompt（同源重建；systemPrompt 字段保持，agentRoute 断言恒真）。
function buildSessionConfig(agentCfg) {
  const provider = agentCfg.provider || DEFAULT_PROVIDER;
  let apiKey = UNCONFIGURED_API_KEY;
  if (hasEncryptedApiKey(agentCfg)) {
    try {
      apiKey = decryptSecret(agentCfg.apiKeyEncrypted);
    } catch {
      // 后端不可用（无 safeStorage 环境）→ 占位，不阻断路由（REQ-AGENT-002 引导兜底）。
      apiKey = UNCONFIGURED_API_KEY;
    }
  }
  return {
    provider,
    apiKey,
    identity: agentCfg.identity,
    systemPrompt: buildSystemPrompt(agentCfg.identity),
  };
}

// 命令用法提示（签核决策 6：/status <UUID>、/list [projectId|flowId] 可选过滤、
// /reset /help 无参；非法参数随 E-CMD-INVALID 下发，payload.code = "E-CMD-INVALID"）。
const COMMAND_USAGE = {
  status: "用法：/status <executionId>（E-CMD-INVALID）",
  list: "用法：/list [projectId|flowId]（E-CMD-INVALID）",
  reset: "用法：/reset（E-CMD-INVALID）",
  help: "用法：/help（E-CMD-INVALID）",
};

// —— 命令参数校验（PRD §7 / 签核决策 6）——
// 非法 → E-CMD-INVALID 用法提示（payload.code = "E-CMD-INVALID"）；合法 → null。
// /status 必须恰好 1 参且为 UUID；/list 至多 1 参（过滤）；/reset /help 无参。
function validateCommand(command) {
  const { name, args } = command;
  if (name === "status") {
    if (args.length !== 1) return COMMAND_USAGE.status;
    if (!UUID_RE.test(args[0])) {
      return `${COMMAND_USAGE.status}，executionId 需为 UUID 格式`;
    }
    return null;
  }
  const usage = COMMAND_USAGE[name];
  if (!usage) return null; // 未知命令（parseSlashCommand 已过滤，防御性兜底）
  return args.length > (name === "list" ? 1 : 0) ? usage : null;
}

// 命令执行错误归一化（E-AGENT-CLI-ERROR 兜底）：executor 与 handleCommand 共用。
// 返回结构化结果 { output: null, errorCode, errorMessage }。
function toCommandError(err) {
  return { output: null, errorCode: err?.code ?? "E-AGENT-CLI-ERROR", errorMessage: err?.message ?? String(err) };
}

// —— 命令结果格式化（REQ-AGENT-021：格式化回复）——
// result = { output, notFound?, errorCode?, errorMessage? }（同步值或异步解析值）。
function formatCommandReply(name, args, result) {
  if (result?.errorCode) {
    return `${name === "status" ? "查询" : "列出"}失败（${result.errorCode}）：${result.errorMessage ?? "未知原因"}`;
  }
  if (name === "status") {
    const id = args[0];
    if (result?.notFound === true) return `查无此执行：${id}`;
    const ex = result?.output;
    if (typeof ex === "string") return ex; // 执行层已提供格式化文本
    if (ex && typeof ex === "object") {
      const parts = [`执行 ${ex.id ?? id}：状态 ${ex.status ?? "未知"}`];
      if (ex.flowName && ex.flowName !== ex.flowId) parts.push(`流程 ${ex.flowName}`);
      else if (ex.flowId) parts.push(`流程 ${ex.flowId}`);
      if (ex.projectName && ex.projectName !== ex.projectId) parts.push(`项目 ${ex.projectName}`);
      if (ex.startedAt) parts.push(`开始于 ${ex.startedAt}`);
      if (ex.endedAt) parts.push(`结束于 ${ex.endedAt}`);
      return parts.join("，");
    }
    return `执行 ${id}：状态未知（无结果）`;
  }
  // list：执行列表摘要（可过滤 projectId|flowId，REQ-AGENT-021 标准 3）。
  const filter = args[0];
  const list = Array.isArray(result?.output) ? result.output : [];
  const filtered = filter ? list.filter((e) => e.projectId === filter || e.flowId === filter) : list;
  if (filtered.length === 0) {
    return filter ? `没有找到 ${filter} 的执行记录` : "（暂无执行记录）";
  }
  return filtered.map(formatListLine).join("\n");
}

// 执行列表摘要行（无值的字段省略尾随空格）。
function formatListLine(e) {
  return `- ${e.id} ${e.status ?? "?"} ${e.flowName ?? e.flowId ?? "?"} ${e.startedAt ?? ""}`.trimEnd();
}

// /status 查询（404 → 查无此执行，REQ-AGENT-021 标准 2 明确回复）。
async function getExecutionOrNotFound(id) {
  try {
    return { output: await taskCommand.getExecution({ id }) };
  } catch (err) {
    if (err?.status === 404) return { output: null, notFound: true };
    throw err;
  }
}

// —— 生产命令执行层（C2 路径，U2：命令直通不再静默）——
// 与 toolAdapter 同形态：进程内 import 命令模块 → HTTP API（ADR-001）→ services；
// baseUrl 经 setServerBaseUrlOverride seam 直连本地 server（主进程注册表发现按 ppid
// 归属不适用于主进程自身——注入显式 baseUrl 避免误 spawn headless server）。
// 返回结构化结果 { output, notFound?, errorCode?, errorMessage? }。
function createCommandExecutor({ baseUrl } = {}) {
  return {
    async execute(name, args) {
      const prev = getServerBaseUrlOverride();
      setServerBaseUrlOverride(baseUrl ?? null);
      try {
        if (name === "status") return await getExecutionOrNotFound(args[0]);
        if (name === "list") return { output: await taskCommand.listExecutions() };
        return { output: null, errorCode: "E-CMD-UNSUPPORTED", errorMessage: `不支持的命令：${name}` };
      } catch (err) {
        return toCommandError(err);
      } finally {
        setServerBaseUrlOverride(prev);
      }
    },
  };
}

// 命令决策包装（REQ-AGENT-017 输出模型：payload = { command, message, ...extra }）。
function commandDecision(command, message, extra = {}) {
  return { action: "command", payload: { command, message, ...extra } };
}

// ② 命令识别 → 直通（REQ-AGENT-021/022）：主进程内调命令模块/服务，不经
// LLM/agent 进程（签核决策 7）；未配 key 可用（REQ-AGENT-002 标准 2）。
// 校验非法 → E-CMD-INVALID 用法提示（不执行命令）；合法 → 执行：
// - 同步结果 → 格式化回复（payload.reply）；
// - 异步结果（生产命令模块路径）→ payload.reply = 受理提示 +
//   payload.commandReply = 执行完成后的真实格式化回复（imRouter 回投，U2）。
// 依赖注入：executor（命令执行层）、getStore（会话存储惰性工厂）、spaceKeyFor。
function handleCommand(command, { message, chatId }, { executor, getStore, spaceKeyFor }) {
  const invalid = validateCommand(command);
  if (invalid) {
    return commandDecision(command, message, { reply: invalid, code: "E-CMD-INVALID" });
  }
  if (command.name === "help") {
    return commandDecision(command, message, { reply: HELP_TEXT });
  }
  if (command.name === "reset") {
    // /reset 复用 REQ-AGENT-010 语义：sessionStore.reset（仅当前空间，签核决策 17）；
    // agentService 经 store.onReset 清上下文 + IPC reset-session（Slice 3 已接线）。
    const store = getStore();
    if (store?.reset) store.reset(spaceKeyFor(chatId));
    return commandDecision(command, message, { reply: "已重置当前对话空间会话，可以开始新对话了" });
  }
  // status / list：命令模块执行层（C2 直通）。
  let result;
  try {
    result = executor.execute(command.name, command.args);
  } catch (err) {
    result = toCommandError(err);
  }
  if (result && typeof result.then === "function") {
    // 异步执行：route 同步返回受理提示；真实格式化回复经 commandReply 由 imRouter 回投
    // （U2：生产 /status /list 命令直通不再静默）。
    const replyPromise = Promise.resolve(result).then(
      (r) => formatCommandReply(command.name, command.args, r),
      (err) => formatCommandReply(command.name, command.args, toCommandError(err))
    );
    const argText = command.args.length ? ` ${command.args.join(" ")}` : "";
    return commandDecision(command, message, {
      reply: `命令已受理：/${command.name}${argText}`,
      commandReply: replyPromise,
    });
  }
  return commandDecision(command, message, { reply: formatCommandReply(command.name, command.args, result) });
}

export function createAgentRouter({
  settings,
  bindings = { getBinding },
  commands,
  sessionStore,
  baseUrl,
  now,
} = {}) {
  // settings 注入优先级：函数（生产实时读取）→ 对象（测试桩）→ 缺省惰性读
  // settingsService（ADR-009：不顶层读 env/磁盘）。
  let getSettings;
  if (typeof settings === "function") {
    getSettings = settings;
  } else if (settings && typeof settings === "object") {
    getSettings = () => settings;
  } else {
    getSettings = () => settingsService.loadSettings();
  }
  // 命令执行层：注入（测试 seam / 生产显式接线）优先；缺省 = 真实命令模块（C2）。
  const executor = commands ?? createCommandExecutor({ baseUrl });
  // 会话存储：对象或惰性工厂（生产共享 agentService 的 store，/reset 用 REQ-AGENT-010）。
  const getStore = () => (typeof sessionStore === "function" ? sessionStore() : sessionStore);

  // 时钟注入（pendingBind 有效期断言，签核修订②；缺省 Date.now()）。
  const clock = typeof now === "function" ? now : () => Date.now();

  // —— 绑定状态机（REQ-AGENT-014 E3 + W-1；settings JSON 持久化）——
  // boundOpenId：settings.boundOpenId（open_id 字段）；pendingBind：
  // settings.pendingBind = { createdAt, expiresAt }（epoch ms，一次性 + 10 分钟）。
  const PENDING_BIND_TTL_MS = 10 * 60 * 1000;

  // 绑定状态读取：boundOpenId（null = 未绑定）；pendingBind 有效（未过期）时返回
  // { createdAt, expiresAt }，过期视为未置位（只读判定，不落盘清除——getBindingStatus
  // 与 route 共用同一判定）。
  function readBindingStatus() {
    const s = getSettings() ?? {};
    const boundOpenId = typeof s.boundOpenId === "string" && s.boundOpenId !== "" ? s.boundOpenId : null;
    const pending = s.pendingBind;
    const pendingBind =
      pending && typeof pending === "object" && typeof pending.expiresAt === "number" && clock() < pending.expiresAt
        ? { createdAt: pending.createdAt, expiresAt: pending.expiresAt }
        : null;
    return { boundOpenId, pendingBind };
  }

  // 绑定状态写入（settings 注入形态自适应：函数/缺省 → settingsService；对象 → 原地）。
  // 清除语义：传 null 显式覆盖（saveSettings 只合并，不能删键——null 落盘后
  // readBindingStatus 视为未绑定/未置位）。
  function persistBinding({ boundOpenId, pendingBind }) {
    const patch = {
      ...(boundOpenId === undefined ? {} : { boundOpenId }),
      ...(pendingBind === undefined ? {} : { pendingBind }),
    };
    if (typeof settings === "function" || settings === undefined) {
      settingsService.saveSettings(patch);
    } else if (settings && typeof settings === "object") {
      Object.assign(settings, patch);
    }
  }

  const spaceKeyFor = (chatId) => `feishu:${chatId}`;

  // dialogue payload 基底（spaceKey/消息/身份四元组）；绑定回执与 session-config
  // 经 extra 扩展，避免两处分发重复构建。
  const dialoguePayload = ({ message, chatId, senderId, channelType }, extra) => ({
    spaceKey: spaceKeyFor(chatId),
    message,
    senderId,
    chatId,
    channelType,
    ...extra,
  });

  // ① 绑定检查（REQ-AGENT-015，先于命令识别——签核决策 8；Slice 8 全量拒绝语义）：
  // - arming（beginBinding 置 pendingBind，未过期）→ 下一条未绑定消息绑定发送者
  //   （E3「发消息即绑定」，一次性：绑定后清除 pendingBind + 回复「绑定成功」）；
  // - 已有绑定 → 非绑定者一切消息拒绝（E-AUTH-NOT-BOUND，含命令）；
  // - 无绑定态 → 未绑定用户**一切消息**（含查询与命令）→ E-AUTH-NOT-BOUND 拒绝
  //   （REQ-AGENT-015 标准 1/2：先于命令识别与会话分发，不启动会话不执行命令；
  //   引导文案指向 Settings——「请先在设置中绑定操作者」）。
  // 返回路由决策；已绑定且为绑定者本人时返回 null（继续后续步骤）。
  const bindingDecision = ({ message, chatId, senderId, channelType }) => {
    const { boundOpenId, pendingBind } = readBindingStatus();
    if (pendingBind && boundOpenId === null) {
      persistBinding({ boundOpenId: senderId, pendingBind: null });
      return {
        action: "dialogue",
        payload: dialoguePayload({ message, chatId, senderId, channelType }, { reply: BINDING_SUCCESS_REPLY }),
      };
    }
    if (boundOpenId !== null && senderId !== boundOpenId) {
      return {
        action: "reject",
        payload: {
          error: "E-AUTH-NOT-BOUND",
          message: "请先在设置中绑定操作者，再使用 agent 对话（E-AUTH-NOT-BOUND）",
        },
      };
    }
    if (boundOpenId === null) {
      return {
        action: "reject",
        payload: { error: "E-AUTH-NOT-BOUND", message: UNBOUND_REJECT_REPLY },
      };
    }
    return null;
  };

  return {
    route({ message, chatId, senderId, channelType }) {
      const cfg = getSettings() ?? {};
      const agentCfg = cfg.agent ?? {};

      const command = parseSlashCommand(message);
      const bound = bindingDecision({ message, chatId, senderId, channelType });
      if (bound) return bound;

      // ② 命令识别（REQ-AGENT-021/022 直通，不经 LLM；未配 key 可用，签核决策 7）。
      if (command) {
        return handleCommand(command, { message, chatId }, { executor, getStore, spaceKeyFor });
      }

      // ③ 会话分发前 key 检查（REQ-AGENT-002 标准 1，Slice 8 裁决后语义）：
      // 已绑定用户未配 key → 对话（非命令）回复 E-AGENT-NO-KEY 引导，不启动会话
      // （无绑定态未绑定用户已被 ① E-AUTH-NOT-BOUND 拒绝——绑定检查先于 key）。
      if (!hasConfiguredKey(agentCfg)) {
        return {
          action: "reject",
          payload: { error: "E-AGENT-NO-KEY", message: "请在设置中配置 Agent API key" },
        };
      }

      // ④ 会话分发（REQ-AGENT-018）：spaceKey = feishu:<chatId>（单聊/群聊各自独立）；
      // 首次对话附带 session-config（供应商/key/身份）——空间不存在由 agentService
      // createSession 自动创建（SQLite agent_sessions 行 + PI JSONL，REQ-AGENT-008）。
      return {
        action: "dialogue",
        payload: dialoguePayload(
          { message, chatId, senderId, channelType },
          { sessionConfig: buildSessionConfig(agentCfg) }
        ),
      };
    },

    // 绑定 arming（E3 + W-1）：Settings「开始绑定」入口置位（一次性 + 10 分钟有效期，
    // 签核修订②），下一条未绑定消息即绑定。已绑定状态不重复 arming（Settings 已显示
    // 已绑定，无入口）。
    beginBinding() {
      const { boundOpenId } = readBindingStatus();
      if (boundOpenId !== null) return;
      const nowMs = clock();
      persistBinding({ pendingBind: { createdAt: nowMs, expiresAt: nowMs + PENDING_BIND_TTL_MS } });
    },

    // 取消 arming（REQ-AGENT-014 标准 5：可取消；取消后不生效）。
    cancelBinding() {
      persistBinding({ pendingBind: null });
    },

    // 解绑（REQ-AGENT-014 标准 4：Settings 解绑 → 回未绑定态，引导流程可重来；
    // 同时清除残留 pendingBind，回到干净初始态）。
    unbind() {
      persistBinding({ boundOpenId: null, pendingBind: null });
    },

    // 绑定状态（Settings Agent 区展示）：{ bound, openId?, pendingBind? }。
    getBindingStatus() {
      const { boundOpenId, pendingBind } = readBindingStatus();
      return {
        bound: boundOpenId !== null,
        ...(boundOpenId !== null ? { openId: boundOpenId } : {}),
        ...(pendingBind ? { pendingBind } : {}),
      };
    },

    // 绑定 flow 作为 agent 下发任务的默认目标候选（REQ-AGENT-017 标准 2）：
    // channel_bindings 不再直接触发（REQ-CHANNEL-002 接替），数据仍可读，
    // 供工具上下文注入（Slice 8 G1 接线：imRouter → session-config toolContext →
    // worker toolSurface 消费）。
    buildToolContext({ chatId }) {
      const binding = bindings.getBinding("feishu");
      return { defaultTarget: binding ? { flowId: binding.flowId, projectId: binding.projectId } : null };
    },
  };
}
