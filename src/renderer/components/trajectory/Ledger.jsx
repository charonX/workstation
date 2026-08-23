// src/renderer/components/trajectory/Ledger.jsx
// 轨迹账本行列表（REQ-AGENT-130 / REQ-AGENT-133 / PRD §4 稳定块 4）。
// 虚拟滚动：挂载节点上界 ≤50（VS1 锚点）。行点击 → Inspector（由 TrajectoryView 协调）。
// data-testid: trajectory-ledger
// 行 data-record-type: turn_boundary / user_message / tool_call / assistant_span / compaction
// 行 data-record-seq: <seq>（虚拟滚动断言）

import { useRef, useState, useEffect, useCallback } from "react";

const ROW_HEIGHT = 36; // 估算行高 px
const OVERSCAN = 10;   // 额外挂载行数（上下各）
const MOUNT_MAX = 50;  // VS1 锚点：最多挂载节点数

function formatTs(ts) {
  if (!ts) return "";
  try {
    const d = new Date(ts);
    return d.toLocaleTimeString("zh-CN", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch {
    return "";
  }
}

function formatDurMs(ms) {
  if (typeof ms !== "number") return "";
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${ms}ms`;
}

function rowLabel(r) {
  switch (r.type) {
    case "turn_boundary": return `— Turn ${r.turn ?? ""} —`;
    case "user_message": return `👤 ${String(r.text ?? "").slice(0, 80)}`;
    case "tool_call": return `🔧 ${r.name ?? "tool"}`;
    case "assistant_span": return `🤖 Assistant`;
    case "compaction": return `⊕ Compaction`;
    default: return r.type ?? "record";
  }
}

function rowMeta(r) {
  const parts = [];
  if (r.type === "tool_call") {
    if (r.status) parts.push(r.status);
    if (typeof r.durationMs === "number") parts.push(formatDurMs(r.durationMs));
  }
  if (r.type === "assistant_span") {
    if (typeof r.ttftMs === "number") parts.push(`TTFT ${r.ttftMs}ms`);
    if (typeof r.decodeMs === "number") parts.push(`decode ${r.decodeMs}ms`);
  }
  return parts.join(" · ");
}

function LedgerRow({ record, selected, onClick }) {
  const isTurn = record.type === "turn_boundary";
  return (
    <div
      className={`traj-row traj-row-${record.type}${isTurn ? " traj-turn-boundary" : ""}${selected ? " traj-row-selected" : ""}`}
      style={{ height: ROW_HEIGHT, display: "flex", alignItems: "center", cursor: isTurn ? "default" : "pointer" }}
      data-record-type={record.type}
      data-record-seq={record.seq}
      onClick={isTurn ? undefined : onClick}
    >
      <span className="traj-row-ts" style={{ width: 64, flex: "none", fontSize: "var(--ch-text-xs)", color: "var(--ch-text-tertiary)", paddingLeft: 8 }}>
        {formatTs(record.ts)}
      </span>
      <span className="traj-row-label" style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: "var(--ch-text-sm)", paddingLeft: 8 }}>
        {rowLabel(record)}
      </span>
      <span className="traj-row-meta" style={{ flex: "none", fontSize: "var(--ch-text-xs)", color: "var(--ch-text-tertiary)", paddingRight: 12 }}>
        {rowMeta(record)}
      </span>
    </div>
  );
}

export default function Ledger({ records, selectedSeq, onSelectRecord }) {
  const containerRef = useRef(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(400);

  // 更新容器高度
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setContainerHeight(el.clientHeight || 400);
    });
    ro.observe(el);
    setContainerHeight(el.clientHeight || 400);
    return () => ro.disconnect();
  }, []);

  const handleScroll = useCallback((e) => {
    setScrollTop(e.target.scrollTop);
  }, []);

  const totalHeight = records.length * ROW_HEIGHT;

  // 虚拟滚动窗口计算（VS1：挂载上界 MOUNT_MAX）
  const startIdx = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const visibleCount = Math.ceil(containerHeight / ROW_HEIGHT) + OVERSCAN * 2;
  const endIdx = Math.min(records.length, startIdx + Math.min(visibleCount, MOUNT_MAX));

  const visibleRecords = records.slice(startIdx, endIdx);
  const paddingTop = startIdx * ROW_HEIGHT;
  const paddingBottom = Math.max(0, (records.length - endIdx) * ROW_HEIGHT);

  return (
    <div
      ref={containerRef}
      className="traj-ledger-scroll"
      data-testid="trajectory-ledger"
      style={{ flex: 1, overflow: "auto", minHeight: 0 }}
      onScroll={handleScroll}
    >
      <div style={{ height: totalHeight, position: "relative" }}>
        <div style={{ paddingTop, paddingBottom }}>
          {visibleRecords.map((r) => (
            <LedgerRow
              key={r.key ?? `traj_${r.seq}`}
              record={r}
              selected={r.seq === selectedSeq}
              onClick={() => onSelectRecord?.(r)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
