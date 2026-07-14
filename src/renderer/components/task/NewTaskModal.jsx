import { useState, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import Modal from "../shared/Modal.jsx";

export default function NewTaskModal({
  isOpen,
  onClose,
  onSubmit,
  projects,
  flows,
}) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [projectId, setProjectId] = useState("");
  const [flowId, setFlowId] = useState("");
  const [trigger, setTrigger] = useState("manual");
  const [cron, setCron] = useState("");
  const [inputVariables, setInputVariables] = useState("{}");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  // Reset form when opening.
  useEffect(() => {
    if (isOpen) {
      setName("");
      setProjectId(projects[0]?.id || "");
      setFlowId("");
      setTrigger("manual");
      setCron("");
      setInputVariables("{}");
      setError(null);
      setSubmitting(false);
    }
  }, [isOpen, projects]);

  // Default to first flow of selected project when project changes.
  useEffect(() => {
    const projectFlows = flows.filter((f) => f.projectId === projectId);
    if (projectFlows.length > 0) {
      setFlowId(projectFlows[0].id);
    } else {
      setFlowId("");
    }
  }, [projectId, flows]);

  const projectFlows = useMemo(
    () => flows.filter((f) => f.projectId === projectId),
    [flows, projectId]
  );

  function handleClose() {
    if (submitting) return;
    setError(null);
    onClose();
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);

    if (!projectId) {
      setError(t("tasks.projectRequired"));
      return;
    }
    if (!flowId) {
      setError(t("flows.empty"));
      return;
    }
    if (trigger === "scheduled" && !cron.trim()) {
      setError(t("tasks.cronRequired"));
      return;
    }

    let variables;
    try {
      variables = inputVariables.trim() ? JSON.parse(inputVariables) : {};
    } catch {
      setError(t("tasks.invalidVariables"));
      return;
    }

    setSubmitting(true);
    try {
      await onSubmit({
        name,
        projectId,
        flowId,
        trigger,
        cron: trigger === "scheduled" ? cron.trim() : undefined,
        variables,
      });
      handleClose();
    } catch (err) {
      setError(err.message || "Failed to create task");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={t("tasks.newTaskTitle")}
      testid="new-task-modal"
    >
      <form onSubmit={handleSubmit}>
        <div className="modal-body">
          <div className="form-group">
            <label className="form-label">{t("tasks.taskName")}</label>
            <input
              type="text"
              className="form-input"
              data-testid="task-name-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("tasks.taskNamePlaceholder")}
            />
          </div>

          <div className="form-row">
            <div className="form-group">
              <label className="form-label">{t("tasks.project")}</label>
              <select
                className="form-input"
                data-testid="task-project-select"
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
              >
                <option value="">{t("tasks.project")}</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label className="form-label">{t("tasks.flow")}</label>
              <select
                className="form-input"
                data-testid="task-flow-select"
                value={flowId}
                onChange={(e) => setFlowId(e.target.value)}
                disabled={!projectId || projectFlows.length === 0}
              >
                <option value="">
                  {projectFlows.length === 0 ? t("flows.empty") : t("tasks.flow")}
                </option>
                {projectFlows.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">{t("tasks.trigger")}</label>
            <div className="radio-group">
              <button
                type="button"
                className={`radio-option ${trigger === "manual" ? "active" : ""}`}
                data-testid="task-trigger-manual"
                onClick={() => setTrigger("manual")}
              >
                {t("tasks.manual")}
              </button>
              <button
                type="button"
                className={`radio-option ${trigger === "scheduled" ? "active" : ""}`}
                data-testid="task-trigger-scheduled"
                onClick={() => setTrigger("scheduled")}
              >
                {t("tasks.scheduled")}
              </button>
            </div>
          </div>

          {trigger === "scheduled" && (
            <div className="form-group">
              <label className="form-label">{t("tasks.cronExpression")}</label>
              <input
                type="text"
                className="form-input"
                data-testid="task-cron-input"
                value={cron}
                onChange={(e) => setCron(e.target.value)}
                placeholder={t("tasks.cronPlaceholder")}
              />
            </div>
          )}

          <div className="form-group">
            <label className="form-label">{t("tasks.inputVariables")}</label>
            <textarea
              className="form-textarea"
              data-testid="task-input-variables-textarea"
              value={inputVariables}
              onChange={(e) => setInputVariables(e.target.value)}
              placeholder={t("tasks.inputVariablesPlaceholder")}
              rows={4}
            />
          </div>

          {error && (
            <div className="form-error" data-testid="new-task-error">
              {error}
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={handleClose}
            disabled={submitting}
          >
            {t("common.cancel")}
          </button>
          <button
            type="submit"
            className="btn btn-primary"
            data-testid="submit-task-button"
            disabled={submitting}
          >
            {submitting ? t("common.loading") : t("tasks.createTask")}
          </button>
        </div>
      </form>
    </Modal>
  );
}
