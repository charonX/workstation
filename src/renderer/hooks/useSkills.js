import { useState, useEffect, useCallback } from "react";
import { getSkills, getSkill, startInstallJob, subscribeInstallJob } from "../api/skills.js";

export function useSkills() {
  const [skills, setSkills] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchSkills = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getSkills();
      setSkills(data);
    } catch (err) {
      setError(err.message || "Failed to load skills");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSkills();
  }, [fetchSkills]);

  const install = useCallback(async (source, identifier, { onLog } = {}) => {
    const jobId = await startInstallJob({ source, identifier });
    return new Promise((resolve, reject) => {
      const unsubscribe = subscribeInstallJob(jobId, {
        onLog,
        onSuccess: (skill) => {
          unsubscribe();
          setSkills((prev) => [...prev, skill]);
          resolve(skill);
        },
        onError: (err) => {
          unsubscribe();
          reject(err);
        }
      });
    });
  }, []);

  return { skills, loading, error, refetch: fetchSkills, install };
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
