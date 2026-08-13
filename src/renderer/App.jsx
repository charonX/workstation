import { HashRouter, Routes, Route, Navigate } from "react-router-dom";
import { SettingsProvider, useSettings } from "./hooks/useSettings.jsx";
import PageLayout from "./components/layout/PageLayout.jsx";
import Dashboard from "./pages/Dashboard.jsx";
import Workspace from "./pages/Workspace.jsx";
import Flows from "./pages/Flows.jsx";
import FlowEditor from "./pages/FlowEditor.jsx";
import Executions from "./pages/Executions.jsx";
import Sources from "./pages/Sources.jsx";
import Notifications from "./pages/Notifications.jsx";
import Skills from "./pages/Skills.jsx";
import Plugins from "./pages/Plugins.jsx";
import Settings from "./pages/Settings.jsx";
import Assistant from "./pages/Assistant.jsx";
import "./i18n/index.js";

// 管理区（ADR-018 双区模型）：旧应用壳原样整体保留——PageLayout（TopBar + Sidebar）
// + 旧页面路由；左导八条目 + 顶部「← 返回对话」（Sidebar 内），旧路由/页面本体
// 零改动（REQ-AGENT-026 AC2/3/5）。screen-admin 为管理区容器 testid 契约。
function AdminZone() {
  return (
    <div className="screen-admin" data-testid="screen-admin">
      <PageLayout>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/workspace" element={<Workspace />} />
          <Route path="/flows" element={<Flows />} />
          <Route path="/flows/:id" element={<FlowEditor />} />
          <Route path="/executions" element={<Executions />} />
          <Route path="/sources" element={<Sources />} />
          <Route path="/notifications" element={<Notifications />} />
          <Route path="/tasks" element={<Navigate to="/executions" replace />} />
          <Route path="/skills" element={<Skills />} />
          <Route path="/plugins" element={<Plugins />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </PageLayout>
    </div>
  );
}

// 双区路由（REQ-AGENT-026 / ADR-018）：
// - /assistant = 会话区（默认落地——启动 URL 由 main.js 直接带 #/assistant，
//   不引入 "/" 重定向，管理区仪表盘指向 "/" 保持可达）；
// - 其余全部 = 管理区壳（含直接访问旧路由，AC5）。
function AppRoutes() {
  const [, , , loading, error] = useSettings();

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
      <Routes>
        <Route path="/assistant" element={<Assistant />} />
        <Route path="*" element={<AdminZone />} />
      </Routes>
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
