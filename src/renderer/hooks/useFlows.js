import { useState, useEffect, useCallback } from "react";
import { getFlows, createFlow } from "../api/flows.js";

/**
 * Hook to load flows, create a flow, and refresh the list.
 * Returns [flows, loading, error, create, refresh].
 */
export function useFlows() {
  const [flows, setFlows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getFlows();
      setFlows(data);
    } catch (err) {
      setError(err.message || "Failed to load flows");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const create = useCallback(async (body) => {
    try {
      const created = await createFlow(body);
      setFlows((prev) => [...prev, created]);
      return created;
    } catch (err) {
      throw new Error(err.message || "Failed to create flow");
    }
  }, []);

  return [flows, loading, error, create, refresh];
}
