// src/renderer/components/trajectory/TimelineOverview.jsx
// 轨迹 Timeline 条带概览（REQ-AGENT-132 / PRD §4 稳定块 6）。
// 按时长投影所有记录，assistant_span 拆分 TTFT/decode 两段。
// data-testid: timeline-overview
// 分段 data-timeline-segment: ttft / decode / tool / other
// 选区（brush）过滤账本行由父层处理。

import { useMemo } from "react";
import { calculateTimelineSegments } from "./trajectoryModel.js";

const MIN_SEGMENT_WIDTH_PX = 4; // 最小段宽（避免完全不可见）
const OVERVIEW_HEIGHT = 32; // 条带高度 px

function toMs(ts) {
  try {
    return new Date(ts).getTime();
  } catch {
    return 0;
  }
}

/**
 * 将记录列表转换为时间轴段（绝对时间戳 + 持续时间）。
 * 按 startMs 排序，计算全局 totalDuration，然后按比例计算 widthPct。
 */
function buildSegments(records) {
  if (!records || records.length === 0) return { segments: [], totalMs: 0 };

  const raw = [];
  for (const r of records) {
    const startMs = toMs(r.ts);
    if (!startMs) continue;

    if (r.type === "assistant_span") {
      const parts = calculateTimelineSegments(r);
      let offset = 0;
      for (const part of parts) {
        raw.push({ startMs: startMs + offset, durationMs: part.durationMs, kind: part.type, record: r });
        offset += part.durationMs;
      }
    } else if (r.type === "tool_call" && typeof r.durationMs === "number" && r.durationMs > 0) {
      raw.push({ startMs, durationMs: r.durationMs, kind: "tool", record: r });
    }
    // turn_boundary / user_message 等无时长记录不投影
  }

  if (raw.length === 0) return { segments: [], totalMs: 0 };

  const globalStart = Math.min(...raw.map((s) => s.startMs));
  const globalEnd = Math.max(...raw.map((s) => s.startMs + (s.durationMs ?? 0)));
  const totalMs = globalEnd - globalStart || 1;

  const segments = raw.map((s) => ({
    ...s,
    offsetPct: ((s.startMs - globalStart) / totalMs) * 100,
    widthPct: Math.max((s.durationMs / totalMs) * 100, (MIN_SEGMENT_WIDTH_PX / 320) * 100),
  }));

  return { segments, totalMs };
}

const KIND_COLORS = {
  ttft: "var(--ch-accent-soft, #2563eb33)",
  decode: "var(--ch-accent, #2563eb)",
  tool: "var(--ch-warning-soft, #92400e33)",
};

export default function TimelineOverview({ records, onBrushChange }) {
  const { segments, totalMs } = useMemo(() => buildSegments(records), [records]);

  if (segments.length === 0 || totalMs === 0) return null;

  return (
    <div className="traj-timeline-wrap" data-testid="timeline-overview">
      <div
        className="traj-timeline-bar"
        style={{ position: "relative", height: OVERVIEW_HEIGHT, background: "var(--ch-surface-high, #1e293b)", borderRadius: 4 }}
      >
        {segments.map((seg, i) => (
          <div
            key={`${seg.record?.seq ?? i}-${seg.kind}`}
            data-timeline-segment={seg.kind}
            title={`${seg.kind}: ${seg.durationMs}ms`}
            style={{
              position: "absolute",
              left: `${seg.offsetPct}%`,
              width: `${seg.widthPct}%`,
              top: 4,
              bottom: 4,
              background: KIND_COLORS[seg.kind] ?? "var(--ch-border, #334155)",
              borderRadius: 2,
              minWidth: MIN_SEGMENT_WIDTH_PX,
            }}
          />
        ))}
      </div>
      {totalMs > 0 && (
        <div className="traj-timeline-meta" style={{ fontSize: "var(--ch-text-xs, 11px)", color: "var(--ch-text-tertiary)" }}>
          总耗时 {totalMs >= 1000 ? `${(totalMs / 1000).toFixed(1)}s` : `${totalMs}ms`}
        </div>
      )}
    </div>
  );
}
