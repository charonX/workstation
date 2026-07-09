import { get, post } from "./client.js";

export function getFlows() {
  return get("/api/flows");
}

export function createFlow(body) {
  return post("/api/flows", body);
}

export function getFlow(flowId) {
  return get(`/api/flows/${flowId}`);
}
