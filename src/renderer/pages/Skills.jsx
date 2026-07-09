import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useSkills } from "../hooks/useSkills.js";
import SkillTable from "../components/skill/SkillTable.jsx";
import SkillDetailModal from "../components/skill/SkillDetailModal.jsx";
import InstallSkillModal from "../components/skill/InstallSkillModal.jsx";

export default function Skills() {
  const { t } = useTranslation();
  const { skills, loading, error, install } = useSkills();
  const [detailSkillId, setDetailSkillId] = useState(null);
  const [showInstallModal, setShowInstallModal] = useState(false);

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
          {skills.length} {t("skills.countSuffix")}
        </span>
      </div>

      {loading && <p className="loading-text">{t("skills.loading")}</p>}

      {error && (
        <div className="card" style={{ borderColor: "var(--ch-error)" }}>
          <div className="card-body" style={{ color: "var(--ch-error)" }}>
            {error}
          </div>
        </div>
      )}

      {!loading && !error && (
        <SkillTable skills={skills} onRowClick={setDetailSkillId} />
      )}

      {showInstallModal && (
        <InstallSkillModal
          onClose={() => setShowInstallModal(false)}
          onInstall={install}
        />
      )}

      {detailSkillId && (
        <SkillDetailModal
          skillId={detailSkillId}
          onClose={() => setDetailSkillId(null)}
        />
      )}
    </div>
  );
}
