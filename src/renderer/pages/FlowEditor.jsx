import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { getFlow, updateFlow, debugFlow } from "../api/flows.js";
import { createExecution } from "../api/executions.js";
import NodePalette from "../components/flow/NodePalette.jsx";
import FlowCanvas from "../components/flow/FlowCanvas.jsx";
import NodeConfigPanel from "../components/flow/NodeConfigPanel.jsx";
import { validateFlowNodes } from "../components/flow/validateFlowNodes.js";
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
  const [canvasNodes, setCanvasNodes] = useState([]);
  const [canvasEdges, setCanvasEdges] = useState([]);
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
      // Icon defaults inside FlowCanvas.addNode (single icon map lives there).
      const newNode = canvasRef.current.addNode(type, name);
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

  const handleFlowStateChange = useCallback((nodes, edges) => {
    setCanvasNodes(nodes);
    setCanvasEdges(edges);
  }, []);

  const handleSave = useCallback(async () => {
    if (!flow || !canvasRef.current?.getFlowState || saving) return;
    setSaving(true);
    setSaveError(null);
    setSaveSuccess(false);
    try {
      const { nodeList, edges } = canvasRef.current.getFlowState();
      // Client-side validation mirrors flowService (tech-design §5.4):
      // invalid configs are blocked before any request is sent.
      const validationErrors = validateFlowNodes(nodeList, t);
      if (validationErrors.length > 0) {
        setSaveError(validationErrors.join("; "));
        return;
      }
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
  }, []);

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

  // Keyboard Delete to remove selected node. Guard against editable
  // targets: pressing Delete inside a form field must not delete the
  // node (BUG-class defect exposed by S5a E2E fill).
  useEffect(() => {
    function onKeyDown(event) {
      if (event.key !== "Delete" || !selectedNode) return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        return;
      }
      handleDeleteNode();
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
            onFlowStateChange={handleFlowStateChange}
          />
        </ReactFlowProvider>

        {/* Properties Panel */}
        <aside className="properties-panel" data-testid="properties-panel">
          <NodeConfigPanel
            node={selectedNode}
            nodes={canvasNodes}
            edges={canvasEdges}
            onUpdateData={handleUpdateNodeData}
            onUpdateConfig={handleUpdateConfig}
            onDelete={handleDeleteNode}
          />
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
                    <>
                      <div className="debug-output-section">
                        <h4>{t("flowEditor.debugOutput")}</h4>
                        <pre>{JSON.stringify(debugResult.output ?? t("flowEditor.debugNoOutput"), null, 2)}</pre>
                      </div>
                      {Array.isArray(debugResult.logs) && debugResult.logs.length > 0 && (
                        <div className="debug-output-section">
                          <h4>{t("flowEditor.debugLogs")}</h4>
                          <ul className="debug-log-list">
                            {debugResult.logs.map((log, index) => (
                              <li key={index} className="debug-log-item">
                                <span className="debug-log-at">{log.at ? new Date(log.at).toLocaleTimeString() : ""}</span>
                                {log.node && <span className="debug-log-node">{log.node}</span>}
                                <span className="debug-log-message">{log.message}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </>
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
