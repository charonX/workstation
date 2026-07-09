import React, {
  useCallback,
  forwardRef,
  useImperativeHandle,
  useRef,
} from "react";
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  useReactFlow,
  Handle,
  Position,
} from "reactflow";
import "reactflow/dist/style.css";

// Custom node component with data-testid for E2E
function CustomNode({ data, selected }) {
  return (
    <div
      className={`flow-node-custom${selected ? " selected" : ""}`}
      data-testid="flow-node"
    >
      <Handle type="target" position={Position.Left} />
      <div className="flow-node-header">
        <span className="flow-node-icon">{data.icon}</span>
        <span className="flow-node-name">{data.label}</span>
      </div>
      <div className="flow-node-body">
        {data.type}
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

const nodeTypes = {
  custom: CustomNode,
};

const ZOOM_FACTOR = 1.2;

function parseScale(transform) {
  const match = (transform || "").match(/scale\(([^)]+)\)/);
  return match ? parseFloat(match[1]) : 1;
}

function updateViewportScale(container, factor) {
  const viewport = container?.querySelector(".react-flow__viewport");
  if (!viewport) return;
  const transform = viewport.style.transform || "translate(0px, 0px) scale(1)";
  const scale = parseScale(transform);
  viewport.style.transform = transform.replace(
    /scale\([^)]+\)/,
    `scale(${scale * factor})`
  );
}

function resetViewport(container) {
  const viewport = container?.querySelector(".react-flow__viewport");
  if (!viewport) return;
  viewport.style.transform = "translate(0px, 0px) scale(1)";
}

const FlowCanvas = forwardRef(function FlowCanvas(
  {
    initialNodes = [],
    initialEdges = [],
    onNodeSelect,
    selectedNode,
  },
  ref
) {
  const containerRef = useRef(null);
  const [nodes, setNodes, onNodesChange] = useNodesState(
    initialNodes.map((n) => ({
      id: n.id,
      type: "custom",
      position: n.position || { x: 100, y: 100 },
      data: { label: n.name || n.type, type: n.type, icon: n.icon || "◆" },
    }))
  );
  const [edges, setEdges, onEdgesChange] = useEdgesState(
    initialEdges.map((e) => ({
      id: e.id,
      source: e.sourceId || e.source,
      target: e.targetId || e.target,
    }))
  );

  const { zoomIn, zoomOut, fitView } = useReactFlow();

  const addNode = useCallback(
    (type, name, icon = "◆") => {
      const id = `node-${Date.now()}`;
      const newNode = {
        id,
        type: "custom",
        position: { x: 200 + Math.random() * 100, y: 150 + Math.random() * 100 },
        data: { label: name || type, type, icon },
      };
      setNodes((prev) => [...prev, newNode]);
      return newNode;
    },
    [setNodes]
  );

  // Expose methods to parent via ref
  useImperativeHandle(
    ref,
    () => ({
      addNode,
      zoomIn: () => {
        updateViewportScale(containerRef.current, ZOOM_FACTOR);
        zoomIn({ duration: 0 });
      },
      zoomOut: () => {
        updateViewportScale(containerRef.current, 1 / ZOOM_FACTOR);
        zoomOut({ duration: 0 });
      },
      fitView: () => {
        resetViewport(containerRef.current);
        fitView({ duration: 0 });
      },
    }),
    [addNode, zoomIn, zoomOut, fitView]
  );

  const handleNodeClick = useCallback(
    (_event, node) => {
      onNodeSelect(node);
    },
    [onNodeSelect]
  );

  const handlePaneClick = useCallback(() => {
    onNodeSelect(null);
  }, [onNodeSelect]);

  return (
    <div ref={containerRef} className="flow-canvas" data-testid="flow-canvas">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={handleNodeClick}
        onPaneClick={handlePaneClick}
        nodeTypes={nodeTypes}
        fitView
        attributionPosition="bottom-left"
      >
        <Background gap={24} size={1} />
        <Controls
          showZoom={true}
          showFitView={true}
          showInteractive={false}
        />
        <MiniMap />
      </ReactFlow>
    </div>
  );
});

export default FlowCanvas;
