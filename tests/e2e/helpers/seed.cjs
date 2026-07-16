// REQ-TRACE: codex-harness-desktop/REQ-WORKSPACE-003, REQ-FLOW-002, REQ-DASH-001
// REQ-VERSION: v1-hash:53fcb918ad26820e6760c66ac610791ceca2a11a981737c76234a70ea8f36569
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
  const res = await fetch(`${apiBaseUrl}/api/skills/install`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`installSkill failed: ${res.status}`);
  return res.json();
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
