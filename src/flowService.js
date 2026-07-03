let flows = [];

export function resetFlows(seed = []) {
  flows = seed.map(f => ({ ...f, nodeList: f.nodeList || [], edges: f.edges || [] }));
}

function nextFlowId() {
  return "f" + (flows.length + 1);
}

function timestamp() {
  return new Date().toISOString();
}

function toFlowView(flow) {
  return {
    ...flow,
    nodes: flow.nodeList.length
  };
}

export function createFlow({ name, projectId, description }) {
  if (!name) throw new Error("Flow name is required");
  if (!projectId) throw new Error("Project is required");
  const flow = {
    id: nextFlowId(),
    name,
    projectId,
    description,
    nodeList: [],
    edges: [],
    scheduleEnabled: false,
    updatedAt: timestamp()
  };
  flows.push(flow);
  return toFlowView(flow);
}

export function listFlows() {
  return flows.map(toFlowView);
}

export function getFlow(id) {
  const flow = flows.find(f => f.id === id);
  return flow ? toFlowView(flow) : undefined;
}

export function addNode(flowId, node) {
  const flow = flows.find(f => f.id === flowId);
  if (!flow) return undefined;
  const newNode = { id: `n${flow.nodeList.length + 1}`, ...node };
  flow.nodeList.push(newNode);
  flow.updatedAt = timestamp();
  return { ...newNode };
}

export function connectNodes(flowId, sourceId, targetId) {
  const flow = flows.find(f => f.id === flowId);
  if (!flow) return undefined;
  const edge = { id: `e${flow.edges.length + 1}`, sourceId, targetId };
  flow.edges.push(edge);
  flow.updatedAt = timestamp();
  return { ...edge };
}

export function getNodeCategories() {
  return ["Trigger", "Agent", "Data", "Logic", "Output"];
}

export function getEditableFields({ type }) {
  const common = ["name", "outputVariable"];
  if (type === "agent") return [...common, "model", "systemPrompt"];
  return common;
}

export function toggleRun(running) {
  return running
    ? { running: false, label: "Run" }
    : { running: true, label: "Running..." };
}

export function zoomIn(current) {
  return Math.min(1.5, Math.round((current + 0.1) * 10) / 10);
}

export function zoomOut(current) {
  return Math.max(0.5, Math.round((current - 0.1) * 10) / 10);
}

export function resetZoom() {
  return 1.0;
}
