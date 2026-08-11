import React, { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useProjectDetail } from "../../hooks/useProjectDetail.js";
import Modal from "../shared/Modal.jsx";
import PermissionConfigTab from "./PermissionConfigTab.jsx";
import "./ProjectDetailModal.css";

/**
 * Project detail modal. The skills tab renders repo skills grouped by source
 * slug (with group-level select-all, per-row selection, search + status
 * filtering, and a bulk link/unlink action bar), external (non-workstation)
 * entries in a read-only section at the bottom, a resync button, and the most
 * recent convergence summary.
 *
 * Model (from useProjectDetail, v1.2):
 *   repoGroups:       [{ slug, skills: [repoEntry...] }]
 *   externalEntries:  [externalEntry...]
 *   repoEntry:        { slug, skillName, name, description, agents, origin:"repo",
 *                       linked, broken?, conflict? }
 *   externalEntry:    { name, agents, origin:"external", conflict? }
 *
 * Bulk link/unlink uses REQ-SKILL-010 AC8 / REQ-SKILL-011 AC5; per-row
 * link/unlink buttons are kept for single-item actions.
 */
const STATUS_FILTERS = ["all", "linked", "unlinked", "issues"];

export default function ProjectDetailModal({ projectId, isOpen, onClose }) {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState("skills");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  // Selection keys: `${slug}/${skillName}`. Selection is independent of the
  // visible filter so checking items then narrowing the search keeps them.
  const [selected, setSelected] = useState(() => new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  // Collapsed source groups, keyed by slug. Collapsing hides only the rows;
  // group selection and already-checked items are unaffected.
  const [collapsedGroups, setCollapsedGroups] = useState(() => new Set());
  const {
    detail,
    repoGroups,
    externalEntries,
    loading,
    error,
    linkSkill,
    unlinkSkill,
    linkSkills,
    unlinkSkills,
    resyncSkills,
    convergenceSummary,
    bulkMessage,
    setBulkMessage
  } = useProjectDetail(projectId);

  const q = query.trim().toLowerCase();

  // Visible (filtered) groups/skills, preserving group structure. Defined
  // unconditionally (Rules of Hooks); the isOpen early-return is below.
  const visibleGroups = useMemo(() => {
    const matchStatus = (entry) => {
      if (statusFilter === "linked") return entry.linked;
      if (statusFilter === "unlinked") return !entry.linked;
      if (statusFilter === "issues") return entry.broken || entry.conflict;
      return true;
    };
    const needle = q;
    const matchText = (entry) => {
      if (!needle) return true;
      return [entry.name, entry.skillName, entry.slug, entry.description]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(needle));
    };
    return repoGroups
      .map((group) => ({
        ...group,
        skills: group.skills.filter((s) => matchStatus(s) && matchText(s))
      }))
      .filter((group) => group.skills.length > 0);
  }, [repoGroups, query, statusFilter, q]);

  const selectedList = useMemo(
    () =>
      [...selected]
        .map((key) => {
          const [slug, skillName] = key.split("/");
          return { slug, skillName };
        })
        // Only act on entries that still exist in the current model.
        .filter(({ slug, skillName }) =>
          repoGroups.some((g) => g.slug === slug && g.skills.some((s) => s.skillName === skillName))
        ),
    [selected, repoGroups]
  );

  if (!isOpen) return null;

  function toggle(key) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    setBulkMessage(null);
  }

  function setGroupSelection(group, keys, checked) {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const key of keys) {
        if (checked) next.add(key);
        else next.delete(key);
      }
      return next;
    });
    setBulkMessage(null);
  }

  function toggleGroupCollapsed(slug) {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  }

  function selectAllVisible(checked) {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const group of visibleGroups) {
        for (const skill of group.skills) {
          const key = `${group.slug}/${skill.skillName}`;
          if (checked) next.add(key);
          else next.delete(key);
        }
      }
      return next;
    });
    setBulkMessage(null);
  }

  async function runBulk(action) {
    if (selectedList.length === 0 || bulkBusy) return;
    setBulkBusy(true);
    setBulkMessage(null);
    try {
      const result =
        action === "link"
          ? await linkSkills(selectedList)
          : await unlinkSkills(selectedList);
      const okCount = action === "link" ? result.count.linked : result.count.unlinked;
      const problemCount =
        action === "link"
          ? result.count.skipped + result.count.failed
          : result.count.skipped + result.count.failed;
      const problems = (result.results || []).filter((r) => r.status !== (action === "link" ? "linked" : "unlinked"));
      setBulkMessage({
        type: problemCount > 0 ? "warn" : "ok",
        text: t("projectDetail.bulkResult", {
          action: t(action === "link" ? "projectDetail.link" : "projectDetail.unlink"),
          ok: okCount,
          problem: problemCount,
          details: problems
            .map((p) => `${p.skillName}: ${t("projectDetail.bulkStatus." + p.status, { code: p.code || "" })}`)
            .join("；")
        })
      });
      setSelected(new Set());
    } catch (err) {
      setBulkMessage({ type: "error", text: err.message || String(err) });
    } finally {
      setBulkBusy(false);
    }
  }

  function handleLink(entry) {
    setBulkMessage(null);
    linkSkill(entry.slug, entry.skillName);
  }

  function handleUnlink(entry) {
    setBulkMessage(null);
    unlinkSkill(entry.slug, entry.skillName);
  }

  function handleResync() {
    setBulkMessage(null);
    resyncSkills();
  }

  // All-visible selection state for the global tri-state checkbox.
  const visibleKeys = visibleGroups.flatMap((g) => g.skills.map((s) => `${g.slug}/${s.skillName}`));
  const visibleSelected = visibleKeys.filter((k) => selected.has(k));
  const allVisibleChecked = visibleKeys.length > 0 && visibleSelected.length === visibleKeys.length;
  const someVisibleChecked = visibleSelected.length > 0 && !allVisibleChecked;

  const footer = (
    <button className="btn btn-secondary" onClick={onClose}>
      {t("projectDetail.close")}
    </button>
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={detail?.overview?.name || t("projectDetail.title")}
      testid="project-detail-modal"
      footer={footer}
      size="xl"
    >
      <div className="tabs">
        <button
          className={`tab ${activeTab === "overview" ? "active" : ""}`}
          onClick={() => setActiveTab("overview")}
        >
          {t("skills.overview")}
        </button>
        <button
          className={`tab ${activeTab === "skills" ? "active" : ""}`}
          onClick={() => setActiveTab("skills")}
        >
          {t("skills.title")}
        </button>
        <button
          className={`tab ${activeTab === "permission" ? "active" : ""}`}
          data-perm-tab
          onClick={() => setActiveTab("permission")}
        >
          权限配置
        </button>
      </div>

      {activeTab === "overview" && (
        <div className="tab-panel">
          {loading && <p className="tab-loading">{t("projectDetail.loading")}</p>}
          {error && <p className="tab-error">{error}</p>}
          {detail?.overview && (
            <div className="meta-list">
              <div className="meta-row">
                <span className="meta-label">{t("projectDetail.projectName")}</span>
                <span className="meta-value">{detail.overview.name}</span>
              </div>
              {detail.overview.localPath && (
                <div className="meta-row">
                  <span className="meta-label">{t("projectDetail.localPath")}</span>
                  <span className="meta-value">{detail.overview.localPath}</span>
                </div>
              )}
              {detail.overview.repoUrl && (
                <div className="meta-row">
                  <span className="meta-label">{t("projectDetail.repoUrl")}</span>
                  <span className="meta-value">{detail.overview.repoUrl}</span>
                </div>
              )}
              <div className="meta-row">
                <span className="meta-label">{t("projectDetail.agents")}</span>
                <span className="meta-value">
                  {Array.isArray(detail.overview.agentTypes) && detail.overview.agentTypes.length > 0
                    ? detail.overview.agentTypes.join(", ")
                    : "—"}
                </span>
              </div>
              <div className="meta-row">
                <span className="meta-label">{t("projectDetail.flows")}</span>
                <span className="meta-value">{detail.overview.flowsCount ?? 0}</span>
              </div>
              <div className="meta-row">
                <span className="meta-label">{t("projectDetail.runs")}</span>
                <span className="meta-value">{detail.overview.runsCount ?? 0}</span>
              </div>
              <div className="meta-row">
                <span className="meta-label">{t("projectDetail.updated")}</span>
                <span className="meta-value">
                  {detail.overview.updatedAt
                    ? new Date(detail.overview.updatedAt).toLocaleString()
                    : "—"}
                </span>
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === "skills" && (
        <div className="tab-panel" data-testid="project-skills-section">
          {loading && <p className="tab-loading">{t("projectDetail.loading")}</p>}
          {error && <p className="tab-error">{error}</p>}

          <div className="project-skills-toolbar">
            <input
              type="search"
              className="project-skills-search"
              data-testid="project-skills-search"
              placeholder={t("projectDetail.searchPlaceholder")}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <div className="project-skills-filters" role="group" aria-label={t("projectDetail.statusFilter")}>
              {STATUS_FILTERS.map((f) => (
                <button
                  key={f}
                  type="button"
                  className={`chip ${statusFilter === f ? "chip-active" : ""}`}
                  data-testid={`status-filter-${f}`}
                  onClick={() => setStatusFilter(f)}
                >
                  {t(`projectDetail.status.${f}`)}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="btn btn-secondary"
              data-testid="resync-skills-button"
              onClick={handleResync}
              disabled={!detail}
            >
              {t("projectDetail.resyncSkills")}
            </button>
          </div>

          {convergenceSummary && Array.isArray(convergenceSummary.agents) && (
            <div className="convergence-summary" data-testid="convergence-summary">
              {t("projectDetail.convergenceSummary")}
              <ul className="convergence-summary-list">
                {convergenceSummary.agents.map((a) => (
                  <li key={a.agent}>
                    {a.agent}
                    {a.invalid ? ` (${t("projectDetail.invalidAgent")})` : ""}
                    {a.linked?.length ? ` · +${a.linked.length}` : ""}
                    {a.unlinked?.length ? ` · -${a.unlinked.length}` : ""}
                    {a.failed?.length ? ` · !${a.failed.length}` : ""}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {bulkMessage && (
            <div
              className={`project-skills-bulk-msg project-skills-bulk-msg--${bulkMessage.type}`}
              data-testid="project-skills-bulk-message"
            >
              {bulkMessage.text}
            </div>
          )}

          {visibleKeys.length > 0 && (
            <div className="project-skills-selectall">
              <label className="project-skill-select">
                <input
                  type="checkbox"
                  data-testid="select-all-visible"
                  checked={allVisibleChecked}
                  ref={(el) => {
                    if (el) el.indeterminate = someVisibleChecked;
                  }}
                  onChange={(e) => selectAllVisible(e.target.checked)}
                />
              </label>
              <span className="project-skills-selectall-label">
                {t("projectDetail.selectAllVisible", {
                  selected: visibleSelected.length,
                  total: visibleKeys.length
                })}
              </span>
            </div>
          )}

          {repoGroups.length === 0 && externalEntries.length === 0 && !loading && (
            <p className="tab-empty">{t("projectDetail.noSkills")}</p>
          )}

          {visibleGroups.map((group) => {
            const groupKeys = group.skills.map((s) => `${group.slug}/${s.skillName}`);
            const groupSelected = groupKeys.filter((k) => selected.has(k));
            const groupAll = groupKeys.length > 0 && groupSelected.length === groupKeys.length;
            const linkedCount = group.skills.filter((s) => s.linked).length;
            const isCollapsed = collapsedGroups.has(group.slug);
            return (
              <div
                className={`project-skill-group${isCollapsed ? " project-skill-group--collapsed" : ""}`}
                key={group.slug}
                data-testid="project-skill-group"
              >
                <div className="project-skill-group-header">
                  <button
                    type="button"
                    className="project-skill-group-chevron"
                    data-testid="group-collapse-toggle"
                    aria-label={t(isCollapsed ? "projectDetail.expandGroup" : "projectDetail.collapseGroup", { group: group.slug })}
                    aria-expanded={!isCollapsed}
                    onClick={() => toggleGroupCollapsed(group.slug)}
                  >
                    {isCollapsed ? "▸" : "▾"}
                  </button>
                  <label className="project-skill-select" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      data-testid="group-select-all"
                      checked={groupAll}
                      ref={(el) => {
                        if (el) el.indeterminate = groupSelected.length > 0 && !groupAll;
                      }}
                      onChange={(e) => setGroupSelection(group, groupKeys, e.target.checked)}
                    />
                  </label>
                  <span
                    className="project-skill-group-title"
                    data-testid="group-title"
                    onClick={() => toggleGroupCollapsed(group.slug)}
                  >
                    {group.slug}
                  </span>
                  <span className="project-skill-group-count">
                    {t("projectDetail.groupCount", { linked: linkedCount, total: group.skills.length })}
                  </span>
                </div>
                {!isCollapsed && <div className="project-skill-group-body">
                  {group.skills.map((entry) => {
                    const key = `${group.slug}/${entry.skillName}`;
                    const isChecked = selected.has(key);
                    return (
                      <div
                        key={key}
                        className={`project-skill-row${isChecked ? " project-skill-row--selected" : ""}`}
                        data-testid="project-skill-row"
                      >
                        <label className="project-skill-select">
                          <input
                            type="checkbox"
                            data-testid="project-skill-checkbox"
                            checked={isChecked}
                            onChange={() => toggle(key)}
                          />
                        </label>
                        <div className="project-skill-row-main">
                          <span className="project-skill-name">
                            {entry.name || entry.skillName}
                            {entry.broken && (
                              <span className="external-skill-badge external-skill-badge--broken">
                                {t("projectDetail.broken")}
                              </span>
                            )}
                            {entry.conflict && (
                              <span className="external-skill-badge external-skill-badge--conflict">
                                {t("projectDetail.conflict")}
                              </span>
                            )}
                            {entry.linked && (
                              <span className="external-skill-badge external-skill-badge--linked">
                                {t("projectDetail.linked")}
                              </span>
                            )}
                          </span>
                          <span className="project-skill-meta">
                            {entry.slug}
                            {entry.agents?.length ? ` · ${entry.agents.join(", ")}` : ""}
                          </span>
                        </div>
                        <div className="project-skill-row-actions">
                          {entry.linked ? (
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              data-testid="skill-unlink-button"
                              onClick={() => handleUnlink(entry)}
                            >
                              {t("projectDetail.unlink")}
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="btn btn-secondary btn-sm"
                              data-testid="skill-link-button"
                              onClick={() => handleLink(entry)}
                              disabled={!!entry.conflict}
                            >
                              {t("projectDetail.link")}
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>}
              </div>
            );
          })}

          {externalEntries.length > 0 && (
            <div className="project-skill-group project-skill-group--external" data-testid="project-skill-external-section">
              <div className="project-skill-group-header">
                <span className="project-skill-group-title">{t("projectDetail.externalSection")}</span>
                <span className="project-skill-group-count">{externalEntries.length}</span>
              </div>
              <div className="project-skill-group-body">
                {externalEntries.map((entry) => (
                  <div
                    key={`external:${entry.name}`}
                    className="project-skill-row"
                    data-testid="project-skill-row"
                  >
                    <div className="project-skill-row-main">
                      <span className="project-skill-name">
                        {entry.name}
                        <span className="external-skill-badge" data-testid="external-skill-badge">
                          {t("projectDetail.external")}
                        </span>
                        {entry.conflict && (
                          <span className="external-skill-badge external-skill-badge--conflict">
                            {t("projectDetail.conflict")}
                          </span>
                        )}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {selectedList.length > 0 && (
            <div className="project-skills-bulkbar" data-testid="project-skills-bulkbar">
              <span className="project-skills-bulkbar-count">
                {t("projectDetail.selectedCount", { count: selectedList.length })}
              </span>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                data-testid="bulk-link-button"
                onClick={() => runBulk("link")}
                disabled={bulkBusy}
              >
                {t("projectDetail.bulkLink")}
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                data-testid="bulk-unlink-button"
                onClick={() => runBulk("unlink")}
                disabled={bulkBusy}
              >
                {t("projectDetail.bulkUnlink")}
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setSelected(new Set())}
                disabled={bulkBusy}
              >
                {t("projectDetail.clearSelection")}
              </button>
            </div>
          )}
        </div>
      )}

      {activeTab === "permission" && (
        <div className="tab-panel">
          <PermissionConfigTab projectId={projectId} />
        </div>
      )}
    </Modal>
  );
}
