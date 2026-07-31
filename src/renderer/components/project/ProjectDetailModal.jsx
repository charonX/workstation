import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { useProjectDetail } from "../../hooks/useProjectDetail.js";
import Modal from "../shared/Modal.jsx";
import "./ProjectDetailModal.css";

/**
 * Project detail modal. The skills tab renders the project-skills-section:
 * a flat list of entries (linked/unlinked library skills + external entries
 * discovered by disk scan), with link/unlink affordances, a resync button,
 * and the most recent convergence summary.
 *
 * Entry shapes (from useProjectDetail):
 *   origin="repo":     { slug, skillName, name?, description?, agents, origin, linked, broken?, conflict? }
 *   origin="external": { name, agents, origin, conflict? }
 */
export default function ProjectDetailModal({ projectId, isOpen, onClose }) {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState("skills");
  const {
    detail,
    entries,
    loading,
    error,
    linkSkill,
    unlinkSkill,
    resyncSkills,
    convergenceSummary
  } = useProjectDetail(projectId);

  if (!isOpen) return null;

  function handleLink(entry) {
    linkSkill(entry.slug, entry.skillName);
  }

  function handleUnlink(entry) {
    unlinkSkill(entry.slug, entry.skillName);
  }

  function handleResync() {
    resyncSkills();
  }

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

          {entries.length === 0 && !loading && (
            <p className="tab-empty">{t("projectDetail.noSkills")}</p>
          )}

          {entries.map((entry) => {
            const isExternal = entry.origin === "external";
            const displayName = isExternal ? entry.name : entry.name || entry.skillName;
            const key = isExternal ? `external:${entry.name}` : `${entry.slug}/${entry.skillName}`;
            const linked = !isExternal && !!entry.linked;
            return (
              <div
                key={key}
                className="project-skill-row"
                data-testid="project-skill-row"
              >
                <div className="project-skill-row-main">
                  <span className="project-skill-name">
                    {displayName}
                    {isExternal && (
                      <span className="external-skill-badge" data-testid="external-skill-badge">
                        {t("projectDetail.external")}
                      </span>
                    )}
                    {entry.conflict && (
                      <span className="external-skill-badge external-skill-badge--conflict">
                        {t("projectDetail.conflict")}
                      </span>
                    )}
                    {entry.broken && (
                      <span className="external-skill-badge external-skill-badge--broken">
                        {t("projectDetail.broken")}
                      </span>
                    )}
                  </span>
                  <span className="project-skill-meta">
                    {isExternal ? null : entry.slug}
                    {entry.agents?.length ? ` · ${entry.agents.join(", ")}` : ""}
                  </span>
                </div>
                <div className="project-skill-row-actions">
                  {isExternal ? null : linked ? (
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
        </div>
      )}
    </Modal>
  );
}
