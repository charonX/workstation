import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useExecutions } from "../hooks/useExecutions.js";
import { useProjects } from "../hooks/useProjects.js";
import { useFlows } from "../hooks/useFlows.js";
import { createExecution } from "../api/executions.js";
import { createSchedule } from "../api/schedules.js";
import ExecutionList from "../components/task/ExecutionList.jsx";
import ExecutionDetail from "../components/task/ExecutionDetail.jsx";
import NewTaskModal from "../components/task/NewTaskModal.jsx";

export default function Tasks() {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState("executions");
  const [executions, executionsLoading, executionsError, refreshExecutions] =
    useExecutions();
  const [projects] = useProjects();
  const [flows] = useFlows();
  const [selectedExecution, setSelectedExecution] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [creating, setCreating] = useState(false);

  async function handleCreateTask({ projectId, flowId, trigger, cron, variables }) {
    setCreating(true);
    try {
      if (trigger === "scheduled") {
        await createSchedule({ projectId, flowId, cron });
      } else {
        await createExecution({ projectId, flowId, trigger, variables });
      }
      // Refresh executions list so the new run appears.
      await refreshExecutions();
      // Switch to executions tab after creating a manual task.
      if (trigger === "manual") {
        setActiveTab("executions");
      }
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="page" data-testid="tasks-page">
      <div className="page-header">
        <h1 className="page-title">{t("nav.tasks")}</h1>
        <button
          className="btn btn-primary"
          data-testid="new-task-button"
          onClick={() => setIsModalOpen(true)}
        >
          {t("tasks.newTask")}
        </button>
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

      <NewTaskModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSubmit={handleCreateTask}
        projects={projects}
        flows={flows}
      />
    </div>
  );
}
