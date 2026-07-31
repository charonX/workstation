import React, { useState, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import { useProjects } from "../hooks/useProjects.js";
import ProjectCard from "../components/project/ProjectCard.jsx";
import ProjectFormModal from "../components/project/ProjectFormModal.jsx";
import ProjectDetailModal from "../components/project/ProjectDetailModal.jsx";
import ConfirmDialog from "../components/shared/ConfirmDialog.jsx";
import { deleteProject } from "../api/projects.js";
import "./Workspace.css";

export default function Workspace() {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const [projects, loading, error, createProject, refreshProjects, updateProject] = useProjects();
  const [formOpen, setFormOpen] = useState(false);
  const [editProject, setEditProject] = useState(null);
  const [detailProjectId, setDetailProjectId] = useState(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [search, setSearch] = useState(searchParams.get("q") || "");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState(null);
  const [agents, setAgents] = useState([]);
  const [lastConvergence, setLastConvergence] = useState(null);

  useEffect(() => {
    const q = searchParams.get("q") || "";
    if (q !== search) {
      setSearch(q);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  // Fetch the agent registry once so the edit modal can highlight drifted keys.
  useEffect(() => {
    let cancelled = false;
    const base = (typeof window !== "undefined" && window.opc?.apiBaseUrl) || "";
    fetch(`${base}/api/agents`)
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => {
        if (!cancelled) setAgents(Array.isArray(data) ? data : []);
      })
      .catch(() => {
        if (!cancelled) setAgents([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const knownKeys = useMemo(() => new Set(agents.map((a) => a.name)), [agents]);

  function invalidKeysFor(project) {
    if (!project || !Array.isArray(project.agentTypes)) return undefined;
    const drifted = project.agentTypes.filter((key) => !knownKeys.has(key));
    return drifted.length ? new Set(drifted) : undefined;
  }

  const filteredProjects = search.trim()
    ? projects.filter((p) =>
        p.name.toLowerCase().includes(search.trim().toLowerCase())
      )
    : projects;

  function handleConfigureSkills(projectId) {
    setDetailProjectId(projectId);
    setDetailOpen(true);
  }

  function handleEdit(project) {
    setEditProject(project);
    setFormOpen(true);
  }

  function handleRequestDelete(projectId) {
    setPendingDeleteId(projectId);
    setConfirmOpen(true);
  }

  async function handleConfirmDelete() {
    if (!pendingDeleteId) return;
    try {
      await deleteProject(pendingDeleteId);
      await refreshProjects();
    } catch (err) {
      // Refresh will surface the remaining state.
    } finally {
      setPendingDeleteId(null);
      setConfirmOpen(false);
    }
  }

  async function handleFormSubmit(body) {
    if (editProject) {
      const result = await updateProject(editProject.id, body);
      // REQ-SKILL-013 AC6: the PUT response carries convergence summary when
      // agentTypes changed. Surface it so the user sees the link migration.
      if (result?.convergence?.agents?.length) {
        setLastConvergence(result.convergence);
      }
    } else {
      await createProject(body);
    }
  }

  function handleFormClose() {
    setFormOpen(false);
    setEditProject(null);
  }

  return (
    <div className="page workspace-page" data-testid="workspace-page">
      <div className="page-header">
        <h1 className="page-title">{t("workspace.title")}</h1>
        <button
          className="btn btn-primary"
          data-testid="add-project-button"
          onClick={() => {
            setEditProject(null);
            setFormOpen(true);
          }}
        >
          + {t("workspace.addProject")}
        </button>
      </div>

      <div className="workspace-search">
        <input
          type="text"
          className="form-input"
          placeholder={t("workspace.searchPlaceholder")}
          value={search}
          onChange={(e) => {
            const value = e.target.value;
            setSearch(value);
            if (value.trim()) {
              setSearchParams({ q: value.trim() });
            } else {
              setSearchParams({});
            }
          }}
        />
      </div>

      {lastConvergence && Array.isArray(lastConvergence.agents) && (
        <div className="convergence-summary" data-testid="convergence-summary">
          <button
            type="button"
            className="convergence-summary-close"
            onClick={() => setLastConvergence(null)}
            aria-label="close"
          >
            ×
          </button>
          {t("projectDetail.convergenceSummary")}
          <ul className="convergence-summary-list">
            {lastConvergence.agents.map((a) => (
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

      {loading && (
        <div className="workspace-loading">{t("workspace.loading")}</div>
      )}

      {error && (
        <div className="workspace-error">{error}</div>
      )}

      {!loading && !error && filteredProjects.length === 0 && (
        <div className="workspace-empty">
          {search.trim()
            ? t("workspace.noSearchResults")
            : t("workspace.empty")}
        </div>
      )}

      {!loading && filteredProjects.length > 0 && (
        <div className="project-grid">
          {filteredProjects.map((project) => (
            <ProjectCard
              key={project.id}
              project={project}
              onConfigureSkills={handleConfigureSkills}
              onEdit={handleEdit}
              onDelete={handleRequestDelete}
            />
          ))}
        </div>
      )}

      <ProjectFormModal
        isOpen={formOpen}
        project={editProject}
        invalidKeys={editProject ? invalidKeysFor(editProject) : undefined}
        agents={agents}
        onClose={handleFormClose}
        onSubmit={handleFormSubmit}
      />

      <ProjectDetailModal
        projectId={detailProjectId}
        isOpen={detailOpen}
        onClose={() => {
          setDetailOpen(false);
          setDetailProjectId(null);
        }}
      />

      <ConfirmDialog
        isOpen={confirmOpen}
        title={t("workspace.confirmDeleteTitle")}
        message={t("workspace.confirmDeleteMessage")}
        onConfirm={handleConfirmDelete}
        onCancel={() => {
          setConfirmOpen(false);
          setPendingDeleteId(null);
        }}
      />
    </div>
  );
}
