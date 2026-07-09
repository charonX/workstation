import React, { useState } from "react";
import { useProjectDetail } from "../../hooks/useProjectDetail.js";
import "./ProjectDetailModal.css";

export default function ProjectDetailModal({ projectId, isOpen, onClose }) {
  const [activeTab, setActiveTab] = useState("overview");
  const [detail, loading, error, toggleSkill] = useProjectDetail(projectId);

  if (!isOpen) return null;

  function handleToggleSkill(skillId, currentlyLinked) {
    toggleSkill(skillId, !currentlyLinked);
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal"
        data-testid="project-detail-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2 className="modal-title">
            {detail?.overview?.name || "Project Detail"}
          </h2>
          <button className="icon-btn" onClick={onClose} type="button">
            ✕
          </button>
        </div>

        <div className="modal-body">
          <div className="tabs">
            <button
              className={`tab ${activeTab === "overview" ? "active" : ""}`}
              onClick={() => setActiveTab("overview")}
            >
              Overview
            </button>
            <button
              className={`tab ${activeTab === "skills" ? "active" : ""}`}
              onClick={() => setActiveTab("skills")}
            >
              Skills
            </button>
          </div>

          {activeTab === "overview" && (
            <div className="tab-panel">
              {loading && <p className="tab-loading">Loading...</p>}
              {error && <p className="tab-error">{error}</p>}
              {detail?.overview && (
                <div className="meta-list">
                  <div className="meta-row">
                    <span className="meta-label">Project Name</span>
                    <span className="meta-value">{detail.overview.name}</span>
                  </div>
                  {detail.overview.localPath && (
                    <div className="meta-row">
                      <span className="meta-label">Local Path</span>
                      <span className="meta-value">{detail.overview.localPath}</span>
                    </div>
                  )}
                  {detail.overview.repoUrl && (
                    <div className="meta-row">
                      <span className="meta-label">Repository URL</span>
                      <span className="meta-value">{detail.overview.repoUrl}</span>
                    </div>
                  )}
                  <div className="meta-row">
                    <span className="meta-label">Flows</span>
                    <span className="meta-value">{detail.overview.flowsCount ?? 0}</span>
                  </div>
                  <div className="meta-row">
                    <span className="meta-label">Runs</span>
                    <span className="meta-value">{detail.overview.runsCount ?? 0}</span>
                  </div>
                  <div className="meta-row">
                    <span className="meta-label">Updated</span>
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
              {loading && <p className="tab-loading">Loading...</p>}
              {error && <p className="tab-error">{error}</p>}
              {detail?.skills && (
                <>
                  <h4 className="skills-section-title">Available Skills</h4>
                  {detail.skills.length === 0 && (
                    <p className="tab-empty">No skills available.</p>
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
        </div>

        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
