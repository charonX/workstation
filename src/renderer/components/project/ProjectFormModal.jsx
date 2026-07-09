import React, { useState } from "react";
import "./ProjectFormModal.css";

export default function ProjectFormModal({ isOpen, onClose, onSubmit }) {
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

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const body =
        sourceType === "git"
          ? { name, repoUrl, branch, localPath: localPath || undefined }
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
    <div className="modal-overlay" onClick={handleClose}>
      <div
        className="modal"
        data-testid="project-form-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2 className="modal-title">Add Project</h2>
          <button className="icon-btn" onClick={handleClose} type="button">
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            <div className="form-group">
              <label className="form-label">Source</label>
              <div className="radio-group">
                <button
                  type="button"
                  className={`radio-option ${sourceType === "local" ? "active" : ""}`}
                  onClick={() => setSourceType("local")}
                >
                  Local Directory
                </button>
                <button
                  type="button"
                  className={`radio-option ${sourceType === "git" ? "active" : ""}`}
                  onClick={() => setSourceType("git")}
                >
                  Git Repository
                </button>
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Project Name</label>
              <input
                type="text"
                className="form-input"
                data-testid="project-name-input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="my-project"
                required
              />
            </div>

            {sourceType === "local" && (
              <div className="form-group">
                <label className="form-label">Local Path</label>
                <input
                  type="text"
                  className="form-input"
                  data-testid="project-local-path-input"
                  value={localPath}
                  onChange={(e) => setLocalPath(e.target.value)}
                  placeholder="/Users/.../my-project"
                />
              </div>
            )}

            {sourceType === "git" && (
              <>
                <div className="form-group">
                  <label className="form-label">Repository URL</label>
                  <input
                    type="text"
                    className="form-input"
                    data-testid="project-repo-url-input"
                    value={repoUrl}
                    onChange={(e) => setRepoUrl(e.target.value)}
                    placeholder="https://github.com/..."
                    required
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Branch</label>
                  <input
                    type="text"
                    className="form-input"
                    data-testid="project-branch-input"
                    value={branch}
                    onChange={(e) => setBranch(e.target.value)}
                    placeholder="main"
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
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              data-testid="submit-project-button"
              disabled={submitting}
            >
              {submitting ? "Adding..." : "Add Project"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
