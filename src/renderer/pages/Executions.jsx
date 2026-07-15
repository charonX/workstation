import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useExecutions } from "../hooks/useExecutions.js";
import ExecutionList from "../components/task/ExecutionList.jsx";
import ExecutionDetail from "../components/task/ExecutionDetail.jsx";

export default function Executions() {
  const { t } = useTranslation();
  const [executions, executionsLoading, executionsError] = useExecutions();
  const [selectedExecution, setSelectedExecution] = useState(null);

  return (
    <div className="page" data-testid="executions-page">
      <div className="page-header">
        <h1 className="page-title">{t("nav.executions")}</h1>
      </div>

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
    </div>
  );
}
