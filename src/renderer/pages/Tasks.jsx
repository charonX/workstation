import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useExecutions } from "../hooks/useExecutions.js";
import ExecutionList from "../components/task/ExecutionList.jsx";
import ExecutionDetail from "../components/task/ExecutionDetail.jsx";

export default function Tasks() {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState("executions");
  const [executions, executionsLoading, executionsError] = useExecutions();
  const [selectedExecution, setSelectedExecution] = useState(null);

  return (
    <div className="page" data-testid="tasks-page">
      <div className="page-header">
        <h1 className="page-title">{t("nav.tasks")}</h1>
      </div>

      <div className="tabs" role="tablist">
        <div
          role="tab"
          aria-selected={activeTab === "tasks"}
          className={`tab${activeTab === "tasks" ? " active" : ""}`}
          data-testid="tasks-tab"
          onClick={() => setActiveTab("tasks")}
        >
          {t("tasks.tabTasks")}
        </div>
        <div
          role="tab"
          aria-selected={activeTab === "executions"}
          className={`tab${activeTab === "executions" ? " active" : ""}`}
          data-testid="executions-tab"
          onClick={() => setActiveTab("executions")}
        >
          {t("tasks.tabExecutions")}
        </div>
      </div>

      {activeTab === "tasks" && (
        <div data-testid="tasks-panel">
          <p className="detail-placeholder">{t("tasks.tasksPlaceholder")}</p>
        </div>
      )}

      {activeTab === "executions" && (
        <div data-testid="executions-panel">
          {executionsLoading && (
            <p className="detail-placeholder">{t("common.loading")}</p>
          )}
          {executionsError && (
            <p className="detail-placeholder" style={{ color: "var(--ch-error)" }}>
              {executionsError}
            </p>
          )}
          {!executionsLoading && !executionsError && (
            <>
              <ExecutionList
                executions={executions}
                selectedId={selectedExecution?.id}
                onSelect={(ex) => setSelectedExecution(ex)}
              />
              <ExecutionDetail execution={selectedExecution} />
            </>
          )}
        </div>
      )}
    </div>
  );
}
