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

  const messageHandler = async (msg) => {
    const { messageId, chatId, senderId, text } = msg || {};
    if (!messageId) return;

    if (!recordInboundMessage(messageId)) {
      // Duplicate message: already processed.
      return;
    }

    const url = extractFirstUrl(text);
    if (!url) {
      try {
        await replyFn({ messageId, text: "发送 http(s) 链接即可速存到素材库" });
      } catch (err) {
        console.error("[imRouter] failed to reply usage hint:", err.message);
      }
      return;
    }

    const binding = channelBindingService.getBinding("feishu");
    if (!binding) {
      try {
        await replyFn({ messageId, text: "未绑定链接速存 flow，请先从模板创建" });
      } catch (err) {
        console.error("[imRouter] failed to reply no-binding hint:", err.message);
      }
      return;
    }

    const flow = flowService.getFlow(binding.flowId);
    if (!flow || flow.status !== "published") {
      try {
        await replyFn({ messageId, text: "链接速存 flow 配置异常（flow 不存在或未发布），请检查模板实例" });
      } catch (err) {
        console.error("[imRouter] failed to reply invalid-binding hint:", err.message);
      }
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
      try {
        await replyFn({ messageId, text: errText });
      } catch (replyErr) {
        console.error("[imRouter] failed to reply enqueue error:", replyErr.message);
      }
      return;
    }

    try {
      await replyFn({ messageId, text: `收到，排队中（第 ${queuePosition} 位）` });
    } catch (err) {
      console.error("[imRouter] failed to reply queue position:", err.message);
    }
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
