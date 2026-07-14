import { getDb, resetDb } from "../db.js";

function timestamp() {
  return new Date().toISOString();
}

export function resetFlows(seed = []) {
  resetDb();
  const db = getDb();
  const insert = db.prepare(`
    INSERT INTO flows (id, projectId, name, description, nodeList, edges, scheduleEnabled, status, publishedNodeList, publishedEdges, publishedAt, updatedAt, deletedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      flow.status || "draft",
      JSON.stringify(flow.publishedNodeList || flow.nodeList || []),
      JSON.stringify(flow.publishedEdges || flow.edges || []),
      flow.publishedAt ?? null,
      flow.updatedAt ?? timestamp(),
      flow.deletedAt ?? null
    );
  }
}

function nextFlowId() {
  const db = getDb();
  const row = db.prepare("SELECT COUNT(*) AS count FROM flows").get();
  return "f" + (row.count + 1);
}

function safeJson(value, fallback) {
  if (Array.isArray(value)) return value;
  if (typeof value === "object" && value !== null) return value;
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
    status: row.status || "draft",
    publishedAt: row.publishedAt || null,
    publishedNodeList: safeJson(row.publishedNodeList, []),
    publishedEdges: safeJson(row.publishedEdges, []),
    updatedAt: row.updatedAt
  };
}

export function createFlow({ name, projectId, description, nodes, edges }) {
  if (!name) throw new Error("Flow name is required");
  if (!projectId) throw new Error("Project is required");
  const flow = {
    id: nextFlowId(),
    projectId,
    name,
    description,
    nodeList: nodes || [],
    edges: edges || [],
    scheduleEnabled: false,
    status: "draft",
    publishedNodeList: [],
    publishedEdges: [],
    publishedAt: null,
    updatedAt: timestamp(),
    deletedAt: null
  };
  const db = getDb();
  db.prepare(`
    INSERT INTO flows (id, projectId, name, description, nodeList, edges, scheduleEnabled, status, publishedNodeList, publishedEdges, publishedAt, updatedAt, deletedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    flow.id,
    flow.projectId,
    flow.name,
    flow.description ?? null,
    JSON.stringify(flow.nodeList),
    JSON.stringify(flow.edges),
    flow.scheduleEnabled ? 1 : 0,
    flow.status,
    JSON.stringify(flow.publishedNodeList),
    JSON.stringify(flow.publishedEdges),
    flow.publishedAt,
    flow.updatedAt,
    flow.deletedAt
  );
  return toFlowView(flow);
}

export function importFlow(data) {
  if (!data.name) throw new Error("Flow name is required");
  if (!data.projectId) throw new Error("Project is required");
  const nodeList = data.nodes || data.nodeList || [];
  const edges = data.edges || [];
  const status = data.status || "draft";
  const publishedNodeList = data.publishedNodeList || (status === "published" ? nodeList : []);
  const publishedEdges = data.publishedEdges || (status === "published" ? edges : []);
  const publishedAt = data.publishedAt || (status === "published" ? timestamp() : null);
  const flow = {
    id: data.id || nextFlowId(),
    projectId: data.projectId,
    name: data.name,
    description: data.description ?? null,
    nodeList,
    edges,
    scheduleEnabled: data.scheduleEnabled ?? false,
    status,
    publishedNodeList,
    publishedEdges,
    publishedAt,
    updatedAt: data.updatedAt || timestamp(),
    deletedAt: data.deletedAt ?? null
  };
  const db = getDb();
  db.prepare(`
    INSERT INTO flows (id, projectId, name, description, nodeList, edges, scheduleEnabled, status, publishedNodeList, publishedEdges, publishedAt, updatedAt, deletedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      projectId=excluded.projectId,
      name=excluded.name,
      description=excluded.description,
      nodeList=excluded.nodeList,
      edges=excluded.edges,
      scheduleEnabled=excluded.scheduleEnabled,
      status=excluded.status,
      publishedNodeList=excluded.publishedNodeList,
      publishedEdges=excluded.publishedEdges,
      publishedAt=excluded.publishedAt,
      updatedAt=excluded.updatedAt,
      deletedAt=excluded.deletedAt
  `).run(
    flow.id,
    flow.projectId,
    flow.name,
    flow.description,
    JSON.stringify(flow.nodeList),
    JSON.stringify(flow.edges),
    flow.scheduleEnabled ? 1 : 0,
    flow.status,
    JSON.stringify(flow.publishedNodeList),
    JSON.stringify(flow.publishedEdges),
    flow.publishedAt,
    flow.updatedAt,
    flow.deletedAt
  );
  return toFlowView(flow);
}

export function exportFlow(id) {
  const db = getDb();
  const row = db.prepare("SELECT * FROM flows WHERE id = ? AND deletedAt IS NULL").get(id);
  if (!row) return undefined;
  const nodeList = safeJson(row.nodeList, []);
  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    description: row.description,
    nodes: nodeList,
    edges: safeJson(row.edges, []),
    scheduleEnabled: Boolean(row.scheduleEnabled),
    updatedAt: row.updatedAt
  };
}

export function listFlows() {
  const db = getDb();
  return db.prepare("SELECT * FROM flows WHERE deletedAt IS NULL").all().map(toFlowView);
}

export function getFlow(id) {
  const db = getDb();
  const row = db.prepare("SELECT * FROM flows WHERE id = ? AND deletedAt IS NULL").get(id);
  return row ? toFlowView(row) : undefined;
}

export function deleteFlow(id) {
  const db = getDb();
  const row = db.prepare("SELECT * FROM flows WHERE id = ? AND deletedAt IS NULL").get(id);
  if (!row) return false;
  db.prepare("UPDATE flows SET deletedAt = ? WHERE id = ?").run(timestamp(), id);
  return true;
}

export function addNode(flowId, node) {
  const db = getDb();
  const row = db.prepare("SELECT * FROM flows WHERE id = ? AND deletedAt IS NULL").get(flowId);
  if (!row) return undefined;
  const nodeList = safeJson(row.nodeList, []);
  const newNode = { id: `n${nodeList.length + 1}`, ...node };
  nodeList.push(newNode);
  db.prepare(`
    UPDATE flows SET nodeList = ?, updatedAt = ? WHERE id = ?
  `).run(JSON.stringify(nodeList), timestamp(), flowId);
  return { ...newNode };
}

export function connectNodes(flowId, sourceNodeId, targetNodeId) {
  const db = getDb();
  const row = db.prepare("SELECT * FROM flows WHERE id = ? AND deletedAt IS NULL").get(flowId);
  if (!row) return undefined;
  const edges = safeJson(row.edges, []);
  const edge = { id: `e${edges.length + 1}`, sourceNodeId, targetNodeId };
  edges.push(edge);
  db.prepare(`
    UPDATE flows SET edges = ?, updatedAt = ? WHERE id = ?
  `).run(JSON.stringify(edges), timestamp(), flowId);
  return { ...edge };
}

export function updateFlow(flowId, patch) {
  const db = getDb();
  const row = db.prepare("SELECT * FROM flows WHERE id = ? AND deletedAt IS NULL").get(flowId);
  if (!row) return undefined;

  const currentNodeList = safeJson(row.nodeList, []);
  const currentEdges = safeJson(row.edges, []);
  const nodeList = patch.nodeList !== undefined ? patch.nodeList : currentNodeList;
  const edges = patch.edges !== undefined ? patch.edges : currentEdges;
  const name = patch.name !== undefined ? patch.name : row.name;
  const description = patch.description !== undefined ? patch.description : row.description;

  let status = row.status || "draft";
  let publishedNodeList = safeJson(row.publishedNodeList, []);
  let publishedEdges = safeJson(row.publishedEdges, []);
  let publishedAt = row.publishedAt || null;

  const nodeListChanged = JSON.stringify(nodeList) !== JSON.stringify(currentNodeList);
  const edgesChanged = JSON.stringify(edges) !== JSON.stringify(currentEdges);

  if (patch.status === "published") {
    status = "published";
    publishedNodeList = nodeList;
    publishedEdges = edges;
    publishedAt = timestamp();
  } else if (patch.status === "draft") {
    status = "draft";
  } else if (status === "published" && (nodeListChanged || edgesChanged)) {
    // Editing a published flow without re-publishing reverts to draft but keeps the snapshot.
    status = "draft";
  }

  const updatedAt = timestamp();
  db.prepare(`
    UPDATE flows SET
      name = ?, description = ?, nodeList = ?, edges = ?,
      status = ?, publishedNodeList = ?, publishedEdges = ?, publishedAt = ?, updatedAt = ?
    WHERE id = ?
  `).run(
    name,
    description,
    JSON.stringify(nodeList),
    JSON.stringify(edges),
    status,
    JSON.stringify(publishedNodeList),
    JSON.stringify(publishedEdges),
    publishedAt,
    updatedAt,
    flowId
  );

  return toFlowView({
    ...row,
    name,
    description,
    nodeList,
    edges,
    status,
    publishedNodeList,
    publishedEdges,
    publishedAt,
    updatedAt
  });
}

export function getPublishedSnapshot(id) {
  const flow = getFlow(id);
  if (!flow) return undefined;
  return {
    nodeList: flow.publishedNodeList || [],
    edges: flow.publishedEdges || []
  };
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
