// Temporary stub for test compilation.

let flows = [];

export function resetFlows(seed = []) {
  flows = seed.map(f => ({ ...f }));
}

export function createFlow({ name, projectId, description }) {
  if (!name) throw new Error("Flow name is required");
  if (!projectId) throw new Error("Project is required");
  const id = "f" + (flows.length + 1);
  const flow = {
    id,
    name,
    projectId,
    description,
    nodes: 0,
    scheduleEnabled: false,
    updatedAt: "just now"
  };
  flows.push(flow);
  return { ...flow };
}

export function listFlows() {
  return flows.map(f => ({ ...f }));
}

export function getFlow(id) {
  return flows.find(f => f.id === id);
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
