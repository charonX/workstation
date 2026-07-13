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
  addEdge,
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

function toReactFlowEdge(edge) {
  return {
    id: edge.id,
    source: edge.sourceNodeId || edge.source,
    target: edge.targetNodeId || edge.target,
    sourceHandle: edge.sourcePort || undefined,
    targetHandle: edge.targetPort || undefined,
  };
}

function toStoredEdge(edge) {
  const stored = {
    id: edge.id,
    sourceNodeId: edge.source,
    targetNodeId: edge.target,
  };
  if (edge.sourceHandle) stored.sourcePort = edge.sourceHandle;
  if (edge.targetHandle) stored.targetPort = edge.targetHandle;
  return stored;
}

function toStoredNode(node) {
  return {
    id: node.id,
    type: node.data?.type,
    name: node.data?.label,
    position: node.position,
  };
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
    initialEdges.map(toReactFlowEdge)
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

  const onConnect = useCallback(
    (params) => setEdges((eds) => addEdge(params, eds)),
    [setEdges]
  );

  const getFlowState = useCallback(() => {
    return {
      nodeList: nodes.map(toStoredNode),
      edges: edges.map(toStoredEdge),
    };
  }, [nodes, edges]);

  // Expose methods to parent via ref
  useImperativeHandle(
    ref,
    () => ({
      addNode,
      getFlowState,
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
    [addNode, getFlowState, zoomIn, zoomOut, fitView]
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
        onConnect={onConnect}
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
