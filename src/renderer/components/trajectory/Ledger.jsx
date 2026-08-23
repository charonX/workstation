// src/renderer/components/trajectory/Ledger.jsx
// 轨迹账本行列表（REQ-AGENT-130 / REQ-AGENT-133 / PRD §4 稳定块 4/7）。
// 虚拟滚动：挂载节点上界 ≤50（VS1 锚点）。行点击 → Inspector（由 TrajectoryView 协调）。
// 滚动跟随：初始定位于尾部，上滑暂停跟随，回底恢复；暂停时显示 follow-banner。
// 顶触加载：支持顶部加载更早一页（VS2）。
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

export default function Ledger({
  records,
  selectedSeq,
  onSelectRecord,
  hasMore = false,
  onLoadOlder,
  loadingOlder = false,
}) {
  const containerRef = useRef(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(400);
  const [followTail, setFollowTail] = useState(true);
  const initialScrollDoneRef = useRef(false);

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

  // 初始加载或新行到达时跟随到底部
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    if (!initialScrollDoneRef.current || followTail) {
      el.scrollTop = el.scrollHeight;
      initialScrollDoneRef.current = true;
    }
  }, [records.length, followTail]);

  const handleScroll = useCallback((e) => {
    const el = e.target;
    setScrollTop(el.scrollTop);
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    if (nearBottom) {
      setFollowTail(true);
    } else {
      setFollowTail(false);
    }
  }, []);

  const scrollToBottom = useCallback(() => {
    const el = containerRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
      setFollowTail(true);
    }
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
    <div style={{ flex: 1, position: "relative", display: "flex", flexDirection: "column", minHeight: 0 }}>
      {/* 顶部加载更早一页按钮 */}
      {hasMore && (
        <div style={{ padding: "4px 8px", textAlign: "center", background: "var(--ch-surface, #0f172a)", borderBottom: "1px solid var(--ch-border, #334155)" }}>
          <button
            type="button"
            data-testid="load-older-btn"
            disabled={loadingOlder}
            onClick={onLoadOlder}
            style={{
              fontSize: "11px",
              padding: "2px 12px",
              borderRadius: 12,
              border: "1px solid var(--ch-border, #475569)",
              background: "var(--ch-surface-high, #1e293b)",
              color: "var(--ch-text-secondary, #cbd5e1)",
              cursor: loadingOlder ? "wait" : "pointer",
            }}
          >
            {loadingOlder ? "加载中…" : "加载更早一页 ↑"}
          </button>
        </div>
      )}

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

      {/* 跟随暂停提示条 */}
      {!followTail && (
        <div
          data-testid="follow-banner"
          onClick={scrollToBottom}
          style={{
            position: "absolute",
            bottom: 12,
            left: "50%",
            transform: "translateX(-50%)",
            background: "var(--ch-surface-highest, #334155)",
            border: "1px solid var(--ch-border-strong, #64748b)",
            borderRadius: 16,
            padding: "4px 14px",
            fontSize: "11px",
            color: "var(--ch-accent, #38bdf8)",
            boxShadow: "0 2px 8px rgba(0,0,0,0.4)",
            cursor: "pointer",
            zIndex: 10,
            userSelect: "none",
          }}
        >
          跟随已暂停 — 点击回到最新 ↓
        </div>
      )}
    </div>
  );
}
