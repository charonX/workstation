import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";

/**
 * Skill library table. Props:
 *   - groups: listSkillGroups() output — [{slug, sourceType, sourceUrl, skills:[{skillName,name,description}]}]
 *   - onRequestDelete(slug): open the confirm dialog
 *   - onRequestUpdate(slug): trigger a source update job
 *   - busySlug: slug currently running an update job
 */
export default function SkillTable({ groups, onRequestDelete, onRequestUpdate, busySlug }) {
  const { t } = useTranslation();
  // Default: expand every group so a fresh install is immediately visible.
  const [expandedSlugs, setExpandedSlugs] = useState(() => new Set(groups.map((g) => g.slug)));

  useEffect(() => {
    setExpandedSlugs((prev) => {
      const next = new Set(prev);
      let changed = false;
      const currentSlugs = new Set(groups.map((g) => g.slug));
      for (const slug of currentSlugs) {
        if (!next.has(slug)) {
          next.add(slug);
          changed = true;
        }
      }
      for (const slug of next) {
        if (!currentSlugs.has(slug)) {
          next.delete(slug);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [groups]);

  function toggle(slug) {
    setExpandedSlugs((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  }

  function expandAll() {
    setExpandedSlugs(new Set(groups.map((g) => g.slug)));
  }

  function collapseAll() {
    setExpandedSlugs(new Set());
  }

  return (
    <div className="skill-table" data-testid="skill-table">
      {groups.length === 0 ? (
        <div className="skill-table-empty">{t("skills.noSkills")}</div>
      ) : (
        <>
          <div className="skill-table-toolbar">
            <button className="skill-action-tertiary" onClick={expandAll} data-testid="expand-all-repos">
              {t("skills.expandAll")}
            </button>
            <button className="skill-action-tertiary" onClick={collapseAll} data-testid="collapse-all-repos">
              {t("skills.collapseAll")}
            </button>
          </div>
          {groups.map((group) => {
            const expanded = expandedSlugs.has(group.slug);
            const busy = busySlug === group.slug;
            return (
              <div key={group.slug} className="skill-repo-group" data-testid="repo-row">
                <div
                  className="skill-repo-header skill-repo-header-clickable"
                  onClick={() => toggle(group.slug)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      toggle(group.slug);
                    }
                  }}
                >
                  <div className="skill-repo-header-left">
                    <span className={`skill-collapse-arrow ${expanded ? "expanded" : ""}`} aria-hidden="true">
                      ▶
                    </span>
                    <div className="skill-repo-info">
                      <span className="skill-repo-name">
                        {group.slug}
                        <span className="skill-count-badge">{group.skills.length}</span>
                      </span>
                      <span className="skill-repo-meta">
                        {group.sourceType}
                        {group.sourceType === "git" || group.sourceType === "local" ? ` · ` : ""}
                        <span data-testid="repo-version">{group.version ?? "—"}</span>
                        {group.sourceUrl ? ` · ${group.sourceUrl}` : ""}
                      </span>
                    </div>
                  </div>
                  <div className="skill-repo-actions" onClick={(e) => e.stopPropagation()}>
                    {group.sourceType === "git" && onRequestUpdate && (
                      <button
                        className="skill-action-secondary"
                        data-testid="repo-update-button"
                        disabled={busy}
                        onClick={(e) => {
                          e.stopPropagation();
                          onRequestUpdate(group.slug);
                        }}
                      >
                        {busy ? t("skills.working") : t("skills.update")}
                      </button>
                    )}
                    {onRequestDelete && (
                      <button
                        className="skill-action-danger"
                        data-testid="repo-delete-button"
                        disabled={busy}
                        onClick={(e) => {
                          e.stopPropagation();
                          onRequestDelete(group.slug);
                        }}
                      >
                        {t("skills.deleteRepo")}
                      </button>
                    )}
                  </div>
                </div>

                {expanded && (
                  <>
                    <div className="skill-table-header">
                      <span>{t("skills.skill")}</span>
                      <span>{t("skills.description")}</span>
                    </div>

                    {group.skills.length === 0 ? (
                      <div className="skill-table-empty">{t("skills.noSkillsInRepo")}</div>
                    ) : (
                      group.skills.map((skill) => (
                        <div
                          key={`${group.slug}/${skill.skillName}`}
                          className="skill-table-row"
                          data-testid="skill-row"
                        >
                          <div className="skill-cell-main">
                            <span className="skill-cell-title">{skill.name || skill.skillName}</span>
                            <span className="skill-cell-meta">{skill.skillName}</span>
                          </div>
                          <span className="skill-cell-text">{skill.description || "—"}</span>
                        </div>
                      ))
                    )}
                  </>
                )}
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}
