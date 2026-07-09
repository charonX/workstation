import { useNavigate } from "react-router-dom";

export default function FlowCard({ flow }) {
  const navigate = useNavigate();

  const nodeCount = flow.nodeCount ?? (Array.isArray(flow.nodeList) ? flow.nodeList.length : 0);

  return (
    <div
      className="flow-card"
      data-testid="flow-card"
      onClick={() => navigate(`/flows/${flow.id}`)}
      role="button"
      tabIndex={0}
    >
      <div className="flow-card-header">
        <div>
          <h3 className="flow-name">{flow.name}</h3>
          <div className="flow-project">{flow.projectName || flow.projectId}</div>
        </div>
      </div>
      <div className="flow-meta">
        <span>{nodeCount} nodes</span>
        <span>{flow.scheduleEnabled ? "Scheduled" : "Manual"}</span>
      </div>
      <div className="flow-footer">
        <span>Updated {formatTime(flow.updatedAt)}</span>
      </div>
    </div>
  );
}

function formatTime(iso) {
  if (!iso) return "—";
  const date = new Date(iso);
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}
