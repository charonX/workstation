import React, {
  useCallback,
  useEffect,
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

function getDefaultConfig(type) {
  switch (type) {
    case "agent":
      return { model: "codex", systemPrompt: "" };
    case "condition":
      return { expression: "" };
    case "forEach":
      return { array: "" };
    case "while":
      return { expression: "" };
    case "output":
      return { path: "" };
    default:
      return {};
  }
}

function NodeConfigSummary({ type, config }) {
  const text =
    type === "condition"
      ? config?.expression
      : type === "forEach"
      ? config?.array
      : type === "while"
      ? config?.expression
      : type === "output"
      ? config?.path
      : type === "agent"
      ? config?.model
      : null;
  if (!text) return <span>{type}</span>;
  return (
    <span className="flow-node-config" title={text}>
      {text.length > 24 ? `${text.slice(0, 24)}…` : text}
    </span>
  );
}

// Custom node component with data-testid for E2E
function CustomNode({ id, data, selected }) {
  const isCondition = data.type === "condition";
  const outputVariables = getNodeOutputVariables(data);
  return (
    <div
      className={`flow-node-custom${selected ? " selected" : ""}`}
      data-testid="flow-node"
      data-node-id={id}
    >
      <Handle type="target" position={Position.Left} />
      <div className="flow-node-header">
        <span className="flow-node-icon">{data.icon}</span>
        <span className="flow-node-name">{data.label}</span>
      </div>
      <div className="flow-node-body">
        <NodeConfigSummary type={data.type} config={data.config} />
        {outputVariables.length > 0 && (
          <div className="flow-node-vars">
            {outputVariables.map((name, index) => (
              <span className="flow-node-var" key={`${name}-${index}`}>
                {name}
              </span>
            ))}
          </div>
        )}
      </div>
      {isCondition ? (
        <>
          <span
            className="flow-node-port-label flow-node-port-label-true"
            data-testid={`node-${id}-output-true`}
          >
            true
          </span>
          <span
            className="flow-node-port-label flow-node-port-label-false"
            data-testid={`node-${id}-output-false`}
          >
            false
          </span>
          <Handle
            type="source"
            position={Position.Right}
            id="true"
            style={{ top: "30%" }}
          />
          <Handle
            type="source"
            position={Position.Right}
            id="false"
            style={{ top: "70%" }}
          />
        </>
      ) : (
        <Handle type="source" position={Position.Right} />
      )}
    </div>
  );
}

// Declared output variables shown as chips on the node body (REQ-FLOW-018/020):
// trigger contributes its outputVariables list, other types their single
// declared output variable (config first, legacy top-level fallback).
function getNodeOutputVariables(data) {
  if (data.type === "trigger") {
    const declared = Array.isArray(data.config?.outputVariables)
      ? data.config.outputVariables
      : [];
    return declared
      .map((variable) =>
        typeof variable?.name === "string" ? variable.name.trim() : ""
      )
      .filter(Boolean);
  }
  const single = data.config?.outputVariable || data.outputVariable;
  return single ? [single] : [];
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
    outputVariable: node.data?.outputVariable,
    config: node.data?.config,
    position: node.position,
  };
}

const FlowCanvas = forwardRef(function FlowCanvas(
  {
    initialNodes = [],
    initialEdges = [],
    onNodeSelect,
    selectedNode,
    onFlowStateChange,
  },
  ref
) {
  const containerRef = useRef(null);
  const [nodes, setNodes, onNodesChange] = useNodesState(
    initialNodes.map((n) => ({
      id: n.id,
      type: "custom",
      position: n.position || { x: 100, y: 100 },
      data: {
        label: n.name || n.type,
        type: n.type,
        icon: n.icon || getIconForType(n.type),
        outputVariable: n.outputVariable || "",
        config: n.config || getDefaultConfig(n.type),
      },
    }))
  );
  const [edges, setEdges, onEdgesChange] = useEdgesState(
    initialEdges.map(toReactFlowEdge)
  );

  const { zoomIn, zoomOut, fitView } = useReactFlow();

  const addNode = useCallback(
    (type, name, icon = getIconForType(type)) => {
      const id = `node_${Date.now()}`;
      setNodes((prev) => {
        const count = prev.length;
        const newNode = {
          id,
          type: "custom",
          position: {
            x: 200 + (count % 3) * 220,
            y: 150 + Math.floor(count / 3) * 140,
          },
          data: {
            label: name || type,
            type,
            icon,
            outputVariable: "",
            config: getDefaultConfig(type),
          },
        };
        return [...prev, newNode];
      });
      // Return a synthetic node matching the shape callers expect.
      return {
        id,
        type: "custom",
        position: { x: 0, y: 0 },
        data: {
          label: name || type,
          type,
          icon,
          outputVariable: "",
          config: getDefaultConfig(type),
        },
      };
    },
    [setNodes]
  );

  const onConnect = useCallback(
    (params) => setEdges((eds) => addEdge(params, eds)),
    [setEdges]
  );

  const updateNodeData = useCallback(
    (id, data) => {
      setNodes((prev) =>
        prev.map((node) =>
          node.id === id ? { ...node, data: { ...node.data, ...data } } : node
        )
      );
    },
    [setNodes]
  );

  const deleteNode = useCallback(
    (id) => {
      setNodes((prev) => prev.filter((node) => node.id !== id));
      setEdges((prev) =>
        prev.filter((edge) => edge.source !== id && edge.target !== id)
      );
    },
    [setNodes, setEdges]
  );

  const getFlowState = useCallback(() => {
    return {
      nodeList: nodes.map(toStoredNode),
      edges: edges.map(toStoredEdge),
    };
  }, [nodes, edges]);

  // Notify the parent (properties panel / variable picker) whenever the
  // live canvas state changes, so upstream variable edits propagate
  // immediately (REQ-FLOW-022 AC4).
  useEffect(() => {
    onFlowStateChange?.(nodes, edges);
  }, [nodes, edges, onFlowStateChange]);

  // Expose methods to parent via ref
  useImperativeHandle(
    ref,
    () => ({
      addNode,
      getFlowState,
      updateNodeData,
      deleteNode,
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
    [addNode, getFlowState, updateNodeData, deleteNode, zoomIn, zoomOut, fitView]
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
