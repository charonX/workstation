import { get, post, patch, del } from "./client.js";

export function getSchedules() {
  return get("/api/schedules");
}

export function createSchedule(body) {
  return post("/api/schedules", body);
}

export function updateSchedule(id, body) {
  return patch(`/api/schedules/${id}`, body);
}

export function deleteSchedule(id) {
  return del(`/api/schedules/${id}`);
}
