import { useState, useEffect, useCallback } from "react";
import {
  getProjectDetail,
  linkProjectSkill,
  unlinkProjectSkill,
  linkProjectSkills,
  unlinkProjectSkills,
  resyncProjectSkills,
  putProject
} from "../api/projects.js";
import { listSkillGroups } from "../api/skills.js";

/**
 * Build the grouped project-skill model for the project detail modal. The disk
 * view from GET /api/projects/:id/skills provides linked/broken/conflict
 * state plus external entries; the full skill library (listSkillGroups) folds
 * in every available (possibly unlinked) skill grouped by source slug.
 *
 * Returns:
 *   repoGroups: [{ slug, skills: [repoEntry...] }]
 *   externalEntries: [externalEntry...]
 * where repoEntry = { slug, skillName, name, description, agents, origin:"repo",
 *                     linked, broken?, conflict? } and externalEntry =
 *   { name, agents, origin:"external", conflict? }.
 */
function buildProjectSkillModel(detail, groups) {
  const fromView = Array.isArray(detail?.skills) ? detail.skills : [];
  const linkedByKey = new Map();
  const externalEntries = [];
  for (const entry of fromView) {
    if (entry.origin === "repo") {
      linkedByKey.set(`${entry.slug}/${entry.skillName}`, { ...entry, linked: true });
    } else {
      externalEntries.push(entry);
    }
  }

  const repoGroups = (groups || []).map((group) => ({
    slug: group.slug,
    skills: (group.skills || []).map((skill) => {
      const key = `${group.slug}/${skill.skillName}`;
      const fromDisk = linkedByKey.get(key);
      if (fromDisk) {
        return {
          ...fromDisk,
          name: fromDisk.name || skill.name,
          description: fromDisk.description || skill.description
        };
      }
      return {
        slug: group.slug,
        skillName: skill.skillName,
        name: skill.name,
        description: skill.description,
        agents: [],
        origin: "repo",
        linked: false
      };
    })
  }));

  externalEntries.sort((a, b) => String(a.name).localeCompare(String(b.name)));
  return { repoGroups, externalEntries };
}

export function useProjectDetail(projectId) {
  const [detail, setDetail] = useState(null);
  const [repoGroups, setRepoGroups] = useState([]);
  const [externalEntries, setExternalEntries] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [convergenceSummary, setConvergenceSummary] = useState(null);
  const [bulkMessage, setBulkMessage] = useState(null);

  const refresh = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setError(null);
    try {
      const [data, groups] = await Promise.all([getProjectDetail(projectId), listSkillGroups()]);
      setDetail(data);
      const model = buildProjectSkillModel(data, groups);
      setRepoGroups(model.repoGroups);
      setExternalEntries(model.externalEntries);
    } catch (err) {
      setError(err.message || "Failed to load project detail");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const linkSkill = useCallback(
    async (slug, skillName) => {
      if (!projectId) return;
      await linkProjectSkill(projectId, { slug, skillName });
      await refresh();
    },
    [projectId, refresh]
  );

  const unlinkSkill = useCallback(
    async (slug, skillName) => {
      if (!projectId) return;
      await unlinkProjectSkill(projectId, { slug, skillName });
      await refresh();
    },
    [projectId, refresh]
  );

  // Bulk link selected identities. Returns the per-item results so the UI can
  // surface failures/conflicts; selection is cleared by the caller on success.
  const linkSkills = useCallback(
    async (skills) => {
      if (!projectId || skills.length === 0) return null;
      const result = await linkProjectSkills(projectId, skills);
      await refresh();
      return result;
    },
    [projectId, refresh]
  );

  const unlinkSkills = useCallback(
    async (skills) => {
      if (!projectId || skills.length === 0) return null;
      const result = await unlinkProjectSkills(projectId, skills);
      await refresh();
      return result;
    },
    [projectId, refresh]
  );

  const resyncSkills = useCallback(async () => {
    if (!projectId) return;
    const result = await resyncProjectSkills(projectId);
    setConvergenceSummary(result);
    await refresh();
    return result;
  }, [projectId, refresh]);

  const updateAgentTypes = useCallback(
    async (agentTypes) => {
      if (!projectId) return;
      const result = await putProject(projectId, { agentTypes });
      setConvergenceSummary(result.convergence);
      await refresh();
      return result;
    },
    [projectId, refresh]
  );

  return {
    detail,
    repoGroups,
    externalEntries,
    loading,
    error,
    refresh,
    linkSkill,
    unlinkSkill,
    linkSkills,
    unlinkSkills,
    resyncSkills,
    updateAgentTypes,
    convergenceSummary,
    bulkMessage,
    setBulkMessage
  };
}
