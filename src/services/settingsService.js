import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import * as agentRegistryService from "./agentRegistryService.js";
import { encryptSecret, decryptSecret } from "./secretStore.js";
import { expandTilde, realpathBestEffort } from "./pathUtils.js";
import { modelInCatalog } from "./modelCatalogService.js";

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

// 落盘后收紧权限（0o600）：settings.json 含渠道凭据与 agent key 密文，仅属主
// 可读写。受限环境（tests/CI）下权限设置失败可容忍（沿用 saveChannelCredentials 做法）。
function writeSettingsRestricted(settings) {
  writeSettings(settings);
  try {
    fs.chmodSync(settingsFile(), 0o600);
  } catch {
    // Ignore permission failures in restricted environments (tests, CI).
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
  // 预置 settings.json 存在（测试迁移 fixture / 用户真实配置）→ 以磁盘为真相重载，
  // 不覆盖（E13 语义：绝不破坏原文件；providerModelConfig.test.js 迁移用例依赖
  // fixture 在 startServer 后存活）。无文件 → 初始化默认并落盘（既有隔离语义）。
  if (fs.existsSync(settingsFile())) {
    settings = readSettings();
  } else {
    settings = { ...getDefaults() };
    writeSettings(settings);
  }
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
  writeSettingsRestricted(settings);
  return { appId, updatedAt: settings.channelCredentials.updatedAt };
}

// —— Agent 配置（REQ-AGENT-090：多 provider 条目 + 全局默认组合）——
// settings.agent 磁盘形态升级：{identity, providers:[{provider, apiKeyEncrypted,
// models[]}], defaultModel:{provider, model}|null}。存量旧形态（{provider,
// apiKeyEncrypted, identity, configured}）读时迁移为第一条 + 默认组合（B1/B4 零操作
// 升级）；迁移失败（settings 损坏）→ 空列表且原文件字节不动（E13）。
// 供应商枚举（签核决策 2）：{deepseek, moonshotai, moonshotai-cn}。
export const AGENT_PROVIDERS = ["deepseek", "moonshotai", "moonshotai-cn"];
// 自定义身份长度上限（签核决策 4 / PRD §7：≤2000 字符，可空）。
export const AGENT_IDENTITY_MAX_LEN = 2000;

// provider → 默认模型（对齐 pi-ai provider 模型名；faux 供测试 seam 使用）。
// REQ-AGENT-099（B8）：moonshotai 默认 kimi-k2.5 → kimi-k3（k2.5 2026-08-31 日落；
// k3 在售旗舰 视觉 + 1M）。DEFAULT_MODELS 是存量迁移与回退的兜底（REQ-099 技术事实）。
// 本常量由 agentService re-export（测试 seam：agentService.DEFAULT_MODELS，
// agentDefaultModel.test.js 同源断言 pi 运行时目录可解析——BUG-004 教训）。
export const DEFAULT_MODELS = {
  deepseek: "deepseek-v4-flash",
  moonshotai: "kimi-k3",
  "moonshotai-cn": "kimi-k3",
  faux: "faux-1",
};

function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

// 条目是否已持有密文（configured 判定与迁移归一化共用，避免表达式三处漂移）。
function hasEncryptedKey(entry) {
  return typeof entry?.apiKeyEncrypted === "string" && entry.apiKeyEncrypted !== "";
}

function configError(message) {
  const err = new Error(message);
  err.code = "E-CONFIG-INVALID";
  err.status = 400;
  return err;
}

// 默认组合指针规范化（REQ-090 标准 4：全局唯一，由结构保证）：显式值必须指向
// providers 内真实组合；否则自动重定向——新增首个条目 → 首个组合；删光 → null。
function normalizeDefaultModel(defaultModel, providers) {
  if (
    defaultModel &&
    typeof defaultModel === "object" &&
    typeof defaultModel.provider === "string" &&
    typeof defaultModel.model === "string"
  ) {
    const entry = providers.find((p) => p.provider === defaultModel.provider);
    if (entry && entry.models.includes(defaultModel.model)) {
      return { provider: defaultModel.provider, model: defaultModel.model };
    }
  }
  for (const p of providers) {
    if (p.models.length > 0) return { provider: p.provider, model: p.models[0] };
  }
  return null;
}

// 读时迁移：settings.agent → 规范形态（providers 数组 + defaultModel 指针）。
// 旧形态（单条 provider + apiKeyEncrypted）→ providers[0] + 默认组合。
// 无法迁移（段缺失/损坏）→ null（GET 回落空列表，E13 不写盘）。
function migrateAgentConfig(agent) {
  if (!agent || typeof agent !== "object") return null;
  const identity = typeof agent.identity === "string" ? agent.identity : "";
  if (Array.isArray(agent.providers)) {
    const providers = agent.providers
      .filter((p) => p && typeof p === "object" && typeof p.provider === "string" && p.provider !== "")
      .map((p) => ({
        provider: p.provider,
        apiKeyEncrypted: hasEncryptedKey(p) ? p.apiKeyEncrypted : undefined,
        // 明文 apiKey 保留（测试 fixture 直写未加密 key 的 seam；生产保存路径恒加密，
        // 明文不会出现。仅主进程内存消费——GET 视图经 loadAgentConfig/loadPublicSettings
        // 剥离，不回传）。会话级装配（provider-change / 水合按行重装）取 key 用。
        apiKey: typeof p.apiKey === "string" && p.apiKey !== "" ? p.apiKey : undefined,
        models: Array.isArray(p.models) ? p.models.filter((m) => typeof m === "string") : [],
      }));
    return { identity, providers, defaultModel: normalizeDefaultModel(agent.defaultModel, providers) };
  }
  // 旧形态（REQ-AGENT-001~004）：单条 provider + apiKeyEncrypted → 第一条 + 默认。
  if (typeof agent.provider !== "string" || agent.provider === "") return null;
  const model = DEFAULT_MODELS[agent.provider];
  return {
    identity,
    providers: [
      {
        provider: agent.provider,
        apiKeyEncrypted: hasEncryptedKey(agent) ? agent.apiKeyEncrypted : undefined,
        models: model ? [model] : [],
      },
    ],
    defaultModel: model ? { provider: agent.provider, model } : null,
  };
}

// Agent 配置只读视图（REQ-AGENT-090 接口契约）：
// GET /api/settings/agent → { identity, providers:[{provider, models[], configured}],
// defaultModel }。永不含 key（明文或密文均不返回，签核决策 5）。
// 每次直读磁盘最新状态：迁移/损坏判定以文件为真相（E13：损坏文件 → 空列表 +
// 原文件字节不动；外部覆盖文件的场景下不依赖模块缓存）。
export function loadAgentConfig() {
  const agent = migrateAgentConfig(readSettings().agent);
  if (!agent) {
    return { identity: "", providers: [], defaultModel: null };
  }
  return {
    identity: agent.identity,
    providers: agent.providers.map((p) => ({
      provider: p.provider,
      models: p.models,
      configured: hasEncryptedKey(p),
    })),
    defaultModel: agent.defaultModel,
  };
}

// 新形态条目校验 + 装配（REQ-090 标准 3）：provider 必选且 ∈ AGENT_PROVIDERS、
// 条目内 provider 不重复、models 非空且每个模型 ∈ pi-ai 静态目录；apiKey 与条目
// 成对——新增条目必填，编辑已有条目（同 provider 已有密文）可不重填。
function buildProvidersFromBody(entries, currentProviders) {
  const providers = [];
  const seen = new Set();
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") {
      throw configError("条目格式无效");
    }
    if (typeof entry.provider !== "string" || !AGENT_PROVIDERS.includes(entry.provider)) {
      throw configError("请选择 provider");
    }
    if (seen.has(entry.provider)) {
      throw configError("provider 重复");
    }
    seen.add(entry.provider);
    if (!Array.isArray(entry.models) || entry.models.length === 0) {
      throw configError("至少选择一个模型");
    }
    for (const model of entry.models) {
      if (typeof model !== "string" || !modelInCatalog(entry.provider, model)) {
        throw configError("模型不存在");
      }
    }
    let encrypted;
    if (typeof entry.apiKey === "string" && entry.apiKey.trim() !== "") {
      encrypted = encryptSecret(entry.apiKey);
    } else {
      const existing = currentProviders.find((p) => p.provider === entry.provider);
      encrypted = existing?.apiKeyEncrypted;
      if (!encrypted) {
        throw configError("请输入 API Key");
      }
    }
    providers.push({ provider: entry.provider, apiKeyEncrypted: encrypted, models: entry.models });
  }
  return providers;
}

// body 未携带 identity（旧 renderer 表单 / 新形态省略）→ 保留当前迁移后 identity。
function identityOrCurrent(body, current) {
  return hasOwn(body, "identity") ? validateIdentity(body.identity) : (current?.identity ?? "");
}

// 保存 Agent 配置（REQ-AGENT-090 新形态 PUT /api/settings/agent）：
// 校验（PRD §7 / REQ-090 标准 3）：
// - provider 必选且 ∈ AGENT_PROVIDERS（「请选择 provider」）；
// - apiKey 与条目成对：新增条目必填；编辑已有条目（同 provider 已有密文）可不重填；
// - models 非空且 ≥1，每个模型 ∈ pi-ai 静态目录（「模型不存在」）；
// - defaultModel 自动重定向（新增首个条目 → 首个组合；删光 → null；显式值不在
//   列表 → 重定向）；identity ≤ AGENT_IDENTITY_MAX_LEN。
// 兼容旧形态（REQ-AGENT-001~004；旧 renderer 直至 Slice 5 替换）：body 含
// provider（平铺形态）→ 等价迁移为单条列表 + 默认组合。
// 校验失败抛 { code: "E-CONFIG-INVALID", status: 400 }。
export function saveAgentConfig(body = {}) {
  const base = readSettings(); // 磁盘为真相（外部改动/迁移后状态）
  const current = migrateAgentConfig(base.agent);
  const currentProviders = current?.providers ?? [];
  let next;

  if (hasOwn(body, "provider") || hasOwn(body, "apiKey")) {
    // —— 旧形态兼容：单条 provider + apiKey（整体替换，等价迁移语义）——
    if (!AGENT_PROVIDERS.includes(body.provider)) {
      throw configError("请选择供应商");
    }
    if (typeof body.apiKey !== "string" || body.apiKey.trim() === "") {
      throw configError("API key 不能为空");
    }
    const model = DEFAULT_MODELS[body.provider];
    next = {
      identity: identityOrCurrent(body, current),
      providers: [
        {
          provider: body.provider,
          apiKeyEncrypted: encryptSecret(body.apiKey),
          models: model ? [model] : [],
        },
      ],
      defaultModel: model ? { provider: body.provider, model } : null,
    };
  } else if (hasOwn(body, "providers")) {
    // —— 新形态：providers 列表 + 可选 defaultModel ——
    if (!Array.isArray(body.providers)) {
      throw configError("providers 必须是列表");
    }
    const providers = buildProvidersFromBody(body.providers, currentProviders);
    next = {
      identity: identityOrCurrent(body, current),
      providers,
      defaultModel: normalizeDefaultModel(hasOwn(body, "defaultModel") ? body.defaultModel : null, providers),
    };
  } else if (hasOwn(body, "identity")) {
    // —— identity 单独更新（REQ-AGENT-004 标准 2：存量会话热更新 systemPrompt，
    //    不重建上下文）：providers/defaultModel 原样保留 ——
    next = {
      identity: validateIdentity(body.identity),
      providers: currentProviders.map((p) => ({ ...p })),
      defaultModel: current ? normalizeDefaultModel(current.defaultModel, currentProviders) : null,
    };
  } else {
    throw configError("无有效配置字段");
  }

  settings = { ...base, agent: next };
  writeSettingsRestricted(settings);
  return loadAgentConfig();
}

// Agent 运行时装配默认（主进程消费者：agentService 水合/懒恢复、agentRouter、
// agentSessions buildSessionConfig 共用）——从规范形态（迁移后）取默认组合对应条目，
// 返回 {provider, apiKeyEncrypted, identity, configured, model}；无条目 →
// provider/model 为空串（调用方各自保留 DEFAULT_PROVIDER 兜底）。
// 形态升级过渡装配源（Slice 2 REQ-AGENT-093/095 将升级为按 agent_sessions 行读取，
// 默认组合即 NULL 行语义）。agent 参数可注入（agentRouter 传入 getSettings() 的
// 原始段并显式 `?? {}`——保留注入式单元测试 seam，不意外读盘）；缺省（无参）直读磁盘。
export function getAgentRuntimeConfig(agent = readSettings().agent) {
  const migrated = migrateAgentConfig(agent);
  if (!migrated || migrated.providers.length === 0) {
    return { provider: "", apiKeyEncrypted: undefined, identity: "", configured: false, model: "" };
  }
  const dm = migrated.defaultModel ?? null;
  const entry =
    migrated.providers.find((p) => dm && p.provider === dm.provider) ?? migrated.providers[0];
  const model =
    dm && entry.models.includes(dm.model)
      ? dm.model
      : entry.models.length > 0
        ? entry.models[0]
        : "";
  return {
    provider: entry.provider,
    apiKeyEncrypted: entry.apiKeyEncrypted,
    identity: migrated.identity,
    configured: hasEncryptedKey(entry),
    model,
  };
}

// 会话级组合解析（ADR-026 / REQ-AGENT-095 标准 1-4，Slice 2）：按 agent_sessions
// 行读取 provider/model 解析会话组合——行值优先（行带 provider/model → 命中条目用
// 行值）；行 NULL → 默认组合；行值条目已删/模型不在条目 → 回落默认组合（E12，
// fallback:true——不悬空）。providers 空 → { provider:"", model:"" }（调用方各自
// 保留 DEFAULT_PROVIDER 兜底）。entry = 命中条目原始形态（含 apiKeyEncrypted /
// 明文 apiKey fixture），供调用方取 key（entryApiKey）。
// 单点解析：agentService 水合/懒恢复、HTTP 路由（GET/PUT provider、buildSessionConfig）
// 共用本函数，避免组合语义三处漂移。每次直读磁盘最新状态（Settings 改默认 →
// 后续解析立即生效，REQ-AGENT-095 标准 5）。
export function resolveSessionModelConfig(rowProvider, rowModel) {
  const migrated = migrateAgentConfig(readSettings().agent);
  if (!migrated || migrated.providers.length === 0) {
    return { provider: "", model: "", entry: undefined, identity: migrated?.identity ?? "", fallback: false };
  }
  const dm = migrated.defaultModel;
  const defaultEntry =
    migrated.providers.find((p) => dm && p.provider === dm.provider) ?? migrated.providers[0];
  const defaultModel =
    (dm && defaultEntry.models.includes(dm.model) ? dm.model : defaultEntry.models[0]) ||
    DEFAULT_MODELS[defaultEntry.provider] ||
    defaultEntry.provider;
  if (
    typeof rowProvider === "string" &&
    rowProvider !== "" &&
    typeof rowModel === "string" &&
    rowModel !== ""
  ) {
    const entry = migrated.providers.find((p) => p.provider === rowProvider);
    if (entry && entry.models.includes(rowModel)) {
      return { provider: rowProvider, model: rowModel, entry, identity: migrated.identity, fallback: false };
    }
    // E12：行值条目已删/模型不在条目 → 回落默认组合（不悬空）。
    return {
      provider: defaultEntry.provider,
      model: defaultModel,
      entry: defaultEntry,
      identity: migrated.identity,
      fallback: true,
    };
  }
  return {
    provider: defaultEntry.provider,
    model: defaultModel,
    entry: defaultEntry,
    identity: migrated.identity,
    fallback: false,
  };
}

// 条目明文 key（E-MODEL-KEY-FAIL 语义）：密文优先（解密失败 → undefined）；明文
// apiKey fixture 兜底（测试直写 settings 的条目）；无 key → undefined。调用方自行
// 决定语义（PUT provider → 400 E-MODEL-KEY-FAIL；水合/懒恢复 → 不注入保持未配置）。
export function entryApiKey(entry) {
  if (!entry) return undefined;
  if (typeof entry.apiKeyEncrypted === "string" && entry.apiKeyEncrypted !== "") {
    try {
      return decryptSecret(entry.apiKeyEncrypted);
    } catch {
      return undefined;
    }
  }
  return typeof entry.apiKey === "string" && entry.apiKey !== "" ? entry.apiKey : undefined;
}

function validateIdentity(identity) {
  if (typeof identity !== "string" || identity.length > AGENT_IDENTITY_MAX_LEN) {
    throw configError("身份配置过长");
  }
  return identity;
}
