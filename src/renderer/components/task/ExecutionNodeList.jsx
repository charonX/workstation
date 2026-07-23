import { useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { getExecution } from "../../api/executions.js";
import { getFlow } from "../../api/flows.js";

/**
 * ExecutionNodeList — renders the node-level execution log for one execution
 * (REQ-FLOW-028 + REQ-FLOW-044): one card per node record with input/output
 * variables, branch taken, error, attempt count; agent-type nodes get an extra
 * agent-call block. callFlow nodes that have a __childExecutionId can be
 * expanded to reveal the child execution's node tree recursively.
 *
 * Props:
 *   - nodes: array of execution node records (undefined while fetching)
 *   - nodeTypes: { [nodeId]: nodeType } map derived from the flow's nodeList
 *   - indent: nesting depth (0 for top-level, 1 for first child, etc.)
 */

const EMPTY_VALUE = "—";

// null/undefined/空字符串统一视为无值
function hasValue(value) {
  return value !== null && value !== undefined && value !== "";
}

function formatVariables(vars) {
  if (!vars || Object.keys(vars).length === 0) return EMPTY_VALUE;
  return JSON.stringify(vars);
}

function formatText(value) {
  return hasValue(value) ? String(value) : EMPTY_VALUE;
}

function formatDurationMs(durationMs) {
  if (durationMs === null || durationMs === undefined) return EMPTY_VALUE;
  return `${durationMs} ms`;
}

function isAgentNode(node, nodeType) {
  if (typeof nodeType === "string" && nodeType.toLowerCase().includes("agent")) return true;
  return [node.prompt, node.output, node.model, node.provider, node.durationMs].some(hasValue);
}

// callFlow 节点：outputVariables 里含 __childExecutionId 则可展开
function getChildExecutionId(node, nodeType) {
  const type = (nodeType || "").toLowerCase();
  if (type !== "callflow" && type !== "callFlow") return null;
  const out = node.outputVariables || {};
  // Key may be `${nodeId}.__childExecutionId` or bare `__childExecutionId`
  const namespaced = `${node.nodeId}.__childExecutionId`;
  return out[namespaced] || out.__childExecutionId || null;
}

function NodeField({ label, value }) {
  return (
    <>
      <span className="execution-node-field-label">{label}</span>
      <span className="execution-node-field-value">{value}</span>
    </>
  );
}

function NodeFieldsGrid({ fields }) {
  return (
    <div className="execution-node-fields">
      {fields.map((field) => (
        <NodeField key={field.label} label={field.label} value={field.value} />
      ))}
    </div>
  );
}

/**
 * Chevron icon for expand/collapse. Uses a simple CSS-only triangle.
 */
function ChevronIcon({ expanded }) {
  return (
    <span
      className={`execution-chevron${expanded ? " expanded" : ""}`}
      aria-hidden="true"
    >
      ▶
    </span>
  );
}

/**
 * Single node card. For callFlow nodes with a childExecutionId, renders an
 * expand/collapse toggle and, when expanded, a nested ExecutionNodeList for
 * the child execution.
 */
function ExecutionNodeCard({ node, nodeType, indent }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [childNodes, setChildNodes] = useState(null);
  const [childNodeTypes, setChildNodeTypes] = useState({});
  const [childLoading, setChildLoading] = useState(false);
  const [childError, setChildError] = useState(null);

  const childExecutionId = getChildExecutionId(node, nodeType);

  // The node's persisted status is the source of truth (REQ-FLOW-037 AC1:
  // child failure propagates to parent callFlow node's status).
  const displayStatus = node.status;

  const loadChild = useCallback(async () => {
    if (!childExecutionId) return;
    setChildLoading(true);
    setChildError(null);
    try {
      const childExec = await getExecution(childExecutionId);
      setChildNodes(childExec.nodes || []);
      if (childExec.flowId) {
        try {
          const flow = await getFlow(childExec.flowId);
          const typeMap = {};
          for (const n of flow?.nodeList ?? []) {
            if (n?.id) typeMap[n.id] = n.type;
          }
          setChildNodeTypes(typeMap);
        } catch {
          // Flow deleted or unavailable; fall back to empty type map.
          setChildNodeTypes({});
        }
      }
    } catch (err) {
      setChildError(err.message || "Failed to load subflow");
    } finally {
      setChildLoading(false);
    }
  }, [childExecutionId]);

  const toggleExpand = useCallback(() => {
    if (!expanded && childNodes === null && !childLoading) {
      loadChild();
    }
    setExpanded((prev) => !prev);
  }, [expanded, childNodes, childLoading, loadChild]);

  const baseFields = [
    { label: t("execution.nodeInput"), value: formatVariables(node.inputVariables) },
    { label: t("execution.nodeOutput"), value: formatVariables(node.outputVariables) },
    { label: t("execution.nodeBranch"), value: formatText(node.branchTaken) },
    { label: t("execution.nodeError"), value: formatText(node.error) },
    { label: t("execution.nodeAttempts"), value: formatText(node.attemptCount) },
  ];

  const agentFields = [
    { label: t("execution.agentPrompt"), value: formatText(node.prompt) },
    { label: t("execution.agentOutput"), value: formatText(node.output) },
    { label: t("execution.agentModel"), value: formatText(node.model) },
    { label: t("execution.agentProvider"), value: formatText(node.provider) },
    { label: t("execution.status"), value: formatText(node.status) },
    { label: t("execution.duration"), value: formatDurationMs(node.durationMs) },
  ];

  const isExpandable = !!childExecutionId;

  return (
    <div className="execution-node-row">
      <div
        className="execution-node"
        data-testid={`execution-detail-node-${node.nodeId}`}
      >
        <div className="execution-node-header">
          <div className="execution-node-header-left">
            {isExpandable && (
              <button
                type="button"
                className="execution-expand-btn"
                data-testid={`execution-callflow-expand-${node.nodeId}`}
                onClick={toggleExpand}
                aria-label={expanded ? t("execution.collapseSubflow") : t("execution.expandSubflow")}
                aria-expanded={expanded}
                title={expanded ? t("execution.collapseSubflow") : t("execution.expandSubflow")}
              >
                <ChevronIcon expanded={expanded} />
              </button>
            )}
            <span className="execution-node-name">{node.nodeName || node.nodeId}</span>
            <span className="execution-node-id">{node.nodeId}</span>
          </div>
          {displayStatus && (
            <span
              className={`status status-${displayStatus}`}
              data-testid={`execution-node-status-${node.nodeId}`}
              data-status={displayStatus}
            >
              <span className="status-dot"></span>
              {displayStatus}
            </span>
          )}
        </div>

        <NodeFieldsGrid fields={baseFields} />

        {isAgentNode(node, nodeType) && (
          <div className="execution-node-agent" data-testid="execution-node-agent">
            <div className="execution-node-agent-title">{t("execution.agentCall")}</div>
            <NodeFieldsGrid fields={agentFields} />
          </div>
        )}
      </div>

      {/* Nested child nodes container (lazy rendered) */}
      {isExpandable && expanded && (
        <div
          className="execution-callflow-children"
          data-testid={`execution-callflow-children-${node.nodeId}`}
          data-indent={String(indent + 1)}
        >
          {childLoading && (
            <p className="detail-placeholder">{t("common.loading")}</p>
          )}
          {childError && !childLoading && (
            <p className="detail-placeholder">{childError}</p>
          )}
          {!childLoading && !childError && childNodes && (
            <ExecutionNodeList
              nodes={childNodes}
              nodeTypes={childNodeTypes}
              indent={indent + 1}
            />
          )}
        </div>
      )}
    </div>
  );
}

export default function ExecutionNodeList({ nodes, nodeTypes, indent = 0 }) {
  const { t } = useTranslation();

  if (!nodes) {
    return <p className="detail-placeholder">{t("common.loading")}</p>;
  }
  if (nodes.length === 0) {
    return <p className="detail-placeholder">{t("execution.noNodes")}</p>;
  }

  return (
    <div
      className="execution-node-list"
      data-indent={String(indent)}
    >
      {nodes.map((node) => (
        <ExecutionNodeCard
          key={node.id || node.nodeId}
          node={node}
          nodeType={nodeTypes?.[node.nodeId]}
          indent={indent}
        />
      ))}
    </div>
  );
}
