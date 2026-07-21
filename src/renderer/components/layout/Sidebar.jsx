import { Link, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useUnreadCount } from "../../hooks/useUnreadCount.js";

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

export default function Sidebar() {
  const { t } = useTranslation();
  const unreadCount = useUnreadCount();

  return (
    <aside className="sidebar" data-testid="sidebar">
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
          <SidebarNavLink to="/settings" testid="nav-settings">{t("nav.settings")}</SidebarNavLink>
        </div>
      </nav>
      <div className="sidebar-bottom">
        <SidebarNavLink to="/notifications" testid="nav-notifications">
          <span>{t("nav.notifications")}</span>
          <span
            className={`nav-badge${unreadCount === 0 ? " hidden" : ""}`}
            data-testid="nav-notifications-badge"
          >
            {unreadCount}
          </span>
        </SidebarNavLink>
      </div>
    </aside>
  );
}
