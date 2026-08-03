// src/services/agentRouter.js
// agent 优先路由的主进程路由层（tech-design「agentRouter（三纯函数）」；
// REQ-AGENT-002 key 缺失引导）。
//
// Slice 1（REQ-AGENT-002）实现：
// - 命令识别（/status /list /reset /help 直通，不经 LLM）先于 key 检查——
//   未配 key 照常可用（签核决策 7 / REQ-AGENT-002 标准 2）；
// - 未配 key 的对话消息 → reject + E-AGENT-NO-KEY 引导文案（PRD §8），
//   不创建会话行（REQ-AGENT-002 标准 1）；
// - 绑定检查（REQ-AGENT-015，先于命令识别）在 Slice 后续接入。
//
// 纯函数、无副作用。注入：createAgentRouter({ settings })——settings 为配置对象
// 或返回配置的函数（生产传 () => settingsService.loadSettings() 保持实时；
// ADR-009：不顶层读 env/磁盘）。

// 命令集（REQ-AGENT-021/022；/run /cancel 明确不做，PRD §12）。
const SLASH_COMMANDS = new Set(["status", "list", "reset", "help"]);

function parseSlashCommand(message) {
  const trimmed = String(message ?? "").trim();
  if (!trimmed.startsWith("/")) return null;
  const [name, ...args] = trimmed.slice(1).split(/\s+/);
  if (!SLASH_COMMANDS.has(name)) return null;
  return { name, args };
}

export function createAgentRouter({ settings = {} } = {}) {
  const getSettings = typeof settings === "function" ? settings : () => settings;
  return {
    route({ message, chatId, senderId, channelType }) {
      const cfg = getSettings() ?? {};
      const agentCfg = cfg.agent ?? {};

      const command = parseSlashCommand(message);
      if (command) {
        return { action: "command", payload: { command, message } };
      }

      const hasKey =
        agentCfg.configured === true &&
        typeof agentCfg.apiKeyEncrypted === "string" &&
        agentCfg.apiKeyEncrypted.length > 0;
      if (!hasKey) {
        return {
          action: "reject",
          payload: { error: "E-AGENT-NO-KEY", message: "请在设置中配置 Agent API key" }
        };
      }

      return { action: "dialogue", payload: { message, chatId, senderId, channelType } };
    }
  };
}
