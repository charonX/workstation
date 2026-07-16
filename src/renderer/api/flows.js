import { get, post, patch, del } from "./client.js";

export function getFlows() {
  return get("/api/flows");
}

export function createFlow(body) {
  return post("/api/flows", body);
}

export function getFlow(flowId) {
  return get(`/api/flows/${flowId}`);
}

export function updateFlow(flowId, body) {
  return patch(`/api/flows/${flowId}`, body);
}

export function deleteFlow(flowId) {
  return del(`/api/flows/${flowId}`);
}

export function debugFlow(flowId, body) {
  return post(`/api/flows/${flowId}/debug`, body);
}
