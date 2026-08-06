// src/renderer/components/assistant/SessionList.jsx
// 会话区左栏（S1/S4）：新对话 + 通用/项目（行内＋）/飞书分组 + 底部 ⚙ 设置。
// testid 契约（五套 E2E「实现约定」块）：new-chat-button / data-session-group /
// data-project-row / data-add-project / data-project-sessions / data-session-item /
// open-admin-button；项目行 aria-expanded 反映展开态，孤儿行 .deleted 划线且无「＋」。

import { useTranslation } from "react-i18next";

// lastActiveAt → 列表行 meta 文本（观感入 REFLECT；仅结构契约）。
function formatMeta(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay
    ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString([], { month: "2-digit", day: "2-digit" });
}

export default function SessionList({
  sessions,
  selectedKey,
  expanded,
  onToggleProject,
  onSelectSession,
  onNewChat,
  onAddProject,
  onOpenAdmin,
}) {
  const { t } = useTranslation();
  const general = sessions?.general ?? [];
  const projects = sessions?.projects ?? [];
  const feishu = sessions?.feishu ?? [];

  return (
    <aside className="assistant-sidebar">
      <div className="assistant-sidebar-header">
        <h1 className="assistant-sidebar-title">助手</h1>
        {/* 新对话归属 = 通用空间（业务规则 7.1 / F4） */}
        <button type="button" className="btn btn-primary" data-testid="new-chat-button" onClick={onNewChat}>
          新对话
        </button>
      </div>

      <nav className="session-nav" aria-label="会话列表">
        {/* 通用分组（ui:copilot:*） */}
        <div className="nav-group" data-session-group="general">
          <div className="nav-group-label">通用</div>
          {general.length === 0 && <div className="nav-empty">没有聊天</div>}
          {general.map((s) => (
            <SessionItem key={s.spaceKey} session={s} active={s.spaceKey === selectedKey} onSelect={onSelectSession} />
          ))}
        </div>

        {/* 项目分组（ui:project:<pid>:*，项目下嵌套会话） */}
        <div className="nav-group" data-session-group="projects">
          <div className="nav-group-label">项目</div>
          {projects.length === 0 && <div className="nav-empty">没有项目会话</div>}
          {projects.map((p) => {
            const isOpen = expanded.has(p.projectId);
            return (
              <div key={p.projectId}>
                <div
                  className={`nav-project${p.orphan ? " deleted" : ""}`}
                  data-project-row={p.projectId}
                  aria-expanded={isOpen}
                  role="button"
                  tabIndex={0}
                  onClick={() => onToggleProject(p.projectId)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onToggleProject(p.projectId);
                    }
                  }}
                >
                  <span className="chev">{isOpen ? "▾" : "▸"}</span>
                  {/* 孤儿组 projectName = null（裁决 16）→「项目已删除」占位（U-1 前端映射） */}
                  <span className="proj-name">{p.projectName ?? "项目已删除"}</span>
                  {!p.orphan && (
                    <span
                      className="add-btn"
                      data-add-project={p.projectId}
                      role="button"
                      title={`在 ${p.projectName ?? ""} 新建会话`}
                      aria-label={`在 ${p.projectName ?? ""} 新建会话`}
                      onClick={(e) => {
                        e.stopPropagation();
                        onAddProject(p);
                      }}
                    >
                      ＋
                    </span>
                  )}
                </div>
                <div data-project-sessions={p.projectId} hidden={!isOpen}>
                  {p.sessions.length === 0 && <div className="nav-empty">没有聊天</div>}
                  {p.sessions.map((s) => (
                    <SessionItem key={s.spaceKey} session={s} active={s.spaceKey === selectedKey} onSelect={onSelectSession} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        {/* 飞书分组（feishu:*，M2 拍板独立分组平铺；只读回看） */}
        <div className="nav-group" data-session-group="feishu">
          <div className="nav-group-label">飞书</div>
          {feishu.length === 0 && <div className="nav-empty">没有聊天</div>}
          {feishu.map((s) => (
            <SessionItem key={s.spaceKey} session={s} active={s.spaceKey === selectedKey} onSelect={onSelectSession} readonly />
          ))}
        </div>
      </nav>

      {/* 设置：左下角 ⚙ → 进入管理区（双区模型：会话区左导纯会话；管理区 = 旧壳原样） */}
      <div className="assistant-sidebar-settings">
        <button type="button" className="nav-page" data-testid="open-admin-button" onClick={onOpenAdmin}>
          ⚙ {t("nav.settings")}
        </button>
      </div>
    </aside>
  );
}

function SessionItem({ session, active, onSelect, readonly }) {
  return (
    <button
      type="button"
      className={`session-item${active ? " active" : ""}${readonly ? " readonly" : ""}`}
      data-session-item={session.spaceKey}
      data-active={active ? "true" : undefined}
      onClick={() => onSelect(session)}
    >
      <span className="s-title">{session.title ?? "新对话"}</span>
      <span className="s-meta">{formatMeta(session.lastActiveAt)}</span>
    </button>
  );
}
