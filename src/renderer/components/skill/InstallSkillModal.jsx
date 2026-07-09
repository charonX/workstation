import { useState } from "react";
import { useTranslation } from "react-i18next";
import Modal from "../shared/Modal.jsx";

const SOURCE_OPTIONS = [
  { value: "npm", label: "npm / npx" },
  { value: "plugin", label: "Claude Plugin" },
  { value: "local", label: "Local Files" },
];

export default function InstallSkillModal({ onClose, onInstall }) {
  const { t } = useTranslation();
  const [source, setSource] = useState("npm");
  const [identifier, setIdentifier] = useState("");
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!identifier.trim()) return;

    setInstalling(true);
    setError(null);
    try {
      await onInstall(source, identifier.trim());
      onClose();
    } catch (err) {
      setError(err.message || t("skills.installError"));
    } finally {
      setInstalling(false);
    }
  }

  return (
    <Modal
      isOpen={true}
      onClose={onClose}
      title={t("skills.installSkill")}
      testid="install-skill-modal"
    >
      <form onSubmit={handleSubmit}>
        <div className="modal-body">
          {error && (
            <div className="form-error" style={{ marginBottom: "var(--ch-space-4)" }}>
              {error}
            </div>
          )}

          <div className="form-group">
            <label className="form-label" htmlFor="skill-source-select">
              {t("skills.installSource")}
            </label>
            <select
              id="skill-source-select"
              className="form-select"
              data-testid="skill-source-select"
              value={source}
              onChange={(e) => setSource(e.target.value)}
            >
              {SOURCE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="skill-identifier-input">
              {t("skills.identifier")}
            </label>
            <input
              id="skill-identifier-input"
              type="text"
              className="form-input"
              data-testid="skill-identifier-input"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              placeholder={t("skills.identifierPlaceholder")}
              required
            />
            <p className="help-text">{t("skills.identifierHelp")}</p>
          </div>
        </div>

        <div className="modal-footer">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button
            type="submit"
            className="btn btn-primary"
            data-testid="submit-install-skill-button"
            disabled={installing || !identifier.trim()}
          >
            {installing ? t("skills.installing") : t("skills.installSkill")}
          </button>
        </div>
      </form>
    </Modal>
  );
}
