import { useTranslation } from "react-i18next";

export default function SkillTable({ skills, onRowClick }) {
  const { t } = useTranslation();

  return (
    <div className="skill-table" data-testid="skill-table">
      <div className="skill-table-header">
        <span>{t("skills.skill")}</span>
        <span>{t("skills.repoPath")}</span>
        <span>{t("skills.version")}</span>
        <span>{t("skills.category")}</span>
        <span></span>
      </div>
      {skills.length === 0 ? (
        <div className="skill-table-empty">{t("skills.noSkills")}</div>
      ) : (
        skills.map((skill) => (
          <div
            key={skill.id}
            className="skill-table-row"
            data-testid="skill-row"
            onClick={() => onRowClick(skill.id)}
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
  );
}
