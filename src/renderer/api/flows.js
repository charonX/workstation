import { get, post, del } from "./client.js";

export function getFlows() {
  return get("/api/flows");
}

export function createFlow(body) {
  return post("/api/flows", body);
}

export function getFlow(flowId) {
  return get(`/api/flows/${flowId}`);
}

export function deleteFlow(flowId) {
  return del(`/api/flows/${flowId}`);
}
