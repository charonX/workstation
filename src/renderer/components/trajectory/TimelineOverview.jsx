// src/renderer/components/trajectory/TimelineOverview.jsx
// 轨迹 Timeline 条带概览（REQ-AGENT-132 / PRD §4 稳定块 6）。
// 按时长投影所有记录，assistant_span 拆分 TTFT/decode 两段。
// data-testid: timeline-overview
// 分段 data-timeline-segment: ttft / decode / tool / other
// 支持长空闲间隔智能折叠压缩（Gap Compression）、滚轮缩放时间域、拖拽区间过滤（brush）、hover 500ms 钟表时间提示、右键清除/平移。

import { useState, useRef, useMemo, useCallback } from "react";
import { calculateTimelineSegments } from "./trajectoryModel.js";

const MIN_SEGMENT_WIDTH_PX = 4; // 最小段宽（避免完全不可见）
const MAX_IDLE_GAP_MS = 20 * 1000; // 超过 20 秒的空闲视为长间隔进行折叠
const COMPRESSED_GAP_MS = 10 * 1000; // 长间隔在视觉上折叠压缩为 10 秒虚拟时长

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

function formatGapDuration(ms) {
  if (ms < 60000) return `${Math.round(ms / 1000)}秒`;
  const mins = Math.floor(ms / 60000);
  const secs = Math.round((ms % 60000) / 1000);
  if (mins < 60) return `${mins}分${secs > 0 ? `${secs}秒` : ""}`;
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  return `${hours}小时${remMins > 0 ? `${remMins}分` : ""}`;
}

/**
 * 将记录列表转换为时间轴段，并对长空闲进行智能折叠映射。
 */
function buildTimelineProjection(records) {
  if (!records || records.length === 0) {
    return {
      segments: [],
      gaps: [],
      tmin: 0,
      tmax: 0,
      totalVirtualMs: 0,
      mapVirtualToRealMs: (v) => v,
      mapRealToVirtualMs: (r) => r,
    };
  }

  // 1. 提取所有原始段
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

  if (raw.length === 0) {
    return {
      segments: [],
      gaps: [],
      tmin: 0,
      tmax: 0,
      totalVirtualMs: 0,
      mapVirtualToRealMs: (v) => v,
      mapRealToVirtualMs: (r) => r,
    };
  }

  // 按 startMs 升序排列
  raw.sort((a, b) => a.startMs - b.startMs);

  const tmin = raw[0].startMs;
  const tmax = Math.max(...raw.map((s) => s.startMs + (s.durationMs ?? 0)));

  // 2. 找出所有活跃区间（合并重叠或极小间隔段）
  const activeSpans = [];
  for (const s of raw) {
    const start = s.startMs;
    const end = s.startMs + Math.max(1, s.durationMs || 1);
    if (activeSpans.length === 0) {
      activeSpans.push({ start, end });
    } else {
      const last = activeSpans[activeSpans.length - 1];
      if (start <= last.end + 1000) {
        last.end = Math.max(last.end, end);
      } else {
        activeSpans.push({ start, end });
      }
    }
  }

  // 3. 构建区间映射表：[realStart, realEnd] -> [virtualStart, virtualEnd]
  const intervals = [];
  const gaps = [];
  let currentVirtual = 0;

  for (let i = 0; i < activeSpans.length; i++) {
    const span = activeSpans[i];
    if (i > 0) {
      const prevSpan = activeSpans[i - 1];
      const gapMs = span.start - prevSpan.end;
      if (gapMs > MAX_IDLE_GAP_MS) {
        // 长空闲压缩折叠
        const vStart = currentVirtual;
        const vEnd = currentVirtual + COMPRESSED_GAP_MS;
        intervals.push({
          realStart: prevSpan.end,
          realEnd: span.start,
          virtualStart: vStart,
          virtualEnd: vEnd,
          isGap: true,
          realDurationMs: gapMs,
        });
        gaps.push({
          realStartMs: prevSpan.end,
          realEndMs: span.start,
          realDurationMs: gapMs,
          virtualStartMs: vStart,
          virtualDurationMs: COMPRESSED_GAP_MS,
        });
        currentVirtual = vEnd;
      } else if (gapMs > 0) {
        // 短间隔，按真实时间比例线性映射
        const vStart = currentVirtual;
        const vEnd = currentVirtual + gapMs;
        intervals.push({
          realStart: prevSpan.end,
          realEnd: span.start,
          virtualStart: vStart,
          virtualEnd: vEnd,
          isGap: false,
          realDurationMs: gapMs,
        });
        currentVirtual = vEnd;
      }
    }

    const spanDur = span.end - span.start;
    const vStart = currentVirtual;
    const vEnd = currentVirtual + spanDur;
    intervals.push({
      realStart: span.start,
      realEnd: span.end,
      virtualStart: vStart,
      virtualEnd: vEnd,
      isGap: false,
      realDurationMs: spanDur,
    });
    currentVirtual = vEnd;
  }

  const totalVirtualMs = Math.max(1, currentVirtual);

  // 真实时间 -> 虚拟投影时间
  function mapRealToVirtualMs(realMs) {
    if (realMs <= tmin) return 0;
    if (realMs >= tmax) return totalVirtualMs;
    for (const iv of intervals) {
      if (realMs >= iv.realStart && realMs <= iv.realEnd) {
        const ratio = iv.realEnd > iv.realStart ? (realMs - iv.realStart) / (iv.realEnd - iv.realStart) : 0;
        return iv.virtualStart + ratio * (iv.virtualEnd - iv.virtualStart);
      }
    }
    return totalVirtualMs;
  }

  // 虚拟投影时间 -> 真实时间
  function mapVirtualToRealMs(vMs) {
    if (vMs <= 0) return tmin;
    if (vMs >= totalVirtualMs) return tmax;
    for (const iv of intervals) {
      if (vMs >= iv.virtualStart && vMs <= iv.virtualEnd) {
        const ratio = iv.virtualEnd > iv.virtualStart ? (vMs - iv.virtualStart) / (iv.virtualEnd - iv.virtualStart) : 0;
        return iv.realStart + ratio * (iv.realEnd - iv.realStart);
      }
    }
    return tmax;
  }

  // 4. 为每个 segment 赋予虚拟坐标
  const projectedSegments = raw.map((s) => {
    const vStart = mapRealToVirtualMs(s.startMs);
    const vEnd = mapRealToVirtualMs(s.startMs + (s.durationMs || 1));
    const vDur = Math.max(0.1, vEnd - vStart);
    return {
      ...s,
      virtualStartMs: vStart,
      virtualDurationMs: vDur,
    };
  });

  return {
    segments: projectedSegments,
    gaps,
    tmin,
    tmax,
    totalVirtualMs,
    mapRealToVirtualMs,
    mapVirtualToRealMs,
  };
}

export default function TimelineOverview({ records, brushRange, onBrushChange }) {
  const containerRef = useRef(null);
  const [zoom, setZoom] = useState(1);
  const [panFrac, setPanFrac] = useState(0);
  const [dragState, setDragState] = useState(null); // { startX, currentX }
  const [hoverInfo, setHoverInfo] = useState(null);
  const hoverTimerRef = useRef(null);

  const {
    segments,
    gaps,
    tmin,
    tmax,
    totalVirtualMs,
    mapVirtualToRealMs,
  } = useMemo(() => buildTimelineProjection(records), [records]);

  // 时间域换算（基于虚拟压缩时间）
  const fracOfVirtual = useCallback(
    (vMs) => (totalVirtualMs > 0 ? vMs / totalVirtualMs : 0),
    [totalVirtualMs]
  );
  const viewFrac = useCallback((f) => (f - panFrac) * zoom, [panFrac, zoom]);
  const calcLeftPct = useCallback((vMs) => viewFrac(fracOfVirtual(vMs)) * 100, [viewFrac, fracOfVirtual]);
  const calcWidthPct = useCallback(
    (vStartMs, vDurMs) => {
      const w = (viewFrac(fracOfVirtual(vStartMs + vDurMs)) - viewFrac(fracOfVirtual(vStartMs))) * 100;
      return Math.max(0.4, w);
    },
    [viewFrac, fracOfVirtual]
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
    const vStartMs = startTimeFrac * totalVirtualMs;
    const vEndMs = endTimeFrac * totalVirtualMs;

    const startMs = mapVirtualToRealMs(vStartMs);
    const endMs = mapVirtualToRealMs(vEndMs);

    if (onBrushChange) {
      onBrushChange({ startMs, endMs });
    }
  }, [dragState, panFrac, zoom, totalVirtualMs, mapVirtualToRealMs, onBrushChange]);

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

  const handleGapMouseEnter = useCallback((gap, leftPct) => {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = setTimeout(() => {
      setHoverInfo({
        label: `空闲（已折叠）`,
        gapText: `空闲 ${formatGapDuration(gap.realDurationMs)}`,
        startMs: gap.realStartMs,
        durationMs: gap.realDurationMs,
        leftPct,
      });
    }, 300);
  }, []);

  const handleMouseLeave = useCallback(() => {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    setHoverInfo(null);
  }, []);

  if (segments.length === 0 || totalVirtualMs === 0) return null;

  // 拖拽中的视觉选区
  let dragBoxLeftPct = 0;
  let dragBoxWidthPct = 0;
  if (dragState && dragState.width > 0) {
    const a = Math.min(dragState.startX, dragState.currentX);
    const b = Math.max(dragState.startX, dragState.currentX);
    dragBoxLeftPct = (a / dragState.width) * 100;
    dragBoxWidthPct = ((b - a) / dragState.width) * 100;
  }

  // 当前可视范围的起止时钟时间
  const visibleRealStart = mapVirtualToRealMs(panFrac * totalVirtualMs);
  const visibleRealEnd = mapVirtualToRealMs((panFrac + 1 / zoom) * totalVirtualMs);

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
          时间线总览：{formatClockTime(visibleRealStart || tmin)} – {formatClockTime(visibleRealEnd || tmax)}
          {gaps.length > 0 && (
            <span style={{ marginLeft: 8, opacity: 0.7 }}>
              （已智能折叠 {gaps.length} 处长空闲）
            </span>
          )}
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
          {/* 长空闲折叠标记渲染 */}
          {gaps.map((gap, i) => {
            const leftPct = calcLeftPct(gap.virtualStartMs);
            const widthPct = calcWidthPct(gap.virtualStartMs, gap.virtualDurationMs);
            if (leftPct + widthPct < 0 || leftPct > 100) return null;

            return (
              <div
                key={`gap_${gap.realStartMs}_${i}`}
                className="tl-gap"
                style={{
                  left: `${leftPct}%`,
                  width: `${widthPct}%`,
                }}
                onMouseEnter={() => handleGapMouseEnter(gap, leftPct + widthPct / 2)}
                onMouseLeave={handleMouseLeave}
              >
                <span className="tl-gap-mark">折叠</span>
              </div>
            );
          })}

          {/* 段渲染 */}
          {segments.map((seg, i) => {
            const leftPct = calcLeftPct(seg.virtualStartMs);
            const widthPct = calcWidthPct(seg.virtualStartMs, seg.virtualDurationMs);
            if (leftPct + widthPct < 0 || leftPct > 100) return null;

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
                onMouseLeave={handleMouseLeave}
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
            {hoverInfo.gapText ? (
              <span>⏳ {hoverInfo.gapText}</span>
            ) : (
              <span>
                {hoverInfo.label} {formatClockTime(hoverInfo.startMs)} ·{" "}
                {hoverInfo.durationMs >= 1000
                  ? `${(hoverInfo.durationMs / 1000).toFixed(2)}s`
                  : `${hoverInfo.durationMs}ms`}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
