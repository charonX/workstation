// src/renderer/components/trajectory/TrajectoryView.jsx
// 轨迹视图总入口（REQ-AGENT-129 / PRD §4 稳定块 3）。
// 三区一体：Timeline 条带 / Ledger 账本 / Inspector 检查器。
// data-testid: trajectory-view
// 空态 data-testid: traj-empty-state（无记录时展示）
//
// 数据来源：
//   1. 初始化：GET /api/agent/sessions/:spaceKey/trajectory（历史快照）
//   2. Live：SSE trajectory-record 事件（通过 onTrajectoryEvent prop 传入）
// 状态管理：使用 trajectoryModel.js 纯函数 reducer。

import { useState, useEffect, useCallback } from "react";
import {
  createTrajectoryState,
  applyTrajectoryRecord,
} from "./trajectoryModel.js";
import Ledger from "./Ledger.jsx";
import TimelineOverview from "./TimelineOverview.jsx";
import Inspector from "./Inspector.jsx";
import { getTrajectoryRecords } from "../../api/agentSessions.js";

export default function TrajectoryView({ spaceKey, liveRecord }) {
  const [state, setState] = useState(() => createTrajectoryState([]));
  const [selectedRecord, setSelectedRecord] = useState(null);
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

    getTrajectoryRecords(spaceKey, { limit: 200 })
      .then((result) => {
        if (cancelled) return;
        setState(createTrajectoryState(result.records ?? []));
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err?.message ?? "加载轨迹失败");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [spaceKey]);

  // Live：接收 SSE trajectory-record 事件（由父层 Assistant.jsx 传入）
  useEffect(() => {
    if (!liveRecord) return;
    // 仅接受同一会话的事件
    if (liveRecord.sessionKey && spaceKey && !liveRecord.sessionKey.includes(spaceKey.replace(/:/g, "_"))) {
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

  return (
    <div className="traj-view" data-testid="trajectory-view" style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, overflow: "hidden" }}>
      {/* Timeline 概览条（REQ-AGENT-132）*/}
      <TimelineOverview records={state.records} />

      {/* 主体：Ledger + Inspector */}
      <div style={{ flex: 1, display: "flex", minHeight: 0, overflow: "hidden" }}>
        <Ledger
          records={state.records}
          selectedSeq={selectedRecord?.seq}
          onSelectRecord={handleSelectRecord}
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
