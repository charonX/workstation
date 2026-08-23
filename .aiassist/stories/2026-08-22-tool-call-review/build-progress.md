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
| **Slice 3** | 归一记录纯函数模型与时间域计算 | REQ-AGENT-134, REQ-AGENT-132 | `src/renderer/components/trajectory/trajectoryModel.js` | `api/trajectoryModel.test.js` | `NOT_STARTED` |
| **Slice 4** | UI 组件渲染与交互集成 | REQ-AGENT-129, REQ-AGENT-130, REQ-AGENT-131, REQ-AGENT-132, REQ-AGENT-133, REQ-AGENT-135 | `src/renderer/components/trajectory/*`, `src/renderer/components/Assistant.jsx`, `src/renderer/api/agentSessions.js` | `e2e/trajectoryView.test.cjs` | `NOT_STARTED` |

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

