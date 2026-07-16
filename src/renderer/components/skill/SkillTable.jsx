import { useTranslation } from "react-i18next";

export default function SkillTable({ repos, onSkillClick, onRepoDelete }) {
  const { t } = useTranslation();

  const totalSkills = repos.reduce((sum, group) => sum + group.skills.length, 0);

  return (
    <div className="skill-table" data-testid="skill-table">
      {repos.length === 0 ? (
        <div className="skill-table-empty">{t("skills.noSkills")}</div>
      ) : (
        repos.map((group) => (
          <div key={group.repo.id} className="skill-repo-group" data-testid="repo-row">
            <div className="skill-repo-header">
              <div className="skill-repo-info">
                <span className="skill-repo-name">{group.repo.name}</span>
                <span className="skill-repo-meta">
                  {group.repo.installSource} · {group.repo.repoPath}
                </span>
              </div>
              {onRepoDelete && (
                <button
                  className="skill-action-danger"
                  data-testid="repo-delete-button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRepoDelete(group.repo.id);
                  }}
                >
                  {t("skills.deleteRepo")}
                </button>
              )}
            </div>

            <div className="skill-table-header">
              <span>{t("skills.skill")}</span>
              <span>{t("skills.repoPath")}</span>
              <span>{t("skills.version")}</span>
              <span>{t("skills.category")}</span>
              <span></span>
            </div>

            {group.skills.length === 0 ? (
              <div className="skill-table-empty">{t("skills.noSkillsInRepo")}</div>
            ) : (
              group.skills.map((skill) => (
                <div
                  key={skill.id}
                  className="skill-table-row"
                  data-testid="skill-row"
                  onClick={() => onSkillClick(skill.id)}
                >
                  <div className="skill-cell-main">
                    <span className="skill-cell-title">{skill.name}</span>
                    <span className="skill-cell-meta">{skill.description}</span>
                  </div>
                  <span className="skill-cell-text">{skill.repoPath}</span>
                  <span className="skill-cell-text">{skill.version || "—"}</span>
                  <span className="skill-cell-text">{skill.category || "—"}</span>
                  <span className="skill-action-link">{t("skills.view")}</span>
                </div>
              ))
            )}
          </div>
        ))
      )}
    </div>
  );
}
