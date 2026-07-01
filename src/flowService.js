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
