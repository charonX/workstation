import { HashRouter, Routes, Route, Navigate } from "react-router-dom";
import { SettingsProvider, useSettings } from "./hooks/useSettings.jsx";
import PageLayout from "./components/layout/PageLayout.jsx";
import Dashboard from "./pages/Dashboard.jsx";
import Workspace from "./pages/Workspace.jsx";
import Flows from "./pages/Flows.jsx";
import FlowEditor from "./pages/FlowEditor.jsx";
import Executions from "./pages/Executions.jsx";
import Skills from "./pages/Skills.jsx";
import Settings from "./pages/Settings.jsx";
import "./i18n/index.js";

function AppRoutes() {
  const [, , loading, error] = useSettings();

  if (loading) {
    return (
      <div className="loading-screen" data-testid="loading-screen">
        Loading...
      </div>
    );
  }

  if (error) {
    return (
      <div className="loading-screen" data-testid="settings-error-screen">
        Unable to connect to the workstation server.
      </div>
    );
  }

  return (
    <HashRouter>
      <PageLayout>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/workspace" element={<Workspace />} />
          <Route path="/flows" element={<Flows />} />
          <Route path="/flows/:id" element={<FlowEditor />} />
          <Route path="/executions" element={<Executions />} />
          <Route path="/tasks" element={<Navigate to="/executions" replace />} />
          <Route path="/skills" element={<Skills />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </PageLayout>
    </HashRouter>
  );
}

export default function App() {
  return (
    <SettingsProvider>
      <AppRoutes />
    </SettingsProvider>
  );
}
