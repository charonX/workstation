import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { getFlow } from "../api/flows.js";
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
        setError(err.message || "Failed to load flow");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [id]);

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
        <p className="loading-text">Loading flow editor...</p>
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
              Flows
            </button>
            <span className="breadcrumb-sep">/</span>
            <span className="breadcrumb-current">{flow?.name}</span>
          </div>
        </div>
        <div className="flow-editor-topbar-right">
          <button className="btn btn-secondary">Schedule</button>
          <button className="btn btn-secondary">Save</button>
          <button
            className="btn btn-primary"
            data-testid="run-flow-button"
            onClick={handleRun}
            disabled={running}
          >
            {running ? "Running..." : "▶ Run"}
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
                  value={selectedNode.data?.label || selectedNode.data?.name || ""}
                  readOnly
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
                  placeholder="outputVar"
                />
              </div>
            </div>
          ) : (
            <div className="properties-placeholder">
              Select a node to edit
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
