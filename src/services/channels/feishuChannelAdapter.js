import crypto from "node:crypto";

const MAX_SEND_ATTEMPTS = 3;

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
  const listeners = new Set();

  let status = "offline";
  let tenantAccessToken = null;
  let reconnectTimer = null;

  function setStatus(next) {
    status = next;
  }

  function notifyChannelStatus(title, body) {
    if (!notificationService) return;
    try {
      notificationService.notify({ type: "channel-status", title, body });
    } catch (err) {
      log.error("[feishuChannelAdapter] failed to write channel-status notification:", err.message);
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

  return {
    getStatus() {
      return status;
    },

    async start() {
      if (status === "online" || status === "connecting") return;
      setStatus("connecting");
      try {
        await fetchTenantAccessToken();
        setStatus("online");
        log.info("[feishuChannelAdapter] online, app_id:", credentials.appId);
      } catch (err) {
        setStatus("offline");
        log.error("[feishuChannelAdapter] start failed:", err.message);
        throw err;
      }
    },

    async send({ chatId, text } = {}) {
      if (!chatId || text === undefined) {
        throw new Error("E-CHANNEL-SEND: chatId and text are required");
      }
      const url = `${baseUrl}/open-apis/im/v1/messages?receive_id_type=chat_id`;
      const body = {
        receive_id: chatId,
        msg_type: "text",
        content: JSON.stringify({ text })
      };
      return sendWithRetry(async () => postJson(url, body, authorizationHeader()));
    },

    async reply({ messageId, text } = {}) {
      if (!messageId || text === undefined) {
        throw new Error("E-CHANNEL-SEND: messageId and text are required");
      }
      const url = `${baseUrl}/open-apis/im/v1/messages/${encodeURIComponent(messageId)}/reply`;
      const body = {
        msg_type: "text",
        content: JSON.stringify({ text })
      };
      return sendWithRetry(async () => postJson(url, body, authorizationHeader()));
    },

    onMessage(cb) {
      if (typeof cb === "function") listeners.add(cb);
    },

    offMessage(cb) {
      listeners.delete(cb);
    },

    /** Test seam: inject an inbound message into the adapter. */
    simulateReceiveForTests(msg) {
      for (const cb of listeners) {
        try { cb(msg); } catch (err) { log.error("[feishuChannelAdapter] message listener error:", err.message); }
      }
    },

    simulateDisconnectForTests({ reconnectWillFail = false } = {}) {
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      setStatus("offline");
      tenantAccessToken = null;
      log.info("[feishuChannelAdapter] simulated disconnect");

      reconnectTimer = setTimeout(() => {
        if (reconnectWillFail) {
          setStatus("offline");
          notifyChannelStatus("通道掉线", "飞书通道长连接断开且重连失败，请检查凭据与网络");
          log.error("[feishuChannelAdapter] simulated reconnect failed");
          return;
        }
        setStatus("online");
        notifyChannelStatus("通道已恢复", "飞书通道已恢复在线");
        log.info("[feishuChannelAdapter] simulated reconnect succeeded");
      }, 0);
    },

    simulateReconnectForTests() {
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      setStatus("online");
      notifyChannelStatus("通道已恢复", "飞书通道已恢复在线");
      log.info("[feishuChannelAdapter] simulated reconnect succeeded");
    }
  };
}
