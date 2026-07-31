import { useState, useEffect, useCallback } from "react";
import { getProjects, createProject, putProject } from "../api/projects.js";

/**
 * Hook to load projects, create a project, update a project (partial PUT —
 * used by the edit flow for agentTypes changes), and refresh the list.
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

  // PUT /api/projects/:id — partial update. Returns { ...project, convergence }
  // when agentTypes changed. Updates local list state to the returned project.
  const update = useCallback(async (projectId, body) => {
    try {
      const result = await putProject(projectId, body);
      const updated = { ...result };
      delete updated.convergence;
      setProjects((prev) => prev.map((p) => (p.id === projectId ? updated : p)));
      return result;
    } catch (err) {
      throw new Error(err.message || "Failed to update project");
    }
  }, []);

  return [projects, loading, error, create, refresh, update];
}
