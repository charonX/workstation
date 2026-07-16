import { useState, useEffect, useCallback } from "react";
import { getSkillRepos, getSkill, startInstallJob, subscribeInstallJob } from "../api/skills.js";

export function useSkills() {
  const [repos, setRepos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchRepos = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getSkillRepos();
      setRepos(data);
    } catch (err) {
      setError(err.message || "Failed to load skills");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRepos();
  }, [fetchRepos]);

  const install = useCallback(async (source, identifier, { onLog } = {}) => {
    const jobId = await startInstallJob({ source, identifier });
    return new Promise((resolve, reject) => {
      const unsubscribe = subscribeInstallJob(jobId, {
        onLog,
        onSuccess: (repo, skills) => {
          unsubscribe();
          setRepos((prev) => [{ repo, skills }, ...prev]);
          resolve({ repo, skills });
        },
        onError: (err) => {
          unsubscribe();
          reject(err);
        }
      });
    });
  }, []);

  return { repos, loading, error, refetch: fetchRepos, install };
}

export function useSkillDetail(skillId) {
  const [skill, setSkill] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchSkill = useCallback(async () => {
    if (!skillId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await getSkill(skillId);
      setSkill(data);
    } catch (err) {
      setError(err.message || "Failed to load skill detail");
    } finally {
      setLoading(false);
    }
  }, [skillId]);

  useEffect(() => {
    fetchSkill();
  }, [fetchSkill]);

  return { skill, loading, error, refetch: fetchSkill };
}
