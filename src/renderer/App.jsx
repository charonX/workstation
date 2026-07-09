import { useState, useEffect } from "react";
import { HashRouter, Routes, Route, Link } from "react-router-dom";

function App() {
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchSettings() {
      try {
        const res = await fetch(`${window.opc.apiBaseUrl}/api/settings`);
        if (res.ok) {
          const data = await res.json();
          setSettings(data);
          // Apply theme and language to document
          if (data.theme) {
            document.documentElement.setAttribute("data-theme", data.theme);
          }
          if (data.language) {
            document.documentElement.setAttribute("lang", data.language);
          }
        }
      } catch (err) {
        console.error("Failed to fetch settings:", err);
      } finally {
        setLoading(false);
      }
    }
    fetchSettings();
  }, []);

  if (loading) {
    return (
      <div className="loading-screen">
        Loading...
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
        <NavLink to="/" testid="nav-dashboard">Dashboard</NavLink>
        <NavLink to="/workspace" testid="nav-workspace">Workspace</NavLink>
        <NavLink to="/flows" testid="nav-flows">Flows</NavLink>
        <NavLink to="/tasks" testid="nav-tasks">Tasks</NavLink>
        <NavLink to="/skills" testid="nav-skills">Skills</NavLink>
        <NavLink to="/settings" testid="nav-settings">Settings</NavLink>
      </nav>
    </aside>
  );
}

function NavLink({ to, testid, children }) {
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
    <div className="page">
      <h1>Workspace</h1>
      <p>Manage your projects.</p>
    </div>
  );
}

function FlowsPage() {
  return (
    <div className="page">
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
    <div className="page">
      <h1>Tasks</h1>
      <p>Manage tasks and view execution history.</p>
    </div>
  );
}

function SkillsPage() {
  return (
    <div className="page">
      <h1>Skills</h1>
      <p>Manage your skills.</p>
    </div>
  );
}

function SettingsPage() {
  return (
    <div className="page">
      <h1>Settings</h1>
      <p>Configure workspace, theme, and preferences.</p>
    </div>
  );
}

export default App;
