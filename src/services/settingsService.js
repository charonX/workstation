import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import * as agentRegistryService from "./agentRegistryService.js";
import { encryptSecret } from "./secretStore.js";
import { expandTilde, realpathBestEffort } from "./pathUtils.js";

function resolveConfigDir() {
  if (process.env.OPC_WORKSTATION_CONFIG_DIR) {
    return process.env.OPC_WORKSTATION_CONFIG_DIR;
  }
  return path.join(os.homedir(), ".opc-workstation");
}

export function configDir() {
  return resolveConfigDir();
}

function settingsFile() {
  return path.join(configDir(), "settings.json");
}

// REQ-SKILL-005 AC1: the default skill library path is ~/.opc-workstation/skills
// (renamed from the legacy ~/.codex-harness/skills; old content is not migrated).
// Computed lazily (ADR-009): os.homedir() must not run at module load time.
function getDefaults() {
  return {
    workspaceRoot: "~/codex-harness-workspace",
    skillRepoPath: path.join(os.homedir(), ".opc-workstation", "skills"),
    theme: "dark",
    language: "en-US",
    density: "comfortable"
  };
}

function normalizePath(value) {
  if (typeof value !== "string") return value;
  const home = os.homedir();
  if (value.startsWith(home + path.sep)) {
    return "~" + value.slice(home.length);
  }
  return value;
}

function normalizeSettings(settings) {
  return {
    ...settings,
    workspaceRoot: normalizePath(settings.workspaceRoot)
    // skillRepoPath is intentionally NOT tilde-normalized: loadSettings must
    // return the stored/default value verbatim (REQ-SKILL-005 AC1 expects the
    // absolute default; a user-supplied "~/..." value round-trips unchanged).
  };
}

function normalizeForConflictCheck(inputPath) {
  const expanded = expandTilde(inputPath);
  if (!expanded || typeof expanded !== "string") return null;
  const resolved = realpathBestEffort(path.resolve(expanded));
  const trimmed = resolved.endsWith(path.sep) ? resolved.slice(0, -1) : resolved;
  return trimmed.toLowerCase();
}

function isPrefixEitherWay(a, b) {
  return a === b || a.startsWith(b + path.sep) || b.startsWith(a + path.sep);
}

// REQ-SKILL-005 AC2 (E11): the skill library must never coincide with — or
// nest inside, or contain — any agent's global scan dir (tech-design D3/E11:
// bidirectional prefix containment after ~ expansion, realpath and case
// normalization). Returns the conflicting agent keys.
export function findSkillRepoPathConflicts(candidatePath) {
  const candidate = normalizeForConflictCheck(candidatePath);
  if (!candidate) return [];
  const conflicts = [];
  for (const agent of agentRegistryService.listAgents()) {
    const globalDir = agentRegistryService.getGlobalSkillsDir(agent.name);
    if (!globalDir) continue;
    const scanDir = normalizeForConflictCheck(globalDir);
    if (!scanDir) continue;
    if (isPrefixEitherWay(candidate, scanDir)) {
      conflicts.push(agent.name);
    }
  }
  return conflicts.sort();
}

function readSettings() {
  // BUG-009 fix: readSettings is now called lazily on first access (not at module
  // top-level), so OPC_WORKSTATION_CONFIG_DIR is guaranteed to be set by the time
  // any caller invokes loadSettings/saveSettings. This makes settingsService
  // resilient to ESM import hoisting and bundler reordering (vite/rollup may place
  // import statements before inline bootstrap code in the output bundle).
  const file = settingsFile();
  try {
    const data = fs.readFileSync(file, "utf8");
    return { ...getDefaults(), ...JSON.parse(data) };
  } catch {
    return { ...getDefaults() };
  }
}

function writeSettings(settings) {
  const dir = configDir();
  const file = settingsFile();
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(settings, null, 2));
  } catch {
    // Ignore persistence failures in restricted environments (tests, CI).
  }
}

// BUG-009: lazy init — null sentinel; populated on first loadSettings()/saveSettings().
// Previously this was `let settings = readSettings()` which ran at module load time,
// before the Electron main process had a chance to set OPC_WORKSTATION_CONFIG_DIR
// (ESM imports are hoisted, and vite bundles the bootstrap-env inline AFTER other
// static imports, so env was unset when readSettings ran).
let settings = null;

function ensureLoaded() {
  if (settings === null) {
    settings = readSettings();
  }
}

export function resetSettings() {
  settings = { ...getDefaults() };
  writeSettings(settings);
  return loadSettings();
}

export function loadSettings() {
  ensureLoaded();
  return normalizeSettings({ ...settings });
}

export function saveSettings(partial) {
  ensureLoaded();
  if (partial && Object.prototype.hasOwnProperty.call(partial, "workspaceRoot") && partial.workspaceRoot === "") {
    throw new Error("Workspace root is required");
  }
  if (partial && Object.prototype.hasOwnProperty.call(partial, "skillRepoPath")) {
    if (typeof partial.skillRepoPath !== "string" || partial.skillRepoPath.trim() === "") {
      throw new Error("Skill repository path is required");
    }
    // REQ-SKILL-005 AC2 (E11): reject library paths conflicting with any
    // agent's global scan dir; the error body carries the conflicting agents.
    const conflicts = findSkillRepoPathConflicts(partial.skillRepoPath);
    if (conflicts.length > 0) {
      const err = new Error(
        `Skill repository path conflicts with agent global skills directories: ${conflicts.join(", ")}`
      );
      err.status = 400;
      err.code = "SKILL_REPO_PATH_CONFLICT";
      err.conflicts = conflicts;
      throw err;
    }
  }
  settings = { ...settings, ...partial };
  writeSettings(settings);
  return loadSettings();
}

export function saveChannelCredentials({ appId, appSecret } = {}) {
  ensureLoaded();
  if (!appId || !appSecret) {
    throw new Error("E-CHANNEL-CRED: App ID and App Secret are required");
  }
  settings = {
    ...settings,
    channelCredentials: { appId, appSecret, updatedAt: new Date().toISOString() }
  };
  writeSettings(settings);
  try {
    fs.chmodSync(settingsFile(), 0o600);
  } catch {
    // Ignore permission failures in restricted environments (tests, CI).
  }
  return { appId, updatedAt: settings.channelCredentials.updatedAt };
}

// —— Agent 配置（REQ-AGENT-001~004）——
// 供应商枚举（签核决策 2）：{deepseek, moonshotai, moonshotai-cn}。
export const AGENT_PROVIDERS = ["deepseek", "moonshotai", "moonshotai-cn"];
// 自定义身份长度上限（签核决策 4 / PRD §7：≤2000 字符，可空）。
export const AGENT_IDENTITY_MAX_LEN = 2000;

function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

// Agent 配置只读视图：永不外泄 key（明文或密文均不返回，签核决策 5）。
// GET /api/settings/agent 返回 { provider, configured, identity }。
export function loadAgentConfig() {
  ensureLoaded();
  const agent = settings.agent ?? {};
  return {
    provider: agent.provider ?? "",
    configured: agent.configured === true,
    identity: agent.identity ?? ""
  };
}

// 保存 Agent 配置（provider/key 或 identity 可单独/组合更新）：
// - provider+apiKey 成对出现（切换供应商时校验对应 key，PRD §7）→ key 经
//   secretStore 加密后落 settings.json（无明文，签核决策 5）；
// - identity 单独更新 → 由调用方触发存量会话热更新（REQ-AGENT-004，见路由层）；
// - key 仅非空校验（签核修订①：前缀不校验，准确性由用户负责，测试连接兜底）。
// 校验失败抛 { code: "E-CONFIG-INVALID", status: 400 }。
export function saveAgentConfig(body = {}) {
  ensureLoaded();
  const current = settings.agent ?? {};
  const next = { ...current };
  let touched = false;

  const hasCredentials = hasOwn(body, "provider") || hasOwn(body, "apiKey");
  if (hasCredentials) {
    if (!AGENT_PROVIDERS.includes(body.provider)) {
      const err = new Error("请选择供应商");
      err.code = "E-CONFIG-INVALID";
      err.status = 400;
      throw err;
    }
    if (typeof body.apiKey !== "string" || body.apiKey.trim() === "") {
      const err = new Error("API key 不能为空");
      err.code = "E-CONFIG-INVALID";
      err.status = 400;
      throw err;
    }
    next.provider = body.provider;
    next.apiKeyEncrypted = encryptSecret(body.apiKey);
    next.configured = true;
    touched = true;
  }

  if (hasOwn(body, "identity")) {
    if (typeof body.identity !== "string" || body.identity.length > AGENT_IDENTITY_MAX_LEN) {
      const err = new Error("身份配置过长");
      err.code = "E-CONFIG-INVALID";
      err.status = 400;
      throw err;
    }
    next.identity = body.identity;
    touched = true;
  }

  if (!touched) {
    const err = new Error("无有效配置字段");
    err.code = "E-CONFIG-INVALID";
    err.status = 400;
    throw err;
  }

  settings = { ...settings, agent: next };
  writeSettings(settings);
  return loadAgentConfig();
}
