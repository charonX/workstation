// src/renderer/components/trajectory/Ledger.jsx
// 轨迹账本行列表（REQ-AGENT-130 / REQ-AGENT-133 / PRD §4 稳定块 4/7）。
// 虚拟滚动：挂载节点上界 ≤50（VS1 锚点）。行点击 → Inspector（由 TrajectoryView 协调）。
// 滚动跟随：初始定位于尾部，上滑暂停跟随，回底恢复；暂停时显示 follow-banner。
// 顶触加载：支持顶部加载更早一页（VS2）。
// data-testid: trajectory-ledger
// 行 data-record-type: turn_boundary / user_message / tool_call / assistant_span / compaction
// 行 data-record-seq: <seq>（虚拟滚动断言）

import { useRef, useState, useEffect, useCallback } from "react";

const ROW_HEIGHT = 28; // 行高 px（与 ux/trajectory.html 一致）
const OVERSCAN = 10;   // 额外挂载行数（上下各）
const MOUNT_MAX = 50;  // VS1 锚点：最多挂载节点数

function formatDurMs(ms) {
  if (typeof ms !== "number") return "";
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${ms}ms`;
}

function LedgerRow({ record, selected, onClick, onToggleTurn }) {
  if (record.type === "turn_boundary") {
    const isCollapsed = Boolean(record.isCollapsed);
    return (
      <div
        className={`turn-rule${isCollapsed ? " collapsed" : " expanded"}`}
        data-record-type="turn_boundary"
        data-record-seq={record.seq}
        data-turn-number={record.turn}
        style={{ height: ROW_HEIGHT }}
        onClick={() => onToggleTurn?.(record.turn)}
        title={isCollapsed ? "点击展开该回合" : "点击收起该回合"}
      >
        <span className="turn-label">
          <span className="turn-chevron">{isCollapsed ? "▶" : "▼"}</span>
          <span>Turn {record.turn ?? ""}</span>
          {record.subRecordCount > 0 && isCollapsed && (
            <span className="turn-summary-pill">
              （已收起 {record.subRecordCount} 条记录{record.toolCount > 0 ? ` · ${record.toolCount}个工具` : ""}）
            </span>
          )}
        </span>
      </div>
    );
  }

  const isSelected = selected;
  const isError = Boolean(record.isError || record.status === "error");
  const isRunning = record.status === "running";
  const isInterrupted = record.status === "interrupted";

  let evClass = "ev";
  let evText = record.type ?? "RECORD";
  let contentNode = null;

  if (record.type === "user_message") {
    evClass = "ev user";
    evText = "USER";
    contentNode = (
      <>
        <span>{String(record.text ?? "")}</span>
      </>
    );
  } else if (record.type === "assistant_span") {
    evClass = "ev assistant";
    evText = "ASSISTANT";
    const preview = record.textPreview ? String(record.textPreview).slice(0, 70) : "Assistant 响应";
    const metaParts = [];
    if (typeof record.ttftMs === "number") metaParts.push(`TTFT ${record.ttftMs}ms`);
    if (typeof record.decodeMs === "number") metaParts.push(`decode ${record.decodeMs}ms`);
    contentNode = (
      <>
        <span>{preview}</span>
        {metaParts.length > 0 && <span className="tmeta">{metaParts.join(" · ")}</span>}
      </>
    );
  } else if (record.type === "tool_call") {
    evClass = `ev tool${isError ? " error" : ""}${isRunning ? " running" : ""}`;
    evText = isRunning ? "TOOL…" : "TOOL";
    const inputStr = record.input ? (typeof record.input === "string" ? record.input : JSON.stringify(record.input)) : "";
    const metaParts = [];
    if (record.status && record.status !== "completed") metaParts.push(record.status);
    if (typeof record.durationMs === "number") metaParts.push(formatDurMs(record.durationMs));

    contentNode = (
      <>
        <span className="tname">{record.name ?? "tool"}</span>
        {inputStr && <span style={{ opacity: 0.75 }}>{inputStr.slice(0, 60)}</span>}
        {isInterrupted && <span className="running-mark">（已中断）</span>}
        {metaParts.length > 0 && <span className="tmeta">{metaParts.join(" · ")}</span>}
      </>
    );
  } else if (record.type === "compaction") {
    evClass = "ev compaction";
    evText = "COMPACT";
    contentNode = (
      <>
        <span>{record.reason ?? "上下文压缩"}</span>
      </>
    );
  }

  let rowClass = "lrow";
  if (isSelected) rowClass += " selected";
  if (isError) rowClass += " error-row";
  if (isInterrupted) rowClass += " interrupted-row";

  return (
    <div
      className={rowClass}
      style={{ height: ROW_HEIGHT }}
      data-record-type={record.type}
      data-record-seq={record.seq}
      onClick={onClick}
    >
      <span className="idx">{String(record.seq ?? "").padStart(3, " ")}</span>
      <span className={evClass}>{evText}</span>
      <span className="content">{contentNode}</span>
    </div>
  );
}

export default function Ledger({
  records,
  selectedSeq,
  onSelectRecord,
  onToggleTurn,
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
    <div className="ledger-area">
      {/* 顶部加载更早一页按钮 */}
      {hasMore && (
        <div className="load-older-wrap">
          <button
            type="button"
            className={`load-older${loadingOlder ? " loading" : ""}`}
            data-testid="load-older-btn"
            disabled={loadingOlder}
            onClick={onLoadOlder}
          >
            {loadingOlder ? "加载中…" : "加载更早一页 ↑"}
          </button>
        </div>
      )}

      <div
        ref={containerRef}
        className="ledger-scroll"
        data-testid="trajectory-ledger"
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
                onToggleTurn={onToggleTurn}
              />
            ))}
          </div>
        </div>
      </div>

      {/* 跟随暂停提示条 */}
      {!followTail && (
        <div
          className="follow-banner"
          data-testid="follow-banner"
          onClick={scrollToBottom}
        >
          跟随已暂停 — 点击回到最新 ↓
        </div>
      )}
    </div>
  );
}
