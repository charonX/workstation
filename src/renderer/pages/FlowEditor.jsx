import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { getFlow, updateFlow } from "../api/flows.js";
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
  const canvasRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
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
    if (!flow || !canvasRef.current?.getFlowState) return;
    try {
      const { nodeList, edges } = canvasRef.current.getFlowState();
      const updated = await updateFlow(flow.id, { nodeList, edges });
      setFlow(updated);
    } catch (err) {
      console.error("Failed to save flow:", err);
    }
  }, [flow]);

  const handleUpdateNodeData = useCallback(
    (field, value) => {
      if (!selectedNode || !canvasRef.current?.updateNodeData) return;
      canvasRef.current.updateNodeData(selectedNode.id, { [field]: value });
      setSelectedNode((prev) =>
        prev ? { ...prev, data: { ...prev.data, [field]: value } } : prev
      );
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
    },
    [selectedNode]
  );

  const handleDeleteNode = useCallback(() => {
    if (!selectedNode || !canvasRef.current?.deleteNode) return;
    canvasRef.current.deleteNode(selectedNode.id);
    setSelectedNode(null);
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
          <button className="btn btn-secondary">{t("flowEditor.schedule")}</button>
          <button className="btn btn-secondary" onClick={handleSave}>{t("flowEditor.save")}</button>
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
