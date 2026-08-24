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

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  createTrajectoryState,
  applyTrajectoryRecord,
  prependTrajectoryRecords,
  filterRecordsByTimeRange,
  filterVisibleLedgerRecords,
  extractTurnNumbers,
} from "./trajectoryModel.js";
import Ledger from "./Ledger.jsx";
import TimelineOverview from "./TimelineOverview.jsx";
import Inspector from "./Inspector.jsx";
import { getTrajectoryRecords } from "../../api/agentSessions.js";
import "./trajectory.css";

export default function TrajectoryView({ spaceKey, liveRecord }) {
  const [state, setState] = useState(() => createTrajectoryState([]));
  const [hasMore, setHasMore] = useState(false);
  const [skippedCount, setSkippedCount] = useState(0);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [selectedRecord, setSelectedRecord] = useState(null);
  const [brushRange, setBrushRange] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [collapsedTurns, setCollapsedTurns] = useState(() => new Set());

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
    setCollapsedTurns(new Set());

    getTrajectoryRecords(spaceKey, { limit: 200 })
      .then((result) => {
        if (cancelled) return;
        const newState = createTrajectoryState(result.records ?? []);
        setState(newState);
        setHasMore(Boolean(result.hasMore));
        if (result.meta?.skipped) {
          setSkippedCount(result.meta.skipped);
        }

        // 多回合时，默认收起历史回合，仅展开最新一轮，优化长对话性能与视线聚焦
        const turns = extractTurnNumbers(newState.records);
        if (turns.length > 1) {
          const pastTurns = turns.slice(0, turns.length - 1);
          setCollapsedTurns(new Set(pastTurns));
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
        setState((prev) => {
          const updated = prependTrajectoryRecords(prev, result.records ?? []);
          // 如果新拉取了历史回合，将新拉取出的历史回合默认加入收起集合
          const allTurns = extractTurnNumbers(updated.records);
          if (allTurns.length > 1) {
            setCollapsedTurns((prevSet) => {
              const nextSet = new Set(prevSet);
              for (let i = 0; i < allTurns.length - 1; i++) {
                nextSet.add(allTurns[i]);
              }
              return nextSet;
            });
          }
          return updated;
        });
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

  // 回合折叠切换
  const handleToggleTurn = useCallback((turnNumber) => {
    if (typeof turnNumber !== "number") return;
    setCollapsedTurns((prev) => {
      const next = new Set(prev);
      if (next.has(turnNumber)) {
        next.delete(turnNumber);
      } else {
        next.add(turnNumber);
      }
      return next;
    });
  }, []);

  const allTurnNumbers = useMemo(() => extractTurnNumbers(state.records), [state.records]);

  const handleExpandAll = useCallback(() => {
    setCollapsedTurns(new Set());
  }, []);

  const handleCollapsePast = useCallback(() => {
    if (allTurnNumbers.length <= 1) return;
    const past = allTurnNumbers.slice(0, allTurnNumbers.length - 1);
    setCollapsedTurns(new Set(past));
  }, [allTurnNumbers]);

  if (loading) {
    return (
      <div className="trajectory-view" data-testid="trajectory-view" style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
        <span style={{ color: "var(--ch-text-tertiary)", fontSize: "var(--ch-text-sm)" }}>加载轨迹中…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="trajectory-view" data-testid="trajectory-view">
        <div className="traj-empty-state-card" data-testid="traj-empty-state">
          <div className="empty-card">
            <h3>加载失败</h3>
            <p>{error}</p>
          </div>
        </div>
      </div>
    );
  }

  if (state.records.length === 0) {
    return (
      <div className="trajectory-view" data-testid="trajectory-view">
        <div className="traj-empty-state-card" data-testid="traj-empty-state">
          <div className="empty-card">
            <h3>该会话没有轨迹记录</h3>
            <p>功能启用前的会话不追溯。新会话的工具调用将自动记录在此。</p>
          </div>
        </div>
      </div>
    );
  }

  // 1. 时间范围过滤（Brush 选区）
  const timeFilteredRecords = brushRange
    ? filterRecordsByTimeRange(state.records, brushRange.startMs, brushRange.endMs)
    : state.records;

  // 2. 回合折叠过滤（收起的回合仅保留 turn_boundary 单行，内部记录不进入虚拟滚动，极大减少 DOM 开销）
  const displayRecords = filterVisibleLedgerRecords(timeFilteredRecords, collapsedTurns);

  const hasCollapsedTurns = collapsedTurns.size > 0;

  return (
    <section className="trajectory-view" data-testid="trajectory-view">
      {/* 损坏行提示（E-TRAJ-PARTIAL）*/}
      {skippedCount > 0 && (
        <div
          className="partial-note"
          data-testid="partial-note"
          style={{
            padding: "4px var(--ch-space-5)",
            fontSize: "var(--ch-text-xs)",
            background: "var(--ch-warning-soft)",
            color: "var(--ch-warning)",
            borderBottom: "1px solid var(--ch-border)",
            display: "block",
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

      {/* 选区提示条 */}
      {brushRange && (
        <div
          className="filter-banner"
          data-testid="timeline-brush-banner"
        >
          <span>已过滤时间范围（共 {displayRecords.length} / {state.records.length} 条记录）</span>
          <button
            type="button"
            className="clear-btn"
            onClick={() => setBrushRange(null)}
          >
            清除过滤
          </button>
        </div>
      )}

      {/* 回合折叠管理工具栏（多回合时长对话性能与视图切换）*/}
      {allTurnNumbers.length > 1 && (
        <div className="turn-toolbar">
          <span>
            共 {allTurnNumbers.length} 个交互回合
            {hasCollapsedTurns ? `（已收起 ${collapsedTurns.size} 个历史回合）` : "（全部展开）"}
          </span>
          <div className="turn-toolbar-actions">
            {hasCollapsedTurns ? (
              <button
                type="button"
                className="turn-tool-btn"
                onClick={handleExpandAll}
              >
                展开全部回合
              </button>
            ) : (
              <button
                type="button"
                className="turn-tool-btn"
                onClick={handleCollapsePast}
              >
                仅展开最新回合
              </button>
            )}
          </div>
        </div>
      )}

      {/* Ledger 账本 */}
      <Ledger
        records={displayRecords}
        selectedSeq={selectedRecord?.seq}
        onSelectRecord={handleSelectRecord}
        onToggleTurn={handleToggleTurn}
        hasMore={hasMore}
        onLoadOlder={handleLoadOlder}
        loadingOlder={loadingOlder}
      />

      {/* Inspector 详情检查器（底部抽屉，选中时展开）*/}
      {selectedRecord && (
        <Inspector
          record={selectedRecord}
          onClose={handleCloseInspector}
        />
      )}
    </section>
  );
}
