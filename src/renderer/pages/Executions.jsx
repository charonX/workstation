import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useExecutions, useExecution } from "../hooks/useExecutions.js";
import ExecutionList from "../components/task/ExecutionList.jsx";
import ExecutionDetail from "../components/task/ExecutionDetail.jsx";

export default function Executions() {
  const { t } = useTranslation();
  const [executions, executionsLoading, executionsError] = useExecutions();
  const [selectedExecution, setSelectedExecution] = useState(null);
  // 详情 API 额外携带 nodes（节点级执行记录，REQ-FLOW-028）；拉取完成前
  // 先回落到列表行（含 logs/variables/output），保证详情面板立即可用。
  // id 守卫避免切换选择时短暂显示上一条执行的详情。
  const [executionDetail] = useExecution(selectedExecution?.id);
  const detailForPanel =
    executionDetail && executionDetail.id === selectedExecution?.id
      ? executionDetail
      : selectedExecution;

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
            <ExecutionDetail execution={detailForPanel} />
          </>
        )}
      </div>
    </div>
  );
}
