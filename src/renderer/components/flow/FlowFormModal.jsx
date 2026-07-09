import { useState } from "react";

export default function FlowFormModal({ projects, onSubmit, onClose }) {
  const [name, setName] = useState("");
  const [projectId, setProjectId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!name.trim() || !projectId) return;
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit({ name: name.trim(), projectId });
      onClose();
    } catch (err) {
      setError(err.message || "Failed to create flow");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-overlay" data-testid="flow-form-modal">
      <div className="modal" role="dialog" aria-modal="true">
        <div className="modal-header">
          <h2 className="modal-title">New Flow</h2>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            {error && <div className="form-error">{error}</div>}
            <div className="form-group">
              <label className="form-label" htmlFor="flow-name-input">
                Flow Name
              </label>
              <input
                id="flow-name-input"
                type="text"
                className="form-input"
                data-testid="flow-name-input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Enter flow name"
                required
              />
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="flow-project-select">
                Project
              </label>
              <select
                id="flow-project-select"
                className="form-select"
                data-testid="flow-project-select"
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
                required
              >
                <option value="">Select a project</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              data-testid="submit-flow-button"
              disabled={submitting || !name.trim() || !projectId}
            >
              {submitting ? "Creating..." : "Create Flow"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
