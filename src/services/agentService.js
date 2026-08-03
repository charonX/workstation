// src/services/agentService.js
// agent 子进程生命周期的主进程侧服务（tech-design「agentService（主进程）」）。
//
// Slice 1（REQ-AGENT-003/004）只实现配置/身份下发面：
// - createSession：按对话空间创建会话句柄，经 IPC 下发 session-config
//   （{ sessionKey, provider, model, keyRef, systemPrompt }，tech-design IPC 表）；
//   内置身份经 session-config 生效（REQ-AGENT-003 标准 2），systemPrompt 不含
//   任何 secret（REQ-AGENT-003 标准 3）；
// - broadcastConfigUpdate：自定义身份变更 → 存量会话热更新 systemPrompt
//   （re-send session-config + config-ack 回执；provider/key 未变不重建上下文，
//   sessionRef 不变，REQ-AGENT-004 标准 2/3）。
// 子进程 spawn / 看门狗 / prompt / 流式事件在 Slice 2+（REQ-AGENT-005/006）。
//
// IPC 注入（signoff「实现者测试缝契约」内存版快速路径）：
// - 真实传输：{ ipc: { send(msg) } }——主进程 → 子进程；
// - 内存版：{ ipc: { sent: [], acks: [] } }——出站消息进 sent，config-ack 回执
//   进 acks（测试 seam，模拟子进程回执；真实回执来自子进程，Slice 2 接 IPC）。
//
// ADR-009：惰性初始化，无顶层 env/磁盘读取；模块级仅持有活跃服务引用。

import path from "node:path";
import * as settingsService from "./settingsService.js";
import { buildSystemPrompt } from "./agentSystemPrompt.js";

// provider → 默认模型（Slice 2 接入 PI 时对齐 pi-ai provider 模型名）。
const DEFAULT_MODELS = {
  deepseek: "deepseek-chat",
  moonshotai: "kimi-latest",
  "moonshotai-cn": "kimi-latest"
};

// 活跃服务实例：HTTP 路由层经广播函数热更新存量会话（REQ-AGENT-004）。
let activeService = null;

export function getActiveService() {
  return activeService;
}

// 会话句柄：spaceKey → { sessionRef, provider, model, keyRef, identity }。
// keyRef → 明文 key 仅持内存（一次性注入语义，不落盘/不落日志/不进 JSONL，
// tech-design「secret 约束」；Slice 2 由子进程经 IPC 解析）。
export function createAgentService({ ipc }) {
  const sessions = new Map();
  const keySecrets = new Map();

  function sendToChild(message) {
    if (typeof ipc?.send === "function") {
      return ipc.send(message);
    }
    if (Array.isArray(ipc?.sent)) {
      ipc.sent.push(message);
      // 内存版快速路径：模拟子进程 config-ack 回执（真实回执来自子进程）。
      if (Array.isArray(ipc.acks)) {
        ipc.acks.push({ type: "config-ack" });
      }
    }
  }

  // JSONL 会话引用（REQ-AGENT-008 接口契约：sessionRef = JSONL 路径）。
  // 按空间 key 稳定生成——provider/key 未变不重建（REQ-AGENT-004 标准 2）。
  function sessionRefFor(spaceKey) {
    const dir = path.join(settingsService.configDir(), "agent-sessions");
    const safeKey = String(spaceKey).replace(/[^a-zA-Z0-9_-]/g, "_");
    return path.join(dir, `${safeKey}.jsonl`);
  }

  function buildConfigMessage(spaceKey, session) {
    return {
      type: "session-config",
      sessionKey: spaceKey,
      provider: session.provider,
      model: session.model,
      keyRef: session.keyRef,
      systemPrompt: buildSystemPrompt(session.identity)
    };
  }

  const service = {
    // 创建/复用空间会话。已有空间返回同一 sessionRef（不重复下发，复用语义
    // 由 Slice 2 会话分发补全）。identity 未传时取当前全局设置（可空 = 仅内置）。
    createSession({ spaceKey, provider, apiKey, identity }) {
      const existing = sessions.get(spaceKey);
      if (existing) {
        return { sessionRef: existing.sessionRef };
      }
      const keyRef = `key:${provider}`;
      keySecrets.set(keyRef, apiKey);
      const session = {
        sessionRef: sessionRefFor(spaceKey),
        provider,
        model: DEFAULT_MODELS[provider] ?? provider,
        keyRef,
        identity: identity ?? settingsService.loadAgentConfig().identity
      };
      sessions.set(spaceKey, session);
      sendToChild(buildConfigMessage(spaceKey, session));
      return { sessionRef: session.sessionRef };
    },

    // 身份变更 → 存量会话热更新（不重建上下文：sessionRef/keyRef/provider/model
    // 均不变，仅 systemPrompt 重发；REQ-AGENT-004 标准 2）。
    broadcastConfigUpdate({ identity }) {
      if (typeof identity !== "string") return;
      for (const [spaceKey, session] of sessions) {
        session.identity = identity;
        sendToChild(buildConfigMessage(spaceKey, session));
      }
    }
  };

  activeService = service;
  return service;
}

// 供 HTTP 路由（PUT /api/settings/agent 保存身份后）热更新存量会话。
// 无活跃服务（未创建任何会话）时为空操作。
export function broadcastIdentityChange({ identity }) {
  if (activeService) {
    activeService.broadcastConfigUpdate({ identity });
  }
}
