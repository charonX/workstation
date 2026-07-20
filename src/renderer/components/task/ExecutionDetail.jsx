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

function basename(filePath) {
  if (!filePath) return "";
  const parts = String(filePath).split(/[\\/]/);
  return parts[parts.length - 1] || "";
}

function normalizeArtifact(artifact) {
  if (typeof artifact === "string") {
    return { path: artifact, name: basename(artifact) };
  }
  const artifactPath = artifact?.path || "";
  return {
    path: artifactPath,
    name: artifact?.name || basename(artifactPath) || "未知产物",
  };
}

function openArtifactPath(projectPath, artifactPath) {
  if (!projectPath) return;
  window.opc
    .openArtifactPath(projectPath, artifactPath)
    .catch((err) => console.error("打开产物失败:", err));
}

function showArtifactInFolder(projectPath, artifactPath) {
  if (!projectPath) return;
  window.opc
    .showArtifactInFolder(projectPath, artifactPath)
    .catch((err) => console.error("在文件夹中显示失败:", err));
}

export default function ExecutionDetail({ execution }) {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState("nodes");
  const [nodeTypes, setNodeTypes] = useState({});
  const flowId = execution?.flowId;

  // 切换执行时重置默认 tab：成功执行优先展示产物，失败执行展示日志。
  useEffect(() => {
    if (!execution) {
      setActiveTab("nodes");
      return undefined;
    }
    setActiveTab(execution.status === "success" ? "artifacts" : "logs");
  }, [execution?.id]);

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
    { key: "nodes", label: "节点", testid: "nodes-tab" },
    { key: "logs", label: "日志", testid: "logs-tab" },
    { key: "variables", label: "变量", testid: "variables-tab" },
    { key: "output", label: "输出", testid: "output-tab" },
    { key: "artifacts", label: "产物", testid: "artifacts-tab" },
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

        {activeTab === "artifacts" && (
          <div data-testid="artifacts-panel">
            {!execution.artifacts || execution.artifacts.length === 0 ? (
              <p className="detail-placeholder">本次执行未登记产物</p>
            ) : (
              <div className="artifact-list">
                {execution.artifacts.map((artifact, index) => {
                  const { path: artifactPath, name } = normalizeArtifact(artifact);
                  if (!artifactPath) return null;
                  return (
                    <div className="artifact-card" key={index}>
                      <div className="artifact-row" data-testid="artifact-row">
                        <span className="artifact-icon">FILE</span>
                        <div className="artifact-main">
                          <div className="artifact-name-row">
                            <span className="artifact-name">{name}</span>
                          </div>
                          <div className="artifact-path" data-testid="artifact-path">
                            {artifactPath}
                          </div>
                        </div>
                        <div className="artifact-actions">
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            onClick={() => openArtifactPath(execution.projectPath, artifactPath)}
                          >
                            打开
                          </button>
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            onClick={() => showArtifactInFolder(execution.projectPath, artifactPath)}
                          >
                            在文件夹中显示
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
