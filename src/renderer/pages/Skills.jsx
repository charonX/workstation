import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useSkills } from "../hooks/useSkills.js";
import SkillTable from "../components/skill/SkillTable.jsx";
import InstallSkillModal from "../components/skill/InstallSkillModal.jsx";
import ConfirmDialog from "../components/shared/ConfirmDialog.jsx";

export default function Skills() {
  const { t } = useTranslation();
  const { groups, loading, error, refetch, install, updateSource, removeSource } = useSkills();
  const [showInstallModal, setShowInstallModal] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingDeleteSlug, setPendingDeleteSlug] = useState(null);
  const [busySlug, setBusySlug] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [actionSuccess, setActionSuccess] = useState(null);
  const [updateLog, setUpdateLog] = useState(null);

  const skillCount = groups.reduce((sum, g) => sum + g.skills.length, 0);

  function handleRequestDelete(slug) {
    setPendingDeleteSlug(slug);
    setConfirmOpen(true);
  }

  async function handleConfirmDelete() {
    if (!pendingDeleteSlug) return;
    const slug = pendingDeleteSlug;
    setConfirmOpen(false);
    setPendingDeleteSlug(null);
    setBusySlug(slug);
    setActionError(null);
    setActionSuccess(null);
    setUpdateLog(null);
    try {
      await removeSource(slug);
    } catch (err) {
      setActionError(err.message || "Delete failed");
    } finally {
      setBusySlug(null);
    }
  }

  async function handleUpdate(slug) {
    setBusySlug(slug);
    setActionError(null);
    setActionSuccess(null);
    setUpdateLog(null);
    try {
      await updateSource(slug);
      setActionSuccess(t("skills.updateSuccess", { slug }));
    } catch (err) {
      setActionError(err.message || "Update failed");
      setUpdateLog(err.log ?? null);
    } finally {
      setBusySlug(null);
    }
  }

  async function handleInstall(sourceType, identifier) {
    setActionError(null);
    setActionSuccess(null);
    setUpdateLog(null);
    await install(sourceType, identifier);
  }

  return (
    <div className="page" data-testid="skills-page">
      <div className="page-header">
        <h1 className="page-title">{t("skills.title")}</h1>
        <button
          className="btn btn-primary"
          data-testid="install-skill-button"
          onClick={() => setShowInstallModal(true)}
        >
          + {t("skills.installSkill")}
        </button>
      </div>

      <div className="toolbar">
        <span className="skill-count">
          {skillCount} {t("skills.countSuffix")}
        </span>
      </div>

      {actionSuccess && (
        <div className="card" style={{ borderColor: "var(--ch-success)" }} data-testid="update-success">
          <div className="card-body" style={{ color: "var(--ch-success)" }}>
            {actionSuccess}
          </div>
        </div>
      )}

      {actionError && (
        <div className="card" style={{ borderColor: "var(--ch-error)" }}>
          <div className="card-body" style={{ color: "var(--ch-error)" }}>
            {actionError}
          </div>
        </div>
      )}

      {updateLog && (
        <div className="card" style={{ borderColor: "var(--ch-border)" }}>
          <div className="card-body">
            <div className="update-log-title" style={{ marginBottom: "var(--ch-space-2)", fontWeight: "var(--ch-weight-medium)" }}>
              {t("skills.updateLogTitle")}
            </div>
            <pre
              data-testid="update-log-panel"
              style={{
                margin: 0,
                maxHeight: 240,
                overflow: "auto",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                fontFamily: "var(--ch-font-mono)",
                fontSize: "var(--ch-text-xs)",
                background: "var(--ch-surface-high)",
                padding: "var(--ch-space-2) var(--ch-space-3)",
                borderRadius: "var(--ch-radius-md)",
              }}
            >
              {updateLog}
            </pre>
          </div>
        </div>
      )}

      {loading && <p className="loading-text">{t("skills.loading")}</p>}

      {error && (
        <div className="card" style={{ borderColor: "var(--ch-error)" }}>
          <div className="card-body" style={{ color: "var(--ch-error)" }}>
            {error}
          </div>
        </div>
      )}

      {!loading && !error && (
        <SkillTable
          groups={groups}
          onRequestDelete={handleRequestDelete}
          onRequestUpdate={handleUpdate}
          busySlug={busySlug}
        />
      )}

      {showInstallModal && (
        <InstallSkillModal
          onClose={() => setShowInstallModal(false)}
          onInstall={handleInstall}
        />
      )}

      <ConfirmDialog
        isOpen={confirmOpen}
        title={t("skills.confirmDeleteRepoTitle")}
        message={t("skills.confirmDeleteRepoMessage")}
        onConfirm={handleConfirmDelete}
        onCancel={() => {
          setConfirmOpen(false);
          setPendingDeleteSlug(null);
        }}
      />
    </div>
  );
}
