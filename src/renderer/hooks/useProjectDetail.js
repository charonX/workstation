import { useState, useEffect, useCallback } from "react";
import { getProjectDetail, updateProjectSkills } from "../api/projects.js";

/**
 * Hook to load and update a single project's detail with skills.
 * Returns [detail, loading, error, toggleSkill, refresh].
 */
export function useProjectDetail(projectId) {
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await getProjectDetail(projectId);
      setDetail(data);
    } catch (err) {
      setError(err.message || "Failed to load project detail");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const toggleSkill = useCallback(async (skillId, linked) => {
    if (!projectId) return;
    // Optimistically flip the local skill link so controlled checkboxes
    // respond immediately to user interaction.
    setDetail((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        skills: prev.skills.map((s) => (s.id === skillId ? { ...s, linked } : s)),
      };
    });
    try {
      const updated = await updateProjectSkills(projectId, skillId, linked);
      setDetail(updated);
      return updated;
    } catch (err) {
      // Revert optimistic update on failure.
      setDetail((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          skills: prev.skills.map((s) => (s.id === skillId ? { ...s, linked: !linked } : s)),
        };
      });
      throw new Error(err.message || "Failed to update skill link");
    }
  }, [projectId]);

  return [detail, loading, error, toggleSkill, refresh];
}
