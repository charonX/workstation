# Build Progress — 2026-08-22-tool-call-review

> 故事 ID：`2026-08-22-tool-call-review`
> 状态：进行中
> 开始时间：2026-08-23
> 来源：`requirements.md` v1（哈希：`cd8088309c498ee02824a8f9ff74c5d454bcfe3496be20777990ce134a267fa6`）

---

## 切片规划

| 切片 | 名称 | 涉及 REQ-ID | 涉及模块 | 契约测试 | 状态 |
|---|---|---|---|---|---|
| **Slice 1** | Worker 侧轨迹落盘与 IPC 出站 | REQ-AGENT-127 | `src/agent/trajectoryRecorder.js`, `src/agent/worker.js`, `src/services/agentService.js` | `api/trajectoryRecorder.test.js` | `COMPLETED` |
| **Slice 2** | 领域模型投影与 HTTP 轨迹 API | REQ-AGENT-128 | `src/services/sessionDomain.js`, `src/http/routes/agentSessions.js` | `api/trajectoryApi.test.js` | `COMPLETED` |
| **Slice 3** | 归一记录纯函数模型与时间域计算 | REQ-AGENT-134, REQ-AGENT-132 | `src/renderer/components/trajectory/trajectoryModel.js` | `api/trajectoryModel.test.js` | `COMPLETED` |
| **Slice 4** | UI 组件渲染与交互集成 | REQ-AGENT-129, REQ-AGENT-130, REQ-AGENT-131, REQ-AGENT-132, REQ-AGENT-133, REQ-AGENT-135 | `src/renderer/components/trajectory/*`, `src/renderer/components/Assistant.jsx`, `src/renderer/api/agentSessions.js` | `e2e/trajectoryView.test.cjs` | `COMPLETED` |

---

## 进度记录

### 2026-08-23: Slice 1: Worker 侧轨迹落盘与 IPC 出站 (REQ-AGENT-127)

- **状态**: `COMPLETED`
- **契约测试**: `tests/capabilities/agent-dialogue/trajectory/2026-08-22-tool-call-review/api/trajectoryRecorder.test.js`（6/6 PASS）
- **变更模块**:
  - `src/agent/trajectoryRecorder.js`: 新建工厂 `createTrajectoryRecorder`，管理每会话单调递增 `seq`，格式化 5 类行记录（`turn_boundary`, `user_message`, `assistant_span`, `tool_call`, `compaction`），实现工具名规范化、时间片统计（`ttftMs`, `decodeMs`, `durationMs`）、双载体 ≤256KB 独立截断、写磁盘异常 fail-safe 降级日志与 `trajectory-record` IPC 双写。
  - `src/agent/worker.js`: 接入 `trajectoryRecorder`，在 `handlePrompt`（turn 起止与异常 abort）、`agentSession.subscribe`（text_delta/message_end/tool_execution/compaction）、`toolSurface.onEvent`（tool_execution_error）、`stop-session`（abort）、`lifecycle/turnPipeline`（会话状态清理与重置）中打通链路。
  - `src/services/agentService.js`: 在 `handleChildMessage` 中接入 `case "trajectory-record":`，向会话实例 emit `session-event`，交由 `sessionSseRegistry` 原样推送 SSE。

#### PRD → 代码可追溯性表

| PRD 锚点 / 条款 | REQ 条款 | 实现代码位置 | 验证测试 |
|---|---|---|---|
| §4 稳定块 1 / §6.3 T1 | REQ-AGENT-127 AC1 | `src/agent/trajectoryRecorder.js` (`createTrajectoryRecorder`, `writeRecord`) | `trajectoryRecorder.test.js` (AC1: 文件创建与格式合规) |
| §4 稳定块 1 / §6.3 T2 | REQ-AGENT-127 AC2 | `src/agent/trajectoryRecorder.js` (`onToolStart`, `onToolEnd`, `normalizeToolName`) | `trajectoryRecorder.test.js` (AC2: 工具调用记录完整性) |
| §4 稳定块 1 / §6.3 T3 | REQ-AGENT-127 AC3 | `src/agent/trajectoryRecorder.js` (`onFirstTextDelta`, `onAssistantMessageEnd`) | `trajectoryRecorder.test.js` (AC3: Assistant 时间片与 Token 用量) |
| §4 稳定块 1 / §6.3 T4 | REQ-AGENT-127 AC4 | `src/agent/trajectoryRecorder.js` (`onTurnAbort`), `src/agent/worker.js` (`stop-session`) | `trajectoryRecorder.test.js` (AC4: 中断收尾与零伪造时长) |
| §10.4 接口 1 (256KB 截断) | REQ-AGENT-127 AC5 | `src/agent/trajectoryRecorder.js` (`truncateRecord`, `truncateCarrierField`) | `trajectoryRecorder.test.js` (AC5: 载体截断 ≤256KB 保护) |
| §8 错误状态 (写异常降级) | REQ-AGENT-127 AC6 | `src/agent/trajectoryRecorder.js` (`writeRecord` try/catch + log) | `trajectoryRecorder.test.js` (AC6: 写入异常优雅降级) |
| §10.4 接口 3 (IPC 出站) | REQ-AGENT-134 | `src/agent/trajectoryRecorder.js` (`send trajectory-record`), `src/services/agentService.js` (`case "trajectory-record"`) | `trajectoryRecorder.test.js` (AC1/AC6 send 验证) |

### 2026-08-23: Slice 2: 领域模型投影与 HTTP 轨迹 API (REQ-AGENT-128)

- **状态**: `COMPLETED`
- **契约测试**: `tests/capabilities/agent-dialogue/trajectory/2026-08-22-tool-call-review/api/trajectoryApi.test.js`（5/5 PASS）
- **变更模块**:
  - `src/services/sessionDomain.js`: 新增 `sidecarPathFor(sessionRef)` 推导侧车路径、`normalizeTrajectoryLimit(limit)` 轨迹 limit 归一化（默认 200，上界 1000）、`readTrajectoryRecords(sessionRef, { limit, before })` 实现游标分页（`traj_<seq>` 格式、排序、`hasMore`、坏行 `skipped` 统计）。
  - `src/http/routes/agentSessions.js`: 新增 `trajectory` 路由分发（`GET /api/agent/sessions/:spaceKey/trajectory`）、`handleGetTrajectory()` 处理函数、`parseTrajectoryPaginationQuery()` query 解析。未知 spaceKey → 404 `E-SESSION-NOT-FOUND`。

#### PRD → 代码可追溯性表

| PRD 锚点 / 条款 | REQ 条款 | 实现代码位置 | 验证测试 |
|---|---|---|---|
| §4 稳定块 2 / §6.3 A1 | REQ-AGENT-128 AC1 | `sessionDomain.readTrajectoryRecords`, `agentSessions.handleGetTrajectory` | `trajectoryApi.test.js` (AC1: 游标分页基础读取) |
| §4 稳定块 2 / §6.3 A2 | REQ-AGENT-128 AC2 | `sessionDomain.readTrajectoryRecords` (before 游标过滤窗口) | `trajectoryApi.test.js` (AC2: 游标 before 分页窗口) |
| §7 输入验证 (limit 归一化) | REQ-AGENT-128 AC3 | `sessionDomain.normalizeTrajectoryLimit` | `trajectoryApi.test.js` (AC3: 查询参数校验与归一化) |
| §6.2 异常 / §8 错误状态 (坏行跳过) | REQ-AGENT-128 AC4 | `sessionDomain.readTrajectoryRecords` (try/catch skipped++) | `trajectoryApi.test.js` (AC4: 缺失文件空态与损坏行容错) |
| §8 错误状态 (404) | REQ-AGENT-128 AC5 | `agentSessions.handleGetTrajectory` (store.get → 404) | `trajectoryApi.test.js` (AC5: 未知会话 404) |

### 2026-08-23: Slice 3: 归一记录纯函数模型与时间域计算 (REQ-AGENT-134, REQ-AGENT-132)

- **状态**: `COMPLETED`
- **契约测试**: `tests/capabilities/agent-dialogue/trajectory/2026-08-22-tool-call-review/api/trajectoryModel.test.js`（6/6 PASS）
- **变更模块**:
  - `src/renderer/components/trajectory/trajectoryModel.js`（新建）: 实现 5 个纯函数导出：`createTrajectoryState`、`applyTrajectoryRecord`（原位更新 + 升序插入、key 稳定）、`prependTrajectoryRecords`（顶部触底合并去重）、`filterRecordsByTimeRange`（时间域过滤）、`calculateTimelineSegments`（TTFT/decode 拆分）。

#### PRD → 代码可追溯性表

| PRD 锚点 / 条款 | REQ 条款 | 实现代码位置 | 验证测试 |
|---|---|---|---|
| §10.5 D4 / §10.2 (单一记录模型) | REQ-AGENT-134 AC2 | `trajectoryModel.createTrajectoryState` | `trajectoryModel.test.js` (AC2: 初始状态构建与升序排列) |
| §10.5 D4 (原位更新+key 稳定) | REQ-AGENT-134 AC2 | `trajectoryModel.applyTrajectoryRecord` | `trajectoryModel.test.js` (AC2: running→completed 原位更新) |
| §10.5 D4 (幂等) | REQ-AGENT-134 AC2 | `trajectoryModel.applyTrajectoryRecord` | `trajectoryModel.test.js` (AC2: 重复 seq 幂等) |
| §10.2 (顶部加载) | REQ-AGENT-134 AC2 | `trajectoryModel.prependTrajectoryRecords` | `trajectoryModel.test.js` (AC2: prependTrajectoryRecords 合并保序) |
| §6.3 TL2 / REQ-AGENT-132 AC2 (时间域过滤) | REQ-AGENT-132 AC2 | `trajectoryModel.filterRecordsByTimeRange` | `trajectoryModel.test.js` (AC2: filterRecordsByTimeRange) |
| §6.3 TL1 / REQ-AGENT-132 AC1 (时间段拆分) | REQ-AGENT-132 AC1 | `trajectoryModel.calculateTimelineSegments` | `trajectoryModel.test.js` (AC1: calculateTimelineSegments) |

### 2026-08-23: Slice 4: UI 组件渲染与交互集成 (REQ-AGENT-129~133, 135)

- **状态**: `COMPLETED`
- **契约测试**: `tests/capabilities/agent-dialogue/trajectory/2026-08-22-tool-call-review/e2e/trajectoryView.test.cjs`（E2E，待 QA 阶段验证）
- **全量单元测试回归**: 1068 tests, 0 failures（无回归）
- **变更模块**:
  - `src/renderer/api/agentSessions.js`: 新增 `getTrajectoryRecords()` API 函数（轨迹端点调用）
  - `src/renderer/components/trajectory/TrajectoryView.jsx`（新建）: 视图总入口，含历史加载、SSE live 接入、空态、三区布局
  - `src/renderer/components/trajectory/Ledger.jsx`（新建）: 虚拟滚动账本行（ROW_HEIGHT=36, OVERSCAN=10, MOUNT_MAX=50 满足 VS1 锚点），行点击选中
  - `src/renderer/components/trajectory/TimelineOverview.jsx`（新建）: 时间轴条带，`assistant_span` 拆 TTFT/decode 两段（`data-timeline-segment`），`tool_call` 按比例投影
  - `src/renderer/components/trajectory/Inspector.jsx`（新建）: 详情检查器（输入/输出/耗时/Token/子执行跳转 `data-testid="subexec-link"`）
  - `src/renderer/components/assistant/ChatView.jsx`: 新增「轨迹」Tab（`data-testid="trajectory-tab"`），Tab 切换控制 `TrajectoryView`/消息区显隐
  - `src/renderer/pages/Assistant.jsx`: 新增 `liveTrajectoryRecord` 状态，SSE `trajectory-record` 事件转发，`spaceKey` 和 `liveTrajectoryRecord` 传入 `ChatView`

#### PRD → 代码可追溯性表

| PRD 锚点 / 条款 | REQ 条款 | 实现代码位置 | 验证测试 |
|---|---|---|---|
| §4 稳定块 3 / §6.3 V1 (Tab 显隐) | REQ-AGENT-129 AC1 | `ChatView.jsx` (activeTab state + trajectory-tab + view-tabs) | `trajectoryView.test.cjs` (Tab 切换) |
| §6.2 E-TRAJ-EMPTY (空态卡片) | REQ-AGENT-129 AC2 | `TrajectoryView.jsx` (records.length===0 → traj-empty-state) | `trajectoryView.test.cjs` (空态卡片) |
| §4 稳定块 4 / §6.3 L1 (账本行渲染) | REQ-AGENT-130 AC1 | `Ledger.jsx` (LedgerRow, data-record-type) | `trajectoryView.test.cjs` (Ledger 行渲染) |
| §6.3 I1 (Inspector 展开) | REQ-AGENT-131 AC1 | `Inspector.jsx`, `TrajectoryView.jsx` (selectedRecord state) | `trajectoryView.test.cjs` (Inspector 展开) |
| §6.3 TL1 (Timeline TTFT/decode) | REQ-AGENT-132 AC1 | `TimelineOverview.jsx` (data-timeline-segment=ttft/decode) | `trajectoryView.test.cjs` (Timeline 分段) |
| §6.3 VS1 (虚拟滚动 ≤50 节点) | REQ-AGENT-133 AC1 | `Ledger.jsx` (MOUNT_MAX=50, slice窗口) | `trajectoryView.test.cjs` (虚拟滚动上界) |
| §10.5 D4 / §6.3 (SSE 单一模型) | REQ-AGENT-134 AC1 | `Assistant.jsx` (trajectory-record case), `TrajectoryView.jsx` (applyTrajectoryRecord) | E2E live 流 |
| §6.3 J1 (子执行跳转) | REQ-AGENT-135 AC1 | `Inspector.jsx` (SubexecLink, data-testid="subexec-link") | `trajectoryView.test.cjs` (子执行跳转) |



