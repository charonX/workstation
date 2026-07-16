import { useState } from "react";
import { useTranslation } from "react-i18next";

/**
 * ExecutionDetail — renders the detail panel for a selected execution.
 * Props:
 *   - execution: object — the selected execution with logs, variables, output
 */
export default function ExecutionDetail({ execution }) {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState("logs");

  if (!execution) {
    return (
      <div className="detail-panel" data-testid="execution-detail-panel">
        <div className="detail-body">
          <p className="detail-placeholder">{t("execution.selectExecution")}</p>
        </div>
      </div>
    );
  }

  const tabs = [
    { key: "logs", label: t("execution.logs"), testid: "logs-tab" },
    { key: "variables", label: t("execution.variables"), testid: "variables-tab" },
    { key: "output", label: t("execution.output"), testid: "output-tab" },
  ];

  function formatDate(isoString) {
    if (!isoString) return "—";
    const d = new Date(isoString);
    return d.toLocaleString();
  }

  return (
    <div className="detail-panel" data-testid="execution-detail-panel">
      <div className="detail-header">
        <div>
          <h2 className="detail-title">
            {t("execution.detailTitle")} #{execution.id}
          </h2>
          <div className="detail-subtitle">
            {execution.flowName || execution.flowId} · {execution.projectName || execution.projectId} · {execution.trigger} · {formatDate(execution.startedAt)}
          </div>
        </div>
        <div className="detail-status">
          <span className={`status status-${execution.status}`}>
            <span className="status-dot"></span>
            {execution.status}
          </span>
        </div>
      </div>

      <div className="detail-tabs" role="tablist">
        {tabs.map((tab) => (
          <div
            key={tab.key}
            role="tab"
            aria-selected={activeTab === tab.key}
            className={`detail-tab${activeTab === tab.key ? " active" : ""}`}
            data-testid={tab.testid}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.label}
          </div>
        ))}
      </div>

      <div className="detail-body" role="tabpanel">
        {activeTab === "logs" && (
          <div data-testid="logs-panel">
            {execution.logs && execution.logs.length > 0 ? (
              execution.logs.map((log, i) => (
                <div key={i} className="log-entry">
                  <span className="log-time">
                    {log.at ? new Date(log.at).toLocaleTimeString() : "—"}
                  </span>
                  <span className="log-level">{log.node || "INFO"}</span>
                  <span className="log-msg">{log.message || ""}</span>
                </div>
              ))
            ) : (
              <p className="detail-placeholder">{t("execution.noLogs")}</p>
            )}
          </div>
        )}

        {activeTab === "variables" && (
          <div data-testid="variables-panel">
            {execution.variables && Object.keys(execution.variables).length > 0 ? (
              <div className="kv-grid">
                {Object.entries(execution.variables).map(([key, value]) => (
                  <>
                    <div key={`k-${key}`} className="kv-key">{key}</div>
                    <div key={`v-${key}`} className="kv-value">
                      {typeof value === "object" ? JSON.stringify(value) : String(value)}
                    </div>
                  </>
                ))}
              </div>
            ) : (
              <p className="detail-placeholder">{t("execution.noVariables")}</p>
            )}
          </div>
        )}

        {activeTab === "output" && (
          <div data-testid="output-panel">
            {execution.output !== null && execution.output !== undefined ? (
              <pre className="output-box">
                {typeof execution.output === "object"
                  ? JSON.stringify(execution.output, null, 2)
                  : String(execution.output)}
              </pre>
            ) : (
              <p className="detail-placeholder">{t("execution.noOutput")}</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
