import { useState, useEffect, useCallback } from "react";
import {
  getProjectDetail,
  linkProjectSkill,
  unlinkProjectSkill,
  resyncProjectSkills,
  putProject
} from "../api/projects.js";
import { listSkillGroups } from "../api/skills.js";

/**
 * Build a combined project skill list: the disk-derived view from
 * GET /api/projects/:id/skills (linked repo entries + external entries +
 * broken/conflict markers) unioned with the full skill library so the UI can
 * offer every available skill for linking, not only those already linked.
 *
 * Returns the same entry shape accepted by ProjectDetailModal:
 *   origin="repo":     { slug, skillName, name, description, agents, origin, linked, broken?, conflict? }
 *   origin="external": { name, agents, origin, conflict? }
 */
function mergeProjectSkills(detail, groups) {
  const fromView = Array.isArray(detail?.skills) ? detail.skills : [];
  const byKey = new Map();
  for (const entry of fromView) {
    if (entry.origin === "repo") {
      const key = `${entry.slug}/${entry.skillName}`;
      byKey.set(key, { ...entry, linked: true });
    } else {
      byKey.set(`external:${entry.name}`, entry);
    }
  }

  // Fold in library skills the disk scan didn't mention (available but
  // unlinked for this project). REQ-SKILL-010: any {slug,skillName} in the
  // library is a link candidate regardless of current link state.
  for (const group of groups || []) {
    for (const skill of group.skills || []) {
      const key = `${group.slug}/${skill.skillName}`;
      if (!byKey.has(key)) {
        byKey.set(key, {
          slug: group.slug,
          skillName: skill.skillName,
          name: skill.name,
          description: skill.description,
          agents: [],
          origin: "repo",
          linked: false
        });
      } else {
        const existing = byKey.get(key);
        if (!existing.name) existing.name = skill.name;
        if (!existing.description) existing.description = skill.description;
      }
    }
  }

  return [...byKey.values()].sort((a, b) =>
    String(a.skillName ?? a.name).localeCompare(String(b.skillName ?? b.name))
  );
}

export function useProjectDetail(projectId) {
  const [detail, setDetail] = useState(null);
  const [availableGroups, setAvailableGroups] = useState([]);
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [convergenceSummary, setConvergenceSummary] = useState(null);

  const refresh = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setError(null);
    try {
      const [data, groups] = await Promise.all([getProjectDetail(projectId), listSkillGroups()]);
      setDetail(data);
      setAvailableGroups(groups);
      setEntries(mergeProjectSkills(data, groups));
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
    entries,
    loading,
    error,
    refresh,
    linkSkill,
    unlinkSkill,
    resyncSkills,
    updateAgentTypes,
    convergenceSummary
  };
}
