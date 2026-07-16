import { useState, useEffect, useCallback } from "react";
import { getDashboard } from "../api/dashboard.js";

/**
 * Hook to load dashboard data.
 * Returns [data, loading, error, refresh].
 */
export function useDashboard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const dashboardData = await getDashboard();
      setData(dashboardData);
    } catch (err) {
      setError(err.message || "Failed to load dashboard");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return [data, loading, error, refresh];
}
