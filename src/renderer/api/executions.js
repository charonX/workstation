import { get, post } from "./client.js";

export function getExecutions() {
  return get("/api/executions");
}

export function getExecution(executionId) {
  return get(`/api/executions/${executionId}`);
}

export function createExecution(body) {
  return post("/api/executions", body);
}
