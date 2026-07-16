/**
 * StatusBadge — shared status badge component.
 * Props:
 *   - status: string — raw status value (success/completed/running/error/failed/unknown)
 *   - label: string — optional override label
 */
export default function StatusBadge({ status, label }) {
  const normalized = status?.toLowerCase() || "unknown";
  let className = "status-badge";
  let displayLabel = label || status || "Unknown";

  if (normalized === "success" || normalized === "completed") {
    className += " status-success";
    displayLabel = label || "Success";
  } else if (normalized === "running") {
    className += " status-running";
    displayLabel = label || "Running";
  } else if (normalized === "error" || normalized === "failed") {
    className += " status-error";
    displayLabel = label || "Failed";
  } else {
    className += " status-success";
  }

  return (
    <span className={className}>
      <span className="status-dot" />
      {displayLabel}
    </span>
  );
}
