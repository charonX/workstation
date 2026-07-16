import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import Modal from "../shared/Modal.jsx";
import DirectoryInput from "../shared/DirectoryInput.jsx";
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

export default function ProjectFormModal({ isOpen, onClose, onSubmit }) {
  const { t } = useTranslation();
  const [sourceType, setSourceType] = useState("local");
  const [name, setName] = useState("");
  const [localPath, setLocalPath] = useState("");
  const [repoUrl, setRepoUrl] = useState("");
  const [branch, setBranch] = useState("main");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  if (!isOpen) return null;

  function handleClose() {
    setName("");
    setLocalPath("");
    setRepoUrl("");
    setBranch("main");
    setSourceType("local");
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
      const body =
        sourceType === "git"
          ? { name, repoUrl, branch }
          : { name, localPath };
      await onSubmit(body);
      handleClose();
    } catch (err) {
      setError(err.message || "Failed to create project");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={t("projectForm.title")}
      testid="project-form-modal"
    >
      <form onSubmit={handleSubmit}>
        <div className="modal-body">
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

          {sourceType === "local" && (
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

          {sourceType === "git" && (
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

          {error && (
            <div className="form-error">{error}</div>
          )}
        </div>

        <div className="modal-footer">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={handleClose}
          >
            {t("projectForm.cancel")}
          </button>
          <button
            type="submit"
            className="btn btn-primary"
            data-testid="submit-project-button"
            disabled={submitting}
          >
            {submitting ? t("projectForm.adding") : t("projectForm.add")}
          </button>
        </div>
      </form>
    </Modal>
  );
}
