import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { getFlow, updateFlow, debugFlow } from "../api/flows.js";
import { createExecution } from "../api/executions.js";
import NodePalette from "../components/flow/NodePalette.jsx";
import FlowCanvas from "../components/flow/FlowCanvas.jsx";
import { ReactFlowProvider } from "reactflow";
import "./FlowEditor.css";

export default function FlowEditor() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [flow, setFlow] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedNode, setSelectedNode] = useState(null);
  const [running, setRunning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [debugOpen, setDebugOpen] = useState(false);
  const [debugVariables, setDebugVariables] = useState("{}");
  const [debugResult, setDebugResult] = useState(null);
  const [debugLoading, setDebugLoading] = useState(false);
  const [debugError, setDebugError] = useState(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const canvasRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      setHasUnsavedChanges(false);
      try {
        const data = await getFlow(id);
        if (cancelled) return;
        setFlow(data);
      } catch (err) {
        if (cancelled) return;
        setError(err.message || t("common.loading"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [id, t]);

  const handleAddNode = useCallback((type, name) => {
    if (canvasRef.current?.addNode) {
      const newNode = canvasRef.current.addNode(type, name, getIconForType(type));
      setSelectedNode(newNode);
      setHasUnsavedChanges(true);
    }
  }, []);

  const handleRun = useCallback(async () => {
    if (!flow) return;
    setRunning(true);
    try {
      await createExecution({ projectId: flow.projectId, flowId: flow.id });
    } catch (err) {
      console.error("Failed to run flow:", err);
    } finally {
      setRunning(false);
    }
  }, [flow]);

  const handleSave = useCallback(async () => {
    if (!flow || !canvasRef.current?.getFlowState || saving) return;
    setSaving(true);
    setSaveError(null);
    setSaveSuccess(false);
    try {
      const { nodeList, edges } = canvasRef.current.getFlowState();
      const updated = await updateFlow(flow.id, { nodeList, edges });
      setFlow(updated);
      setHasUnsavedChanges(false);
      setSaveSuccess(true);
    } catch (err) {
      console.error("Failed to save flow:", err);
      setSaveError(err.message || t("flowEditor.saveFailed"));
    } finally {
      setSaving(false);
    }
  }, [flow, saving, t]);

  const handlePublish = useCallback(async () => {
    if (!flow) return;
    try {
      if (flow.status === "published") {
        const updated = await updateFlow(flow.id, { status: "draft" });
        setFlow(updated);
      } else if (canvasRef.current?.getFlowState) {
        const { nodeList, edges } = canvasRef.current.getFlowState();
        const updated = await updateFlow(flow.id, { nodeList, edges, status: "published" });
        setFlow(updated);
      }
      setHasUnsavedChanges(false);
    } catch (err) {
      console.error("Failed to publish flow:", err);
    }
  }, [flow]);

  const runDebug = useCallback(async (variablesInput) => {
    if (!flow || !canvasRef.current?.getFlowState) return;
    setDebugLoading(true);
    setDebugError(null);
    setDebugResult(null);
    try {
      let variables;
      try {
        variables = JSON.parse(variablesInput || "{}");
      } catch {
        throw new Error(t("tasks.invalidVariables"));
      }
      const { nodeList, edges } = canvasRef.current.getFlowState();
      const result = await debugFlow(flow.id, { variables, nodeList, edges });
      setDebugResult(result);
    } catch (err) {
      console.error("Failed to debug flow:", err);
      setDebugError(err.message || t("flowEditor.debugFailed"));
    } finally {
      setDebugLoading(false);
    }
  }, [flow, t]);

  const handleDebugOpen = useCallback(() => {
    setDebugOpen(true);
    setDebugResult(null);
    setDebugError(null);
    setDebugVariables("{}");
    runDebug("{}");
  }, [runDebug]);

  const handleDebugClose = useCallback(() => {
    setDebugOpen(false);
  }, []);

  const handleDebugRun = useCallback(() => {
    runDebug(debugVariables);
  }, [runDebug, debugVariables]);

  const handleUpdateNodeData = useCallback(
    (field, value) => {
      if (!selectedNode || !canvasRef.current?.updateNodeData) return;
      canvasRef.current.updateNodeData(selectedNode.id, { [field]: value });
      setSelectedNode((prev) =>
        prev ? { ...prev, data: { ...prev.data, [field]: value } } : prev
      );
      setHasUnsavedChanges(true);
    },
    [selectedNode]
  );

  const handleUpdateConfig = useCallback(
    (key, value) => {
      if (!selectedNode || !canvasRef.current?.updateNodeData) return;
      const nextConfig = { ...(selectedNode.data?.config || {}), [key]: value };
      canvasRef.current.updateNodeData(selectedNode.id, { config: nextConfig });
      setSelectedNode((prev) =>
        prev ? { ...prev, data: { ...prev.data, config: nextConfig } } : prev
      );
      setHasUnsavedChanges(true);
    },
    [selectedNode]
  );

  const handleDeleteNode = useCallback(() => {
    if (!selectedNode || !canvasRef.current?.deleteNode) return;
    canvasRef.current.deleteNode(selectedNode.id);
    setSelectedNode(null);
    setHasUnsavedChanges(true);
  }, [selectedNode]);

  // Keyboard Delete to remove selected node
  useEffect(() => {
    function onKeyDown(event) {
      if (event.key === "Delete" && selectedNode) {
        handleDeleteNode();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedNode, handleDeleteNode]);

  const handleZoomIn = useCallback(() => {
    if (canvasRef.current?.zoomIn) {
      canvasRef.current.zoomIn();
    }
  }, []);

  const handleZoomOut = useCallback(() => {
    if (canvasRef.current?.zoomOut) {
      canvasRef.current.zoomOut();
    }
  }, []);

  const handleZoomReset = useCallback(() => {
    if (canvasRef.current?.fitView) {
      canvasRef.current.fitView();
    }
  }, []);

  if (loading) {
    return (
      <div className="flow-editor" data-testid="flow-editor-page">
        <p className="loading-text">{t("flowEditor.loading")}</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flow-editor" data-testid="flow-editor-page">
        <div className="card" style={{ borderColor: "var(--ch-error)" }}>
          <div className="card-body" style={{ color: "var(--ch-error)" }}>
            {error}
          </div>
        </div>
      </div>
    );
  }

  const isPublished = flow?.status === "published" && !hasUnsavedChanges;

  return (
    <div className="flow-editor" data-testid="flow-editor-page">
      {/* Topbar */}
      <header className="flow-editor-topbar">
        <div className="flow-editor-topbar-left">
          <div className="breadcrumb">
            <button className="breadcrumb-link" onClick={() => navigate("/flows")}>
              {t("flowEditor.breadcrumb")}
            </button>
            <span className="breadcrumb-sep">/</span>
            <span className="breadcrumb-current">{flow?.name}</span>
          </div>
        </div>
        <div className="flow-editor-topbar-right">
          {(saveSuccess || saveError) && (
            <div
              className={`save-feedback ${saveSuccess ? "save-success" : "save-error"}`}
              data-testid={saveSuccess ? "flow-save-success" : "flow-save-error"}
            >
              {saveSuccess ? t("flowEditor.saveSuccess") : saveError}
            </div>
          )}
          <span
            className={`flow-status-badge ${isPublished ? "status-published" : "status-draft"}`}
            data-testid="flow-status-badge"
          >
            {isPublished ? t("flowEditor.published") : t("flowEditor.draft")}
          </span>
          <button
            className="btn btn-secondary"
            data-testid="publish-flow-button"
            onClick={handlePublish}
          >
            {flow?.status === "published" ? t("flowEditor.unpublish") : t("flowEditor.publish")}
          </button>
          <button
            className="btn btn-secondary"
            data-testid="debug-flow-button"
            onClick={handleDebugOpen}
          >
            {t("flowEditor.debug")}
          </button>
          <button className="btn btn-secondary">{t("flowEditor.schedule")}</button>
          <button
            className="btn btn-secondary"
            onClick={handleSave}
            disabled={saving}
            data-testid="save-flow-button"
          >
            {saving ? t("flowEditor.saving") : t("flowEditor.save")}
          </button>
          <button
            className="btn btn-primary"
            data-testid="run-flow-button"
            onClick={handleRun}
            disabled={running}
          >
            {running ? t("flowEditor.running") : `▶ ${t("flowEditor.run")}`}
          </button>
        </div>
      </header>

      <div className="flow-editor-body">
        {/* Node Palette */}
        <NodePalette onAddNode={handleAddNode} />

        {/* Canvas - wrapped in ReactFlowProvider for useReactFlow hook */}
        <ReactFlowProvider>
          <FlowCanvas
            ref={canvasRef}
            initialNodes={flow?.nodeList || []}
            initialEdges={flow?.edges || []}
            onNodeSelect={setSelectedNode}
            selectedNode={selectedNode}
          />
        </ReactFlowProvider>

        {/* Properties Panel */}
        <aside className="properties-panel" data-testid="properties-panel">
          <h2 className="properties-title">Node Properties</h2>
          {selectedNode ? (
            <div className="properties-form">
              <div className="form-group">
                <label className="form-label">Node Name</label>
                <input
                  type="text"
                  className="form-input"
                  data-testid="node-name-input"
                  value={selectedNode.data?.label || ""}
                  onChange={(e) => handleUpdateNodeData("label", e.target.value)}
                />
              </div>
              <div className="form-group">
                <label className="form-label">Type</label>
                <input
                  type="text"
                  className="form-input"
                  value={selectedNode.data?.type || ""}
                  readOnly
                />
              </div>
              <div className="form-group">
                <label className="form-label">Output Variable</label>
                <input
                  type="text"
                  className="form-input"
                  data-testid="node-output-variable-input"
                  value={selectedNode.data?.outputVariable || ""}
                  onChange={(e) =>
                    handleUpdateNodeData("outputVariable", e.target.value)
                  }
                />
              </div>
              <NodeTypeFields
                type={selectedNode.data?.type}
                config={selectedNode.data?.config || {}}
                onChange={handleUpdateConfig}
              />
              <button
                className="btn btn-danger"
                data-testid="node-delete-button"
                onClick={handleDeleteNode}
              >
                Delete Node
              </button>
            </div>
          ) : (
            <div className="properties-placeholder">
              {t("flowEditor.selectNode")}
            </div>
          )}
        </aside>
      </div>

      {/* Zoom controls overlay with test ids - wired to React Flow */}
      <div className="zoom-controls-overlay">
        <button className="zoom-btn" data-testid="zoom-in-button" title="Zoom In" onClick={handleZoomIn}>
          +
        </button>
        <button className="zoom-btn" data-testid="zoom-out-button" title="Zoom Out" onClick={handleZoomOut}>
          −
        </button>
        <button className="zoom-btn" data-testid="zoom-reset-button" title="Reset Zoom" onClick={handleZoomReset}>
          ⊘
        </button>
      </div>

      {debugOpen && (
        <div className="debug-modal-overlay" data-testid="debug-modal">
          <div className="debug-modal-content">
            <div className="debug-modal-header">
              <h3>{t("flowEditor.debugTitle")}</h3>
              <button
                className="debug-close-button"
                data-testid="debug-close-button"
                onClick={handleDebugClose}
              >
                {t("common.close")}
              </button>
            </div>
            <div className="debug-modal-body">
              <div className="form-group">
                <label className="form-label">{t("flowEditor.debugVariables")}</label>
                <textarea
                  className="form-textarea"
                  value={debugVariables}
                  onChange={(e) => setDebugVariables(e.target.value)}
                  rows={4}
                  placeholder='{"name": "world"}'
                />
              </div>
              <button
                className="btn btn-primary"
                onClick={handleDebugRun}
                disabled={debugLoading}
              >
                {debugLoading ? t("flowEditor.debugRunning") : t("flowEditor.debugRun")}
              </button>
              {debugError && (
                <div className="debug-error">{debugError}</div>
              )}
              {debugLoading && (
                <div className="debug-output-panel" data-testid="debug-output-panel">
                  {t("flowEditor.debugRunning")}
                </div>
              )}
              {!debugLoading && (debugResult || debugError) && (
                <div className="debug-output-panel" data-testid="debug-output-panel">
                  {debugError ? (
                    <div className="debug-error">{debugError}</div>
                  ) : (
                    <pre>{JSON.stringify(debugResult.output ?? t("flowEditor.debugNoOutput"), null, 2)}</pre>
                  )}
                </div>
              )}
              {!debugLoading && !debugResult && !debugError && (
                <div className="debug-output-panel" data-testid="debug-output-panel">
                  {t("flowEditor.debugNoOutput")}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function NodeTypeFields({ type, config, onChange }) {
  switch (type) {
    case "agent":
      return (
        <>
          <div className="form-group">
            <label className="form-label">Model</label>
            <select
              className="form-input"
              data-testid="agent-model-select"
              value={config.model || "codex"}
              onChange={(e) => onChange("model", e.target.value)}
            >
              <option value="codex">Codex</option>
              <option value="claude-code">Claude Code</option>
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">System Prompt</label>
            <textarea
              className="form-textarea"
              data-testid="agent-system-prompt-textarea"
              value={config.systemPrompt || ""}
              onChange={(e) => onChange("systemPrompt", e.target.value)}
              rows={4}
            />
          </div>
        </>
      );
    case "condition":
      return (
        <div className="form-group">
          <label className="form-label">Expression</label>
          <input
            type="text"
            className="form-input"
            data-testid="condition-expression-input"
            value={config.expression || ""}
            onChange={(e) => onChange("expression", e.target.value)}
          />
        </div>
      );
    case "forEach":
      return (
        <div className="form-group">
          <label className="form-label">Array</label>
          <input
            type="text"
            className="form-input"
            data-testid="foreach-array-input"
            value={config.array || ""}
            onChange={(e) => onChange("array", e.target.value)}
          />
        </div>
      );
    case "while":
      return (
        <div className="form-group">
          <label className="form-label">Expression</label>
          <input
            type="text"
            className="form-input"
            data-testid="while-expression-input"
            value={config.expression || ""}
            onChange={(e) => onChange("expression", e.target.value)}
          />
        </div>
      );
    case "output":
      return (
        <div className="form-group">
          <label className="form-label">Output Path</label>
          <input
            type="text"
            className="form-input"
            data-testid="output-path-input"
            value={config.path || ""}
            onChange={(e) => onChange("path", e.target.value)}
          />
        </div>
      );
    default:
      return null;
  }
}

function getIconForType(type) {
  const icons = {
    trigger: "⏱",
    condition: "◈",
    forEach: "↻",
    while: "⟳",
    agent: "◆",
    skill: "◈",
    data: "{}",
    output: "▢",
  };
  return icons[type] || "◆";
}
