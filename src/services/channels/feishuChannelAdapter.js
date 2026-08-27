import { WSClient, EventDispatcher } from "@larksuiteoapi/node-sdk";
import { randomUUID } from "node:crypto";

const MAX_SEND_ATTEMPTS = 3;
const FEISHU_APP_ID_RE = /^cli_[0-9a-fA-F]{16}$/;
// H4（spike-report）：CardKit 流式更新 content 1~100,000 字符；sequence 严格递增（300317）。
const MAX_CARD_CONTENT_CHARS = 100000;

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

  // 通用 JSON 请求（POST/PUT 共用：res 形状 { ok, status, data }，平台失败 code≠0
  // 记为 !ok；响应体解析失败兜底空对象）。
  async function requestJson(method, url, body, headers = {}) {
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json", ...headers },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {})
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok && data.code === 0, status: res.status, data };
  }

  function postJson(url, body, headers) {
    return requestJson("POST", url, body, headers);
  }

  function putJson(url, body, headers) {
    return requestJson("PUT", url, body, headers);
  }

  function patchJson(url, body, headers) {
    return requestJson("PATCH", url, body, headers);
  }

  // E-CHANNEL-SEND 错误（统一 code 标注，供上层告警分类；message 保留既有文案）。
  function channelSendError(message) {
    const err = new Error(`E-CHANNEL-SEND: ${message}`);
    err.code = "E-CHANNEL-SEND";
    return err;
  }

  async function sendWithRetry(operation) {
    let lastError;
    for (let attempt = 1; attempt <= MAX_SEND_ATTEMPTS; attempt++) {
      try {
        const result = await operation();
        if (result.ok) return result.data;
        // 诊断：带出飞书 API 返回体的错误码与 msg（此前只留 status，丢了具体原因）。
        const code = result?.data?.code;
        const msg = result?.data?.msg;
        const detail = [result.status, code !== undefined ? `code=${code}` : "", msg ? `msg=${msg}` : ""]
          .filter(Boolean)
          .join(" ");
        lastError = new Error(`feishu API error: ${detail}`);
      } catch (err) {
        lastError = err;
      }
    }
    const err = new Error(`E-CHANNEL-SEND: failed after ${MAX_SEND_ATTEMPTS} attempts: ${lastError?.message}`);
    err.code = "E-CHANNEL-SEND";
    throw err;
  }

  // 每卡片串行链（BUG-011，code-defect）：同一张卡的流式更新/定型按调用顺序排队
  // 落地——修复前各调用是 fire-and-forget 独立 HTTP，finalize（PATCH settings）可
  // 抢在在途尾部更新（PUT elements/content）之前到达：streaming_mode 一关，尾部
  // 更新全部被拒，卡片冻结在半途；并发在途更新乱序到达还会触发 300317 sequence
  // 错误。串行化后三者一并消除（请求频率也自然降到串行水位）。
  // 上一棒无论成败都放行下一棒（失败经 sendWithRetry 耗尽后由调用方重试/告警）；
  // 本棒的 promise 原样回传调用方，链上另存 catch 过的尾巴防未处理拒绝；
  // 队列排空后自清（长会话 cardId 不累积）。
  const cardChains = new Map();
  function enqueueCardOp(cardId, operation) {
    const prev = cardChains.get(cardId) ?? Promise.resolve();
    const run = prev.then(operation, operation);
    const tail = run.catch(() => {});
    cardChains.set(cardId, tail);
    tail.then(() => {
      if (cardChains.get(cardId) === tail) cardChains.delete(cardId);
    });
    return run;
  }

  // 排队更新合并（BUG-012，code-defect）：H4 契约 content = 全量累计文本——排队中
  // 的旧更新已被后来者完整覆盖，出队时若同卡已有更新的排队更新，跳过本次 HTTP
  // （零信息丢失）。修复前串行链为每个 delta 支付一次往返（226 次更新 = 226 个
  // 串行 RTT：后台早已跑完，卡片还在追账逐字输出）。finalize 不合并、顺序保证
  // （BUG-011）不弱化；在途 HTTP 无法撤回，仅跳过未出队的。
  const pendingCardUpdates = new Map(); // cardId → marker（同卡最新一次未出队更新）

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

    /**
     * CardKit 卡片发送（F1 / REQ-AGENT-019，H4 契约）：
     * 1. 创建卡片实体（卡片 JSON 2.0 + streaming_mode）→ card_id（实体仅发送一次）；
     * 2. 以交互消息（msg_type=interactive）把 card_id 发出（im/v1/messages）。
     * 返回 { cardId } 供 updateCardStream 引用。
     * 真实凭据联调待 QA（signoff H4：契约 PASS / 联调待验证）。
     */
    async sendCard({ chatId, cardJson } = {}) {
      if (!chatId) {
        throw channelSendError("chatId is required");
      }
      if (!cardJson || typeof cardJson !== "object") {
        throw channelSendError("cardJson is required");
      }
      // 诊断：卡片发送开始（回复回传的最后一步）。
      log.info(`[feishuChannelAdapter] sendCard chatId=${chatId}`);
      // 诊断（BUG-006 排查）：打印实际发送的 data 字段（转义后的卡片 JSON 前 300 字符），
      // 对比 create 接口能否通过——用于定位 200621 parse card json err 的触发点。
      log.info(`[feishuChannelAdapter] sendCard data前300=${JSON.stringify(cardJson).slice(0, 300)}`);
      // 创建卡片实体（CardKit：cardkit:card:write 权限）。
      // BUG-006（code-defect）：创建接口要求外层 { type: "card_json", data: "<转义卡片JSON>" }，
      // 直接 POST 卡片 JSON 本体会 400 field validation failed（99992402）。
      const createResult = await sendWithRetry(async () =>
        postJson(
          `${baseUrl}/open-apis/cardkit/v1/cards`,
          { type: "card_json", data: JSON.stringify(cardJson) },
          authorizationHeader()
        )
      );
      // 官方响应 { code, msg, data: { card_id } }：requestJson 解包后 data 为整个响应体。
      const cardId = createResult?.data?.card_id;
      if (!cardId) {
        throw channelSendError("card entity creation returned no card_id");
      }
      log.info(`[feishuChannelAdapter] sendCard 卡片实体创建成功 cardId=${cardId}`);
      // 发送交互消息（im:message:send_as_bot 权限），卡片实体随消息一次性发出。
      // BUG-006（code-defect）：content 官方格式为 { type: "card", data: { card_id } }，
      // 直接传 { card_id } 会 200621 parse card json err（创建成功但发送失败）。
      await sendWithRetry(async () =>
        postJson(
          `${baseUrl}/open-apis/im/v1/messages?receive_id_type=chat_id`,
          {
            receive_id: chatId,
            msg_type: "interactive",
            content: JSON.stringify({ type: "card", data: { card_id: cardId } })
          },
          authorizationHeader()
        )
      );
      return { cardId };
    },

    /**
     * CardKit 卡片流式更新（F1 / REQ-AGENT-019，H4 契约）：
     * PUT /cardkit/v1/cards/:card_id/elements/:element_id/content——
     * content = 全量累计文本（1~100,000 字符）、sequence 严格递增（错误码 300317）、
     * uuid 幂等。流式期间不触发 QPS 限流；10 分钟窗口由调用方（卡片渲染器）自控。
     * cardId 缺失（sendCard 尚未完成的竞态窗口）→ 跳过（返回 ok，不报错）：
     * content 为全量累计文本，后续更新不丢内容（渲染器在 cardId 回填后继续携带真实 id）。
     */
    async updateCardStream({ cardId, content, sequence, elementId = "content" } = {}) {
      if (!cardId) {
        // 竞态窗口：卡片实体尚未创建完成——跳过本次更新（不丢内容，见上注）。
        return { ok: true, skipped: true };
      }
      if (typeof content !== "string" || content.length < 1 || content.length > MAX_CARD_CONTENT_CHARS) {
        throw channelSendError("content 必须为 1~100,000 字符（H4）");
      }
      if (!Number.isInteger(sequence) || sequence < 1) {
        throw channelSendError("sequence 必须为正整数且严格递增（H4，错误码 300317）");
      }
      const url = `${baseUrl}/open-apis/cardkit/v1/cards/${encodeURIComponent(cardId)}/elements/${encodeURIComponent(elementId)}/content`;
      // BUG-012 合并：入队即把同卡旧排队更新标记作废；出队时作废者跳过 HTTP。
      const marker = { stale: false };
      const prevPending = pendingCardUpdates.get(cardId);
      if (prevPending) prevPending.stale = true;
      pendingCardUpdates.set(cardId, marker);
      return enqueueCardOp(cardId, () => {
        if (marker.stale) return { ok: true, skipped: true, coalesced: true };
        pendingCardUpdates.delete(cardId);
        return sendWithRetry(async () =>
          putJson(url, { content, sequence, uuid: randomUUID() }, authorizationHeader())
        );
      });
    },

    /**
     * CardKit 卡片定型（BUG-004/BUG-005 / REQ-AGENT-019 标准 2）：
     * PATCH /cardkit/v1/cards/:card_id/settings —— 官方 schema：settings 为 **JSON 字符串**
     * （{ config: { streaming_mode: false, summary: { content } } }），sequence 流式序号
     * （正整数，与元素更新同一严格递增序列）、uuid 幂等。
     * BUG-005 实测实证：官方方法为 **PATCH**——误用 PUT 获网关级 404（无 code 字段）。
     * 流式结束/任务终态后关闭 streaming_mode 并把会话列表预览 summary 换成正文摘要——
     * 否则 streaming_mode 常开，列表永远停在初始 summary「[生成中...]」直到 10 分钟
     * 窗口自动关闭（H4 spike：建议手动 card.settings 关 streaming_mode）。
     * cardId 缺失（sendCard 竞态窗口）→ 跳过（渲染器在回填后补发，不失定型）。
     */
    async finalizeCard({ cardId, summary, sequence } = {}) {
      if (!cardId) {
        return { ok: true, skipped: true };
      }
      const settings = { config: { streaming_mode: false } };
      if (typeof summary === "string" && summary !== "") {
        settings.config.summary = { content: summary };
      }
      const url = `${baseUrl}/open-apis/cardkit/v1/cards/${encodeURIComponent(cardId)}/settings`;
      const body = { settings: JSON.stringify(settings), uuid: randomUUID() };
      if (Number.isInteger(sequence) && sequence > 0) body.sequence = sequence;
      // 诊断（BUG-005）：定型请求可见——对齐 BUG-006 sendCard 诊断模式，生产联调定位用。
      log.info(`[feishuChannelAdapter] finalizeCard cardId=${cardId} sequence=${sequence}`);
      log.info(`[feishuChannelAdapter] finalizeCard body前300=${JSON.stringify(body).slice(0, 300)}`);
      const result = await enqueueCardOp(cardId, () =>
        sendWithRetry(async () =>
          patchJson(url, body, authorizationHeader())
        )
      );
      log.info(`[feishuChannelAdapter] finalizeCard 成功 cardId=${cardId}`);
      return result;
    },

    /**
     * 会话信息查询（Slice 9 / REQ-AGENT-034 通道侧 chat 名写入）：
     * GET /open-apis/im/v1/chats/:chatId → data.name（群聊名 / 单聊对方名）。
     * 入站消息事件（im.message.receive_v1）不含 chat_name，chat 名只能经本查询取得。
     * 元数据增强路径：任何失败（网络/权限/无 name）→ 返回 null 且不抛出——调用方
     * 降级跳过写入（列表显示名 fallback spaceKey，signoff 裁决 10），不阻断消息路由。
     * 非生产形态 appId（测试 fixture，同 startWebSocketClient 判定）→ 直接 null：
     * 避免测试环境对真实飞书开放平台发起无谓网络请求。
     */
    async fetchChatName(chatId) {
      if (!chatId || !FEISHU_APP_ID_RE.test(credentials.appId)) return null;
      try {
        const res = await fetch(`${baseUrl}/open-apis/im/v1/chats/${encodeURIComponent(chatId)}`, {
          headers: authorizationHeader(),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || data.code !== 0) {
          log.error(`[feishuChannelAdapter] fetchChatName failed chatId=${chatId} code=${data?.code ?? res.status}`);
          return null;
        }
        const name = data?.data?.name;
        return typeof name === "string" && name.trim() !== "" ? name : null;
      } catch (err) {
        log.error("[feishuChannelAdapter] fetchChatName error:", err.message);
        return null;
      }
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
