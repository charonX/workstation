import { useTranslation } from "react-i18next";

/**
 * ExecutionNodeList — renders the node-level execution log for one execution
 * (REQ-FLOW-028): one card per node record with input/output variables,
 * branch taken, error, attempt count; agent-type nodes get an extra
 * agent-call block (prompt/output/model/provider/status/durationMs).
 *
 * Props:
 *   - nodes: array of execution node records (undefined while the detail
 *     fetch is still in flight)
 *   - nodeTypes: { [nodeId]: nodeType } map derived from the flow's nodeList
 *     (used to recognise agent nodes even when the mock path recorded no
 *     agent call details)
 */

const EMPTY_VALUE = "—";

function formatVariables(vars) {
  if (!vars || Object.keys(vars).length === 0) return EMPTY_VALUE;
  return JSON.stringify(vars);
}

function formatText(value) {
  if (value === null || value === undefined || value === "") return EMPTY_VALUE;
  return String(value);
}

function formatDurationMs(durationMs) {
  if (durationMs === null || durationMs === undefined) return EMPTY_VALUE;
  return `${durationMs} ms`;
}

// mock agent 路径不产 agent 调用详情（tech-design §5.6：prompt/model 等列为
// NULL），因此优先用 flow 节点类型判定；flow 已删除等场景回落到记录字段启发式。
function isAgentNode(node, nodeType) {
  if (typeof nodeType === "string" && nodeType.toLowerCase().includes("agent")) return true;
  return [node.prompt, node.output, node.model, node.provider, node.durationMs].some(
    (value) => value !== null && value !== undefined && value !== ""
  );
}

function NodeField({ label, value }) {
  return (
    <>
      <span className="execution-node-field-label">{label}</span>
      <span className="execution-node-field-value">{value}</span>
    </>
  );
}

function ExecutionNodeCard({ node, nodeType }) {
  const { t } = useTranslation();
  return (
    <div className="execution-node" data-testid="execution-node">
      <div className="execution-node-header">
        <div>
          <span className="execution-node-name">{node.nodeName || node.nodeId}</span>
          <span className="execution-node-id">{node.nodeId}</span>
        </div>
        {node.status && (
          <span className={`status status-${node.status}`}>
            <span className="status-dot"></span>
            {node.status}
          </span>
        )}
      </div>

      <div className="execution-node-fields">
        <NodeField label={t("execution.nodeInput")} value={formatVariables(node.inputVariables)} />
        <NodeField label={t("execution.nodeOutput")} value={formatVariables(node.outputVariables)} />
        <NodeField label={t("execution.nodeBranch")} value={formatText(node.branchTaken)} />
        <NodeField label={t("execution.nodeError")} value={formatText(node.error)} />
        <NodeField label={t("execution.nodeAttempts")} value={formatText(node.attemptCount)} />
      </div>

      {isAgentNode(node, nodeType) && (
        <div className="execution-node-agent" data-testid="execution-node-agent">
          <div className="execution-node-agent-title">{t("execution.agentCall")}</div>
          <div className="execution-node-fields">
            <NodeField label={t("execution.agentPrompt")} value={formatText(node.prompt)} />
            <NodeField label={t("execution.agentOutput")} value={formatText(node.output)} />
            <NodeField label={t("execution.agentModel")} value={formatText(node.model)} />
            <NodeField label={t("execution.agentProvider")} value={formatText(node.provider)} />
            <NodeField label={t("execution.status")} value={formatText(node.status)} />
            <NodeField label={t("execution.duration")} value={formatDurationMs(node.durationMs)} />
          </div>
        </div>
      )}
    </div>
  );
}

export default function ExecutionNodeList({ nodes, nodeTypes }) {
  const { t } = useTranslation();

  if (!nodes) {
    return <p className="detail-placeholder">{t("common.loading")}</p>;
  }
  if (nodes.length === 0) {
    return <p className="detail-placeholder">{t("execution.noNodes")}</p>;
  }

  return (
    <div className="execution-node-list">
      {nodes.map((node) => (
        <ExecutionNodeCard key={node.id} node={node} nodeType={nodeTypes?.[node.nodeId]} />
      ))}
    </div>
  );
}
