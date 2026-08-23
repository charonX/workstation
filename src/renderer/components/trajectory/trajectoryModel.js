// src/renderer/components/trajectory/trajectoryModel.js
// 会话轨迹账本——归一记录纯函数数据模型（ADR-038 / REQ-AGENT-134 / REQ-AGENT-132）。
//
// 设计决策（§10.5 D4）：
// - 纯函数 reducer：所有函数无副作用，输入 → 输出，便于 React 状态更新与 SSR 测试。
// - 单一记录模型：live 事件（trajectory-record SSE）与重放（API 响应）共享同一记录结构。
// - React key 稳定：每行 key = `traj_${seq}`，seq 单调递增不可变，key 不随状态更新变动。
// - 原位更新语义（D6）：同一 seq 的新事件覆盖既有行（running → completed），不增加行数。
// - 顶部触底加载（prependTrajectoryRecords）：把历史页合并到内存，维持全局升序，去重保序。

/**
 * 创建初始轨迹状态。
 * @param {Array} initialRecords - 来自 API 分页的记录列表（已排序）
 * @returns {{ records: Array, maxSeq: number }}
 */
export function createTrajectoryState(initialRecords = []) {
  const sorted = [...initialRecords].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
  const records = sorted.map(withKey);
  const maxSeq = records.length > 0 ? records[records.length - 1].seq : 0;
  return { records, maxSeq };
}

/**
 * 应用一条 trajectory-record 事件到状态（live 流或 SSE 重放）。
 * - 若 seq 已存在（同一 seq 的更新事件），原位替换（保持 key 稳定）。
 * - 若 seq 不存在，按升序插入。
 * @param {{ records: Array, maxSeq: number }} state
 * @param {object} record - 新到达的轨迹记录
 * @returns {{ records: Array, maxSeq: number }}
 */
export function applyTrajectoryRecord(state, record) {
  const newRecord = withKey(record);
  const seq = newRecord.seq;

  // 原位更新：找到已有的同 seq 行
  const idx = state.records.findIndex((r) => r.seq === seq);
  if (idx !== -1) {
    const updated = [...state.records];
    updated[idx] = { ...newRecord, key: updated[idx].key };
    return { records: updated, maxSeq: Math.max(state.maxSeq, seq ?? 0) };
  }

  // 新行：按升序插入（通常是追加到末尾）
  const insertAt = findInsertionIndex(state.records, seq ?? 0);
  const updated = [
    ...state.records.slice(0, insertAt),
    newRecord,
    ...state.records.slice(insertAt),
  ];
  return { records: updated, maxSeq: Math.max(state.maxSeq, seq ?? 0) };
}

/**
 * 顶部触底加载：将更早的一页历史记录合并到状态头部，维持全局升序，去重。
 * @param {{ records: Array, maxSeq: number }} state
 * @param {Array} earlierRecords - API 返回的更早一页记录（seq 均小于当前内存头部）
 * @returns {{ records: Array, maxSeq: number }}
 */
export function prependTrajectoryRecords(state, earlierRecords) {
  const existingSeqs = new Set(state.records.map((r) => r.seq));
  const toAdd = earlierRecords
    .filter((r) => !existingSeqs.has(r.seq))
    .map(withKey);

  const merged = [...toAdd, ...state.records].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
  const maxSeq = merged.length > 0 ? Math.max(...merged.map((r) => r.seq ?? 0), state.maxSeq) : state.maxSeq;
  return { records: merged, maxSeq };
}

/**
 * 时间域换算与选区过滤（REQ-AGENT-132 AC2）。
 * 对每条记录计算其时间窗口 [startMs, endMs]，返回与 [rangeStart, rangeEnd] 有重叠的记录。
 * - tool_call：startMs = ts, endMs = ts + durationMs（若 durationMs 无效则以 ts 为点）
 * - assistant_span：startMs = ts, endMs = ts + ttftMs + decodeMs（若均无效则以 ts 为点）
 * - 其他类型：以 ts 为点，rangeStart ≤ ts ≤ rangeEnd 时纳入
 *
 * @param {Array} records
 * @param {number} rangeStart - Unix 毫秒时间戳
 * @param {number} rangeEnd   - Unix 毫秒时间戳
 * @returns {Array}
 */
export function filterRecordsByTimeRange(records, rangeStart, rangeEnd) {
  return records.filter((r) => {
    const tsMs = r.ts ? new Date(r.ts).getTime() : 0;
    if (Number.isNaN(tsMs)) return false;

    let startMs = tsMs;
    let endMs = tsMs;

    if (r.type === "tool_call") {
      const dur = typeof r.durationMs === "number" && r.durationMs >= 0 ? r.durationMs : 0;
      endMs = tsMs + dur;
    } else if (r.type === "assistant_span") {
      const ttft = typeof r.ttftMs === "number" && r.ttftMs >= 0 ? r.ttftMs : 0;
      const decode = typeof r.decodeMs === "number" && r.decodeMs >= 0 ? r.decodeMs : 0;
      if (r.startTs) {
        startMs = new Date(r.startTs).getTime();
        endMs = startMs + ttft + decode;
      } else {
        endMs = tsMs + ttft + decode;
      }
    }

    // 重叠判断：[startMs, endMs] 与 [rangeStart, rangeEnd] 有重叠
    return startMs <= rangeEnd && endMs >= rangeStart;
  });
}

/**
 * Assistant 片段拆分计算（REQ-AGENT-132 AC1）。
 * 将 assistant_span 记录的 TTFT/decode 拆为两个独立段，用于 Timeline 渲染。
 *
 * @param {object} record - assistant_span 类型的轨迹记录
 * @returns {Array<{ type: 'ttft'|'decode', durationMs: number }>}
 */
export function calculateTimelineSegments(record) {
  if (record?.type !== "assistant_span") return [];
  const segments = [];
  if (typeof record.ttftMs === "number") {
    segments.push({ type: "ttft", durationMs: record.ttftMs });
  }
  if (typeof record.decodeMs === "number") {
    segments.push({ type: "decode", durationMs: record.decodeMs });
  }
  return segments;
}

// —— 私有工具函数 ——

/** 为记录附加稳定的 React key（traj_<seq>）。 */
function withKey(record) {
  return { ...record, key: `traj_${record.seq}` };
}

/** 在已排序数组中找到按 seq 升序的插入位置（二分逼近）。 */
function findInsertionIndex(records, seq) {
  let lo = 0;
  let hi = records.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if ((records[mid].seq ?? 0) <= seq) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
