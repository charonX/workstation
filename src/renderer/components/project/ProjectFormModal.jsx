import React, { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import Modal from "../shared/Modal.jsx";
import DirectoryInput from "../shared/DirectoryInput.jsx";
import AgentTypeMultiSelect from "../common/AgentTypeMultiSelect.jsx";
import "./ProjectFormModal.css";

function deriveRepoName(repoUrl) {
  if (!repoUrl) return "";
  try {
    const url = new URL(repoUrl);
    const normalized = url.pathname.replace(/\.git$/i, "");
    const parts = normalized.split("/").filter(Boolean);
    return parts[parts.length - 1] || "";
  } catch {
    const match = repoUrl.match(/[:/]([^/]+?)(?:\.git)?$/i);
    return match ? match[1] : "";
  }
}

/**
 * Create or edit a project.
 *
 * In create mode (no `project` prop): name/localPath/repoUrl/branch are empty,
 * sourceType defaults to "local", agentTypes defaults to [].
 *
 * In edit mode (`project` is an existing project row): the form renders with
 * the project's values pre-filled; source/name/path/branch are locked (only
 * agentTypes is editable — per the ADR-011 partial-update contract). onSubmit
 * receives {agentTypes} so the caller PUTs just that field.
 */
export default function ProjectFormModal({ isOpen, onClose, onSubmit, project, invalidKeys }) {
  const { t } = useTranslation();
  const isEdit = !!project;
  const [sourceType, setSourceType] = useState("local");
  const [name, setName] = useState("");
  const [localPath, setLocalPath] = useState("");
  const [repoUrl, setRepoUrl] = useState("");
  const [branch, setBranch] = useState("main");
  const [agentTypes, setAgentTypes] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!isOpen) return;
    if (project) {
      setSourceType(project.sourceType || "local");
      setName(project.name || "");
      setLocalPath(project.localPath || "");
      setRepoUrl(project.repoUrl || "");
      setBranch(project.branch || "main");
      setAgentTypes(Array.isArray(project.agentTypes) ? [...project.agentTypes] : []);
    } else {
      setSourceType("local");
      setName("");
      setLocalPath("");
      setRepoUrl("");
      setBranch("main");
      setAgentTypes([]);
    }
    setError(null);
  }, [isOpen, project]);

  if (!isOpen) return null;

  function handleClose() {
    setError(null);
    onClose();
  }

  function handleRepoUrlChange(value) {
    setRepoUrl(value);
    if (!name) {
      setName(deriveRepoName(value));
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      let body;
      if (isEdit) {
        // Edit flow: only agentTypes is editable; the parent PUT endpoint
        // triggers server-side convergence and returns convergence summary.
        body = { agentTypes };
      } else if (sourceType === "git") {
        body = { name, repoUrl, branch, agentTypes };
      } else {
        body = { name, localPath, agentTypes };
      }
      await onSubmit(body);
      handleClose();
    } catch (err) {
      setError(err.message || (isEdit ? "Failed to update project" : "Failed to create project"));
    } finally {
      setSubmitting(false);
    }
  }

  const titleKey = isEdit ? "projectForm.editTitle" : "projectForm.title";
  const submitKey = isEdit ? "projectForm.save" : "projectForm.add";
  const submittingKey = isEdit ? "projectForm.saving" : "projectForm.adding";

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={t(titleKey)}
      testid="project-form-modal"
    >
      <form onSubmit={handleSubmit}>
        <div className="modal-body">
          {!isEdit && (
            <div className="form-group">
              <label className="form-label">{t("projectForm.source")}</label>
              <div className="radio-group">
                <button
                  type="button"
                  className={`radio-option ${sourceType === "local" ? "active" : ""}`}
                  onClick={() => setSourceType("local")}
                  data-testid="project-source-local"
                >
                  {t("projectForm.sourceLocal")}
                </button>
                <button
                  type="button"
                  className={`radio-option ${sourceType === "git" ? "active" : ""}`}
                  onClick={() => setSourceType("git")}
                  data-testid="project-source-git"
                >
                  {t("projectForm.sourceGit")}
                </button>
              </div>
            </div>
          )}

          {!isEdit && (
            <div className="form-group">
              <label className="form-label">{t("projectForm.projectName")}</label>
              <input
                type="text"
                className="form-input"
                data-testid="project-name-input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("projectForm.projectNamePlaceholder")}
                required={sourceType === "local"}
              />
            </div>
          )}

          {!isEdit && sourceType === "local" && (
            <div className="form-group">
              <label className="form-label">{t("projectForm.localPath")}</label>
              <DirectoryInput
                value={localPath}
                onChange={setLocalPath}
                placeholder={t("projectForm.localPathPlaceholder")}
                pickerTitle={t("projectForm.localPath")}
                data-testid="project-local-path-input"
              />
            </div>
          )}

          {!isEdit && sourceType === "git" && (
            <>
              <div className="form-group">
                <label className="form-label">{t("projectForm.repoUrl")}</label>
                <input
                  type="text"
                  className="form-input"
                  data-testid="project-repo-url-input"
                  value={repoUrl}
                  onChange={(e) => handleRepoUrlChange(e.target.value)}
                  placeholder={t("projectForm.repoUrlPlaceholder")}
                  required
                />
              </div>
              <div className="form-group">
                <label className="form-label">{t("projectForm.branch")}</label>
                <input
                  type="text"
                  className="form-input"
                  data-testid="project-branch-input"
                  value={branch}
                  onChange={(e) => setBranch(e.target.value)}
                  placeholder={t("projectForm.branchPlaceholder")}
                />
              </div>
            </>
          )}

          {isEdit && (
            <div className="form-group form-group--readonly">
              <label className="form-label">{t("projectForm.projectName")}</label>
              <div className="form-readonly">{name}</div>
              {localPath && (
                <div className="form-readonly form-readonly--path">{localPath}</div>
              )}
            </div>
          )}

          <div className="form-group">
            <label className="form-label">{t("projectForm.agentTypes")}</label>
            <AgentTypeMultiSelect
              value={agentTypes}
              onChange={setAgentTypes}
              invalidKeys={invalidKeys}
            />
          </div>

          {error && <div className="form-error">{error}</div>}
        </div>

        <div className="modal-footer">
          <button type="button" className="btn btn-secondary" onClick={handleClose}>
            {t("projectForm.cancel")}
          </button>
          <button
            type="submit"
            className="btn btn-primary"
            data-testid="submit-project-button"
            disabled={submitting}
          >
            {submitting ? t(submittingKey) : t(submitKey)}
          </button>
        </div>
      </form>
    </Modal>
  );
}
