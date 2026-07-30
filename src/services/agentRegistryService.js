import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Agent Registry service (REQ-SKILL-018): single runtime entry point for the
// 75-agent directory-convention snapshot produced by
// scripts/sync-agent-registry.mjs (ADR-011: registry data follows upstream via
// snapshot, zero runtime library calls).
//
// ADR-009: lazy load — the snapshot is read from disk on first access and
// cached; importing this module has no file-system or environment side
// effects. Tests may point OPC_AGENT_REGISTRY_SNAPSHOT at a fixture and call
// resetAgentRegistryCache() to force a re-read.

const DEFAULT_SNAPSHOT_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "agentRegistry.json"
);

// Display configuration is a workstation product decision and deliberately
// lives outside the upstream snapshot (tech-design D3): pinned agents first in
// this exact order, the rest sorted by displayName.
const PINNED_ORDER = ["claude-code", "codex", "opencode", "cursor", "kimi-code-cli"];

let cache = null;

// Baseline = the snapshot shipped with the app (DEFAULT_SNAPSHOT_PATH), kept
// separate from the env-overridable working snapshot. agentTypes validation
// accepts keys known to either (REQ-WORKSPACE-013: a declaration that drifts
// out of the current registry stays writable — the data is preserved and the
// agent is marked invalid at convergence time — while never-known keys are
// still rejected with INVALID_AGENT_TYPES). In production the two snapshots
// are the same file; they diverge only under the OPC_AGENT_REGISTRY_SNAPSHOT
// test seam.
let baselineCache = null;

function ensureBaselineLoaded() {
  if (baselineCache !== null) return;
  const snapshot = JSON.parse(fs.readFileSync(DEFAULT_SNAPSHOT_PATH, "utf-8"));
  baselineCache = new Set(snapshot.agents.map((agent) => agent.name));
}

function snapshotPath() {
  return process.env.OPC_AGENT_REGISTRY_SNAPSHOT || DEFAULT_SNAPSHOT_PATH;
}

function ensureLoaded() {
  if (cache !== null) return;
  const snapshot = JSON.parse(fs.readFileSync(snapshotPath(), "utf-8"));
  const byName = new Map();
  const byDisplayName = new Map();
  for (const agent of snapshot.agents) {
    byName.set(agent.name, agent);
    byDisplayName.set(agent.displayName, agent.name);
  }
  cache = { snapshot, byName, byDisplayName };
}

export function resetAgentRegistryCache() {
  cache = null;
  baselineCache = null;
}

export function isValidAgentKey(key) {
  ensureLoaded();
  return typeof key === "string" && cache.byName.has(key);
}

// Validation predicate for project agentTypes writes: current working
// snapshot ∪ shipped baseline. Unlike isValidAgentKey (current snapshot only,
// used for operational lookups such as skillsDir resolution), this keeps
// drifted-but-once-known keys writable.
export function isKnownAgentKey(key) {
  if (typeof key !== "string") return false;
  ensureBaselineLoaded();
  if (baselineCache.has(key)) return true;
  return isValidAgentKey(key);
}

export function getAgentKeyByDisplayName(displayName) {
  ensureLoaded();
  return cache.byDisplayName.get(displayName) ?? null;
}

// Expands a globalSkillsDir template at call time (ADR-009: never at load
// time). Two template shapes are possible (see deriveTemplate in the sync
// script):
//   - "~/<config-root>/...": the first whitelisted env var that is set
//     replaces the leading config-root segment — mirroring the upstream
//     pattern `process.env.V?.trim() || join(home, '.x')`.
//   - anything else (bare "~", "$VAR" placeholders, absolute paths): handled
//     by placeholder expansion in expandDollarTemplate.
// Environment variables outside the agent's globalEnvDeps whitelist are never
// read.
function expandGlobalTemplate(template, envDeps) {
  if (template == null) return null;
  if (template.startsWith("~/")) {
    for (const varName of envDeps) {
      const value = process.env[varName]?.trim();
      if (!value) continue;
      const rest = template.slice(2);
      const slash = rest.indexOf("/");
      return slash === -1 ? value : path.join(value, rest.slice(slash + 1));
    }
  }
  return expandDollarTemplate(template, envDeps);
}

function expandDollarTemplate(template, envDeps) {
  const tokens = template.match(/\$[A-Z_]+/g) ?? [];
  let result = template;
  for (const token of tokens) {
    const varName = token.slice(1);
    if (!envDeps.includes(varName)) continue; // non-whitelisted env is never read
    const value = process.env[varName]?.trim();
    if (!value) return null; // declared dependency unset: cannot expand faithfully
    result = result.replaceAll(token, value);
  }
  if (result === "~") return os.homedir();
  if (result.startsWith("~/")) return path.join(os.homedir(), result.slice(2));
  return result;
}

// Returns the expanded global skills dir for an agent key, or null when the
// key is unknown or the agent has no global skills dir. Never throws for
// unknown keys (E9 drift handling builds on this).
export function getGlobalSkillsDir(key) {
  ensureLoaded();
  const agent = cache.byName.get(key);
  if (!agent) return null;
  return expandGlobalTemplate(agent.globalSkillsDir, agent.globalEnvDeps ?? []);
}

// Registry list for GET /api/agents and the agent-type selector: pinned agents
// first in PINNED_ORDER, the rest by displayName. Unknown pinned keys (future
// snapshot drift) are skipped silently so the route stays stable.
export function listAgents() {
  ensureLoaded();
  const pinned = PINNED_ORDER.map((key) => cache.byName.get(key)).filter(Boolean);
  const rest = cache.snapshot.agents
    .filter((agent) => !PINNED_ORDER.includes(agent.name))
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
  return [...pinned, ...rest];
}
