import { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import { useExecutions, useExecution } from "../hooks/useExecutions.js";
import ExecutionList from "../components/task/ExecutionList.jsx";
import ExecutionDetail from "../components/task/ExecutionDetail.jsx";

export default function Executions() {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const highlightId = searchParams.get("highlight");

  const [executions, executionsLoading, executionsError] = useExecutions();
  const [selectedExecution, setSelectedExecution] = useState(null);
  const lastHandledHighlight = useRef(null);

  // 详情 API 额外携带 nodes（节点级执行记录，REQ-FLOW-028）；拉取完成前
  // 先回落到列表行（含 logs/variables/output），保证详情面板立即可用。
  // id 守卫避免切换选择时短暂显示上一条执行的详情。
  const highlightInList = highlightId ? executions.find((ex) => ex.id === highlightId) : null;
  const detailId =
    highlightId && !executionsLoading && !highlightInList
      ? highlightId
      : selectedExecution?.id;
  const [executionDetail] = useExecution(detailId);

  // 从通知点击跳转时，URL 携带 highlight=executionId；加载完成后自动选中对应执行。
  // 列表中不存在时通过详情 API 拉取。选中后清除 highlight 参数，避免刷新重复触发。
  useEffect(() => {
    if (!highlightId || executionsLoading) return;
    if (lastHandledHighlight.current === highlightId) return;

    const fromList = executions.find((ex) => ex.id === highlightId);
    const target = fromList || executionDetail;
    if (!target) return;

    lastHandledHighlight.current = highlightId;
    setSelectedExecution(target);

    const next = new URLSearchParams(searchParams);
    if (next.has("highlight")) {
      next.delete("highlight");
      setSearchParams(next, { replace: true });
    }
  }, [highlightId, executionsLoading, executions, executionDetail, searchParams, setSearchParams]);

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
