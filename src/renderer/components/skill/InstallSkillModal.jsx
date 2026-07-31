import { useState } from "react";
import { useTranslation } from "react-i18next";
import Modal from "../shared/Modal.jsx";

// REQ-SKILL-009: only Git URL and Local Path are accepted after the ADR-011
// rewrite (npm/plugin sources have been removed).
const SOURCE_OPTIONS = [
  { value: "git", label: "Git URL" },
  { value: "local", label: "Local Path" },
];

export default function InstallSkillModal({ onClose, onInstall }) {
  const { t } = useTranslation();
  const [source, setSource] = useState("git");
  const [identifier, setIdentifier] = useState("");
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState(null);
  const [completed, setCompleted] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!identifier.trim()) return;

    setInstalling(true);
    setCompleted(false);
    setError(null);
    try {
      await onInstall(source, identifier.trim());
      setCompleted(true);
      // Brief pause so the success state is perceivable before dismissal.
      setTimeout(() => onClose(), 400);
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
              disabled={installing || completed}
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
              placeholder={
                source === "git"
                  ? "https://github.com/owner/repo.git"
                  : t("skills.identifierPlaceholder")
              }
              required
              disabled={installing || completed}
            />
            <p className="help-text">{t("skills.identifierHelp")}</p>
          </div>
        </div>

        <div className="modal-footer">
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={installing}>
            {t("common.cancel")}
          </button>
          <button
            type="submit"
            className="btn btn-primary"
            data-testid="submit-install-skill-button"
            disabled={installing || completed || !identifier.trim()}
          >
            {installing ? t("skills.installing") : t("skills.installSkill")}
          </button>
        </div>
      </form>
    </Modal>
  );
}
