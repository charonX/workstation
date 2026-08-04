// src/services/agentRouter.js
// agent 优先路由的主进程路由层（tech-design「agentRouter（三纯函数）」：
// ①绑定检查 ②命令识别 ③会话分发，D1）。
//
// 覆盖 REQ：
// - REQ-AGENT-002（Slice 1）：命令识别先于 key 检查——斜杠命令未配 key 照常可用
//   （签核决策 7）；未配 key 且尚无绑定的对话 → reject + E-AGENT-NO-KEY 引导。
// - REQ-AGENT-014/015（最小绑定检查，Slice 5 范围）：in-memory 状态机——beginBinding()
//   arming → 下一条未绑定消息绑定发送者（一次性）；已有绑定 → 非绑定者拒绝
//   （E-AUTH-NOT-BOUND，先于命令识别）。settings 持久化 / 有效期 / 解绑 /
//   pendingBind 存 settings JSON 由 Slice 8（REQ-AGENT-014 完整状态机）接管。
//   「尚无任何绑定（settings 无绑定态）→ 不拦截」是 Slice 5 最小形态的既定取舍
//   （parent 指定：以测试断言为准）；REQ-AGENT-015 全量拒绝语义随 Slice 8 落地。
// - REQ-AGENT-017（agent 优先路由，REQ-CHANNEL-002 接替）：会话分发输出
//   { action: "reject" | "command" | "dialogue", payload }；绑定数据仍可读，
//   buildToolContext 把绑定 flow 作为 agent 下发任务的默认目标候选（不再直接触发）。
// - REQ-AGENT-018（会话分发与群聊语义）：spaceKey = feishu:<chatId>（单聊/群聊
//   各自独立）；首次对话附带 session-config（供应商/key/身份）。
//
// 纯函数、无副作用（会话状态除绑定状态机外不落地）。注入：
// createAgentRouter({ settings, bindings, now? })——settings 为配置对象或返回
// 配置的函数（生产传 () => settingsService.loadSettings() 保持实时；缺省按
// ADR-009 惰性读 settingsService）；bindings 为绑定读取服务（缺省真实
// channelBindingService）；now 时钟注入（Slice 8 有效期断言预留，本 slice 未用）。

import * as settingsService from "./settingsService.js";
import { getBinding } from "./channelBindingService.js";
import { decryptSecret } from "./secretStore.js";
import { buildSystemPrompt } from "./agentSystemPrompt.js";

// 命令集（REQ-AGENT-021/022；/run /cancel 明确不做，PRD §12）。
const SLASH_COMMANDS = new Set(["status", "list", "reset", "help"]);

// 缺省供应商（未配置时 session-config 的兜底；对齐 agentService DEFAULT_MODELS）。
const DEFAULT_PROVIDER = "deepseek";
// 未配置 key 时 session-config 的 apiKey 占位（保证「首次对话附带 session-config」
// 契约恒成立；真实 key 仅在配置后注入——REQ-AGENT-018 标准 3 断言要求 apiKey 恒真值）。
const UNCONFIGURED_API_KEY = "NOT_CONFIGURED";
// 绑定成功回执（E3「发消息即绑定」，payload.reply 由 imRouter 直接回复，不进 agent turn）。
const BINDING_SUCCESS_REPLY = "绑定成功：已绑定为操作者，可以开始对话了";

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
    systemPrompt: buildSystemPrompt(agentCfg.identity),
  };
}

export function createAgentRouter({ settings, bindings = { getBinding } } = {}) {
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
  const state = { boundOpenId: null, pendingBind: false };
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

  // ① 绑定检查（REQ-AGENT-015，先于命令识别——签核决策 8）：
  // - arming（beginBinding 置 pendingBind）→ 下一条未绑定消息绑定发送者
  //   （E3「发消息即绑定」，一次性：绑定后清除 pendingBind）；
  // - 已有绑定 → 非绑定者一切消息拒绝（E-AUTH-NOT-BOUND，含命令）；
  // - 尚无任何绑定（settings 无绑定态）→ 不拦截，交给后续检查（Slice 5 最小形态）。
  // 返回路由决策；不构成决策（继续后续步骤）时返回 null。
  const bindingDecision = ({ message, chatId, senderId, channelType }) => {
    if (state.pendingBind && state.boundOpenId === null) {
      state.boundOpenId = senderId;
      state.pendingBind = false;
      return {
        action: "dialogue",
        payload: dialoguePayload({ message, chatId, senderId, channelType }, { reply: BINDING_SUCCESS_REPLY }),
      };
    }
    if (state.boundOpenId !== null && senderId !== state.boundOpenId) {
      return {
        action: "reject",
        payload: {
          error: "E-AUTH-NOT-BOUND",
          message: "请先在设置中绑定操作者，再使用 agent 对话（E-AUTH-NOT-BOUND）",
        },
      };
    }
    return null;
  };

  return {
    route({ message, chatId, senderId, channelType }) {
      const cfg = getSettings() ?? {};
      const agentCfg = cfg.agent ?? {};

      const bound = bindingDecision({ message, chatId, senderId, channelType });
      if (bound) return bound;

      // ② 命令识别（REQ-AGENT-021/022 直通，不经 LLM；未配 key 可用，签核决策 7）。
      const command = parseSlashCommand(message);
      if (command) {
        return { action: "command", payload: { command, message } };
      }

      // ③ 会话分发前 key 检查（REQ-AGENT-002 标准 1）：未配 key 且尚无绑定 →
      // reject + E-AGENT-NO-KEY 引导，不启动会话（agent_sessions 无行）。
      if (!hasConfiguredKey(agentCfg) && state.boundOpenId === null) {
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

    // 绑定 arming（E3 + W-1）：Settings「开始绑定」入口置位，下一条未绑定消息即绑定。
    // 完整状态机（pendingBind 有效期/取消/解绑/存 settings）由 Slice 8 接管。
    beginBinding() {
      state.pendingBind = true;
    },

    // 绑定 flow 作为 agent 下发任务的默认目标候选（REQ-AGENT-017 标准 2）：
    // channel_bindings 不再直接触发（REQ-CHANNEL-002 接替），数据仍可读，
    // 供工具上下文注入（Slice 4 toolAdapter 消费方预留）。
    buildToolContext({ chatId }) {
      const binding = bindings.getBinding("feishu");
      return { defaultTarget: binding ? { flowId: binding.flowId, projectId: binding.projectId } : null };
    },
  };
}
