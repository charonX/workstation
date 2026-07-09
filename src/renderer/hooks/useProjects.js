import { useState, useEffect, useCallback } from "react";
import { getProjects, createProject } from "../api/projects.js";

/**
 * Hook to load projects, create a project, and refresh the list.
 * Returns [projects, loading, error, create, refresh].
 */
export function useProjects() {
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getProjects();
      setProjects(data);
    } catch (err) {
      setError(err.message || "Failed to load projects");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const create = useCallback(async (body) => {
    try {
      const created = await createProject(body);
      setProjects((prev) => [...prev, created]);
      return created;
    } catch (err) {
      throw new Error(err.message || "Failed to create project");
    }
  }, []);

  return [projects, loading, error, create, refresh];
}
