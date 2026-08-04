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
  agentService
} = {}) {
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
      // 命令直通（REQ-AGENT-021/022）执行与格式化回复由 Slice 6 落地；此处仅透传
      // 路由层已附带的回复（如有），避免本 slice 吞掉路由结果。
      if (payload.reply) {
        await safeReply({ messageId: msg.messageId, text: payload.reply }, "agent command");
      }
      return;
    }
    if (payload.reply) {
      // 绑定成功等系统回执：直接回复，不进 agent turn。
      await safeReply({ messageId: msg.messageId, text: payload.reply }, "agent reply");
      return;
    }
    if (!agentService) return; // 单元 seam：未接线 agentService 不驱动对话。
    const spaceKey = payload.spaceKey ?? `feishu:${msg.chatId}`;
    const config = payload.sessionConfig ?? {};
    try {
      const svc = typeof agentService === "function" ? await agentService() : agentService;
      svc.createSession({
        spaceKey,
        provider: config.provider,
        apiKey: config.apiKey,
        identity: config.identity
      });
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
