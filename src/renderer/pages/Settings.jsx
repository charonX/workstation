import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useSettings } from "../hooks/useSettings.js";

export default function Settings() {
  const { t } = useTranslation();
  const [settings, updateSettings, loading] = useSettings();
  const [form, setForm] = useState({
    workspaceRoot: "",
    skillRepoPath: "",
    theme: "dark",
    language: "en-US",
    density: "comfortable",
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (settings) {
      setForm({
        workspaceRoot: settings.workspaceRoot || "",
        skillRepoPath: settings.skillRepoPath || "",
        theme: settings.theme || "dark",
        language: settings.language || "en-US",
        density: settings.density || "comfortable",
      });
    }
  }, [settings]);

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await updateSettings({
        workspaceRoot: form.workspaceRoot,
        skillRepoPath: form.skillRepoPath,
        theme: form.theme,
        language: form.language,
        density: form.density,
      });
    } finally {
      setSaving(false);
    }
  }

  function handleChange(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }));
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

      <form id="settings-form" data-testid="settings-form" onSubmit={handleSubmit}>
        <div className="settings-grid">
          <div className="settings-main">
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
                  <input
                    id="workspace-root-input"
                    type="text"
                    className="form-input"
                    data-testid="workspace-root-input"
                    value={form.workspaceRoot}
                    onChange={(e) => handleChange("workspaceRoot", e.target.value)}
                  />
                  <p className="help-text">{t("settings.workspaceRootHelp")}</p>
                </div>

                <div className="form-group">
                  <label className="form-label" htmlFor="skill-repo-path-input">
                    {t("settings.skillRepoPath")}
                  </label>
                  <input
                    id="skill-repo-path-input"
                    type="text"
                    className="form-input"
                    data-testid="skill-repo-path-input"
                    value={form.skillRepoPath}
                    onChange={(e) => handleChange("skillRepoPath", e.target.value)}
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
                    <option value="en-US">English</option>
                    <option value="zh-CN">中文</option>
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
