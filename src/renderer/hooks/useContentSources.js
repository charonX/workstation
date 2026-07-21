import { useState, useEffect, useCallback } from "react";
import {
  getContentSources,
  createContentSource,
  updateContentSource,
  toggleContentSource,
  deleteContentSource,
} from "../api/contentSources.js";

/**
 * Hook to load and manage content sources.
 * Returns [sources, loading, error, refresh, create, update, toggle, remove].
 */
export function useContentSources() {
  const [sources, setSources] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getContentSources();
      setSources(data);
    } catch (err) {
      setError(err.message || "Failed to load content sources");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const create = useCallback(async (body) => {
    const created = await createContentSource(body);
    setSources((prev) => [created, ...prev]);
    return created;
  }, []);

  const update = useCallback(async (id, body) => {
    const updated = await updateContentSource(id, body);
    setSources((prev) =>
      prev.map((s) => (s.id === id ? updated : s))
    );
    return updated;
  }, []);

  const toggle = useCallback(async (id) => {
    const updated = await toggleContentSource(id);
    setSources((prev) =>
      prev.map((s) => (s.id === id ? updated : s))
    );
    return updated;
  }, []);

  const remove = useCallback(async (id) => {
    await deleteContentSource(id);
    setSources((prev) => prev.filter((s) => s.id !== id));
  }, []);

  return [sources, loading, error, refresh, create, update, toggle, remove];
}
