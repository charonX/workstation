// src/renderer/components/trajectory/Inspector.jsx
// 轨迹账本行详情检查器（REQ-AGENT-131 / PRD §4 稳定块 5）。
// 展示选中记录的 Input / Output / Timing / Usage 节；超限截断徽章。
// data-testid：inspector-panel
// 子执行跳转（REQ-AGENT-135）：name="task run" 且 output.executionId 有效时渲染 data-testid="subexec-link"。

import { useNavigate } from "react-router-dom";

function TruncatedBadge({ truncated }) {
  if (!truncated) return null;
  return <span className="traj-truncated-badge" title="载体超 256KB，内容已截断">截断</span>;
}

function JsonBlock({ label, value, truncated }) {
  if (value === undefined || value === null) return null;
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return (
    <div className="insp-section">
      <div className="insp-section-label">{label}<TruncatedBadge truncated={truncated} /></div>
      <pre className="insp-code">{text}</pre>
    </div>
  );
}

function TimingSection({ record }) {
  const parts = [];
  if (typeof record.ttftMs === "number") {
    parts.push(`首字延迟（TTFT）: ${record.ttftMs} ms`);
  }
  if (typeof record.decodeMs === "number") {
    parts.push(`解码: ${record.decodeMs} ms`);
  }
  if (typeof record.durationMs === "number") {
    parts.push(`耗时: ${record.durationMs} ms`);
  }
  if (parts.length === 0) return null;
  return (
    <div className="insp-section">
      <div className="insp-section-label">耗时</div>
      <div className="insp-timing">{parts.map((p) => <div key={p}>{p}</div>)}</div>
    </div>
  );
}

function UsageSection({ record }) {
  const u = record.usage;
  if (!u) return null;
  return (
    <div className="insp-section">
      <div className="insp-section-label">Token 用量</div>
      <div className="insp-timing">
        {typeof u.input === "number" && <div>in: {u.input}</div>}
        {typeof u.output === "number" && <div>out: {u.output}</div>}
      </div>
    </div>
  );
}

function SubexecLink({ record }) {
  const navigate = useNavigate();
  const executionId = record?.output?.executionId;
  if (!executionId) return null;
  if (record.name !== "task run" && record.name !== "task_run") return null;
  return (
    <div className="insp-section">
      <div className="insp-section-label">子执行</div>
      <button
        type="button"
        className="traj-subexec-link"
        data-testid="subexec-link"
        onClick={() => navigate(`/executions/${executionId}`)}
      >
        {executionId}
      </button>
    </div>
  );
}

export default function Inspector({ record, onClose }) {
  if (!record) return null;

  return (
    <aside className="traj-inspector" data-testid="inspector-panel">
      <div className="insp-header">
        <span className="insp-title">{record.name ?? record.type}</span>
        <button type="button" className="insp-close" onClick={onClose} aria-label="关闭">×</button>
      </div>
      <div className="insp-body">
        <JsonBlock label="输入" value={record.input} truncated={record.inputTruncated} />
        <JsonBlock label="输出" value={record.output} truncated={record.outputTruncated} />
        <TimingSection record={record} />
        <UsageSection record={record} />
        <SubexecLink record={record} />
      </div>
    </aside>
  );
}
