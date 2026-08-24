// src/renderer/components/trajectory/TimelineOverview.jsx
// 轨迹 Timeline 条带概览（REQ-AGENT-132 / PRD §4 稳定块 6）。
// 按时长投影所有记录，assistant_span 拆分 TTFT/decode 两段。
// data-testid: timeline-overview
// 分段 data-timeline-segment: ttft / decode / tool / other
// 支持滚轮缩放时间域、拖拽区间过滤（brush）、hover 500ms 钟表时间提示、右键清除/平移。

import { useState, useRef, useMemo, useCallback } from "react";
import { calculateTimelineSegments } from "./trajectoryModel.js";

const MIN_SEGMENT_WIDTH_PX = 4; // 最小段宽（避免完全不可见）

function toMs(ts) {
  try {
    return new Date(ts).getTime();
  } catch {
    return 0;
  }
}

function formatClockTime(ms) {
  if (!ms) return "";
  try {
    return new Date(ms).toLocaleTimeString("zh-CN", { hour12: false });
  } catch {
    return "";
  }
}

/**
 * 将记录列表转换为时间轴段（绝对时间戳 + 持续时间）。
 */
function buildSegments(records) {
  if (!records || records.length === 0) return { segments: [], tmin: 0, tmax: 0, totalMs: 0 };

  const raw = [];
  for (const r of records) {
    const endTsMs = toMs(r.ts);
    if (!endTsMs && !r.startTs) continue;

    if (r.type === "assistant_span") {
      const parts = calculateTimelineSegments(r);
      const spanDur = (r.ttftMs ?? 0) + (r.decodeMs ?? 0);
      const startMs = r.startTs ? toMs(r.startTs) : Math.max(0, endTsMs - spanDur);
      let offset = 0;
      for (const part of parts) {
        raw.push({
          startMs: startMs + offset,
          durationMs: part.durationMs,
          kind: part.type,
          label: `Assistant (${part.type.toUpperCase()})`,
          record: r,
        });
        offset += part.durationMs;
      }
    } else if (r.type === "tool_call" && typeof r.durationMs === "number" && r.durationMs > 0) {
      const startMs = toMs(r.ts);
      raw.push({
        startMs,
        durationMs: r.durationMs,
        kind: "tool",
        label: r.name || "tool",
        isError: r.isError,
        record: r,
      });
    }
  }

  if (raw.length === 0) return { segments: [], tmin: 0, tmax: 0, totalMs: 0 };

  const tmin = Math.min(...raw.map((s) => s.startMs));
  const tmax = Math.max(...raw.map((s) => s.startMs + (s.durationMs ?? 0)));
  const totalMs = Math.max(1, tmax - tmin);

  return { segments: raw, tmin, tmax, totalMs };
}

export default function TimelineOverview({ records, brushRange, onBrushChange }) {
  const containerRef = useRef(null);
  const [zoom, setZoom] = useState(1);
  const [panFrac, setPanFrac] = useState(0);
  const [dragState, setDragState] = useState(null); // { startX, currentX }
  const [hoverInfo, setHoverInfo] = useState(null);
  const hoverTimerRef = useRef(null);

  const { segments, tmin, _tmax, totalMs } = useMemo(() => buildSegments(records), [records]);

  // 时间域换算
  const fracOf = useCallback((ts) => (totalMs > 0 ? (ts - tmin) / totalMs : 0), [tmin, totalMs]);
  const viewFrac = useCallback((f) => (f - panFrac) * zoom, [panFrac, zoom]);
  const calcLeftPct = useCallback((ts) => viewFrac(fracOf(ts)) * 100, [viewFrac, fracOf]);
  const calcWidthPct = useCallback(
    (startMs, durMs) => {
      const w = (viewFrac(fracOf(startMs + durMs)) - viewFrac(fracOf(startMs))) * 100;
      return Math.max(0.4, w);
    },
    [viewFrac, fracOf]
  );

  // 滚轮缩放与平移（以鼠标指针为中心）
  const handleWheel = useCallback(
    (e) => {
      e.preventDefault();
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const at = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const factor = e.deltaY < 0 ? 1.2 : 1 / 1.2;
      const newZoom = Math.max(1, Math.min(30, zoom * factor));
      const newPan = Math.max(0, Math.min(1 - 1 / newZoom, at - at / newZoom));
      setZoom(newZoom);
      setPanFrac(newPan);
    },
    [zoom]
  );

  // 鼠标拖拽选区
  const handleMouseDown = useCallback((e) => {
    if (e.button !== 0) return; // 只响应左键
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = e.clientX - rect.left;
    setDragState({ startX: x, currentX: x, width: rect.width });
  }, []);

  const handleMouseMove = useCallback(
    (e) => {
      if (!dragState || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
      setDragState((prev) => (prev ? { ...prev, currentX: x } : null));
    },
    [dragState]
  );

  const handleMouseUp = useCallback(() => {
    if (!dragState) return;
    const { startX, currentX, width } = dragState;
    setDragState(null);
    if (Math.abs(currentX - startX) < 6) return; // 单击由 segment onClick 承接

    const aFrac = Math.min(startX, currentX) / width;
    const bFrac = Math.max(startX, currentX) / width;
    const startTimeFrac = panFrac + aFrac / zoom;
    const endTimeFrac = panFrac + bFrac / zoom;
    const startMs = tmin + startTimeFrac * totalMs;
    const endMs = tmin + endTimeFrac * totalMs;

    if (onBrushChange) {
      onBrushChange({ startMs, endMs });
    }
  }, [dragState, panFrac, zoom, tmin, totalMs, onBrushChange]);

  // Hover 500ms 延迟提示
  const handleSegmentMouseEnter = useCallback((seg, leftPct) => {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = setTimeout(() => {
      setHoverInfo({
        label: seg.label,
        startMs: seg.startMs,
        durationMs: seg.durationMs,
        leftPct,
      });
    }, 500);
  }, []);

  const handleSegmentMouseLeave = useCallback(() => {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    setHoverInfo(null);
  }, []);

  if (segments.length === 0 || totalMs === 0) return null;

  // 拖拽中的视觉选区
  let dragBoxLeftPct = 0;
  let dragBoxWidthPct = 0;
  if (dragState && dragState.width > 0) {
    const a = Math.min(dragState.startX, dragState.currentX);
    const b = Math.max(dragState.startX, dragState.currentX);
    dragBoxLeftPct = (a / dragState.width) * 100;
    dragBoxWidthPct = ((b - a) / dragState.width) * 100;
  }

  return (
    <div
      className="timeline-wrap"
      data-testid="timeline-overview"
      onContextMenu={(e) => {
        e.preventDefault();
        if (onBrushChange) onBrushChange(null);
      }}
    >
      <div className="timeline-label">
        <span>
          时间线总览：{formatClockTime(tmin + panFrac * totalMs)} – {formatClockTime(tmin + (panFrac + 1 / zoom) * totalMs)}
        </span>
        <span className="zoom-hint">滚轮缩放 · 拖拽区间过滤 · 右键清除/平移</span>
      </div>

      <div
        ref={containerRef}
        className="timeline-canvas"
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
      >
        <div className="tl-track">
          {/* 段渲染 */}
          {segments.map((seg, i) => {
            const leftPct = calcLeftPct(seg.startMs);
            const widthPct = calcWidthPct(seg.startMs, seg.durationMs);
            const isSelected =
              brushRange &&
              seg.startMs >= brushRange.startMs &&
              seg.startMs + seg.durationMs <= brushRange.endMs;
            const segClass = `tl-seg ${seg.kind}${seg.isError ? " err" : ""}`;

            return (
              <div
                key={`${seg.record?.seq ?? i}-${seg.kind}-${seg.startMs}`}
                className={segClass}
                data-timeline-segment={seg.kind}
                onClick={(e) => {
                  e.stopPropagation();
                  if (onBrushChange) {
                    onBrushChange({
                      startMs: seg.startMs,
                      endMs: seg.startMs + (seg.durationMs || 1),
                    });
                  }
                }}
                onMouseEnter={() => handleSegmentMouseEnter(seg, leftPct)}
                onMouseLeave={handleSegmentMouseLeave}
                style={{
                  left: `${leftPct}%`,
                  width: `${widthPct}%`,
                  minWidth: MIN_SEGMENT_WIDTH_PX,
                  outline: isSelected ? "2px solid var(--ch-accent)" : "none",
                }}
              />
            );
          })}
        </div>

        {/* 拖拽选区指示框 */}
        {dragState && dragBoxWidthPct > 0 && (
          <div
            className="tl-brush"
            data-testid="timeline-brush"
            style={{
              left: `${dragBoxLeftPct}%`,
              width: `${dragBoxWidthPct}%`,
              display: "block",
            }}
          />
        )}

        {/* 500ms Hover 提示浮层 */}
        {hoverInfo && (
          <div
            className="tl-tip"
            data-testid="timeline-tooltip"
            style={{
              left: `${Math.min(80, Math.max(5, hoverInfo.leftPct))}%`,
              top: 4,
              display: "block",
            }}
          >
            {hoverInfo.label} {formatClockTime(hoverInfo.startMs)} ·{" "}
            {hoverInfo.durationMs >= 1000
              ? `${(hoverInfo.durationMs / 1000).toFixed(2)}s`
              : `${hoverInfo.durationMs}ms`}
          </div>
        )}
      </div>
    </div>
  );
}
