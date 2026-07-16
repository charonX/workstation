import { useTranslation } from "react-i18next";

/**
 * ExecutionList — renders a table of executions.
 * Props:
 *   - executions: array of execution objects
 *   - selectedId: string | null — currently selected execution
 *   - onSelect: (execution) => void — called when a row is clicked
 */
export default function ExecutionList({ executions, selectedId, onSelect }) {
  const { t } = useTranslation();

  function formatDate(isoString) {
    if (!isoString) return "—";
    const d = new Date(isoString);
    return d.toLocaleString();
  }

  function formatDuration(duration) {
    if (duration === null || duration === undefined) return "—";
    if (duration < 60) return `${duration}s`;
    return `${Math.floor(duration / 60)}m ${duration % 60}s`;
  }

  return (
    <div className="execution-list" data-testid="execution-list">
      <div className="table" data-testid="execution-table">
        <div className="table-header" role="rowgroup">
          <span>{t("execution.flow")}</span>
          <span>{t("execution.project")}</span>
          <span>{t("execution.trigger")}</span>
          <span>{t("execution.status")}</span>
          <span>{t("execution.startedAt")}</span>
          <span>{t("execution.duration")}</span>
        </div>
        {executions.length === 0 ? (
          <div className="table-empty" data-testid="execution-empty">
            {t("execution.noExecutions")}
          </div>
        ) : (
          executions.map((ex) => (
            <div
              key={ex.id}
              className={`table-row${selectedId === ex.id ? " active" : ""}`}
              data-testid="execution-row"
              onClick={() => onSelect(ex)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") onSelect(ex);
              }}
            >
              <div className="cell-main">
                <span className="cell-title">{ex.flowName || "—"}</span>
                <span className="cell-meta">{ex.id}</span>
              </div>
              <span className="cell-text">{ex.projectName || "—"}</span>
              <span className="cell-text">{ex.trigger || "manual"}</span>
              <span className={`status status-${ex.status}`}>
                <span className="status-dot"></span>
                {ex.status}
              </span>
              <span className="cell-text">{formatDate(ex.startedAt)}</span>
              <span className="cell-text">{formatDuration(ex.duration)}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
