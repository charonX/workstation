# 构建进度（Build Progress）— 2026-08-16-deepen-shallow-residue-sweep

> 故事 ID：`2026-08-16-deepen-shallow-residue-sweep`
> 对应 Requirements：[`requirements.md`](./requirements.md)
> 签核记录：[`signoff.md`](./signoff.md)
> 开始时间：2026-08-19

---

## 切片规划（Slices）

- [x] **Slice 1: 废除 agentAdapter 与缺 Provider 显式报错**
  - REQ: `REQ-FLOW-058`
  - 涉及文件: `src/flowEngine/agentAdapter.js` (删除), `src/flowEngine/executors/agentExecutor.js`, `src/flowEngine/claudeAgentAdapter.js`
  - 验证测试: `tests/capabilities/flow-orchestration/flow-engine/2026-08-16-deepen-shallow-residue-sweep/api/agentExecutorProvider.test.js`

- [x] **Slice 2: 统一 HTTP 响应助手与 5 路由收敛引用**
  - REQ: `REQ-WORKSPACE-020`
  - 涉及文件: `src/http/responders.js` (新建), `src/http/routes/{mcp,plugins,skills,projects,settings}.js`
  - 验证测试: `tests/capabilities/workspace-management/server/2026-08-16-deepen-shallow-residue-sweep/api/responders.test.js`

- [x] **Slice 3: Cron 描述助手归位至 schedulerService**
  - REQ: `REQ-SCHEDULE-011`
  - 涉及文件: `src/services/schedulerService.js`, `src/services/taskService.js`, `src/http/routes/schedules.js`
  - 验证测试: `tests/capabilities/scheduling-execution/schedule/2026-08-16-deepen-shallow-residue-sweep/api/cronDescription.test.js`

- [x] **Slice 4: 清理 flowService 废弃 UI 计算助手**
  - REQ: `REQ-FLOW-059`
  - 涉及文件: `src/services/flowService.js`
  - 验证测试: `tests/capabilities/flow-orchestration/flow/2026-08-16-deepen-shallow-residue-sweep/api/flowServiceCleanup.test.js`

---

## 进度记录

### Slice 1: 废除 agentAdapter 与缺 Provider 显式报错 (REQ-FLOW-058)

- **状态**: **complete**
- **涉及文件**:
  - `src/flowEngine/agentAdapter.js`（删除）
  - `src/flowEngine/executors/agentExecutor.js`（移除 mockAgentExecute 导入，重构分派分支）
  - `src/flowEngine/claudeAgentAdapter.js`（支持 async queryFn 与 text 消息类型兼容）
  - `tests/capabilities/flow-orchestration/flow/codex-harness-desktop/api/flow.test.js`（适配 setAgentExecutorForTests seam）
  - `tests/capabilities/scheduling-execution/task/codex-harness-desktop/api/task.test.js`（适配 setAgentExecutorForTests seam）
  - `tests/capabilities/scheduling-execution/execution/2026-07-19-media-production-line/api/artifacts.test.js`（移除对已删除 agentAdapter.js 的代码结构断言）
- **验证结果**: `agentExecutorProvider.test.js` 4/4 绿，既有回归测试（37/37）全绿。

#### PRD→代码 可追溯性表（Slice 1）

| PRD 意图（§10 / REQ） | 实现文件/函数 | 测试文件 | 覆盖状态 |
|---|---|---|---|
| §10.1 #1 彻底删除静默 mock adapter（REQ-FLOW-058 AC1） | `src/flowEngine/agentAdapter.js` (deleted) | agentExecutorProvider.test.js AC1 | COVERED |
| §6.3 / §8 缺 provider 显式报错 `E-AGENT-NO-PROVIDER`（REQ-FLOW-058 AC2） | `agentExecutor.js`: agentExecutor (`!provider` 分支) | agentExecutorProvider.test.js AC2 | COVERED |
| §6.2 / §8 未知 provider 显式报错 `Unknown agent provider`（REQ-FLOW-058 AC3） | `agentExecutor.js`: agentExecutor (未知 provider 分支) | agentExecutorProvider.test.js AC3 | COVERED |
| §6.1 #1 provider 为 anthropic 时真实分派至 claudeAgentAdapter（REQ-FLOW-058 AC4） | `agentExecutor.js`: agentExecutor (`provider === "anthropic"` 分支) | agentExecutorProvider.test.js AC4 | COVERED |

### Slice 2: 统一 HTTP 响应助手与 5 路由收敛引用 (REQ-WORKSPACE-020)

- **状态**: **complete**
- **涉及文件**:
  - `src/http/responders.js`（新建：提供 ok, noContent, badRequest, notFound, mapError, decodeParam, normalizeBool）
  - `src/http/routes/mcp.js`（重构：导入 responders.js，移除本地多余导出）
  - `src/http/routes/plugins.js`（重构：导入 responders.js，解除对 mcp.js 的反向引用）
  - `src/http/routes/skills.js`（重构：导入 responders.js，移除本地重复 helper）
  - `src/http/routes/projects.js`（重构：导入 responders.js，移除本地重复 helper）
  - `src/http/routes/settings.js`（重构：导入 responders.js，移除本地重复 helper）
- **验证结果**: `responders.test.js` 5/5 绿，相关路由及既有测试全绿。

#### PRD→代码 可追溯性表（Slice 2）

| PRD 意图（§10 / REQ） | 实现文件/函数 | 测试文件 | 覆盖状态 |
|---|---|---|---|
| §10.2 #1 导出标准化助手集合（REQ-WORKSPACE-020 AC1） | `src/http/responders.js` (`ok`, `noContent`, `badRequest`, `notFound`, `mapError`, `decodeParam`, `normalizeBool`) | `responders.test.js` AC1 | COVERED |
| §6.3 / §8 标准 HTTP 响应格式（REQ-WORKSPACE-020 AC2） | `src/http/responders.js` (`ok`, `noContent`, `badRequest`, `notFound`) | `responders.test.js` AC2 | COVERED |
| §6.2 / §10.2 统一 mapError 与 extra 字段透传（REQ-WORKSPACE-020 AC3） | `src/http/responders.js` (`mapError`) | `responders.test.js` AC3 | COVERED |
| §7 参数解码与布尔归一化（REQ-WORKSPACE-020 AC4） | `src/http/responders.js` (`decodeParam`, `normalizeBool`) | `responders.test.js` AC4 | COVERED |
| §10.1 #2 / §10.2 5 路由统一引用且解耦 plugins->mcp（REQ-WORKSPACE-020 AC5） | `src/http/routes/{mcp,plugins,skills,projects,settings}.js` | `responders.test.js` AC5 | COVERED |

### Slice 3: Cron 描述助手归位至 schedulerService (REQ-SCHEDULE-011)

- **状态**: **complete**
- **涉及文件**:
  - `src/services/schedulerService.js`（新增实现并导出 `getCronDescription`，支持 5/6 字段 24 小时制与非法字段数校验报错）
  - `src/http/routes/schedules.js`（修改 `toListView` 直接调用 `schedulerService.getCronDescription(schedule.cron)`）
  - `src/services/taskService.js`（移除本地解析实现，改为 `export { getCronDescription } from "./schedulerService.js"` 单行兼容转发）
- **验证结果**: `cronDescription.test.js` 4/4 绿，既有 schedule/task 回归测试（18/18）全绿。

#### PRD→代码 可追溯性表（Slice 3）

| PRD 意图（§10 / REQ） | 实现文件/函数 | 测试文件 | 覆盖状态 |
|---|---|---|---|
| §10.2 #2 导出 getCronDescription 并支持 5/6 字段（REQ-SCHEDULE-011 AC1） | `src/services/schedulerService.js`: `getCronDescription` | `cronDescription.test.js` AC1 | COVERED |
| §6.3 / §7 非法字段数抛错 `Invalid cron expression: expected 5 or 6 fields`（REQ-SCHEDULE-011 AC1） | `src/services/schedulerService.js`: `getCronDescription` | `cronDescription.test.js` AC2 | COVERED |
| §10.2 #2 / §6.1 #4 schedules 路由直接导入 schedulerService 并生成 cronDescription（REQ-SCHEDULE-011 AC2） | `src/http/routes/schedules.js`: `toListView` | `cronDescription.test.js` AC3 | COVERED |
| §10.2 / §2 #3 taskService 单行转发保证平滑过渡（REQ-SCHEDULE-011 AC3） | `src/services/taskService.js`: `export { getCronDescription }` | `cronDescription.test.js` AC4 | COVERED |

### Slice 4: 清理 flowService 废弃 UI 计算助手 (REQ-FLOW-059)

- **状态**: **complete**
- **涉及文件**:
  - `src/services/flowService.js`（彻底删除 `toggleRun`, `zoomIn`, `zoomOut`, `resetZoom`, `getNodeCategories`, `getEditableFields` 6 个 UI 助手导出与实现；显式导出 `publishFlow` 核心服务端方法）
- **验证结果**: `flowServiceCleanup.test.js` 2/2 绿，全量 1034 个单元测试全绿。

#### PRD→代码 可追溯性表（Slice 4）

| PRD 意图（§10 / REQ） | 实现文件/函数 | 测试文件 | 覆盖状态 |
|---|---|---|---|
| §10.1 #6 / §4 #4 彻底删除 flowService 中的 6 个废弃 UI 计算助手（REQ-FLOW-059 AC1） | `src/services/flowService.js`: 删除 `toggleRun`, `zoomIn`, `zoomOut`, `resetZoom`, `getNodeCategories`, `getEditableFields` | `flowServiceCleanup.test.js` AC1 | COVERED |
| §6.1 #5 / §10.1 #6 保留服务端核心 Flow CRUD 与校验能力（REQ-FLOW-059 AC2） | `src/services/flowService.js`: `createFlow`, `getFlow`, `updateFlow`, `deleteFlow`, `listFlows`, `publishFlow`, `validateNodeList` | `flowServiceCleanup.test.js` AC2 | COVERED |


