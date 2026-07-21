import { get, post } from "./client.js";

export function getChannelStatus() {
  return get("/api/channel/status");
}

export function saveChannelCredentials({ appId, appSecret }) {
  return post("/api/channel/credentials", { appId, appSecret });
}

export function reconnectChannel() {
  return post("/api/channel/reconnect");
}
