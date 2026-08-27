import { get, put, post } from "./client.js";

export function getCredentials() {
  return get("/api/settings/credentials");
}

export function saveCredential(service, body) {
  return put(`/api/settings/credentials/${encodeURIComponent(service)}`, body);
}

export function testCredential(service, body) {
  return post(`/api/settings/credentials/${encodeURIComponent(service)}/test`, body);
}
