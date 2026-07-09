import { post } from "./client.js";

export function createExecution(body) {
  return post("/api/executions", body);
}
