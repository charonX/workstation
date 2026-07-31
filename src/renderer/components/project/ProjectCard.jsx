import React from "react";
import { useTranslation } from "react-i18next";
import "./ProjectCard.css";

export default function ProjectCard({ project, onConfigureSkills, onEdit, onDelete }) {
  const { t } = useTranslation();
  return (
    <div className="project-card" data-testid="project-card">
      <div className="project-card-header">
        <div>
          <h3 className="project-name">{project.name}</h3>
          <div className="project-path">{project.localPath || project.repoUrl || "—"}</div>
        </div>
      </div>
      <div className="project-meta">
        <span>{project.flowsCount ?? 0} flows</span>
        <span>{project.runsCount ?? 0} runs</span>
        {Array.isArray(project.agentTypes) && project.agentTypes.length > 0 && (
          <span>{project.agentTypes.length} agents</span>
        )}
      </div>
      <div className="project-actions">
        <button
          className="project-action"
          data-testid="edit-project-button"
          onClick={() => onEdit?.(project)}
        >
          {t("projectCard.edit")}
        </button>
        <button
          className="project-action"
          data-testid="configure-skills-button"
          onClick={() => onConfigureSkills(project.id)}
        >
          {t("projectCard.configureSkills")}
        </button>
        <button
          className="project-action project-action-danger"
          data-testid="project-delete-button"
          onClick={() => onDelete(project.id)}
        >
          {t("projectCard.delete")}
        </button>
      </div>
    </div>
  );
}
