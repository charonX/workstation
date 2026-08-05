import { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useSettings } from "../hooks/useSettings.jsx";
import DirectoryInput from "../components/shared/DirectoryInput.jsx";
import { getChannelStatus, saveChannelCredentials, reconnectChannel } from "../api/channel.js";
import {
  getAgentConfig,
  saveAgentConfig,
  testConnection,
  bindingBegin,
  bindingCancel,
  bindingDelete,
} from "../api/agent.js";

const DEFAULT_FORM = {
  workspaceRoot: "",
  skillRepoPath: "",
  theme: "dark",
  language: "en-US",
  density: "comfortable",
};

const DEFAULT_CHANNEL_STATUS = { status: "offline", error: null };

// Agent 配置区常量（REQ-AGENT-001/004）：身份长度上限（签核决策 4）+ 供应商枚举。
const AGENT_IDENTITY_MAX_LEN = 2000;
const AGENT_PROVIDER_OPTIONS = [
  { value: "deepseek", labelKey: "settings.agent.providerDeepseek" },
  { value: "moonshotai", labelKey: "settings.agent.providerMoonshotai" },
  { value: "moonshotai-cn", labelKey: "settings.agent.providerMoonshotaiCn" },
];

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
  const [activeTab, setActiveTab] = useState("general");

  // Feishu channel configuration state (independent from the main settings form).
  const [channelStatus, setChannelStatus] = useState(DEFAULT_CHANNEL_STATUS);
  const [channelAppId, setChannelAppId] = useState("");
  const [channelAppSecret, setChannelAppSecret] = useState("");
  const [showSecret, setShowSecret] = useState(false);
  const [channelSaving, setChannelSaving] = useState(false);
  const [channelError, setChannelError] = useState(null);
  const [channelSuccess, setChannelSuccess] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({ appId: false, appSecret: false });

  // Agent 配置区（独立 state 模式，与主表单/Feishu 通道区互不影响；REQ-AGENT-001/004/014）。
  const [agentConfig, setAgentConfig] = useState(null); // { provider, configured, identity, binding }
  const [agentProvider, setAgentProvider] = useState("");
  const [agentApiKey, setAgentApiKey] = useState(""); // 永不回显（签核决策 5），保存后清空
  const [agentShowSecret, setAgentShowSecret] = useState(false);
  const [agentIdentity, setAgentIdentity] = useState("");
  const [agentSaving, setAgentSaving] = useState(false);
  const [agentError, setAgentError] = useState(null);
  const [agentSuccess, setAgentSuccess] = useState(null);
  const [agentFieldErrors, setAgentFieldErrors] = useState({ provider: false, apiKey: false, identity: false });
  const [agentTesting, setAgentTesting] = useState(false);
  const [agentTestResult, setAgentTestResult] = useState(null); // { ok, message }
  const [agentBindingAction, setAgentBindingAction] = useState(false);

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
        setAgentProvider(config.provider || "");
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

  // —— Agent 配置区（REQ-AGENT-001/004/014）——

  // 供应商显示名（i18n 键，语言切换即时生效）。
  function providerLabel(value) {
    const option = AGENT_PROVIDER_OPTIONS.find((o) => o.value === value);
    return option ? t(option.labelKey) : "";
  }

  // openId 脱敏显示（如 ou_***）：仅保留前 3 字符，避免完整 open_id 泄露。
  function maskOpenId(openId) {
    if (!openId) return "";
    return openId.length > 3 ? `${openId.slice(0, 3)}***` : openId;
  }

  // 保存 Agent 配置：provider+apiKey 成对提交（PRD §7）；已配置且未输入新 key 时
  // 省略 apiKey 字段以保留现有 key（key 永不回显——签核决策 5）；身份独立可存。
  async function handleSaveAgent() {
    setAgentSuccess(null);
    setAgentError(null);
    setAgentTestResult(null);
    const provider = agentProvider.trim();
    const hasKey = agentApiKey.trim() !== "";
    // 已配置 + 未更换供应商 + 未输入新 key → 保留现有 key（只存身份）。
    const keepExistingKey = agentConfig?.configured === true && agentConfig?.provider === provider && !hasKey;
    const errors = { provider: false, apiKey: false, identity: false };
    if (hasKey && !provider) {
      errors.provider = true;
    } else if (provider && !hasKey && !keepExistingKey) {
      errors.apiKey = true;
    }
    if (agentIdentity.length > AGENT_IDENTITY_MAX_LEN) {
      errors.identity = true;
    }
    setAgentFieldErrors(errors);
    if (errors.provider) {
      setAgentError(t("settings.agent.providerRequired"));
      return;
    }
    if (errors.apiKey) {
      setAgentError(t("settings.agent.apiKeyRequired"));
      return;
    }
    if (errors.identity) {
      setAgentError(t("settings.agent.identityTooLong", { max: AGENT_IDENTITY_MAX_LEN }));
      return;
    }

    const body = {
      identity: agentIdentity,
      ...(hasKey ? { provider, apiKey: agentApiKey.trim() } : {}),
    };
    setAgentSaving(true);
    try {
      const saved = await saveAgentConfig(body);
      setAgentConfig((prev) => ({
        ...prev,
        provider: saved.provider,
        configured: saved.configured,
        identity: saved.identity,
      }));
      setAgentApiKey("");
      setAgentSuccess(t("settings.agent.saved"));
    } catch (err) {
      // E-CONFIG-INVALID（400）透传后端文案（如「API key 不能为空」）。
      setAgentError(err.message || t("settings.agent.saveFailed"));
    } finally {
      setAgentSaving(false);
    }
  }

  // 测试连接（REQ-AGENT-001 AC4）：失败透传供应商原因（E-AGENT-LLM-FAIL），不阻止保存。
  async function handleTestConnection() {
    setAgentSuccess(null);
    setAgentError(null);
    setAgentTestResult(null);
    const provider = agentProvider.trim();
    const apiKey = agentApiKey.trim();
    const errors = { provider: !provider, apiKey: !apiKey, identity: false };
    setAgentFieldErrors(errors);
    if (errors.provider) {
      setAgentError(t("settings.agent.providerRequired"));
      return;
    }
    if (errors.apiKey) {
      setAgentError(t("settings.agent.apiKeyRequired"));
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
      // 400 E-CONFIG-INVALID（前端已拦截）或网络错误。
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
                className={`status ${agentConfig?.configured ? "status-success" : "status-error"}`}
                data-testid="agent-config-status-badge"
                data-status={agentConfig?.configured ? "configured" : "unconfigured"}
              >
                <span className="status-dot"></span>
                <span>
                  {agentConfig?.configured ? t("settings.agent.configured") : t("settings.agent.unconfigured")}
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
                {providerLabel(agentConfig?.provider || "")}
              </span>
            </div>

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

            <div className="form-group">
              <label className="form-label" htmlFor="agent-provider-select">
                {t("settings.agent.provider")}
              </label>
              <select
                id="agent-provider-select"
                className={`form-select form-input ${agentFieldErrors.provider ? "invalid" : ""}`}
                data-testid="agent-provider-select"
                value={agentProvider}
                onChange={(e) => {
                  setAgentProvider(e.target.value);
                  setAgentFieldErrors((prev) => ({ ...prev, provider: false }));
                  setAgentError(null);
                }}
              >
                <option value="">{t("settings.agent.selectProvider")}</option>
                {AGENT_PROVIDER_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {t(option.labelKey)}
                  </option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="agent-api-key-input">
                {t("settings.agent.apiKey")}
              </label>
              <div
                className="secret-row"
                style={{ display: "flex", gap: "var(--ch-space-2)" }}
              >
                <input
                  id="agent-api-key-input"
                  className={`form-input ${agentFieldErrors.apiKey ? "invalid" : ""}`}
                  data-testid="agent-api-key-input"
                  type={agentShowSecret ? "text" : "password"}
                  placeholder={t("settings.agent.apiKeyPlaceholder")}
                  value={agentApiKey}
                  onChange={(e) => {
                    setAgentApiKey(e.target.value);
                    setAgentFieldErrors((prev) => ({ ...prev, apiKey: false }));
                    setAgentError(null);
                  }}
                  autoComplete="off"
                  spellCheck={false}
                  style={{ flex: 1 }}
                />
                <button
                  type="button"
                  className="btn btn-secondary btn-sm secret-toggle"
                  onClick={() => setAgentShowSecret((prev) => !prev)}
                >
                  {agentShowSecret ? t("settings.hide") : t("settings.show")}
                </button>
              </div>
              <p className="help-text">{t("settings.agent.apiKeyHelp")}</p>
            </div>

            <div className="form-group">
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

            <div className="form-group">
              <label className="form-label" htmlFor="agent-identity-input">
                {t("settings.agent.identity")}
              </label>
              <textarea
                id="agent-identity-input"
                className={`form-input ${agentFieldErrors.identity ? "invalid" : ""}`}
                data-testid="agent-identity-input"
                value={agentIdentity}
                onChange={(e) => {
                  setAgentIdentity(e.target.value);
                  if (e.target.value.length > AGENT_IDENTITY_MAX_LEN) {
                    setAgentFieldErrors((prev) => ({ ...prev, identity: true }));
                    setAgentError(t("settings.agent.identityTooLong", { max: AGENT_IDENTITY_MAX_LEN }));
                  } else {
                    setAgentFieldErrors((prev) => ({ ...prev, identity: false }));
                    setAgentError(null);
                  }
                }}
                rows={4}
                spellCheck={false}
                style={{ fontFamily: "var(--ch-font-sans)", resize: "vertical" }}
              />
              <p className="help-text">
                {t("settings.agent.identityHelp", { max: AGENT_IDENTITY_MAX_LEN })}
              </p>
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

            <div className="form-group" style={{ marginBottom: 0 }}>
              <button
                type="button"
                className="btn btn-primary"
                data-testid="save-agent-config-button"
                onClick={handleSaveAgent}
                disabled={agentSaving}
              >
                {agentSaving ? t("settings.agent.saving") : t("settings.agent.save")}
              </button>
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
