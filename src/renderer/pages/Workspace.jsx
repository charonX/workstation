import React, { useState } from "react";
import { useProjects } from "../hooks/useProjects.js";
import ProjectCard from "../components/project/ProjectCard.jsx";
import ProjectFormModal from "../components/project/ProjectFormModal.jsx";
import ProjectDetailModal from "../components/project/ProjectDetailModal.jsx";
import "./Workspace.css";

export default function Workspace() {
  const [projects, loading, error, createProject] = useProjects();
  const [formOpen, setFormOpen] = useState(false);
  const [detailProjectId, setDetailProjectId] = useState(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [search, setSearch] = useState("");

  const filteredProjects = search.trim()
    ? projects.filter((p) =>
        p.name.toLowerCase().includes(search.trim().toLowerCase())
      )
    : projects;

  function handleConfigureSkills(projectId) {
    setDetailProjectId(projectId);
    setDetailOpen(true);
  }

  return (
    <div className="page workspace-page" data-testid="workspace-page">
      <div className="page-header">
        <h1 className="page-title">Projects</h1>
        <button
          className="btn btn-primary"
          data-testid="add-project-button"
          onClick={() => setFormOpen(true)}
        >
          + Add Project
        </button>
      </div>

      <div className="workspace-search">
        <input
          type="text"
          className="form-input"
          placeholder="Search projects..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {loading && (
        <div className="workspace-loading">Loading projects...</div>
      )}

      {error && (
        <div className="workspace-error">{error}</div>
      )}

      {!loading && !error && filteredProjects.length === 0 && (
        <div className="workspace-empty">
          {search.trim()
            ? "No projects match your search."
            : 'No projects yet. Click "+ Add Project" to get started.'}
        </div>
      )}

      {!loading && filteredProjects.length > 0 && (
        <div className="project-grid">
          {filteredProjects.map((project) => (
            <ProjectCard
              key={project.id}
              project={project}
              onConfigureSkills={handleConfigureSkills}
            />
          ))}
        </div>
      )}

      <ProjectFormModal
        isOpen={formOpen}
        onClose={() => setFormOpen(false)}
        onSubmit={createProject}
      />

      <ProjectDetailModal
        projectId={detailProjectId}
        isOpen={detailOpen}
        onClose={() => {
          setDetailOpen(false);
          setDetailProjectId(null);
        }}
      />
    </div>
  );
}
