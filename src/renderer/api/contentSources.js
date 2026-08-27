import { get, post, patch, del } from "./client.js";

export function getContentSources() {
  return get("/api/content-sources");
}

export function createContentSource(body) {
  return post("/api/content-sources", body);
}

export function updateContentSource(id, body) {
  return patch(`/api/content-sources/${id}`, body);
}

export function toggleContentSource(id) {
  return patch(`/api/content-sources/${id}`, {});
}

export function deleteContentSource(id) {
  return del(`/api/content-sources/${id}`);
}

export function fetchContentSourceItems(id) {
  return post(`/api/content-sources/${id}/fetch`);
}
