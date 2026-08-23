// src/renderer/components/trajectory/TrajectoryView.jsx
// 轨迹视图总入口（REQ-AGENT-129 / PRD §4 稳定块 3）。
// 三区一体：Timeline 条带 / Ledger 账本 / Inspector 检查器。
// data-testid: trajectory-view
// 空态 data-testid: traj-empty-state（无记录时展示）
//
// 数据来源：
//   1. 初始化：GET /api/agent/sessions/:spaceKey/trajectory（历史快照）
//   2. 历史翻页：GET /api/agent/sessions/:spaceKey/trajectory?before=traj_<earliestSeq>（顶部触底加载）
//   3. Live：SSE trajectory-record 事件（通过 liveRecord prop 传入）
// 状态管理：使用 trajectoryModel.js 纯函数 reducer。

import { useState, useEffect, useCallback } from "react";
import {
  createTrajectoryState,
  applyTrajectoryRecord,
  prependTrajectoryRecords,
  filterRecordsByTimeRange,
} from "./trajectoryModel.js";
import Ledger from "./Ledger.jsx";
import TimelineOverview from "./TimelineOverview.jsx";
import Inspector from "./Inspector.jsx";
import { getTrajectoryRecords } from "../../api/agentSessions.js";

export default function TrajectoryView({ spaceKey, liveRecord }) {
  const [state, setState] = useState(() => createTrajectoryState([]));
  const [hasMore, setHasMore] = useState(false);
  const [skippedCount, setSkippedCount] = useState(0);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [selectedRecord, setSelectedRecord] = useState(null);
  const [brushRange, setBrushRange] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // 初始化：加载历史快照
  useEffect(() => {
    if (!spaceKey) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setState(createTrajectoryState([]));
    setSelectedRecord(null);
    setBrushRange(null);
    setHasMore(false);
    setSkippedCount(0);

    getTrajectoryRecords(spaceKey, { limit: 200 })
      .then((result) => {
        if (cancelled) return;
        setState(createTrajectoryState(result.records ?? []));
        setHasMore(Boolean(result.hasMore));
        if (result.meta?.skipped) {
          setSkippedCount(result.meta.skipped);
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err?.message ?? "加载轨迹失败");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [spaceKey]);

  // 顶部加载上一页历史记录（稳定块 7 / VS2）
  const handleLoadOlder = useCallback(() => {
    if (loadingOlder || !hasMore || !spaceKey) return;
    const earliestSeq = state.records[0]?.seq;
    if (earliestSeq === undefined) return;

    setLoadingOlder(true);
    getTrajectoryRecords(spaceKey, { limit: 200, before: `traj_${earliestSeq}` })
      .then((result) => {
        setState((prev) => prependTrajectoryRecords(prev, result.records ?? []));
        setHasMore(Boolean(result.hasMore));
        if (result.meta?.skipped) {
          setSkippedCount((prev) => prev + result.meta.skipped);
        }
      })
      .catch((_err) => {
        // 翻页失败保持当前状态
      })
      .finally(() => {
        setLoadingOlder(false);
      });
  }, [loadingOlder, hasMore, spaceKey, state.records]);

  // Live：接收 SSE trajectory-record 事件（由父层 Assistant.jsx 传入）
  useEffect(() => {
    if (!liveRecord) return;
    // 严格按当前会话精确过滤，防止跨会话污染（W8）
    if (liveRecord.sessionKey && spaceKey && liveRecord.sessionKey !== spaceKey) {
      return;
    }
    setState((prev) => applyTrajectoryRecord(prev, liveRecord));
  }, [liveRecord, spaceKey]);

  const handleSelectRecord = useCallback((r) => {
    setSelectedRecord((prev) => (prev?.seq === r.seq ? null : r));
  }, []);

  const handleCloseInspector = useCallback(() => setSelectedRecord(null), []);

  if (loading) {
    return (
      <div className="traj-view" data-testid="trajectory-view" style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <span style={{ color: "var(--ch-text-tertiary)" }}>加载轨迹中…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="traj-view" data-testid="trajectory-view" style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div className="traj-empty" data-testid="traj-empty-state">
          <div>加载失败：{error}</div>
        </div>
      </div>
    );
  }

  if (state.records.length === 0) {
    return (
      <div className="traj-view" data-testid="trajectory-view" style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div className="traj-empty" data-testid="traj-empty-state">
          <div className="traj-empty-title">没有轨迹记录</div>
          <div className="traj-empty-sub">工具调用与 Assistant 响应将在此实时呈现</div>
        </div>
      </div>
    );
  }

  const displayRecords = brushRange
    ? filterRecordsByTimeRange(state.records, brushRange.startMs, brushRange.endMs)
    : state.records;

  return (
    <div className="traj-view" data-testid="trajectory-view" style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, overflow: "hidden" }}>
      {/* 损坏行提示（E-TRAJ-PARTIAL）*/}
      {skippedCount > 0 && (
        <div
          className="traj-partial-note"
          data-testid="partial-note"
          style={{
            padding: "2px 12px",
            fontSize: "11px",
            background: "var(--ch-warning-soft, rgba(245, 158, 11, 0.15))",
            color: "var(--ch-warning, #f59e0b)",
            borderBottom: "1px solid var(--ch-border, #334155)",
          }}
        >
          跳过 {skippedCount} 条损坏记录（E-TRAJ-PARTIAL）
        </div>
      )}

      {/* Timeline 概览条（REQ-AGENT-132）*/}
      <TimelineOverview
        records={state.records}
        brushRange={brushRange}
        onBrushChange={setBrushRange}
      />

      {brushRange && (
        <div
          className="traj-brush-banner"
          data-testid="timeline-brush-banner"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "4px 12px",
            fontSize: "11px",
            background: "var(--ch-surface-high, #1e293b)",
            borderBottom: "1px solid var(--ch-border, #334155)",
            color: "var(--ch-text-secondary)",
          }}
        >
          <span>已过滤时间范围（共 {displayRecords.length} / {state.records.length} 条记录）</span>
          <button
            type="button"
            onClick={() => setBrushRange(null)}
            style={{
              background: "transparent",
              border: "none",
              color: "var(--ch-accent, #3b82f6)",
              cursor: "pointer",
              fontSize: "11px",
            }}
          >
            清除过滤
          </button>
        </div>
      )}

      {/* 主体：Ledger + Inspector */}
      <div style={{ flex: 1, display: "flex", minHeight: 0, overflow: "hidden" }}>
        <Ledger
          records={displayRecords}
          selectedSeq={selectedRecord?.seq}
          onSelectRecord={handleSelectRecord}
          hasMore={hasMore}
          onLoadOlder={handleLoadOlder}
          loadingOlder={loadingOlder}
        />
        {selectedRecord && (
          <Inspector
            record={selectedRecord}
            onClose={handleCloseInspector}
          />
        )}
      </div>
    </div>
  );
}
