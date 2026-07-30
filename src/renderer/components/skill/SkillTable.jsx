import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";

export default function SkillTable({ repos, onSkillClick, onRepoDelete, onRepoRescan, onRepoUpdate, busyRepoId }) {
  const { t } = useTranslation();
  // 默认所有repo都是展开状态
  const [expandedRepos, setExpandedRepos] = useState(() => new Set(repos.map(g => g.repo.id)));

  // 当新增repo时（比如安装新技能包），自动展开它
  useEffect(() => {
    setExpandedRepos(prev => {
      const next = new Set(prev);
      let changed = false;
      for (const group of repos) {
        if (!next.has(group.repo.id)) {
          next.add(group.repo.id);
          changed = true;
        }
      }
      // 清理已删除的repo
      const repoIds = new Set(repos.map(g => g.repo.id));
      for (const id of next) {
        if (!repoIds.has(id)) {
          next.delete(id);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [repos]);

  const totalSkills = repos.reduce((sum, group) => sum + group.skills.length, 0);
  const isBusy = (id) => busyRepoId === id;
  const isExpanded = (repoId) => expandedRepos.has(repoId);

  function toggleRepo(repoId) {
    setExpandedRepos(prev => {
      const next = new Set(prev);
      if (next.has(repoId)) {
        next.delete(repoId);
      } else {
        next.add(repoId);
      }
      return next;
    });
  }

  function expandAll() {
    setExpandedRepos(new Set(repos.map(g => g.repo.id)));
  }

  function collapseAll() {
    setExpandedRepos(new Set());
  }

  return (
    <div className="skill-table" data-testid="skill-table">
      {repos.length === 0 ? (
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
          {repos.map((group) => {
            const expanded = isExpanded(group.repo.id);
            return (
              <div key={group.repo.id} className="skill-repo-group" data-testid="repo-row">
                <div
                  className="skill-repo-header skill-repo-header-clickable"
                  onClick={() => toggleRepo(group.repo.id)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      toggleRepo(group.repo.id);
                    }
                  }}
                >
                  <div className="skill-repo-header-left">
                    <span className={`skill-collapse-arrow ${expanded ? "expanded" : ""}`} aria-hidden="true">
                      ▶
                    </span>
                    <div className="skill-repo-info">
                      <span className="skill-repo-name">
                        {group.repo.name}
                        <span className="skill-count-badge">{group.skills.length}</span>
                      </span>
                      <span className="skill-repo-meta">
                        {group.repo.installSource} · {group.repo.repoPath}
                      </span>
                    </div>
                  </div>
                  <div className="skill-repo-actions" onClick={(e) => e.stopPropagation()}>
                    {onRepoRescan && (
                      <button
                        className="skill-action-secondary"
                        data-testid="repo-rescan-button"
                        disabled={isBusy(group.repo.id)}
                        onClick={(e) => {
                          e.stopPropagation();
                          onRepoRescan(group.repo.id);
                        }}
                      >
                        {isBusy(group.repo.id) ? t("skills.working") : t("skills.rescan")}
                      </button>
                    )}
                    {onRepoUpdate && (
                      <button
                        className="skill-action-secondary"
                        data-testid="repo-update-button"
                        disabled={isBusy(group.repo.id)}
                        onClick={(e) => {
                          e.stopPropagation();
                          onRepoUpdate(group.repo.id);
                        }}
                      >
                        {isBusy(group.repo.id) ? t("skills.working") : t("skills.update")}
                      </button>
                    )}
                    {onRepoDelete && (
                      <button
                        className="skill-action-danger"
                        data-testid="repo-delete-button"
                        disabled={isBusy(group.repo.id)}
                        onClick={(e) => {
                          e.stopPropagation();
                          onRepoDelete(group.repo.id);
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
