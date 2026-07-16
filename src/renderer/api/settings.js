import { get, patch } from "./client.js";

export function getSettings() {
  return get("/api/settings");
}

export function updateSettings(partial) {
  return patch("/api/settings", partial);
}
