// src/renderer/components/trajectory/Inspector.jsx
// 轨迹账本行详情检查器（REQ-AGENT-131 / PRD §4 稳定块 5）。
// 展示选中记录的 Input / Output / Timing / Usage 节；超限截断徽章。
// data-testid：inspector-panel
// 子执行跳转（REQ-AGENT-135）：name="task run" 且 output.executionId 有效时渲染 data-testid="subexec-link"。

import { useNavigate } from "react-router-dom";

function formatTs(ts) {
  if (!ts) return "—";
  try {
    const d = new Date(ts);
    return d.toLocaleTimeString("zh-CN", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch {
    return String(ts);
  }
}

function formatDurMs(ms) {
  if (typeof ms !== "number") return "—";
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)}s`;
  return `${ms}ms`;
}

export default function Inspector({ record, onClose }) {
  const navigate = useNavigate();
  if (!record) return null;

  const executionId = record?.output?.executionId;
  const isTaskRun = (record.name === "task run" || record.name === "task_run" || Boolean(executionId));
  const isTruncated = Boolean(record.truncated || record.inputTruncated || record.outputTruncated);

  const u = record.usage;
  const hasTiming = typeof record.durationMs === "number" || typeof record.ttftMs === "number" || typeof record.decodeMs === "number" || Boolean(record.ts);
  const hasUsage = Boolean(u && (typeof u.input === "number" || typeof u.output === "number" || typeof u.cacheRead === "number"));

  const inputJson = record.input !== undefined ? (typeof record.input === "string" ? record.input : JSON.stringify(record.input, null, 2)) : null;
  const outputJson = record.output !== undefined ? (typeof record.output === "string" ? record.output : JSON.stringify(record.output, null, 2)) : (record.errorMessage ? `Error: ${record.errorMessage}` : null);

  return (
    <aside className="inspector" data-testid="inspector-panel">
      <div className="inspector-head">
        <span className="insp-title">{record.type === "tool_call" ? `tool_call · ${record.name ?? "tool"}` : (record.type === "assistant_span" ? "assistant_span" : (record.type ?? "record"))}</span>
        <button type="button" className="close" onClick={onClose} aria-label="收起">收起 ✕</button>
      </div>
      <div className="inspector-body">
        <div className="insp-main">
          {inputJson !== null && (
            <div className="insp-section">
              <div className="insp-label">输入 Input</div>
              <pre className="insp-content">{inputJson}</pre>
            </div>
          )}
          {outputJson !== null && (
            <div className="insp-section">
              <div className="insp-label">
                输出 Output
                {isTruncated && (
                  <span className="truncated-badge" data-testid="truncated-badge">已截断 truncated</span>
                )}
              </div>
              <pre className="insp-content">{outputJson}</pre>
            </div>
          )}
          {isTaskRun && executionId && (
            <div className="insp-section">
              <button
                type="button"
                className="subexec-link"
                data-testid="subexec-link"
                onClick={() => navigate(`/executions?highlight=${executionId}`)}
              >
                ↗ 打开子执行详情 {executionId}
              </button>
            </div>
          )}
        </div>

        <div className="insp-side">
          {hasTiming && (
            <div className="insp-section">
              <div className="insp-label">Timing 耗时</div>
              {record.ts && (
                <div className="kv"><span className="k">开始</span><span className="v">{formatTs(record.ts)}</span></div>
              )}
              {typeof record.durationMs === "number" && (
                <div className="kv"><span className="k">耗时</span><span className="v">{formatDurMs(record.durationMs)}</span></div>
              )}
              {typeof record.ttftMs === "number" && (
                <div className="kv"><span className="k">TTFT 首字</span><span className="v">{record.ttftMs}ms</span></div>
              )}
              {typeof record.decodeMs === "number" && (
                <div className="kv"><span className="k">解码时长</span><span className="v">{record.decodeMs}ms</span></div>
              )}
            </div>
          )}

          {hasUsage && (
            <div className="insp-section">
              <div className="insp-label">Tokens 用量</div>
              {typeof u.input === "number" && (
                <div className="kv"><span className="k">input</span><span className="v">{u.input}</span></div>
              )}
              {typeof u.output === "number" && (
                <div className="kv"><span className="k">output</span><span className="v">{u.output}</span></div>
              )}
              {typeof u.cacheRead === "number" && (
                <div className="kv"><span className="k">cacheRead</span><span className="v">{u.cacheRead}</span></div>
              )}
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
