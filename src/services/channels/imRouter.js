import { getDb } from "../../db.js";
import * as eventBus from "../eventBus.js";
import * as defaultTaskService from "../taskService.js";
import * as defaultBindingService from "../channelBindingService.js";
import * as defaultFlowService from "../flowService.js";
import * as defaultNotificationService from "../notificationService.js";

function timestamp() {
  return new Date().toISOString();
}

async function writeChannelStatusNotification(notificationService, body, code) {
  try {
    notificationService.notify({
      type: "channel-status",
      title: "通道状态异常",
      body,
      ...(code ? { code } : {})
    });
  } catch (err) {
    console.error("[imRouter] failed to write channel-status notification:", err.message);
  }
}

function recordInboundMessage(messageId) {
  const db = getDb();
  try {
    db.prepare(`
      INSERT INTO channel_messages (messageId, createdAt)
      VALUES (?, ?)
    `).run(messageId, timestamp());
    return true;
  } catch (err) {
    if (err.message && err.message.includes("UNIQUE constraint failed")) {
      return false;
    }
    throw err;
  }
}

function hasFeishuMessageTrigger(flow) {
  return (flow.nodeList || []).some(
    (n) => n.type?.toLowerCase() === "feishumessage"
  );
}

function buildTaskVariables(msg, binding) {
  const { messageId, chatId, senderId, text } = msg || {};
  return {
    projectId: binding.projectId,
    flowId: binding.flowId,
    trigger: "channel",
    variables: {
      text,
      sender: senderId,
      messageId,
      channelReply: { channelType: "feishu", chatId, messageId }
    }
  };
}

function formatEnqueueError(err) {
  const message = err?.message || "";
  if (message.includes("E-QUEUE-FULL") || message.includes("队列已满")) {
    return "队列已满，稍后再发";
  }
  return `入队失败：${message || "请稍后重试"}`;
}

export function createImRouter({
  channelAdapter,
  channelManager,
  baseUrl,
  taskService = defaultTaskService,
  channelBindingService = defaultBindingService,
  flowService = defaultFlowService,
  notificationService = defaultNotificationService,
  agentRouter,
  agentService,
  onSessionEvent,
  onSessionCreated
} = {}) {
  // 监听器去重（code-defect 2 修复）：同一会话句柄（生产 createSession 按 spaceKey
  // 缓存，同空间复用同一句柄）只挂一次 session-event 监听器——修复前每条消息无条件
  // 挂载 → 监听器随消息数累积，单条事件触发 N 次（每轮 sendCard N 次）。
  const sessionListeners = new WeakSet();

  // 会话接线（Slice 7）：agent 流式事件 → 会话卡片渲染器（回复卡片流式，
  // REQ-AGENT-019）——流式事件监听（同句柄只挂一次，code-defect 2）+ 轮次边界
  // 宣告（code-defect 1 生产接线：每条新消息 = 新一轮对话 → 经会话事件通道宣告
  // stream_start，worker 尚未映射 PI turn_start/turn_end，边界由路由层宣告，渲染器
  // 重置上一轮定型状态并为本轮重新发卡）+ 句柄登记（缺口 3：REQ-AGENT-020 标准 3
  // 执行结果回投钩子）。
  function wireSession(spaceKey, session) {
    if (!session || typeof session !== "object") return;
    if (onSessionEvent && typeof session.on === "function") {
      // code-defect 2：同一会话句柄只挂一次监听器（WeakSet 按句柄去重）。
      if (!sessionListeners.has(session)) {
        sessionListeners.add(session);
        session.on("session-event", (ev) => onSessionEvent(spaceKey, ev));
      }
      if (typeof session.emit === "function") {
        session.emit("session-event", { type: "stream_start" });
      }
    }
    // 缺口 3：会话句柄登记（REQ-AGENT-020 标准 3 执行结果回投——会话活跃时
    // execution 终态经 onExecutionResult 驱动 agent 生成摘要回投）。
    if (onSessionCreated) onSessionCreated(spaceKey, session);
  }

  const replyFn = async (payload) => {
    if (channelManager && typeof channelManager.reply === "function") {
      return channelManager.reply("feishu", payload);
    }
    if (channelAdapter && typeof channelAdapter.reply === "function") {
      return channelAdapter.reply(payload);
    }
    throw new Error("E-CHANNEL-CONFIG: no reply channel available");
  };

  async function safeReply(payload, context) {
    try {
      return await replyFn(payload);
    } catch (err) {
      console.error(`[imRouter] failed to reply ${context}:`, err.message);
    }
  }

  // 路由决策已附带回执（绑定成功等系统回执 / 命令回复）：直接回复，不进 agent turn。
  // 返回是否已回复（供调用方决定是否继续分发）。
  async function replyIfAttached(msg, payload, context) {
    if (!payload?.reply) return false;
    await safeReply({ messageId: msg.messageId, text: payload.reply }, context);
    return true;
  }

  // agent 优先路由（REQ-AGENT-017，REQ-CHANNEL-002 接替，2026-08-03 拍板）：
  // 去重后全量进 agentRouter（绑定检查 → 命令识别 → 会话分发），不再因命中
  // channel_bindings 直接 createTask（绑定降级为默认目标候选，agentRouter 侧读取）。
  // agentService 为服务对象或惰性工厂（生产接线：首次对话才创建并 start() 子进程，
  // ADR-009）。路由失败 → 回调内直接返回（复用 REQ-CHANNEL-002 3 秒回调语义）。
  async function routeToAgent(msg) {
    let decision;
    try {
      decision = agentRouter.route({
        message: msg.text,
        text: msg.text,
        chatId: msg.chatId,
        senderId: msg.senderId,
        channelType: msg.channelType ?? "feishu"
      });
    } catch (err) {
      console.error("[imRouter] agentRouter 路由失败:", err.message);
      return;
    }
    const payload = decision?.payload ?? {};
    if (decision.action === "reject") {
      const text = payload.message ?? `操作被拒绝（${payload.error ?? "E-AGENT-REJECT"}）`;
      await safeReply({ messageId: msg.messageId, text }, "agent reject");
      return;
    }
    if (decision.action === "command") {
      // 命令直通（REQ-AGENT-021/022，Slice 6）：路由层已附带回复（用法提示 / help /
      // reset / 同步结果）或异步执行回执（commandReply = 命令执行完成后的真实格式化
      // 回复——生产 /status /list 路径，U2：命令直通不再静默，不经 LLM/agent turn）。
      if (payload.commandReply) {
        const text = await payload.commandReply.catch(() => null);
        if (typeof text === "string" && text.length > 0) {
          await safeReply({ messageId: msg.messageId, text }, "agent command result");
          return;
        }
      }
      await replyIfAttached(msg, payload, "agent command");
      return;
    }
    if (await replyIfAttached(msg, payload, "agent reply")) return;
    if (!agentService) return; // 单元 seam：未接线 agentService 不驱动对话。
    const spaceKey = payload.spaceKey ?? `feishu:${msg.chatId}`;
    const config = payload.sessionConfig ?? {};
    try {
      const svc = typeof agentService === "function" ? await agentService() : agentService;
      const session = svc.createSession({
        spaceKey,
        provider: config.provider,
        apiKey: config.apiKey,
        // U1（Slice 6）：session-config 携带 identity（agentRouter 同源构建——
        // agentService 与路由层从同一 identity 重建 systemPrompt；此前 config.identity
        // 恒 undefined，identity 在链路上丢失，agentService 退化为独立读 settings）。
        identity: config.identity
      });
      // Slice 7：会话接线（流式事件监听 / 轮次边界 / 句柄登记）。
      wireSession(spaceKey, session);
      await svc.prompt(spaceKey, payload.message ?? msg.text).catch((err) => {
        console.error(`[imRouter] agent prompt 失败 session=${spaceKey}:`, err.message);
      });
    } catch (err) {
      console.error("[imRouter] agent dialogue 失败:", err.message);
    }
  }

  const messageHandler = async (msg) => {
    const { messageId } = msg || {};
    if (!messageId) return;

    if (!recordInboundMessage(messageId)) {
      // Duplicate message: already processed.
      return;
    }

    if (agentRouter) {
      // agent 优先路由（REQ-AGENT-017）：去重（沿用 channel_messages）→ agentRouter
      // （绑定检查 → 命令识别 → 会话分发）→ agentService.prompt。
      await routeToAgent(msg);
      return;
    }

    // 未接线 agent 的既有语义（REQ-CHANNEL-002 原样保留：命中绑定 → createTask；
    // 生产接线后不再到达此路径——本分支服务于未注入 agentRouter 的既有调用方）。
    const binding = channelBindingService.getBinding("feishu");
    if (!binding) {
      await safeReply({ messageId, text: "未绑定链接速存 flow，请先从模板创建" }, "no-binding hint");
      return;
    }

    const flow = flowService.getFlow(binding.flowId);
    if (!flow || flow.status !== "published") {
      await safeReply({ messageId, text: "链接速存 flow 配置异常（flow 不存在或未发布），请检查模板实例" }, "invalid-binding hint");
      await writeChannelStatusNotification(notificationService, "链接速存 flow 配置异常（flow 不存在或未发布）");
      return;
    }

    if (!hasFeishuMessageTrigger(flow)) {
      await safeReply({ messageId, text: "链接速存 flow 配置异常（缺少飞书消息触发节点），请检查模板实例" }, "no-trigger hint");
      await writeChannelStatusNotification(
        notificationService,
        "链接速存 flow 配置异常（缺少飞书消息触发节点）",
        "E-CHANNEL-FLOW-NO-TRIGGER"
      );
      return;
    }

    let taskResult;
    try {
      taskResult = taskService.createTask(buildTaskVariables(msg, binding));
    } catch (err) {
      console.error("[imRouter] failed to create task:", err.message);
      await safeReply({ messageId, text: formatEnqueueError(err) }, "enqueue error");
      return;
    }

    const queuePosition = taskResult.queuePosition ?? 1;
    await safeReply({ messageId, text: `收到，排队中（第 ${queuePosition} 位）` }, "queue position");
  };

  let unsubscribe = null;
  if (channelAdapter) {
    channelAdapter.onMessage(messageHandler);
  } else {
    unsubscribe = eventBus.subscribe("channel:message-received", messageHandler);
  }

  return {
    baseUrl,
    stop() {
      if (channelAdapter && typeof channelAdapter.offMessage === "function") {
        channelAdapter.offMessage(messageHandler);
      }
      if (unsubscribe) {
        unsubscribe();
        unsubscribe = null;
      }
    }
  };
}
