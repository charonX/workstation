import { useState, useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useSettings } from "../hooks/useSettings.jsx";
import DirectoryInput from "../components/shared/DirectoryInput.jsx";
import { getChannelStatus, saveChannelCredentials, reconnectChannel } from "../api/channel.js";
import {
  getAgentConfig,
  saveAgentConfig,
  fetchProviderModels,
  testConnection,
  bindingBegin,
  bindingCancel,
  bindingDelete,
} from "../api/agent.js";
import { isVisionModel } from "../modelCapabilities.js";

const DEFAULT_FORM = {
  workspaceRoot: "",
  skillRepoPath: "",
  theme: "dark",
  language: "en-US",
  density: "comfortable",
};

const DEFAULT_CHANNEL_STATUS = { status: "offline", error: null };

// Agent 配置区常量（REQ-AGENT-001/004 + REQ-AGENT-090 多 provider 列表）：身份长度
// 上限（签核决策 4）+ 供应商枚举（含中文展示名，UX settings-providers.html 形态）。
const AGENT_IDENTITY_MAX_LEN = 2000;
const AGENT_PROVIDER_OPTIONS = [
  { value: "deepseek", label: "DeepSeek（api.deepseek.com）" },
  { value: "moonshotai", label: "Moonshot AI（api.moonshot.ai）" },
  { value: "moonshotai-cn", label: "Moonshot AI 中国站（api.moonshot.cn）" },
];

// 内置模型目录展示副本（REQ-AGENT-092 回退源 = pi-ai 静态目录；本表为 renderer
// 侧同源镜像——添加条目表单「填 key 后自动刷新」前的即时展示 + 拉取失败回退
//（2026-08-13 目录核对，modelCapabilities.js 同源）。保存校验以服务端为准）。
const BUILTIN_MODEL_CATALOG = {
  deepseek: [
    { model: "deepseek-v4-flash", vision: false, reasoning: true },
    { model: "deepseek-v4-pro", vision: false, reasoning: true },
  ],
  moonshotai: [
    { model: "kimi-k3", vision: true, reasoning: true },
    { model: "kimi-k2.7-code", vision: true, reasoning: true },
    { model: "kimi-k2.7-code-highspeed", vision: true, reasoning: true },
    { model: "kimi-k2.6", vision: true, reasoning: true },
    { model: "kimi-k2.5", vision: true, reasoning: true },
    { model: "kimi-k2-turbo-preview", vision: false, reasoning: false },
    { model: "kimi-k2-thinking-turbo", vision: false, reasoning: true },
    { model: "kimi-k2-thinking", vision: false, reasoning: true },
    { model: "kimi-k2-0905-preview", vision: false, reasoning: false },
    { model: "kimi-k2-0711-preview", vision: false, reasoning: false },
  ],
  "moonshotai-cn": [
    { model: "kimi-k3", vision: true, reasoning: true },
    { model: "kimi-k2.7-code", vision: true, reasoning: true },
    { model: "kimi-k2.7-code-highspeed", vision: true, reasoning: true },
    { model: "kimi-k2.6", vision: true, reasoning: true },
    { model: "kimi-k2.5", vision: true, reasoning: true },
    { model: "kimi-k2-turbo-preview", vision: false, reasoning: false },
    { model: "kimi-k2-thinking-turbo", vision: false, reasoning: true },
    { model: "kimi-k2-thinking", vision: false, reasoning: true },
    { model: "kimi-k2-0905-preview", vision: false, reasoning: false },
    { model: "kimi-k2-0711-preview", vision: false, reasoning: false },
  ],
};

// 添加条目表单拉取状态文案（E2/E3 提示分支）。
const FETCH_STATUS = {
  noKey: { kind: "noKey", text: "填 key 后自动刷新（实时，无缓存）" },
  fetching: { kind: "fetching", text: "拉取中…" },
  fetched: { kind: "fetched", text: "已从供应商 API 拉取 · 勾选要使用的模型" },
  fallback: { kind: "fallback", text: "模型列表拉取失败，已使用内置列表（不阻塞保存）" },
};

// 检查更新状态区：checking=检查中 / hasUpdate=发现新版 / upToDate=已是最新 / error=检查失败
const STATUS_CHECKING = "checking";
const STATUS_HAS_UPDATE = "hasUpdate";
const STATUS_UP_TO_DATE = "upToDate";
const STATUS_ERROR = "error";

// 把主进程 checkUpdates 结果归一化为状态区对象（REQ-DIST-002 契约：hasUpdate / error / 其余 = 已最新）
function statusFromResult(result) {
  if (result?.hasUpdate) {
    return { kind: STATUS_HAS_UPDATE, latestVersion: result.latestVersion ?? null, error: null };
  }
  if (result?.error) {
    return { kind: STATUS_ERROR, latestVersion: null, error: result.error };
  }
  return { kind: STATUS_UP_TO_DATE, latestVersion: null, error: null };
}

// 状态行通用样式（channel 状态行 / 更新状态行共用）
const STATUS_ROW_STYLE = {
  display: "flex",
  alignItems: "center",
  gap: "var(--ch-space-3)",
  padding: "var(--ch-space-3)",
  background: "var(--ch-surface-high)",
  border: "1px solid var(--ch-border)",
  borderRadius: "var(--ch-radius-md)",
  marginBottom: "var(--ch-space-5)",
};

const UPDATE_STATUS_ROW_STYLE = {
  ...STATUS_ROW_STYLE,
  flexWrap: "wrap",
  fontSize: "var(--ch-text-sm)",
};

// Settings 页四 tab（REQ-AGENT-023 AC1/AC2，ux/settings-tabs.html 拍板）：
// 通用 / Agent 配置 / 飞书通道 / 关于与更新；label 复用既有 i18n 键。
const SETTINGS_TABS = [
  { name: "general", labelKey: "settings.general" },
  { name: "agent", labelKey: "settings.agent.title" },
  { name: "channel", labelKey: "settings.channel" },
  { name: "about", labelKey: "settings.aboutUpdate" },
];

// 面板容器（REQ-AGENT-023 AC1）：role=tabpanel + aria-labelledby 关联对应 tab；
// 未选中 hidden 但保持 DOM 挂载（REQ-AGENT-025：切换保留未保存编辑、不触发请求）。
// 四个面板共用此容器，契约属性（data-tab-panel / aria-labelledby）只写一份。
function TabPanel({ name, activeTab, children }) {
  return (
    <section
      data-tab-panel={name}
      role="tabpanel"
      aria-labelledby={`settings-tab-${name}`}
      hidden={activeTab !== name}
    >
      {children}
    </section>
  );
}

export default function Settings() {
  const { t } = useTranslation();
  const [settings, updateSettings, reloadSettings, loading] = useSettings();
  const [form, setForm] = useState({ ...DEFAULT_FORM });
  const formRef = useRef(form);
  const initializedRef = useRef(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [generalSuccess, setGeneralSuccess] = useState(false);
  // Settings 页 tab 化（REQ-AGENT-023）：默认选中「通用」；切换只改显隐、面板保持
  // DOM 挂载（REQ-AGENT-025：未保存编辑跨 tab 保留；切换不触发任何保存请求）。
  // 2026-08-02-ui-copilot §8 引导态：会话区「去配置」经 navigate state 指定初始 tab
  // （agentTab=true → 落 Agent 配置 tab）；缺省行为不变（general）。
  const location = useLocation();
  const [activeTab, setActiveTab] = useState(location.state?.agentTab === true ? "agent" : "general");

  // Feishu channel configuration state (independent from the main settings form).
  const [channelStatus, setChannelStatus] = useState(DEFAULT_CHANNEL_STATUS);
  const [channelAppId, setChannelAppId] = useState("");
  const [channelAppSecret, setChannelAppSecret] = useState("");
  const [showSecret, setShowSecret] = useState(false);
  const [channelSaving, setChannelSaving] = useState(false);
  const [channelError, setChannelError] = useState(null);
  const [channelSuccess, setChannelSuccess] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({ appId: false, appSecret: false });

  // Agent 配置区（独立 state 模式，与主表单/Feishu 通道区互不影响；REQ-AGENT-001/004/
  // 014 + REQ-AGENT-090/091 多 provider 列表）。
  const [agentConfig, setAgentConfig] = useState(null); // { identity, providers, defaultModel, binding }
  const [agentIdentity, setAgentIdentity] = useState("");
  const [agentSaving, setAgentSaving] = useState(false);
  const [agentError, setAgentError] = useState(null);
  const [agentSuccess, setAgentSuccess] = useState(null);
  const [agentBindingAction, setAgentBindingAction] = useState(false);

  // 添加条目表单（REQ-AGENT-091：provider + key → 拉取列表 → 勾选子集 → 保存）。
  const [addFormOpen, setAddFormOpen] = useState(false);
  const [addProvider, setAddProvider] = useState("");
  const [addApiKey, setAddApiKey] = useState(""); // 永不回显；新增条目必填
  const [modelOptions, setModelOptions] = useState([]); // [{model, vision, reasoning}]
  const [checkedModels, setCheckedModels] = useState(() => new Set());
  const [fetchStatus, setFetchStatus] = useState(FETCH_STATUS.noKey);
  const [addError, setAddError] = useState(null); // 表单行内错误（E1/E9）
  const [agentTesting, setAgentTesting] = useState(false);
  const [agentTestResult, setAgentTestResult] = useState(null); // { ok, message }

  // 绑定状态派生（GET binding 形态：{ bound, openId?, pendingBind? }，未接线 agentRouter 时兜底未绑定）。
  const agentBinding = agentConfig?.binding;
  const agentIsBound = agentBinding?.bound === true;
  const agentBindingPending = !agentIsBound && !!agentBinding?.pendingBind;

  // 关于/更新区：当前版本（经 IPC 获取，禁止硬编码——REQ-DIST-003）+ 检查更新状态
  const [appVersion, setAppVersion] = useState(null);
  const [updateStatus, setUpdateStatus] = useState(null); // { kind, latestVersion, error }
  // checking 从 updateStatus 派生（检查中即 kind === STATUS_CHECKING），避免双份状态
  const checking = updateStatus?.kind === STATUS_CHECKING;

  useEffect(() => {
    if (settings && !initializedRef.current) {
      const next = {
        workspaceRoot: settings.workspaceRoot || "",
        skillRepoPath: settings.skillRepoPath || "",
        theme: settings.theme || "dark",
        language: settings.language || "en-US",
        density: settings.density || "comfortable",
      };
      setForm(next);
      formRef.current = next;
      initializedRef.current = true;
      setSaveError(null);
    }
  }, [settings]);

  // Load Feishu channel status and saved credentials when the settings page mounts.
  // Use a ref to avoid depending on the unstable reloadSettings callback identity.
  const reloadSettingsRef = useRef(reloadSettings);
  reloadSettingsRef.current = reloadSettings;
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [status, freshSettings] = await Promise.all([
          getChannelStatus(),
          reloadSettingsRef.current()
        ]);
        if (cancelled) return;
        setChannelStatus(status || DEFAULT_CHANNEL_STATUS);
        const creds = freshSettings?.channelCredentials;
        if (creds?.appId) setChannelAppId(creds.appId);
        if (creds?.appSecret) setChannelAppSecret(creds.appSecret);
      } catch {
        if (!cancelled) setChannelStatus(DEFAULT_CHANNEL_STATUS);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  // Load agent config and binding status when the settings page mounts
  // (GET /api/settings/agent never returns the key — signed-off decision 5).
  // t is accessed via a ref (same pattern as reloadSettingsRef) so a language
  // switch does not re-run this effect and clobber in-progress edits.
  const agentTRef = useRef(t);
  agentTRef.current = t;
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const config = await getAgentConfig();
        if (cancelled) return;
        setAgentConfig(config);
        setAgentIdentity(config.identity || "");
      } catch {
        if (!cancelled) setAgentError(agentTRef.current("settings.agent.loadFailed"));
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  // 挂载时读取当前版本号（REQ-DIST-003 AC1：经 IPC 获取，与打包进应用的 package.json version 一致）。
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const v = await window.opc?.getVersion?.();
        if (!cancelled) setAppVersion(v ?? "");
      } catch {
        if (!cancelled) setAppVersion("");
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // 启动静默检查结果订阅（REQ-DIST-002 AC7：复用同一提示路径；页面未挂载时结果自然丢弃）。
  useEffect(() => {
    return window.opc?.onUpdateResult?.((result) => {
      if (result?.hasUpdate) setUpdateStatus(statusFromResult(result));
    });
  }, []);

  // 手动检查更新（REQ-DIST-002 AC8）：点击按钮触发 IPC，三种状态之一渲染到状态区。
  async function handleCheckUpdates() {
    if (!window.opc?.checkUpdates || checking) return;
    setUpdateStatus({ kind: STATUS_CHECKING, latestVersion: null, error: null });
    try {
      setUpdateStatus(statusFromResult(await window.opc.checkUpdates()));
    } catch (err) {
      // 主进程契约不抛；此处仅作最后防线（REQ-DIST-002 AC4：应用不崩溃，显示可重试失败态）。
      setUpdateStatus({ kind: STATUS_ERROR, latestVersion: null, error: { code: "E_UPDATE_CHECK_NETWORK", message: String(err?.message ?? err) } });
    }
  }

  // "去下载"：打开 GitHub Releases 页（REQ-DIST-002 AC2，经主进程 shell.openExternal）。
  async function handleDownload() {
    try {
      await window.opc?.openReleasesPage?.();
    } catch {
      // 打开失败静默（主进程已返回 false；不打扰用户）。
    }
  }

  function updateStatusText(status) {
    if (status?.kind === STATUS_CHECKING) return t("settings.checkingUpdates");
    if (status?.kind === STATUS_HAS_UPDATE) {
      return t("settings.updateAvailable", { version: status.latestVersion ?? "" });
    }
    if (status?.kind === STATUS_UP_TO_DATE) return t("settings.upToDate");
    // STATUS_ERROR：E_UPDATE_NO_RELEASE（AC5 暂无发布版本）与其他错误（AC4/AC6 检查失败请重试）区分
    return status?.error?.code === "E_UPDATE_NO_RELEASE"
      ? t("settings.noRelease")
      : t("settings.checkFailed");
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setSaveError(null);
    setGeneralSuccess(false);
    try {
      const current = formRef.current;
      // 通用 tab 保存（REQ-AGENT-024 AC2）：仅提交通用字段，不携带 agent/channelCredentials。
      await updateSettings({
        workspaceRoot: current.workspaceRoot,
        skillRepoPath: current.skillRepoPath,
        theme: current.theme,
        language: current.language,
        density: current.density,
      });
      setGeneralSuccess(true);
    } catch (err) {
      setSaveError(err.message || "Failed to save settings");
    } finally {
      setSaving(false);
    }
  }

  function handleChange(field, value) {
    setForm((prev) => {
      const next = { ...prev, [field]: value };
      formRef.current = next;
      return next;
    });
    setSaveError(null);
    setGeneralSuccess(false);
  }

  function statusClass(status) {
    if (status === "online") return "status-success";
    if (status === "connecting") return "status-running";
    return "status-error";
  }

  function statusText(status) {
    if (status === "online") return t("settings.online") || "在线";
    if (status === "connecting") return t("settings.connecting") || "连接中";
    return t("settings.offline") || "掉线";
  }

  async function handleSaveChannel(e) {
    e.preventDefault();
    setChannelSuccess(null);
    setChannelError(null);
    const errors = {
      appId: !channelAppId.trim(),
      appSecret: !channelAppSecret.trim(),
    };
    setFieldErrors(errors);
    if (errors.appId || errors.appSecret) {
      setChannelError(t("settings.credentialsRequired"));
      return;
    }

    setChannelSaving(true);
    try {
      const result = await saveChannelCredentials({
        appId: channelAppId.trim(),
        appSecret: channelAppSecret.trim(),
      });
      setChannelStatus({ status: result.status, error: result.error });
      // Refresh the shared settings context so other pages/navigation see the
      // latest channel credentials without requiring an app restart.
      try {
        await reloadSettings();
      } catch {
        // Ignore reload failures; the save itself already succeeded.
      }
      if (result.error) {
        setChannelError(result.error);
      } else {
        setChannelSuccess(t("settings.channelConnected"));
      }
    } catch (err) {
      setChannelError(err.message || t("settings.credentialsRequired"));
    } finally {
      setChannelSaving(false);
    }
  }

  async function handleReconnect() {
    setChannelSaving(true);
    setChannelSuccess(null);
    setChannelError(null);
    try {
      const result = await reconnectChannel();
      setChannelStatus({ status: result.status, error: result.error });
      if (result.error) {
        setChannelError(result.error);
      } else {
        setChannelSuccess(t("settings.channelReconnected"));
      }
    } catch (err) {
      setChannelError(err.message || t("settings.credentialsRequired"));
    } finally {
      setChannelSaving(false);
    }
  }

  // —— Agent 配置区（REQ-AGENT-090/091：多 provider 条目列表管理）——

  // 供应商显示名（中文直写，UX settings-providers.html 形态）。
  function providerLabel(value) {
    const option = AGENT_PROVIDER_OPTIONS.find((o) => o.value === value);
    return option ? option.label : value;
  }

  // openId 脱敏显示（如 ou_***）：仅保留前 3 字符，避免完整 open_id 泄露。
  function maskOpenId(openId) {
    if (!openId) return "";
    return openId.length > 3 ? `${openId.slice(0, 3)}***` : openId;
  }

  // 派生：条目列表 / 默认组合 / 已配置（任一条目持有 key）/ 存量迁移产物形态
  //（服务端无持久化迁移标记——renderer 按迁移产物启发式判定：单条目 + 单模型 +
  // 默认组合 = 旧版单条配置迁移结果，signoff migrate-note 契约）。
  const providers = agentConfig?.providers ?? [];
  const defaultModel = agentConfig?.defaultModel ?? null;
  const agentConfigured = providers.some((p) => p.configured === true);
  const migratedShape =
    providers.length === 1 &&
    !!defaultModel &&
    defaultModel.provider === providers[0].provider &&
    defaultModel.model === providers[0].models[0];

  // 添加表单默认 provider = 首个未配置的供应商（已配置的重复条目服务端拒收；
  // 全部已配置 → 取枚举首个，保存时行内提示）。
  function defaultAddProvider() {
    const configuredProviders = new Set(providers.map((p) => p.provider));
    return AGENT_PROVIDER_OPTIONS.find((o) => !configuredProviders.has(o.value))?.value ?? AGENT_PROVIDER_OPTIONS[0].value;
  }

  // 打开/关闭添加表单（打开时预置内置目录展示 + 默认 provider，E2「填 key 后
  // 自动刷新」前的即时可用态）。
  function openAddForm() {
    setAddFormOpen(true);
    setAddError(null);
    setAddApiKey("");
    setCheckedModels(new Set());
    const provider = defaultAddProvider();
    setAddProvider(provider);
    setModelOptions(BUILTIN_MODEL_CATALOG[provider] ?? []);
    setFetchStatus(FETCH_STATUS.noKey);
    setAgentTestResult(null);
  }

  function closeAddForm() {
    setAddFormOpen(false);
    setAddError(null);
  }

  // 拉取模型列表（实时无缓存；成功后替换展示列表——勾选集保留，避免用户勾选
  // 中途被替换丢失）。E2：无 key 不拉取（表单提示「填 key 后自动刷新」）。
  async function fetchModelsFor(provider, apiKey) {
    const key = (apiKey ?? "").trim();
    if (key === "") {
      setModelOptions(BUILTIN_MODEL_CATALOG[provider] ?? []);
      setFetchStatus(FETCH_STATUS.noKey);
      return;
    }
    setFetchStatus(FETCH_STATUS.fetching);
    try {
      const res = await fetchProviderModels(provider, key);
      const list = Array.isArray(res?.models) ? res.models : [];
      const options = list.length > 0 ? list : BUILTIN_MODEL_CATALOG[provider] ?? [];
      setModelOptions(options);
      setFetchStatus(res?.fallback === true ? FETCH_STATUS.fallback : FETCH_STATUS.fetched);
    } catch {
      // 拉取失败（网络/服务）：回退内置目录 + 提示（E3，不阻塞保存）。
      setModelOptions(BUILTIN_MODEL_CATALOG[provider] ?? []);
      setFetchStatus(FETCH_STATUS.fallback);
    }
  }

  // 勾选子集（Set 状态驱动——列表替换/重渲染保留勾选）。
  function toggleModel(model) {
    setCheckedModels((prev) => {
      const next = new Set(prev);
      if (next.has(model)) next.delete(model);
      else next.add(model);
      return next;
    });
  }

  // 保存条目（REQ-AGENT-091 标准 2）：全量 PUT（既有条目不带 key → 服务端复用
  // 密文；新条目带 key → 加密落盘）；成功后重载配置（列表即时更新）。
  async function handleSaveProvider() {
    setAddError(null);
    setAgentSuccess(null);
    const key = addApiKey.trim();
    const models = Array.from(checkedModels);
    if (key === "") {
      setAddError("请输入 API Key");
      return;
    }
    if (models.length === 0) {
      setAddError("请至少勾选一个要使用的模型");
      return;
    }
    if (providers.some((p) => p.provider === addProvider)) {
      setAddError("该 provider 已配置，请选择其他供应商");
      return;
    }
    setAgentSaving(true);
    try {
      await saveAgentConfig({
        identity: agentIdentity,
        providers: [
          ...providers.map((p) => ({ provider: p.provider, models: p.models })),
          { provider: addProvider, apiKey: key, models },
        ],
        defaultModel,
      });
      await reloadAgentConfig();
      setAgentSuccess("条目已保存");
      closeAddForm();
    } catch (err) {
      // E-CONFIG-INVALID（400）透传后端文案（如「模型不存在」「请输入 API Key」）。
      setAddError(err.message || "保存失败");
    } finally {
      setAgentSaving(false);
    }
  }

  // 星标切换默认组合（REQ-AGENT-091 标准 3）：PUT defaultModel 显式指向新组合
  //（全局唯一由服务端结构保证——旧默认自动让位）。
  async function handleSetDefault(provider, model) {
    setAgentSuccess(null);
    setAgentError(null);
    if (defaultModel?.provider === provider && defaultModel?.model === model) return;
    setAgentSaving(true);
    try {
      await saveAgentConfig({
        identity: agentIdentity,
        providers: providers.map((p) => ({ provider: p.provider, models: p.models })),
        defaultModel: { provider, model },
      });
      await reloadAgentConfig();
    } catch (err) {
      setAgentError(err.message || "保存失败");
    } finally {
      setAgentSaving(false);
    }
  }

  // 删除条目（REQ-AGENT-091 标准 4）：confirm 确认（E2E dialog 契约）→ 全量 PUT
  // 不含该条目；不携带 defaultModel → 服务端自动重定向（默认条目被删 → 剩余
  // 首个组合；删光 → null）。
  async function handleDeleteProvider(provider) {
    setAgentSuccess(null);
    setAgentError(null);
    if (!window.confirm(`删除 ${provider} 条目？\n使用它的会话将回落到默认模型。`)) return;
    setAgentSaving(true);
    try {
      await saveAgentConfig({
        identity: agentIdentity,
        providers: providers.filter((p) => p.provider !== provider).map((p) => ({ provider: p.provider, models: p.models })),
      });
      await reloadAgentConfig();
      setAgentSuccess("条目已删除");
    } catch (err) {
      setAgentError(err.message || "删除失败");
    } finally {
      setAgentSaving(false);
    }
  }

  // 保存身份（REQ-AGENT-004 标准 2）：identity 单独 PUT（providers/defaultModel
  // 原样保留；存量会话热更新 systemPrompt，不重建上下文）。
  async function handleSaveIdentity() {
    setAgentSuccess(null);
    setAgentError(null);
    if (agentIdentity.length > AGENT_IDENTITY_MAX_LEN) {
      setAgentError(t("settings.agent.identityTooLong", { max: AGENT_IDENTITY_MAX_LEN }));
      return;
    }
    setAgentSaving(true);
    try {
      await saveAgentConfig({ identity: agentIdentity });
      await reloadAgentConfig();
      setAgentSuccess(t("settings.agent.saved"));
    } catch (err) {
      setAgentError(err.message || t("settings.agent.saveFailed"));
    } finally {
      setAgentSaving(false);
    }
  }

  // 保存/删除/星标后重载配置（GET 回读为真相；错误不覆盖配置展示）。
  async function reloadAgentConfig() {
    const config = await getAgentConfig();
    setAgentConfig(config);
    setAgentIdentity(config.identity || "");
  }

  // 测试连接（添加表单的 provider+key 上下文；REQ-AGENT-001 AC4）：失败透传
  // 供应商原因（E-AGENT-LLM-FAIL），不阻止保存。
  async function handleTestConnection() {
    setAgentSuccess(null);
    setAgentError(null);
    setAgentTestResult(null);
    const provider = addProvider.trim();
    const apiKey = addApiKey.trim();
    if (!provider) {
      setAddError(t("settings.agent.providerRequired"));
      return;
    }
    if (!apiKey) {
      setAddError(t("settings.agent.apiKeyRequired"));
      return;
    }
    setAgentTesting(true);
    try {
      const result = await testConnection({ provider, apiKey });
      setAgentTestResult(
        result.ok
          ? { ok: true, message: t("settings.agent.testSuccess") }
          : { ok: false, message: t("settings.agent.testFailed", { reason: result.message || "" }) }
      );
    } catch (err) {
      setAgentTestResult({ ok: false, message: t("settings.agent.testFailed", { reason: err.message || "" }) });
    } finally {
      setAgentTesting(false);
    }
  }

  // 绑定动作（REQ-AGENT-014）：begin 置 pendingBind（10 分钟一次性）/ cancel 取消 / unbind 解绑；
  // 响应回传最新绑定状态供展示。
  async function runBindingAction(action) {
    setAgentError(null);
    setAgentSuccess(null);
    setAgentBindingAction(true);
    try {
      const result = await action();
      if (result?.binding) {
        setAgentConfig((prev) => ({ ...prev, binding: result.binding }));
      }
    } catch (err) {
      setAgentError(err.message || t("settings.agent.actionFailed"));
    } finally {
      setAgentBindingAction(false);
    }
  }

  async function handleBeginBinding() {
    runBindingAction(bindingBegin);
  }

  async function handleCancelBinding() {
    runBindingAction(bindingCancel);
  }

  async function handleUnbind() {
    runBindingAction(bindingDelete);
  }

  if (loading) {
    return (
      <div className="page" data-testid="settings-page">
        <p className="loading-text">Loading settings...</p>
      </div>
    );
  }

  return (
    <div className="page" data-testid="settings-page">
      <div className="page-header">
        <h1 className="page-title">{t("settings.title")}</h1>
      </div>

      {/* REQ-AGENT-023 AC1：tab 栏（右上角全局保存已移除——REQ-AGENT-024 AC1）。
          面板 DOM 顺序与 tab 顺序不同属实现细节：任一时刻仅一个面板可见，
          未选中面板 hidden 但保持挂载（REQ-AGENT-025）。 */}
      <div className="tab-bar" role="tablist" aria-label={t("settings.tabsAriaLabel")}>
        {SETTINGS_TABS.map((tabDef) => (
          <button
            key={tabDef.name}
            type="button"
            role="tab"
            id={`settings-tab-${tabDef.name}`}
            className="tab-btn"
            data-tab={tabDef.name}
            aria-selected={activeTab === tabDef.name}
            onClick={() => setActiveTab(tabDef.name)}
          >
            {t(tabDef.labelKey)}
          </button>
        ))}
      </div>

      <TabPanel name="agent" activeTab={activeTab}>
        <div className="card" data-testid="agent-settings-card">
          <div className="card-header">
            <h2 className="card-title">{t("settings.agent.title")}</h2>
            <p className="card-subtitle">{t("settings.agent.subtitle")}</p>
          </div>
          <div className="card-body">
            <div className="agent-status-row" style={STATUS_ROW_STYLE}>
              <span
                className={`status ${agentConfigured ? "status-success" : "status-error"}`}
                data-testid="agent-config-status-badge"
                data-status={agentConfigured ? "configured" : "unconfigured"}
              >
                <span className="status-dot"></span>
                <span>
                  {agentConfigured ? t("settings.agent.configured") : t("settings.agent.unconfigured")}
                </span>
              </span>
              <span
                style={{
                  fontSize: "var(--ch-text-xs)",
                  color: "var(--ch-text-secondary)",
                  flex: 1,
                  minWidth: 0,
                }}
              >
                {providers.length > 0
                  ? `${providers.length} 个条目 · 默认 ${defaultModel ? `${defaultModel.provider} · ${defaultModel.model}` : "未设置"}`
                  : t("settings.agent.unconfigured")}
              </span>
            </div>

            {/* 存量迁移提示（REQ-AGENT-091 标准 5，migrate-note 契约）：单条目 +
                默认组合 = 旧版单条配置迁移产物形态（renderer 启发式判定，服务端无
                持久化迁移标记——偏差见 build-progress） */}
            {migratedShape && (
              <div className="migrate-note" data-testid="migrate-note">
                已从旧版配置自动迁移：原单条 provider 配置成为列表第一条，并标记为「默认」。
              </div>
            )}

            {agentError && (
              <div
                className="alert-error show"
                data-testid="agent-settings-error"
                style={{
                  background: "var(--ch-error-soft)",
                  border: "1px solid var(--ch-error)",
                  borderRadius: "var(--ch-radius-md)",
                  padding: "var(--ch-space-3)",
                  fontSize: "var(--ch-text-sm)",
                  color: "var(--ch-text)",
                  marginBottom: "var(--ch-space-5)",
                }}
              >
                <strong style={{ color: "var(--ch-error)" }}>{agentError}</strong>
              </div>
            )}

            {agentSuccess && (
              <div
                className="alert-success show"
                data-testid="agent-settings-success"
                style={{
                  background: "var(--ch-success-soft)",
                  border: "1px solid var(--ch-success)",
                  borderRadius: "var(--ch-radius-md)",
                  padding: "var(--ch-space-3)",
                  fontSize: "var(--ch-text-sm)",
                  color: "var(--ch-text)",
                  marginBottom: "var(--ch-space-5)",
                }}
              >
                {agentSuccess}
              </div>
            )}

            {/* provider 条目列表（REQ-AGENT-091 标准 1：provider 名 + 模型 chips +
                默认徽标唯一；星标移动默认） */}
            <div className="provider-list">
              {providers.length === 0 ? (
                <div className="provider-empty">
                  未配置模型 —— 点击「添加 Provider」配置第一个（对话与 auto 判断将不可用）。
                </div>
              ) : (
                providers.map((entry) => {
                  const entryHasDefault =
                    !!defaultModel && entry.models.some((m) => defaultModel.provider === entry.provider && defaultModel.model === m);
                  return (
                    <div
                      key={entry.provider}
                      className={`provider-entry${entryHasDefault ? " default" : ""}`}
                      data-testid="provider-entry"
                    >
                      <div className="entry-head">
                        <div style={{ flex: 1 }}>
                          <div className="entry-title">
                            <span>{providerLabel(entry.provider)}</span>
                            <span className="entry-key">
                              {entry.configured ? "key 已配置" : "key 未配置"}
                            </span>
                          </div>
                        </div>
                        <div className="entry-actions">
                          <button
                            type="button"
                            className="icon-btn danger"
                            data-testid="delete-provider"
                            title="删除条目"
                            onClick={() => handleDeleteProvider(entry.provider)}
                            disabled={agentSaving}
                          >
                            <svg viewBox="0 0 16 16" aria-hidden="true">
                              <path d="M3.5 5h9M6.5 5V3.5h3V5M5 5l.5 8h5L11 5" />
                            </svg>
                          </button>
                        </div>
                      </div>
                      <div className="entry-models" data-testid="entry-models">
                        {entry.models.map((m) => {
                          const isDefault = defaultModel?.provider === entry.provider && defaultModel?.model === m;
                          const vision = isVisionModel(entry.provider, m);
                          return (
                            <span
                              key={m}
                              className={`model-chip${isDefault ? " default" : ""}`}
                              data-testid="model-chip"
                              data-provider={entry.provider}
                              title={isDefault ? "当前默认组合" : "点星标设为默认"}
                            >
                              <span className={`cap-dot${vision ? " vision" : ""}`}></span>
                              <span className="model-chip-name">{m}</span>
                              {vision && <span className="cap-tag on">视觉</span>}
                              <span
                                className="star"
                                data-model={m}
                                title="设为默认"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleSetDefault(entry.provider, m);
                                }}
                              >
                                ★
                              </span>
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* 添加条目（REQ-AGENT-091 标准 2：provider + key → 拉取列表 → 勾选子集
                → 保存；E1/E9 表单行内校验；E2/E3 拉取状态提示） */}
            <div className="add-panel">
              {!addFormOpen ? (
                <button
                  type="button"
                  className="add-toggle"
                  data-testid="add-provider-button"
                  onClick={openAddForm}
                >
                  ＋ 添加 Provider
                </button>
              ) : (
                <div className="add-form show">
                  <div className="form-row">
                    <div className="form-field">
                      <label htmlFor="add-provider-select">Provider</label>
                      <select
                        id="add-provider-select"
                        className="form-input"
                        data-testid="provider-select"
                        value={addProvider}
                        onChange={(e) => {
                          const p = e.target.value;
                          setAddProvider(p);
                          setAddError(null);
                          setCheckedModels(new Set());
                          setModelOptions(BUILTIN_MODEL_CATALOG[p] ?? []);
                          setFetchStatus(FETCH_STATUS.noKey);
                          setAgentTestResult(null);
                          if (addApiKey.trim() !== "") fetchModelsFor(p, addApiKey);
                        }}
                      >
                        {AGENT_PROVIDER_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="form-field">
                      <label htmlFor="add-provider-key-input">API Key</label>
                      <input
                        id="add-provider-key-input"
                        className="form-input"
                        data-testid="provider-key-input"
                        type="password"
                        placeholder="sk-…"
                        autoComplete="off"
                        spellCheck={false}
                        value={addApiKey}
                        onChange={(e) => {
                          const key = e.target.value;
                          setAddApiKey(key);
                          setAddError(null);
                          setAgentTestResult(null);
                          if (key.trim() !== "") fetchModelsFor(addProvider, key);
                        }}
                      />
                    </div>
                  </div>

                  <div className="form-field" style={{ marginTop: "var(--ch-space-3)" }}>
                    <label>要使用的模型（勾选，不一定要全选）</label>
                    <div className="model-picker">
                      <div className="model-picker-row">
                        <span className={`sync-status${fetchStatus.kind === "fallback" ? " err" : ""}`} data-testid="model-fetch-status">
                          {fetchStatus.text}
                        </span>
                        <button
                          type="button"
                          className="sync-btn"
                          data-testid="refetch-models-button"
                          title="重新从供应商 API 拉取（实时，无缓存）"
                          onClick={() => fetchModelsFor(addProvider, addApiKey)}
                        >
                          重新拉取
                        </button>
                      </div>
                      <div className="model-options">
                        {modelOptions.map((m) => (
                          <label key={m.model} className="model-opt" data-testid="model-option">
                            <input
                              type="checkbox"
                              value={m.model}
                              checked={checkedModels.has(m.model)}
                              onChange={() => toggleModel(m.model)}
                            />
                            <span className="model-opt-name">{m.model}</span>
                            <span className="caps">
                              <span className={`cap-tag${m.vision ? " on" : ""}`}>视觉{m.vision ? "✓" : ""}</span>
                              <span className={`cap-tag${m.reasoning ? " on" : ""}`}>推理✓</span>
                            </span>
                          </label>
                        ))}
                        {modelOptions.length === 0 && (
                          <span className="sync-status">暂无可用模型</span>
                        )}
                      </div>
                    </div>
                  </div>

                  {addError && (
                    <p className="form-hint" style={{ color: "var(--ch-error)" }} data-testid="add-provider-error">
                      {addError}
                    </p>
                  )}

                  <div className="form-group" style={{ marginTop: "var(--ch-space-3)" }}>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      data-testid="agent-test-connection-button"
                      onClick={handleTestConnection}
                      disabled={agentTesting}
                    >
                      {agentTesting ? t("settings.agent.testing") : t("settings.agent.testConnection")}
                    </button>
                    {agentTestResult && (
                      <p
                        className="help-text"
                        data-testid="agent-test-connection-result"
                        data-ok={agentTestResult.ok}
                        style={{
                          marginTop: "var(--ch-space-2)",
                          marginBottom: 0,
                          color: agentTestResult.ok ? "var(--ch-success)" : "var(--ch-error)",
                        }}
                      >
                        {agentTestResult.message}
                      </p>
                    )}
                  </div>

                  <div className="form-actions">
                    <button type="button" className="btn" data-testid="cancel-add-provider" onClick={closeAddForm}>
                      取消
                    </button>
                    <button
                      type="button"
                      className="btn btn-primary"
                      data-testid="save-provider"
                      onClick={handleSaveProvider}
                      disabled={agentSaving}
                    >
                      {agentSaving ? t("settings.agent.saving") : "保存"}
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="agent-identity-input">
                {t("settings.agent.identity")}
              </label>
              <textarea
                id="agent-identity-input"
                className="form-input"
                data-testid="agent-identity-input"
                value={agentIdentity}
                onChange={(e) => {
                  setAgentIdentity(e.target.value);
                  setAgentError(null);
                }}
                rows={4}
                spellCheck={false}
                style={{ fontFamily: "var(--ch-font-sans)", resize: "vertical" }}
              />
              <p className="help-text">
                {t("settings.agent.identityHelp", { max: AGENT_IDENTITY_MAX_LEN })}
              </p>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                data-testid="save-agent-identity-button"
                onClick={handleSaveIdentity}
                disabled={agentSaving}
              >
                {agentSaving ? t("settings.agent.saving") : t("settings.agent.saveIdentity")}
              </button>
            </div>

            <div className="form-group">
              <label className="form-label">{t("settings.agent.binding")}</label>
              <div
                className="agent-binding-row"
                style={{ ...STATUS_ROW_STYLE, marginBottom: 0, flexWrap: "wrap" }}
              >
                {agentIsBound ? (
                  <>
                    <span
                      className="status status-success"
                      data-testid="agent-binding-status"
                      data-bound="true"
                      style={{ marginRight: "auto" }}
                    >
                      <span className="status-dot"></span>
                      <span>
                        {t("settings.agent.bound", { openId: maskOpenId(agentBinding?.openId) })}
                      </span>
                    </span>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      data-testid="agent-unbind-button"
                      onClick={handleUnbind}
                      disabled={agentBindingAction}
                    >
                      {t("settings.agent.unbind")}
                    </button>
                  </>
                ) : agentBindingPending ? (
                  <>
                    <span
                      className="status status-running"
                      data-testid="agent-binding-pending"
                      style={{ marginRight: "auto" }}
                    >
                      <span className="status-dot"></span>
                      <span>{t("settings.agent.bindingPending")}</span>
                    </span>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      data-testid="agent-cancel-binding-button"
                      onClick={handleCancelBinding}
                      disabled={agentBindingAction}
                    >
                      {t("common.cancel")}
                    </button>
                  </>
                ) : (
                  <>
                    <span
                      className="status status-error"
                      data-testid="agent-binding-status"
                      data-bound="false"
                      style={{ marginRight: "auto" }}
                    >
                      <span className="status-dot"></span>
                      <span>
                        {t("settings.agent.unbound")} — {t("settings.agent.bindingGuide")}
                      </span>
                    </span>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      data-testid="agent-begin-binding-button"
                      onClick={handleBeginBinding}
                      disabled={agentBindingAction}
                    >
                      {t("settings.agent.beginBinding")}
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </TabPanel>

      <TabPanel name="channel" activeTab={activeTab}>
        <div className="card" data-testid="channel-settings-card">
          <div className="card-header">
            <h2 className="card-title">{t("settings.channel")}</h2>
            <p className="card-subtitle">{t("settings.channelSubtitle")}</p>
          </div>
          <div className="card-body">
            <div
              className="channel-status-row"
              style={STATUS_ROW_STYLE}
            >
              <span
                className={`status ${statusClass(channelStatus.status)}`}
                data-testid="channel-status-badge"
                data-status={channelStatus.status}
              >
                <span className="status-dot"></span>
                <span>{statusText(channelStatus.status)}</span>
              </span>
              <span
                className="channel-status-meta"
                style={{
                  fontSize: "var(--ch-text-xs)",
                  color: "var(--ch-text-secondary)",
                  flex: 1,
                  minWidth: 0,
                }}
              >
                {t("settings.channel")}
              </span>
              <span className="channel-status-actions" style={{ display: "flex", gap: "var(--ch-space-2)", flexShrink: 0 }}>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  data-testid="reconnect-channel-button"
                  onClick={handleReconnect}
                  disabled={channelSaving}
                >
                  {t("settings.reconnect")}
                </button>
              </span>
            </div>

            {channelError && (
              <div
                className="alert-error show"
                data-testid="channel-status-error"
                style={{
                  background: "var(--ch-error-soft)",
                  border: "1px solid var(--ch-error)",
                  borderRadius: "var(--ch-radius-md)",
                  padding: "var(--ch-space-3)",
                  fontSize: "var(--ch-text-sm)",
                  color: "var(--ch-text)",
                  marginBottom: "var(--ch-space-5)",
                }}
              >
                <strong style={{ color: "var(--ch-error)" }}>{channelError}</strong>
              </div>
            )}

            {channelSuccess && (
              <div
                className="alert-success show"
                data-testid="channel-status-success"
                style={{
                  background: "var(--ch-success-soft)",
                  border: "1px solid var(--ch-success)",
                  borderRadius: "var(--ch-radius-md)",
                  padding: "var(--ch-space-3)",
                  fontSize: "var(--ch-text-sm)",
                  color: "var(--ch-text)",
                  marginBottom: "var(--ch-space-5)",
                }}
              >
                {channelSuccess}
              </div>
            )}

            <div className="form-group">
              <label className="form-label" htmlFor="channel-app-id-input">
                {t("settings.appId")}
              </label>
              <input
                id="channel-app-id-input"
                className={`form-input ${fieldErrors.appId ? "invalid" : ""}`}
                data-testid="channel-app-id-input"
                value={channelAppId}
                onChange={(e) => {
                  setChannelAppId(e.target.value);
                  setFieldErrors((prev) => ({ ...prev, appId: false }));
                  setChannelError(null);
                }}
                placeholder="cli_xxxxxxxxxxxxxxxx"
                autoComplete="off"
                spellCheck={false}
              />
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="channel-app-secret-input">
                {t("settings.appSecret")}
              </label>
              <div
                className="secret-row"
                style={{ display: "flex", gap: "var(--ch-space-2)" }}
              >
                <input
                  id="channel-app-secret-input"
                  className={`form-input ${fieldErrors.appSecret ? "invalid" : ""}`}
                  data-testid="channel-app-secret-input"
                  type={showSecret ? "text" : "password"}
                  value={channelAppSecret}
                  onChange={(e) => {
                    setChannelAppSecret(e.target.value);
                    setFieldErrors((prev) => ({ ...prev, appSecret: false }));
                    setChannelError(null);
                  }}
                  autoComplete="off"
                  spellCheck={false}
                  style={{ flex: 1 }}
                />
                <button
                  type="button"
                  className="btn btn-secondary btn-sm secret-toggle"
                  onClick={() => setShowSecret((prev) => !prev)}
                >
                  {showSecret ? t("settings.hide") : t("settings.show")}
                </button>
              </div>
              <p className="help-text">{t("settings.channelHelp")}</p>
            </div>

            <div className="form-group" style={{ marginBottom: 0 }}>
              <button
                type="button"
                className="btn btn-primary"
                data-testid="save-channel-credentials-button"
                onClick={handleSaveChannel}
                disabled={channelSaving}
              >
                {channelSaving ? "Connecting..." : t("settings.saveCredentials")}
              </button>
            </div>
          </div>
        </div>
      </TabPanel>

      <TabPanel name="general" activeTab={activeTab}>
        {saveError && (
          <div className="card" style={{ marginBottom: "var(--ch-space-4)", borderColor: "var(--ch-error)" }}>
            <div className="card-body" style={{ color: "var(--ch-error)" }}>
              {saveError}
            </div>
          </div>
        )}

        <form id="settings-form" data-testid="settings-form" onSubmit={handleSubmit}>
          <div className="card">
            <div className="card-header">
              <h2 className="card-title">{t("settings.workspace")}</h2>
              <p className="card-subtitle">{t("settings.workspaceSubtitle")}</p>
            </div>
            <div className="card-body">
              <div className="form-group">
                <label className="form-label" htmlFor="workspace-root-input">
                  {t("settings.workspaceRoot")}
                </label>
                <DirectoryInput
                  id="workspace-root-input"
                  value={form.workspaceRoot}
                  onChange={(value) => handleChange("workspaceRoot", value)}
                  placeholder={t("settings.workspaceRoot")}
                  pickerTitle={t("settings.workspaceRoot")}
                  data-testid="workspace-root-input"
                />
                <p className="help-text">{t("settings.workspaceRootHelp")}</p>
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="skill-repo-path-input">
                  {t("settings.skillRepoPath")}
                </label>
                <DirectoryInput
                  id="skill-repo-path-input"
                  value={form.skillRepoPath}
                  onChange={(value) => handleChange("skillRepoPath", value)}
                  placeholder={t("settings.skillRepoPath")}
                  pickerTitle={t("settings.skillRepoPath")}
                  data-testid="skill-repo-path-input"
                />
                <p className="help-text">{t("settings.skillRepoPathHelp")}</p>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-header">
              <h2 className="card-title">{t("settings.appearance")}</h2>
              <p className="card-subtitle">{t("settings.appearanceSubtitle")}</p>
            </div>
            <div className="card-body">
              <div className="form-group">
                <label className="form-label" htmlFor="theme-select">
                  {t("settings.theme")}
                </label>
                <select
                  id="theme-select"
                  className="form-select"
                  data-testid="theme-select"
                  value={form.theme}
                  onChange={(e) => handleChange("theme", e.target.value)}
                >
                  <option value="dark">{t("settings.dark")}</option>
                  <option value="light">{t("settings.light")}</option>
                </select>
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="language-select">
                  {t("settings.language")}
                </label>
                <select
                  id="language-select"
                  className="form-select"
                  data-testid="language-select"
                  value={form.language}
                  onChange={(e) => handleChange("language", e.target.value)}
                >
                  <option value="en-US">{t("settings.english")}</option>
                  <option value="zh-CN">{t("settings.chinese")}</option>
                </select>
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="density-select">
                  {t("settings.density")}
                </label>
                <select
                  id="density-select"
                  className="form-select"
                  data-testid="density-select"
                  value={form.density}
                  onChange={(e) => handleChange("density", e.target.value)}
                >
                  <option value="compact">{t("settings.compact")}</option>
                  <option value="comfortable">{t("settings.comfortable")}</option>
                </select>
              </div>
            </div>
          </div>

          {/* REQ-AGENT-024 AC1/AC2：通用 tab 区内独立保存（替代原右上角全局保存） */}
          <div style={{ display: "flex", alignItems: "center", gap: "var(--ch-space-3)" }}>
            <button
              type="submit"
              className="btn btn-primary"
              data-testid="save-general-settings-button"
              disabled={saving}
            >
              {saving ? t("settings.saving") : t("settings.saveChanges")}
            </button>
            {generalSuccess && (
              <span
                data-testid="general-settings-success"
                style={{ fontSize: "var(--ch-text-xs)", color: "var(--ch-success)" }}
              >
                {t("settings.saved")}
              </span>
            )}
          </div>
        </form>
      </TabPanel>

      <TabPanel name="about" activeTab={activeTab}>
        <div className="card" data-testid="update-section">
          <div className="card-header">
            <h2 className="card-title">{t("settings.aboutUpdate")}</h2>
          </div>
          <div className="card-body">
            <div className="form-group">
              <label className="form-label">{t("settings.version")}</label>
              {appVersion !== null && (
                <div className="form-static" data-testid="update-version">
                  {appVersion}
                </div>
              )}
            </div>
            <div className="form-group">
              <label className="form-label">{t("settings.dataDirectory")}</label>
              <div className="form-static form-static-mono">
                ~/.opc-workstation
              </div>
            </div>
            <div className="form-group">
              <button
                type="button"
                className="btn btn-secondary"
                data-testid="update-check-button"
                onClick={handleCheckUpdates}
                disabled={checking}
              >
                {checking ? t("settings.checkingUpdates") : t("settings.checkForUpdates")}
              </button>
            </div>
            {updateStatus && (
              <div
                className="update-status-row"
                data-testid="update-status"
                style={UPDATE_STATUS_ROW_STYLE}
              >
                <span style={{ flex: 1, minWidth: 0 }}>{updateStatusText(updateStatus)}</span>
                {updateStatus.kind === STATUS_HAS_UPDATE && (
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    data-testid="update-download-button"
                    onClick={handleDownload}
                  >
                    {t("settings.download")}
                  </button>
                )}
              </div>
            )}
            <div className="form-group" style={{ marginBottom: 0 }}>
              <p className="help-text" data-testid="update-guide">
                {t("settings.updateGuide")}
              </p>
            </div>
          </div>
        </div>
      </TabPanel>
    </div>
  );
}
