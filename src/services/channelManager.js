import * as eventBus from "./eventBus.js";
import * as notificationService from "./notificationService.js";
import * as settingsService from "./settingsService.js";
import { createFeishuChannelAdapter } from "./channels/feishuChannelAdapter.js";

const FEISHU_DEFAULT_DOMAIN = "https://open.feishu.cn";

const channels = new Map();

function createChannelRecord(channelType) {
  if (!channels.has(channelType)) {
    channels.set(channelType, {
      channelType,
      adapter: null,
      credentials: null,
      status: "offline",
      error: null
    });
  }
  return channels.get(channelType);
}

function updateStatus(record, { status, error, reason }) {
  const previousStatus = record.status;
  record.status = status;
  record.error = error || null;
  if (status !== previousStatus) {
    eventBus.publish("channel:status-changed", {
      channelType: record.channelType,
      status,
      previousStatus,
      reason: reason || error || undefined
    });
  }
}

function buildAdapter(channelType, credentials, domain) {
  if (channelType === "feishu") {
    return createFeishuChannelAdapter({
      domain: domain || FEISHU_DEFAULT_DOMAIN,
      credentials,
      notificationService,
      logger: console
    });
  }
  throw new Error(`E-CHANNEL-CONFIG: unsupported channel type ${channelType}`);
}

function wireAdapter(record, adapter) {
  adapter.onMessage((msg) => {
    eventBus.publish("channel:message-received", {
      channelType: record.channelType,
      messageId: msg.messageId,
      chatId: msg.chatId,
      senderId: msg.senderId,
      text: msg.text,
      url: msg.url
    });
  });
  adapter.onStatusChange(({ status, previousStatus, reason }) => {
    updateStatus(record, { status, error: reason, reason });
  });
}

export async function start() {
  const settings = settingsService.loadSettings();
  const creds = settings.channelCredentials;
  if (!creds?.appId || !creds?.appSecret) {
    return { status: "offline", error: null };
  }
  return restart("feishu", creds);
}

export async function stop() {
  for (const [channelType, record] of channels) {
    try {
      if (record.adapter && typeof record.adapter.stop === "function") {
        await record.adapter.stop();
      }
    } catch (err) {
      console.error(`[channelManager] failed to stop ${channelType}:`, err.message);
    }
    updateStatus(record, { status: "offline", error: "stopped" });
    record.adapter = null;
  }
}

export async function restart(channelType, credentials) {
  const record = createChannelRecord(channelType);
  const settings = settingsService.loadSettings();
  const creds = credentials || settings.channelCredentials;
  if (!creds?.appId || !creds?.appSecret) {
    const error = "E-CHANNEL-CRED: channel credentials not configured";
    updateStatus(record, { status: "offline", error });
    return { status: "offline", error };
  }

  // Stop any existing adapter for this channel type.
  if (record.adapter && typeof record.adapter.stop === "function") {
    try {
      await record.adapter.stop();
    } catch (err) {
      console.error(`[channelManager] failed to stop previous ${channelType} adapter:`, err.message);
    }
  }
  record.credentials = creds;
  record.error = null;

  let adapter;
  try {
    adapter = buildAdapter(channelType, creds, settings.channelDomain);
  } catch (err) {
    updateStatus(record, { status: "offline", error: err.message });
    return { status: "offline", error: err.message };
  }
  wireAdapter(record, adapter);
  record.adapter = adapter;

  try {
    await adapter.start();
  } catch (err) {
    const error = err.message || String(err);
    updateStatus(record, { status: "offline", error });
    return { status: "offline", error };
  }

  const status = adapter.getStatus();
  updateStatus(record, { status, error: null });
  return { status, error: null };
}

export function getStatus(channelType) {
  const record = channels.get(channelType);
  if (!record) {
    return { status: "offline", error: null };
  }
  return {
    status: record.status,
    error: record.error || undefined
  };
}

export function getAdapter(channelType) {
  return channels.get(channelType)?.adapter || null;
}

async function dispatchToAdapter(channelType, method, payload) {
  const adapter = getAdapter(channelType);
  if (!adapter) {
    throw new Error(`E-CHANNEL-SEND: ${channelType} adapter is not available`);
  }
  return adapter[method](payload);
}

export async function send(channelType, payload) {
  return dispatchToAdapter(channelType, "send", payload);
}

export async function reply(channelType, payload) {
  return dispatchToAdapter(channelType, "reply", payload);
}
