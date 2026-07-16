// REQ-TRACE: codex-harness-desktop/REQ-WORKSPACE-003, REQ-FLOW-002, REQ-DASH-001
// REQ-VERSION: v1-hash:4b1313dc9c3b59ccfee20bf82bc8fb49d36a5b86a2006abff3f9c33d56cc3035
// CAPABILITY-TRACE: workspace-management, flow-orchestration, information-aggregation
// ENTITY-TRACE: project, flow, dashboard
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: false

/**
 * HTTP API seed helpers for E2E tests.
 * These create prerequisite data via the same REST API the renderer uses,
 * keeping E2E tests focused on UI behavior rather than setup clicks.
 */

/**
 * @param {string} apiBaseUrl
 * @param {object} body
 * @returns {Promise<object>}
 */
async function createProject(apiBaseUrl, body) {
  const res = await fetch(`${apiBaseUrl}/api/projects`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`createProject failed: ${res.status}`);
  return res.json();
}

/**
 * @param {string} apiBaseUrl
 * @param {object} body
 * @returns {Promise<object>}
 */
async function createFlow(apiBaseUrl, body) {
  const res = await fetch(`${apiBaseUrl}/api/flows`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`createFlow failed: ${res.status}`);
  return res.json();
}

/**
 * @param {string} apiBaseUrl
 * @param {object} body
 * @returns {Promise<object>}
 */
async function createExecution(apiBaseUrl, body) {
  const res = await fetch(`${apiBaseUrl}/api/executions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`createExecution failed: ${res.status}`);
  return res.json();
}

/**
 * @param {string} apiBaseUrl
 * @param {object} body
 * @returns {Promise<object>}
 */
async function installSkill(apiBaseUrl, body) {
  const startRes = await fetch(`${apiBaseUrl}/api/skills/install`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!startRes.ok) throw new Error(`installSkill start failed: ${startRes.status}`);
  const { jobId } = await startRes.json();

  const streamRes = await fetch(`${apiBaseUrl}/api/skills/install/${jobId}/stream`);
  if (!streamRes.ok) throw new Error(`installSkill stream failed: ${streamRes.status}`);

  const reader = streamRes.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop();
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const event = JSON.parse(line.slice(6));
      if (event.type === "success") return { repo: event.repo, skills: event.skills };
      if (event.type === "error") throw new Error(event.message || "installSkill failed");
    }
  }

  throw new Error("installSkill stream ended without result");
}

/**
 * @param {string} apiBaseUrl
 * @param {object} patch
 * @returns {Promise<object>}
 */
async function updateSettings(apiBaseUrl, patch) {
  const res = await fetch(`${apiBaseUrl}/api/settings`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(`updateSettings failed: ${res.status}`);
  return res.json();
}

module.exports = {
  createProject,
  createFlow,
  createExecution,
  installSkill,
  updateSettings,
};
