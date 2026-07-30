import * as agentRegistryService from "../../services/agentRegistryService.js";

// GET /api/agents — agent registry list (REQ-SKILL-018): pinned agents first,
// the rest sorted by displayName; each item carries name/displayName/skillsDir.
export function handleAgents(req, res) {
  if (req.method === "GET") {
    const agents = agentRegistryService
      .listAgents()
      .map(({ name, displayName, skillsDir }) => ({ name, displayName, skillsDir }));
    return ok(res, agents);
  }

  return notFound(res);
}

function ok(res, data) {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

function notFound(res) {
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "NOT_FOUND", message: "Not found" }));
}
