// REQ-TRACE: codex-harness-desktop/REQ-WORKSPACE-003, REQ-FLOW-002, REQ-DASH-001
// REQ-VERSION: v1-hash:5d0bdb3d2786189d093861e7afc37e0431ca15d5e7ae871afd42b421bf45f108
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
 * Poll execution detail until it reaches a terminal state.
 * @param {string} apiBaseUrl
 * @param {string} executionId
 * @param {object} options
 * @param {number} options.timeoutMs
 * @returns {Promise<object>}
 */
async function waitForExecutionTerminal(apiBaseUrl, executionId, { timeoutMs = 15000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await fetch(`${apiBaseUrl}/api/executions/${executionId}`);
    if (!res.ok) throw new Error(`waitForExecutionTerminal failed: ${res.status}`);
    const detail = await res.json();
    if (detail.status === "success" || detail.status === "error") return detail;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`waitForExecutionTerminal timed out for ${executionId}`);
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
  waitForExecutionTerminal,
  updateSettings,
};
