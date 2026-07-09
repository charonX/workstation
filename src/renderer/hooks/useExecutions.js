import { useState, useEffect, useCallback } from "react";
import { getExecutions, getExecution } from "../api/executions.js";

/**
 * Hook to load executions list.
 * Returns [executions, loading, error, refresh].
 */
export function useExecutions() {
  const [executions, setExecutions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getExecutions();
      setExecutions(data);
    } catch (err) {
      setError(err.message || "Failed to load executions");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return [executions, loading, error, refresh];
}

/**
 * Hook to load a single execution by ID.
 * Returns [execution, loading, error, refresh].
 */
export function useExecution(executionId) {
  const [execution, setExecution] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    if (!executionId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await getExecution(executionId);
      setExecution(data);
    } catch (err) {
      setError(err.message || "Failed to load execution");
    } finally {
      setLoading(false);
    }
  }, [executionId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return [execution, loading, error, refresh];
}
