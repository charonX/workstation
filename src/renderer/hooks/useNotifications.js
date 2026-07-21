import { useState, useEffect, useCallback } from "react";
import { getNotifications, markNotificationRead, markAllNotificationsRead } from "../api/notifications.js";

/**
 * Hook to load notifications and provide mark-read actions.
 * Returns [state, loading, error, refresh, markRead, markAllRead].
 */
export function useNotifications() {
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getNotifications();
      setNotifications(data.items || []);
      setUnreadCount(data.unreadCount || 0);
    } catch (err) {
      setError(err.message || "Failed to load notifications");
    } finally {
      setLoading(false);
    }
  }, []);

  const markRead = useCallback(async (id) => {
    await markNotificationRead(id);
    await refresh();
  }, [refresh]);

  const markAllRead = useCallback(async () => {
    await markAllNotificationsRead();
    await refresh();
  }, [refresh]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return [{
    notifications,
    unreadCount,
  }, loading, error, refresh, markRead, markAllRead];
}
