import { get } from "./client.js";

export function getDashboard() {
  return get("/api/dashboard");
}
