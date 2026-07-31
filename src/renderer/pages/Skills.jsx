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
    try {
      await updateSource(slug);
    } catch (err) {
      setActionError(err.message || "Update failed");
    } finally {
      setBusySlug(null);
    }
  }

  async function handleInstall(sourceType, identifier) {
    setActionError(null);
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

      {actionError && (
        <div className="card" style={{ borderColor: "var(--ch-error)" }}>
          <div className="card-body" style={{ color: "var(--ch-error)" }}>
            {actionError}
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
