import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { getFlow } from "../../api/flows.js";
import ExecutionNodeList from "./ExecutionNodeList.jsx";

/**
 * ExecutionDetail — renders the detail panel for a selected execution.
 * Props:
 *   - execution: object — the selected execution with logs, variables, output;
 *     when loaded via the detail API it also carries `nodes` (REQ-FLOW-028).
 */

// flow.nodeList -> { [nodeId]: nodeType }，供 ExecutionNodeList 识别 agent 节点。
function buildNodeTypeMap(flow) {
  const map = {};
  for (const node of flow?.nodeList ?? []) {
    if (node?.id) map[node.id] = node.type;
  }
  return map;
}

export default function ExecutionDetail({ execution }) {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState("nodes");
  const [nodeTypes, setNodeTypes] = useState({});
  const flowId = execution?.flowId;

  // flow 的 nodeList 提供节点类型，用于识别 agent 节点（mock 路径的执行记录
  // 不产 agent 调用详情，仅靠记录字段无法识别）。flow 已删除时静默回落。
  useEffect(() => {
    let cancelled = false;
    setNodeTypes({});
    if (!flowId) return undefined;
    getFlow(flowId)
      .then((flow) => {
        if (cancelled) return;
        setNodeTypes(buildNodeTypeMap(flow));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [flowId]);

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
    { key: "nodes", label: t("execution.nodes"), testid: "nodes-tab" },
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
        {activeTab === "nodes" && (
          <div data-testid="nodes-panel">
            <ExecutionNodeList nodes={execution.nodes} nodeTypes={nodeTypes} />
          </div>
        )}

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
