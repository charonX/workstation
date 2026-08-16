import { Link, useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";

function SidebarNavLink({ to, testid, children }) {
  const location = useLocation();
  const isActive = location.pathname === to || (to !== "/" && location.pathname.startsWith(to));
  return (
    <Link
      to={to}
      className={`nav-link${isActive ? " active" : ""}`}
      data-testid={testid}
    >
      {children}
    </Link>
  );
}

// 管理区顶部「← 返回对话」（ADR-018 双区模型：管理区 = 旧应用壳原样保留 +
// 返回对话，REQ-AGENT-026 AC2/4/5）——经会话区 ⚙ 进入管理区，经本按钮回会话区。
function BackToChatButton() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  return (
    <button
      type="button"
      className="back-to-chat-button"
      data-testid="back-to-chat-button"
      onClick={() => navigate("/assistant")}
    >
      ← {t("nav.backToChat")}
    </button>
  );
}

export default function Sidebar() {
  const { t } = useTranslation();

  return (
    <aside className="sidebar" data-testid="sidebar">
      <BackToChatButton />
      <nav className="sidebar-nav">
        <div className="nav-group">
          <div className="nav-label">{t("nav.workspace")}</div>
          <SidebarNavLink to="/" testid="nav-dashboard">{t("nav.dashboard")}</SidebarNavLink>
          <SidebarNavLink to="/workspace" testid="nav-workspace">{t("nav.workspace")}</SidebarNavLink>
          <SidebarNavLink to="/flows" testid="nav-flows">{t("nav.flows")}</SidebarNavLink>
          <SidebarNavLink to="/executions" testid="nav-executions">{t("nav.executions")}</SidebarNavLink>
          <SidebarNavLink to="/sources" testid="nav-sources">{t("nav.sources")}</SidebarNavLink>
        </div>
        <div className="nav-group">
          <div className="nav-label">{t("nav.system")}</div>
          <SidebarNavLink to="/skills" testid="nav-skills">{t("nav.skills")}</SidebarNavLink>
          {/* 管理区「MCP」导航项（BUG-013，REQ-AGENT-084 IA 注记：独立页 #/mcp，位于技能之下） */}
          <SidebarNavLink to="/mcp" testid="nav-mcp">MCP</SidebarNavLink>
          {/* 管理区「插件」导航项（REQ-AGENT-083 E2E 路由 #/plugins，signoff D5） */}
          <SidebarNavLink to="/plugins" testid="nav-plugins">插件</SidebarNavLink>
          {/* 管理区左导八条目（REQ-AGENT-026 AC2）：既有七条目 + 补「通知」
              （signoff 实现契约：nav-notifications，路由 /notifications 已存在） */}
          <SidebarNavLink to="/notifications" testid="nav-notifications">{t("nav.notifications")}</SidebarNavLink>
          <SidebarNavLink to="/settings" testid="nav-settings">{t("nav.settings")}</SidebarNavLink>
        </div>
      </nav>
    </aside>
  );
}
