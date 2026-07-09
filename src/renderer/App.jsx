import { useState, useEffect } from "react";
import { HashRouter, Routes, Route, Link } from "react-router-dom";

function App() {
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [settingsError, setSettingsError] = useState(false);

  useEffect(() => {
    async function fetchSettings() {
      try {
        const res = await fetch(`${window.opc.apiBaseUrl}/api/settings`);
        if (res.ok) {
          const data = await res.json();
          setSettings(data);
          // Apply theme, language, and density to document
          if (data.theme) {
            document.documentElement.setAttribute("data-theme", data.theme);
          }
          if (data.language) {
            document.documentElement.setAttribute("lang", data.language);
          }
          if (data.density) {
            document.documentElement.setAttribute("data-density", data.density);
          }
        } else {
          setSettingsError(true);
        }
      } catch (err) {
        console.error("Failed to fetch settings:", err);
        setSettingsError(true);
      } finally {
        setLoading(false);
      }
    }
    fetchSettings();
  }, []);

  if (loading) {
    return (
      <div className="loading-screen" data-testid="loading-screen">
        Loading...
      </div>
    );
  }

  if (settingsError) {
    return (
      <div className="loading-screen" data-testid="settings-error-screen">
        Unable to connect to the workstation server.
      </div>
    );
  }

  return (
    <HashRouter>
      <div className="app-layout">
        <Sidebar />
        <div className="app-main">
          <TopBar />
          <div className="app-content">
            <Routes>
              <Route path="/" element={<DashboardPage />} />
              <Route path="/workspace" element={<WorkspacePage />} />
              <Route path="/flows" element={<FlowsPage />} />
              <Route path="/flows/:id" element={<FlowEditorPage />} />
              <Route path="/tasks" element={<TasksPage />} />
              <Route path="/skills" element={<SkillsPage />} />
              <Route path="/settings" element={<SettingsPage />} />
            </Routes>
          </div>
        </div>
      </div>
    </HashRouter>
  );
}

function Sidebar() {
  return (
    <aside className="sidebar" data-testid="sidebar">
      <div className="sidebar-header">
        <div className="sidebar-logo">OPC Workstation</div>
      </div>
      <nav className="sidebar-nav">
        <SidebarNavLink to="/" testid="nav-dashboard">Dashboard</SidebarNavLink>
        <SidebarNavLink to="/workspace" testid="nav-workspace">Workspace</SidebarNavLink>
        <SidebarNavLink to="/flows" testid="nav-flows">Flows</SidebarNavLink>
        <SidebarNavLink to="/tasks" testid="nav-tasks">Tasks</SidebarNavLink>
        <SidebarNavLink to="/skills" testid="nav-skills">Skills</SidebarNavLink>
        <SidebarNavLink to="/settings" testid="nav-settings">Settings</SidebarNavLink>
      </nav>
    </aside>
  );
}

function SidebarNavLink({ to, testid, children }) {
  return (
    <Link to={to} className="nav-link" data-testid={testid}>
      {children}
    </Link>
  );
}

function TopBar() {
  return (
    <header className="topbar">
      <div className="topbar-title"></div>
      <div className="topbar-actions"></div>
    </header>
  );
}

// Placeholder page components
function DashboardPage() {
  return (
    <div className="page" data-testid="dashboard-page">
      <h1>Dashboard</h1>
      <p>Overview of your workspace.</p>
    </div>
  );
}

function WorkspacePage() {
  return (
    <div className="page" data-testid="workspace-page">
      <h1>Workspace</h1>
      <p>Manage your projects.</p>
    </div>
  );
}

function FlowsPage() {
  return (
    <div className="page" data-testid="flows-page">
      <h1>Flows</h1>
      <p>Manage your automation flows.</p>
    </div>
  );
}

function FlowEditorPage() {
  return (
    <div className="page" data-testid="flow-editor-page">
      <h1>Flow Editor</h1>
      <p>Design and edit your flow.</p>
    </div>
  );
}

function TasksPage() {
  return (
    <div className="page" data-testid="tasks-page">
      <h1>Tasks</h1>
      <p>Manage tasks and view execution history.</p>
    </div>
  );
}

function SkillsPage() {
  return (
    <div className="page" data-testid="skills-page">
      <h1>Skills</h1>
      <p>Manage your skills.</p>
    </div>
  );
}

function SettingsPage() {
  return (
    <div className="page" data-testid="settings-page">
      <h1>Settings</h1>
      <p>Configure workspace, theme, and preferences.</p>
    </div>
  );
}

export default App;
