import React, { useCallback, useMemo } from "react";
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
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

export default function FlowCanvas({
  initialNodes = [],
  initialEdges = [],
  onNodeSelect,
  selectedNode,
  zoomControlsRef,
}) {
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

  // Expose addNode method via a ref-like callback
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

  // Expose addNode to parent via callback ref
  React.useImperativeHandle(
    zoomControlsRef,
    () => ({
      addNode,
    }),
    [addNode]
  );

  const onSelectionChange = useCallback(
    ({ nodes: selectedNodes }) => {
      if (selectedNodes.length > 0) {
        onNodeSelect(selectedNodes[0]);
      } else {
        onNodeSelect(null);
      }
    },
    [onNodeSelect]
  );

  return (
    <div className="flow-canvas" data-testid="flow-canvas">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onSelectionChange={onSelectionChange}
        nodeTypes={nodeTypes}
        fitView
        attributionPosition="bottom-left"
      >
        <Background gap={24} size={1} />
        <Controls
          data-testid="zoom-controls"
          showZoom={true}
          showFitView={false}
          showInteractive={false}
        />
        <MiniMap />
      </ReactFlow>
    </div>
  );
}
