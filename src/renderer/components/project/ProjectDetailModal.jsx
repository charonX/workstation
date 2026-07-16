import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { useProjectDetail } from "../../hooks/useProjectDetail.js";
import Modal from "../shared/Modal.jsx";
import "./ProjectDetailModal.css";

export default function ProjectDetailModal({ projectId, isOpen, onClose }) {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState("skills");
  const [detail, loading, error, toggleSkill] = useProjectDetail(projectId);

  if (!isOpen) return null;

  function handleToggleSkill(skillId, currentlyLinked) {
    toggleSkill(skillId, !currentlyLinked);
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
        <div className="tab-panel">
          {loading && <p className="tab-loading">{t("projectDetail.loading")}</p>}
          {error && <p className="tab-error">{error}</p>}
          {detail?.skills && (
            <>
              <h4 className="skills-section-title">{t("projectDetail.availableSkills")}</h4>
              {detail.skills.length === 0 && (
                <p className="tab-empty">{t("projectDetail.noSkills")}</p>
              )}
              {detail.skills.map((skill) => (
                <label
                  key={skill.id}
                  className="skill-option"
                  data-testid="skill-link-checkbox"
                >
                  <input
                    type="checkbox"
                    checked={!!skill.linked}
                    onChange={() =>
                      handleToggleSkill(skill.id, skill.linked)
                    }
                  />
                  <div className="skill-option-main">
                    <span className="skill-option-title">
                      {skill.name || skill.id}
                    </span>
                    {skill.description && (
                      <span className="skill-option-meta">
                        {skill.description}
                      </span>
                    )}
                  </div>
                </label>
              ))}
            </>
          )}
        </div>
      )}
    </Modal>
  );
}
