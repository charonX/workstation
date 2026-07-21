import { useState, useEffect, useCallback } from "react";
import { getNotifications } from "../api/notifications.js";

/**
 * Lightweight hook that polls the unread notification count.
 * Returns [unreadCount].
 */
export function useUnreadCount(pollMs = 3000) {
  const [unreadCount, setUnreadCount] = useState(0);

  const fetchCount = useCallback(async () => {
    try {
      const data = await getNotifications();
      setUnreadCount(data.unreadCount || 0);
    } catch {
      // ignore polling errors
    }
  }, []);

  useEffect(() => {
    fetchCount();
    const id = setInterval(fetchCount, pollMs);
    return () => clearInterval(id);
  }, [fetchCount, pollMs]);

  return unreadCount;
}
