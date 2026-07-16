import { getDb, resetDb } from "./db.js";

function timestamp() {
  return new Date().toISOString();
}

export function resetFlows(seed = []) {
  resetDb();
  const db = getDb();
  const insert = db.prepare(`
    INSERT INTO flows (id, projectId, name, description, nodeList, edges, scheduleEnabled, updatedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const flow of seed) {
    insert.run(
      flow.id ?? nextFlowId(),
      flow.projectId ?? null,
      flow.name ?? null,
      flow.description ?? null,
      JSON.stringify(flow.nodeList || []),
      JSON.stringify(flow.edges || []),
      flow.scheduleEnabled ? 1 : 0,
      flow.updatedAt ?? timestamp()
    );
  }
}

function nextFlowId() {
  const db = getDb();
  const row = db.prepare("SELECT COUNT(*) AS count FROM flows").get();
  return "f" + (row.count + 1);
}

function safeJson(value, fallback) {
  try {
    return JSON.parse(value || JSON.stringify(fallback));
  } catch {
    return fallback;
  }
}

function toFlowView(row) {
  const nodeList = safeJson(row.nodeList, []);
  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    description: row.description,
    nodes: nodeList.length,
    nodeList,
    edges: safeJson(row.edges, []),
    scheduleEnabled: Boolean(row.scheduleEnabled),
    updatedAt: row.updatedAt
  };
}

export function createFlow({ name, projectId, description }) {
  if (!name) throw new Error("Flow name is required");
  if (!projectId) throw new Error("Project is required");
  const flow = {
    id: nextFlowId(),
    projectId,
    name,
    description,
    nodeList: [],
    edges: [],
    scheduleEnabled: false,
    updatedAt: timestamp()
  };
  const db = getDb();
  db.prepare(`
    INSERT INTO flows (id, projectId, name, description, nodeList, edges, scheduleEnabled, updatedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    flow.id,
    flow.projectId,
    flow.name,
    flow.description ?? null,
    JSON.stringify(flow.nodeList),
    JSON.stringify(flow.edges),
    flow.scheduleEnabled ? 1 : 0,
    flow.updatedAt
  );
  return toFlowView(flow);
}

export function listFlows() {
  const db = getDb();
  return db.prepare("SELECT * FROM flows").all().map(toFlowView);
}

export function getFlow(id) {
  const db = getDb();
  const row = db.prepare("SELECT * FROM flows WHERE id = ?").get(id);
  return row ? toFlowView(row) : undefined;
}

export function addNode(flowId, node) {
  const db = getDb();
  const row = db.prepare("SELECT * FROM flows WHERE id = ?").get(flowId);
  if (!row) return undefined;
  const nodeList = safeJson(row.nodeList, []);
  const newNode = { id: `n${nodeList.length + 1}`, ...node };
  nodeList.push(newNode);
  db.prepare(`
    UPDATE flows SET nodeList = ?, updatedAt = ? WHERE id = ?
  `).run(JSON.stringify(nodeList), timestamp(), flowId);
  return { ...newNode };
}

export function connectNodes(flowId, sourceId, targetId) {
  const db = getDb();
  const row = db.prepare("SELECT * FROM flows WHERE id = ?").get(flowId);
  if (!row) return undefined;
  const edges = safeJson(row.edges, []);
  const edge = { id: `e${edges.length + 1}`, sourceId, targetId };
  edges.push(edge);
  db.prepare(`
    UPDATE flows SET edges = ?, updatedAt = ? WHERE id = ?
  `).run(JSON.stringify(edges), timestamp(), flowId);
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
