import { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useSettings } from "../hooks/useSettings.jsx";
import DirectoryInput from "../components/shared/DirectoryInput.jsx";
import { getChannelStatus, saveChannelCredentials, reconnectChannel } from "../api/channel.js";

const DEFAULT_FORM = {
  workspaceRoot: "",
  skillRepoPath: "",
  theme: "dark",
  language: "en-US",
  density: "comfortable",
};

const DEFAULT_CHANNEL_STATUS = { status: "offline", error: null };

export default function Settings() {
  const { t } = useTranslation();
  const [settings, updateSettings, loading] = useSettings();
  const [form, setForm] = useState({ ...DEFAULT_FORM });
  const formRef = useRef(form);
  const initializedRef = useRef(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);

  // Feishu channel configuration state (independent from the main settings form).
  const [channelStatus, setChannelStatus] = useState(DEFAULT_CHANNEL_STATUS);
  const [channelAppId, setChannelAppId] = useState("");
  const [channelAppSecret, setChannelAppSecret] = useState("");
  const [showSecret, setShowSecret] = useState(false);
  const [channelSaving, setChannelSaving] = useState(false);
  const [channelError, setChannelError] = useState(null);
  const [channelSuccess, setChannelSuccess] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({ appId: false, appSecret: false });

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

  // Load Feishu channel status when the settings page mounts.
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const status = await getChannelStatus();
        if (!cancelled) setChannelStatus(status || DEFAULT_CHANNEL_STATUS);
      } catch {
        if (!cancelled) setChannelStatus(DEFAULT_CHANNEL_STATUS);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setSaveError(null);
    try {
      const current = formRef.current;
      await updateSettings({
        workspaceRoot: current.workspaceRoot,
        skillRepoPath: current.skillRepoPath,
        theme: current.theme,
        language: current.language,
        density: current.density,
      });
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
        <button
          type="submit"
          form="settings-form"
          className="btn btn-primary"
          data-testid="save-settings-button"
          disabled={saving}
        >
          {saving ? "Saving..." : t("settings.saveChanges")}
        </button>
      </div>

      {saveError && (
        <div className="card" style={{ marginBottom: "var(--ch-space-4)", borderColor: "var(--ch-error)" }}>
          <div className="card-body" style={{ color: "var(--ch-error)" }}>
            {saveError}
          </div>
        </div>
      )}

      <form id="settings-form" data-testid="settings-form" onSubmit={handleSubmit}>
        <div className="settings-grid">
          <div className="settings-main">
            <div className="card" data-testid="channel-settings-card">
              <div className="card-header">
                <h2 className="card-title">{t("settings.channel")}</h2>
                <p className="card-subtitle">{t("settings.channelSubtitle")}</p>
              </div>
              <div className="card-body">
                <div
                  className="channel-status-row"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "var(--ch-space-3)",
                    padding: "var(--ch-space-3)",
                    background: "var(--ch-surface-high)",
                    border: "1px solid var(--ch-border)",
                    borderRadius: "var(--ch-radius-md)",
                    marginBottom: "var(--ch-space-5)",
                  }}
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
          </div>

          <div className="settings-side">
            <div className="card">
              <div className="card-header">
                <h2 className="card-title">{t("settings.about")}</h2>
              </div>
              <div className="card-body">
                <div className="form-group">
                  <label className="form-label">{t("settings.version")}</label>
                  <div className="form-static">0.1.0-alpha</div>
                </div>
                <div className="form-group">
                  <label className="form-label">{t("settings.dataDirectory")}</label>
                  <div className="form-static form-static-mono">
                    ~/.opc-workstation
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </form>
    </div>
  );
}
