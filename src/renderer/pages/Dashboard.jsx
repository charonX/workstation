import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { useDashboard } from "../hooks/useDashboard.js";
import StatusBadge from "../components/shared/StatusBadge.jsx";
import "./Dashboard.css";

function StatCard({ testid, label, value }) {
  return (
    <div className="stat-card" data-testid={testid}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
    </div>
  );
}

function RecentExecutionsPanel({ executions }) {
  const { t } = useTranslation();

  if (!executions || executions.length === 0) {
    return (
      <div className="dashboard-panel">
        <div className="panel-header">
          <h2 className="panel-title">{t("dashboard.recentExecutions")}</h2>
        </div>
        <div className="panel-body">
          <div className="empty-state">{t("dashboard.noExecutions")}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="dashboard-panel">
      <div className="panel-header">
        <h2 className="panel-title">{t("dashboard.recentExecutions")}</h2>
      </div>
      <div className="panel-body" data-testid="recent-executions-list">
        {executions.map((execution, index) => (
          <div key={index} className="list-item" role="listitem">
            <div className="list-main">
              <span className="list-title">
                {execution.flowName || t("dashboard.unknownFlow")}
              </span>
              <span className="list-meta">
                {execution.projectName
                  ? `${execution.projectName} · ${execution.status}`
                  : execution.status}
                {execution.time ? ` · ${execution.time}` : ""}
              </span>
            </div>
            <StatusBadge status={execution.status} />
          </div>
        ))}
      </div>
    </div>
  );
}

function QuickProjectsPanel({ projects }) {
  const { t } = useTranslation();
  const navigate = useNavigate();

  if (!projects || projects.length === 0) {
    return (
      <div className="dashboard-panel">
        <div className="panel-header">
          <h2 className="panel-title">{t("dashboard.quickProjects")}</h2>
        </div>
        <div className="panel-body">
          <div className="empty-state">{t("dashboard.noProjects")}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="dashboard-panel">
      <div className="panel-header">
        <h2 className="panel-title">{t("dashboard.quickProjects")}</h2>
      </div>
      <div className="panel-body">
        {projects.map((project) => (
          <div
            key={project.id}
            className="list-item"
            role="link"
            onClick={() => navigate("/workspace")}
          >
            <div className="list-main">
              <span className="list-title">{project.name}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { t } = useTranslation();
  const [data, loading, error] = useDashboard();

  if (loading) {
    return (
      <div className="page" data-testid="dashboard-page">
        <div className="page-header">
          <h1 className="page-title">{t("nav.dashboard")}</h1>
        </div>
        <div className="loading-state">{t("dashboard.loading")}</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="page" data-testid="dashboard-page">
        <div className="page-header">
          <h1 className="page-title">{t("nav.dashboard")}</h1>
        </div>
        <div className="error-state">{error}</div>
      </div>
    );
  }

  const successRatePercent = data?.successRate !== undefined
    ? Math.round(data.successRate * 100)
    : 0;

  return (
    <div className="page" data-testid="dashboard-page">
      <div className="page-header">
        <h1 className="page-title">{t("nav.dashboard")}</h1>
      </div>

      <div className="dashboard-stats-grid">
        <StatCard
          testid="project-count-card"
          label={t("dashboard.projects")}
          value={data?.projectCount ?? 0}
        />
        <StatCard
          testid="active-schedule-count-card"
          label={t("dashboard.activeSchedules")}
          value={data?.activeScheduleCount ?? 0}
        />
        <StatCard
          testid="recent-run-count-card"
          label={t("dashboard.recentRuns")}
          value={data?.recentRunCount ?? 0}
        />
        <StatCard
          testid="success-rate-card"
          label={t("dashboard.successRate")}
          value={`${successRatePercent}%`}
        />
      </div>

      <div className="dashboard-grid">
        <RecentExecutionsPanel executions={data?.recentExecutions} />
        <QuickProjectsPanel projects={data?.quickProjectLinks} />
      </div>
    </div>
  );
}
