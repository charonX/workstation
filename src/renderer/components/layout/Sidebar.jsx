import { Link, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";

function NavLink({ to, testid, children }) {
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

  return (
    <aside className="sidebar" data-testid="sidebar">
      <div className="sidebar-header">
        <div className="sidebar-logo">OPC Workstation</div>
      </div>
      <nav className="sidebar-nav">
        <div className="nav-group">
          <div className="nav-label">{t("nav.workspace")}</div>
          <NavLink to="/" testid="nav-dashboard">{t("nav.dashboard")}</NavLink>
          <NavLink to="/workspace" testid="nav-workspace">{t("nav.workspace")}</NavLink>
          <NavLink to="/flows" testid="nav-flows">{t("nav.flows")}</NavLink>
          <NavLink to="/tasks" testid="nav-tasks">{t("nav.tasks")}</NavLink>
        </div>
        <div className="nav-group">
          <div className="nav-label">{t("nav.system")}</div>
          <NavLink to="/skills" testid="nav-skills">{t("nav.skills")}</NavLink>
          <NavLink to="/settings" testid="nav-settings">{t("nav.settings")}</NavLink>
        </div>
      </nav>
    </aside>
  );
}
