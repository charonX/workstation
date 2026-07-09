import { HashRouter, Routes, Route } from "react-router-dom";
import { useSettings } from "./hooks/useSettings.js";
import PageLayout from "./components/layout/PageLayout.jsx";
import Dashboard from "./pages/Dashboard.jsx";
import Workspace from "./pages/Workspace.jsx";
import Flows from "./pages/Flows.jsx";
import FlowEditor from "./pages/FlowEditor.jsx";
import Tasks from "./pages/Tasks.jsx";
import Skills from "./pages/Skills.jsx";
import Settings from "./pages/Settings.jsx";
import "./i18n/index.js";

function App() {
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
          <Route path="/tasks" element={<Tasks />} />
          <Route path="/skills" element={<Skills />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </PageLayout>
    </HashRouter>
  );
}

export default App;
