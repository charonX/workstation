import { useState, useEffect, useCallback } from "react";
import { listSkillGroups, startInstall, waitForJob, requestSourceUpdate, deleteSource } from "../api/skills.js";

export function useSkills() {
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchGroups = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await listSkillGroups();
      setGroups(Array.isArray(data) ? data : []);
      return data;
    } catch (err) {
      setError(err.message || "Failed to load skills");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchGroups();
  }, [fetchGroups]);

  // Install: start a git/local job and poll to completion. Resolves with the
  // resulting source group ({slug, sourceType, skills[]}) so the caller can
  // surface the outcome; the hook also refreshes the group list.
  // onLog (REQ-SKILL-023): forwarded to waitForJob so the caller can render
  // live install progress from the streamed git log.
  const install = useCallback(
    async (sourceType, identifier, { force, onLog } = {}) => {
      const { jobId } = await startInstall({ sourceType, identifier, force: !!force });
      await waitForJob(jobId, { onLog });
      await fetchGroups();
      return { jobId };
    },
    [fetchGroups]
  );

  const updateSource = useCallback(
    async (slug) => {
      const { jobId } = await requestSourceUpdate(slug);
      await waitForJob(jobId);
      const groups = await fetchGroups();
      return { jobId, groups };
    },
    [fetchGroups]
  );

  const removeSource = useCallback(
    async (slug) => {
      const result = await deleteSource(slug);
      await fetchGroups();
      return result;
    },
    [fetchGroups]
  );

  return { groups, loading, error, refetch: fetchGroups, install, updateSource, removeSource };
}
