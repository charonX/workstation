import { getDb } from "../../db.js";
import * as eventBus from "../eventBus.js";
import * as defaultTaskService from "../taskService.js";
import * as defaultBindingService from "../channelBindingService.js";
import * as defaultFlowService from "../flowService.js";
import * as defaultNotificationService from "../notificationService.js";

function timestamp() {
  return new Date().toISOString();
}

function extractFirstUrl(text) {
  if (typeof text !== "string") return null;
  const match = text.match(/https?:\/\/[^\s]+/i);
  return match ? match[0] : null;
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

export function createImRouter({
  channelAdapter,
  channelManager,
  baseUrl,
  taskService = defaultTaskService,
  channelBindingService = defaultBindingService,
  flowService = defaultFlowService,
  notificationService = defaultNotificationService
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

  const messageHandler = async (msg) => {
    const { messageId, chatId, senderId, text } = msg || {};
    if (!messageId) return;

    if (!recordInboundMessage(messageId)) {
      // Duplicate message: already processed.
      return;
    }

    const url = extractFirstUrl(text);
    if (!url) {
      await safeReply({ messageId, text: "发送 http(s) 链接即可速存到素材库" }, "usage hint");
      return;
    }

    const binding = channelBindingService.getBinding("feishu");
    if (!binding) {
      await safeReply({ messageId, text: "未绑定链接速存 flow，请先从模板创建" }, "no-binding hint");
      return;
    }

    const flow = flowService.getFlow(binding.flowId);
    if (!flow || flow.status !== "published") {
      await safeReply({ messageId, text: "链接速存 flow 配置异常（flow 不存在或未发布），请检查模板实例" }, "invalid-binding hint");
      try {
        notificationService.notify({
          type: "channel-status",
          title: "通道状态异常",
          body: "链接速存 flow 配置异常（flow 不存在或未发布）"
        });
      } catch (err) {
        console.error("[imRouter] failed to write channel-status notification:", err.message);
      }
      return;
    }

    const hasFeishuMessageTrigger = (flow.nodeList || []).some(
      (n) => n.type?.toLowerCase() === "feishumessage"
    );
    if (!hasFeishuMessageTrigger) {
      await safeReply({ messageId, text: "链接速存 flow 配置异常（缺少飞书消息触发节点），请检查模板实例" }, "no-trigger hint");
      try {
        notificationService.notify({
          type: "channel-status",
          title: "通道状态异常",
          body: "链接速存 flow 配置异常（缺少飞书消息触发节点）",
          code: "E-CHANNEL-FLOW-NO-TRIGGER"
        });
      } catch (err) {
        console.error("[imRouter] failed to write channel-status notification:", err.message);
      }
      return;
    }

    let queuePosition = 1;
    try {
      const result = taskService.createTask({
        projectId: binding.projectId,
        flowId: binding.flowId,
        trigger: "channel",
        variables: {
          url,
          sender: senderId,
          messageId,
          channelReply: { channelType: "feishu", chatId, messageId }
        }
      });
      queuePosition = result.queuePosition ?? 1;
    } catch (err) {
      console.error("[imRouter] failed to create task:", err.message);
      const errText = (err.message && (err.message.includes("E-QUEUE-FULL") || err.message.includes("队列已满")))
        ? "队列已满，稍后再发"
        : `入队失败：${err.message || "请稍后重试"}`;
      await safeReply({ messageId, text: errText }, "enqueue error");
      return;
    }

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
