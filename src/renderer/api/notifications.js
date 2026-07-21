import { get, post } from "./client.js";

export function getNotifications() {
  return get("/api/notifications");
}

export function markNotificationRead(notificationId) {
  return post(`/api/notifications/${notificationId}/read`);
}

export function markAllNotificationsRead() {
  return post("/api/notifications/read-all");
}
