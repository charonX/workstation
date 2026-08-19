// REQ-FLOW-032: feishuSend 节点执行器（原 feishuReply）。
// 从 context 读取 imRouter 注入的 channelReply={channelType, chatId, messageId}，
// 对 node.config.content 做 {{fullName}} 变量插值，作为飞书消息体经 channelManager.send/reply 发送。
// 支持 text / post / interactive 等飞书 msg_type；content 为 JSON 字符串，插值后直接透传。
// 无 channelReply 上下文时（手动调试 / schedule 触发）降级为 skipped 而非失败。

const VARIABLE_REF_PATTERN = /\{\{\s*([^{}]+?)\s*\}\}/g;

function interpolate(template, context) {
  if (typeof template !== "string") return template ?? "";
  if (!template.includes("{{")) return template;
  return template.replace(VARIABLE_REF_PATTERN, (_match, fullName) => {
    const value = context[fullName.trim()];
    if (value === undefined || value === null) return "";
    // 插值进 JSON 字符串时，字符串值需转义引号/反斜杠/换行/控制字符。
    if (typeof value === "string") return JSON.stringify(value).slice(1, -1);
    return String(value);
  });
}

function parseContent(rawContent) {
  if (typeof rawContent !== "string" || !rawContent.trim()) return null;
  try {
    return JSON.parse(rawContent);
  } catch {
    // Fallback: treat plain text as a text message body.
    return { text: rawContent };
  }
}

export async function feishuSendExecutor({ node, context, services, options }) {
  const log = (message) => ({ at: new Date().toISOString(), message });
  const logs = [];

  const channelReply = context?.channelReply;
  if (!channelReply || !channelReply.chatId) {
    logs.push(log("feishuSend: no channelReply in context; node skipped"));
    return {
      status: "success",
      output: "skipped",
      logs,
      outputVariables: { skipped: true }
    };
  }

  const msgType = node.config?.msgType || "text";
  const rawContent = node.config?.content ?? node.config?.text ?? "";
  const interpolated = interpolate(rawContent, context);
  const content = parseContent(interpolated);

  if (!content) {
    logs.push(log("feishuSend: empty content after interpolation; node skipped"));
    return {
      status: "success",
      output: "skipped",
      logs,
      outputVariables: { skipped: true }
    };
  }

  const channelSender = services?.channelSender;
  if (!channelSender) {
    const message = "feishuSend: E-CHANNEL-UNAVAILABLE: channelSender service not available";
    return { status: "error", error: message, logs: [log(message)] };
  }

  const channelType = channelReply.channelType || "feishu";
  const replyToOriginal = node.config?.replyToMessage !== false; // default true

  try {
    if (replyToOriginal && channelReply.messageId) {
      await channelSender.reply(channelType, {
        messageId: channelReply.messageId,
        msgType,
        content: JSON.stringify(content)
      });
    } else {
      await channelSender.send(channelType, {
        chatId: channelReply.chatId,
        msgType,
        content: JSON.stringify(content)
      });
    }
    logs.push(log(`feishuSend: sent ${msgType} (reply=${replyToOriginal})`));
    return {
      status: "success",
      output: JSON.stringify(content),
      logs,
      outputVariables: { sent: true, msgType, content }
    };
  } catch (err) {
    const message = `feishuSend: send failed: ${err.message}`;
    logs.push(log(message));
    return { status: "error", error: message, logs };
  }
}
