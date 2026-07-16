import React from "react";
import "./ProjectCard.css";

export default function ProjectCard({ project, onConfigureSkills, onDelete }) {
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
      </div>
      <div className="project-actions">
        <button
          className="project-action"
          data-testid="configure-skills-button"
          onClick={() => onConfigureSkills(project.id)}
        >
          Configure Skills
        </button>
        <button
          className="project-action project-action-danger"
          data-testid="project-delete-button"
          onClick={() => onDelete(project.id)}
        >
          Delete
        </button>
      </div>
    </div>
  );
}
