import { WSClient, EventDispatcher } from "@larksuiteoapi/node-sdk";

const MAX_SEND_ATTEMPTS = 3;
const FEISHU_APP_ID_RE = /^cli_[0-9a-fA-F]{16}$/;

function createLogger(baseLogger) {
  const sink = baseLogger || console;
  const redact = (msg) => {
    if (typeof msg !== "string") return msg;
    return msg.replace(/appSecret['"]?\s*[:=]\s*['"]?[^\s'",}]+/gi, "appSecret=***");
  };
  return {
    info: (...args) => {
      if (typeof sink.info === "function") {
        sink.info(...args.map(redact));
      } else if (typeof sink.log === "function") {
        sink.log(...args.map(redact));
      }
    },
    error: (...args) => {
      if (typeof sink.error === "function") {
        sink.error(...args.map(redact));
      } else if (typeof sink.log === "function") {
        sink.log(...args.map(redact));
      }
    }
  };
}

export function createFeishuChannelAdapter({ domain, credentials, notificationService, logger } = {}) {
  if (!domain) throw new Error("E-CHANNEL-CRED: domain is required");
  if (!credentials?.appId || !credentials?.appSecret) {
    throw new Error("E-CHANNEL-CRED: appId and appSecret are required");
  }

  const baseUrl = domain.replace(/\/$/, "");
  const log = createLogger(logger);
  const messageListeners = new Set();
  const statusListeners = new Set();

  let status = "offline";
  let tenantAccessToken = null;
  let wsClient = null;
  let reconnectTimer = null;

  function setStatus(next, reason) {
    const previousStatus = status;
    status = next;
    for (const cb of statusListeners) {
      try {
        cb({ status: next, previousStatus, reason });
      } catch (err) {
        log.error("[feishuChannelAdapter] status listener error:", err.message);
      }
    }
  }

  function notifyChannelStatus(title, body) {
    if (!notificationService) return;
    try {
      notificationService.notify({ type: "channel-status", title, body });
    } catch (err) {
      log.error("[feishuChannelAdapter] failed to write channel-status notification:", err.message);
    }
  }

  function closeWebSocketClient(context = "") {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (wsClient) {
      try {
        wsClient.close({ force: true });
      } catch (err) {
        const suffix = context ? ` in ${context}` : "";
        log.error(`[feishuChannelAdapter] failed to close WSClient${suffix}:`, err.message);
      }
      wsClient = null;
    }
  }

  async function fetchTenantAccessToken() {
    const url = `${baseUrl}/open-apis/auth/v3/tenant_access_token/internal`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ app_id: credentials.appId, app_secret: credentials.appSecret })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.code !== 0 || !data.tenant_access_token) {
      const err = new Error(`E-CHANNEL-CRED: failed to obtain tenant access token (${data.code ?? res.status})`);
      err.code = "E-CHANNEL-CRED";
      throw err;
    }
    tenantAccessToken = data.tenant_access_token;
    return tenantAccessToken;
  }

  function authorizationHeader() {
    return { Authorization: `Bearer ${tenantAccessToken}` };
  }

  async function postJson(url, body, headers = {}) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body)
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok && data.code === 0, status: res.status, data };
  }

  async function sendWithRetry(operation) {
    let lastError;
    for (let attempt = 1; attempt <= MAX_SEND_ATTEMPTS; attempt++) {
      try {
        const result = await operation();
        if (result.ok) return result.data;
        lastError = new Error(`feishu API error: ${result.status}`);
      } catch (err) {
        lastError = err;
      }
    }
    const err = new Error(`E-CHANNEL-SEND: failed after ${MAX_SEND_ATTEMPTS} attempts: ${lastError?.message}`);
    err.code = "E-CHANNEL-SEND";
    throw err;
  }

  function mapInboundMessage(eventData) {
    // EventDispatcher.parse() spreads v2 schema event.header and event.event
    // to the top level (node-sdk EventDispatcher.parse line 93585), so message
    // and sender live directly on eventData. Fall back to the legacy v1 shape
    // (.event.message / .event.sender) for backward compatibility.
    const message = eventData?.message || eventData?.event?.message;
    if (!message) return null;
    let text = "";
    try {
      const content = typeof message.content === "string" ? JSON.parse(message.content) : message.content;
      text = content?.text || "";
    } catch {
      text = typeof message.content === "string" ? message.content : "";
    }
    const senderObj = eventData?.sender?.sender_id || eventData?.event?.sender?.sender_id;
    return {
      messageId: message.message_id,
      chatId: message.chat_id,
      // Prefer open_id (stable across app re-installs) over user_id.
      senderId: senderObj?.open_id || senderObj?.user_id || senderObj?.union_id,
      text
    };
  }

  async function startWebSocketClient() {
    if (!FEISHU_APP_ID_RE.test(credentials.appId)) {
      // Non-production appId (e.g. test fixtures) cannot pass WSClient validation;
      // rely on the REST seam and test injection instead.
      log.info("[feishuChannelAdapter] appId does not match production format; WebSocket client skipped");
      return;
    }

    const dispatcher = new EventDispatcher({});
    dispatcher.register({
      "im.message.receive_v1": (data) => {
        const msg = mapInboundMessage(data);
        if (msg) {
          for (const cb of messageListeners) {
            try {
              cb(msg);
            } catch (err) {
              log.error("[feishuChannelAdapter] message listener error:", err.message);
            }
          }
        }
      }
    });

    wsClient = new WSClient({
      appId: credentials.appId,
      appSecret: credentials.appSecret,
      domain: baseUrl,
      logger: logger || console,
      autoReconnect: true,
      onReady: () => {
        setStatus("online", "websocket ready");
        log.info("[feishuChannelAdapter] WebSocket ready");
      },
      onError: (err) => {
        setStatus("offline", err?.message || "websocket error");
        notifyChannelStatus("通道掉线", "飞书通道长连接断开且重连失败，请检查凭据与网络");
        log.error("[feishuChannelAdapter] WebSocket error:", err?.message);
      },
      onReconnecting: () => {
        setStatus("connecting", "reconnecting");
        log.info("[feishuChannelAdapter] WebSocket reconnecting");
      },
      onReconnected: () => {
        setStatus("online", "reconnected");
        notifyChannelStatus("通道已恢复", "飞书通道已恢复在线");
        log.info("[feishuChannelAdapter] WebSocket reconnected");
      }
    });

    // Start WSClient in the background; initial handshake failures are surfaced
    // through onError / status change rather than rejecting start().
    wsClient.start({ eventDispatcher: dispatcher }).catch((err) => {
      log.error("[feishuChannelAdapter] failed to start WSClient:", err.message);
    });
  }

  return {
    getStatus() {
      return status;
    },

    async start() {
      if (status === "connecting") {
        // Already in progress; do not double-start.
        return;
      }
      setStatus("connecting");
      try {
        await fetchTenantAccessToken();
      } catch (err) {
        setStatus("offline", err.message);
        log.error("[feishuChannelAdapter] start failed:", err.message);
        throw err;
      }

      // Mark online as soon as REST credentials are validated; real WS handshake
      // proceeds asynchronously and may flip status via onStatusChange callbacks.
      setStatus("online", "token validated");
      log.info("[feishuChannelAdapter] online, app_id:", credentials.appId);

      // Start WebSocket client (production path). Failures here are logged and
      // surfaced via status-change events, not thrown.
      try {
        await startWebSocketClient();
      } catch (err) {
        log.error("[feishuChannelAdapter] WebSocket setup failed:", err.message);
      }
    },

    async stop() {
      closeWebSocketClient();
      tenantAccessToken = null;
      setStatus("offline", "stopped");
    },

    async send({ chatId, text, msgType = "text", content } = {}) {
      if (!chatId) {
        throw new Error("E-CHANNEL-SEND: chatId is required");
      }
      // Back-compat: if `text` is passed as a string, wrap as text content.
      // Otherwise accept msgType + content (already-JSON-stringified content body).
      let resolvedMsgType = msgType;
      let resolvedContent;
      if (content !== undefined) {
        resolvedContent = typeof content === "string" ? content : JSON.stringify(content);
      } else if (text !== undefined) {
        resolvedMsgType = "text";
        resolvedContent = JSON.stringify({ text });
      } else {
        throw new Error("E-CHANNEL-SEND: text or content is required");
      }
      const url = `${baseUrl}/open-apis/im/v1/messages?receive_id_type=chat_id`;
      const body = {
        receive_id: chatId,
        msg_type: resolvedMsgType,
        content: resolvedContent
      };
      return sendWithRetry(async () => postJson(url, body, authorizationHeader()));
    },

    async reply({ messageId, text, msgType = "text", content, chatId } = {}) {
      if (!messageId) {
        throw new Error("E-CHANNEL-SEND: messageId is required");
      }
      let resolvedMsgType = msgType;
      let resolvedContent;
      if (content !== undefined) {
        resolvedContent = typeof content === "string" ? content : JSON.stringify(content);
      } else if (text !== undefined) {
        resolvedMsgType = "text";
        resolvedContent = JSON.stringify({ text });
      } else {
        throw new Error("E-CHANNEL-SEND: text or content is required");
      }
      const url = `${baseUrl}/open-apis/im/v1/messages/${encodeURIComponent(messageId)}/reply`;
      const body = {
        msg_type: resolvedMsgType,
        content: resolvedContent
      };
      if (chatId) body.receive_id = chatId;
      return sendWithRetry(async () => postJson(url, body, authorizationHeader()));
    },

    onMessage(cb) {
      if (typeof cb === "function") messageListeners.add(cb);
    },

    offMessage(cb) {
      messageListeners.delete(cb);
    },

    onStatusChange(cb) {
      if (typeof cb === "function") statusListeners.add(cb);
    },

    offStatusChange(cb) {
      statusListeners.delete(cb);
    },

    /** Test seam: inject an inbound message into the adapter. */
    simulateReceiveForTests(msg) {
      for (const cb of messageListeners) {
        try {
          cb(msg);
        } catch (err) {
          log.error("[feishuChannelAdapter] message listener error:", err.message);
        }
      }
    },

    /**
     * Test seam: inject a raw WS event (as EventDispatcher.parse would deliver
     * for v2 schema events) through the same mapInboundMessage pipeline that the
     * real WSClient dispatcher uses. This exercises the field-path resolution
     * that simulateReceiveForTests bypasses.
     */
    simulateWsEventForTests(rawEvent) {
      const msg = mapInboundMessage(rawEvent);
      if (!msg) return;
      for (const cb of messageListeners) {
        try {
          cb(msg);
        } catch (err) {
          log.error("[feishuChannelAdapter] message listener error:", err.message);
        }
      }
    },

    simulateDisconnectForTests({ reconnectWillFail = false } = {}) {
      closeWebSocketClient("simulate disconnect");
      setStatus("offline", reconnectWillFail ? "reconnect failed" : "disconnected");
      log.info("[feishuChannelAdapter] simulated disconnect");

      reconnectTimer = setTimeout(() => {
        if (reconnectWillFail) {
          setStatus("offline", "reconnect failed");
          notifyChannelStatus("通道掉线", "飞书通道长连接断开且重连失败，请检查凭据与网络");
          log.error("[feishuChannelAdapter] simulated reconnect failed");
          return;
        }
        setStatus("online", "reconnected");
        notifyChannelStatus("通道已恢复", "飞书通道已恢复在线");
        log.info("[feishuChannelAdapter] simulated reconnect succeeded");
      }, 0);
    },

    simulateReconnectForTests() {
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      setStatus("online", "reconnected");
      notifyChannelStatus("通道已恢复", "飞书通道已恢复在线");
      log.info("[feishuChannelAdapter] simulated reconnect succeeded");
    }
  };
}
