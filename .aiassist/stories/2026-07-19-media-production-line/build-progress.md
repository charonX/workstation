# BUILD Progress — 2026-07-19-media-production-line

> 父代理调度记录。每个 slice 完成后追加可追溯性声明。
> Story: 媒体生产线 · 收集管线
> Phase: BUILD (attempt 1)

---

## 切片计划

| Slice | 名称 | REQ-ID | 依赖 | 状态 | 测试文件 |
|---|---|---|---|---|---|
| S1 | Workspace/Server 基础与 DB 改造 | REQ-WORKSPACE-008~010 | 无 | complete | `workspace-management/server/api/server.test.js` |
| S2 | 调度器、执行队列、产物登记与终态投递 | REQ-SCHEDULE-005~009, REQ-FLOW-029 | S1 | in_progress | `scheduling-execution/schedule/api/scheduleTriggers.test.js`, `flow-orchestration/flow-engine/api/triggerVariables.test.js`, `scheduling-execution/execution/api/executionQueue.test.js`, `scheduling-execution/execution/api/artifacts.test.js` |
| S3 | 通知中心服务与 API/CLI | REQ-NOTIFY-001 | S1, S2 | pending | `information-aggregation/notification/api/notifications.test.js` |
| S4 | 内容源服务与 API/CLI | REQ-SRC-001~002 | S1 | pending | `collection-pipeline/content-source/api/contentSources.test.js`, `collection-pipeline/content-source/cli/contentSources.test.js` |
| S5 | 飞书通道 adapter 与绑定管理 | REQ-CHANNEL-001~005 | S1, S2 | pending | `channel-integration/channel/api/feishuChannel.test.js`, `channel-integration/channel/api/imRouting.test.js`, `channel-integration/channel/api/docSync.test.js` |
| S6 | Execution 产物 tab 与打开动作 | REQ-FLOW-030 | S1, S2 | pending | `flow-orchestration/execution/api/artifactOpenPath.test.js`, `flow-orchestration/execution/e2e/artifactsTab.test.cjs` |
| S7 | 内容源管理 UI | REQ-SRC-003 | S1, S4 | pending | `collection-pipeline/content-source/e2e/sourcesPage.test.cjs` |
| S8 | 通知中心 UI | REQ-NOTIFY-002 | S1, S3 | pending | `information-aggregation/notification/e2e/notificationCenter.test.cjs` |
| S9 | 收集 skill 包 | REQ-COLL-003 | 无（依赖 skillService） | pending | `collection-pipeline/collection/api/collectionSkills.test.js` |
| S10 | 模板实例化 | REQ-TPL-001 | S1, S4, S5 | pending | `collection-pipeline/template/api/templates.test.js` |
| S11 | 场景 A · 定时日报端到端 | REQ-COLL-001 | S2, S3, S5, S9 | pending | `collection-pipeline/collection/api/dailyDigest.test.js` |
| S12 | 场景 B · 链接速存端到端 | REQ-COLL-002 | S2, S3, S5, S9 | pending | `collection-pipeline/collection/api/linkCapture.test.js` |

---

## 父代理设计上下文摘要

### 涉及 capability / entity
- workspace-management / server
- scheduling-execution / schedule, execution
- flow-orchestration / flow-engine, execution
- channel-integration / channel
- collection-pipeline / content-source, collection, template
- information-aggregation / notification

### 关键接口契约
- `schedulerService.loadAll/upsert/remove`：随 server 生命周期管理 node-cron 任务；到点 publish `schedule:triggered`。
- `taskService.createTask({projectId, flowId, trigger, variables})`：创建 execution，入 `executionQueue`，终态统一投递。
- `executionQueue.enqueue({projectId, run})/getPosition(executionId)`：per-project 串行，上限 50。
- `channelAdapter` 接口：`start/getStatus/onMessage/send/reply`；`feishuChannelAdapter` 实现长连接与 fake seam。
- `contentSourceService` CRUD + `listByTag({tag, enabledOnly})`；全局归属，无 projectId。
- `notificationService.notify/list/markRead`；类型 `artifact/execution-failed/channel-status`。
- 模板实例化 `POST /api/templates/:id/instantiate`：创建 flow + 通道绑定同事务。

### 与 HTML 原型对齐要点
- `ux/sources.html`：Sources 页列表/新建/编辑/启停/删除；tag 编辑器；类型联动 config 字段。
- `ux/notifications.html`：侧边栏徽标、列表倒序、类型配色、产物产出可跳转执行详情。
- `ux/settings-channel.html`：Settings 飞书凭据区块、通道三态显示。
- `ux/execution-detail.html`：Executions 详情产物 tab、打开/在文件夹中显示按钮。

### 边界 case
- DB 不可写 → `E-DB-UNWRITABLE`，server 启动失败。
- 旧 `userData/data.db` 迁移到新 `~/.opc-workstation/data.db`：复制非移动。
- App 顶替 headless：shutdown 握手，无双触发，超时拒不退让则报错。
- Schedule 到点 flow 为 draft/已删 → `E-SCHED-FLOW-INVALID`，不创建执行。
- IM 消息无 URL → 提示分支；无绑定 → 提示创建；绑定失效 → 通道状态通知。
- 执行队列 per-project 上限 50，超出回执「队列已满，稍后再发」。
- 产物路径白名单：仅项目目录内路径允许 `shell.openPath`/`showItemInFolder`。
- fetch-to-markdown skill 拒绝私网 IP（SSRF 阻断）。

---

## Slice 执行记录

### S1 / workspace-server-db

**状态**: DONE  
**测试命令**: `node --test tests/capabilities/workspace-management/server/2026-07-19-media-production-line/api/server.test.js`  
**测试结果**: 9/9 pass

#### PRD→代码可追溯性表

| PRD 意图 | 实现文件 | 测试文件 | 状态 |
|---|---|---|---|
| OP-6a 步骤 1：CLI 自起 headless server，DB 默认落盘 `~/.opc-workstation/data.db` | `src/db.js` (`defaultDbPath`, `getDb`); `src/cli/headless-server.js`; `src/cli/server.js` | `tests/capabilities/workspace-management/server/2026-07-19-media-production-line/api/server.test.js` | COVERED |
| OP-6a 步骤 2：重启后执行记录/产物路径仍可见（持久化） | `src/db.js` (`getDb`) | 同上 | COVERED |
| §6.2 / §8 错误状态：DB 目录不可写 → `E-DB-UNWRITABLE` | `src/db.js` (`getDb` 目录创建/探针 + Database 打开错误包装) | 同上 | COVERED |
| §6.2 / §8 错误状态：旧 server 拒不退让 → `E-SERVER-TAKEOVER-TIMEOUT` | `src/serverRegistry.js` (`takeoverExistingServer`) | 同上 | COVERED |
| §6.1 OP-6b / §13 决策：任一时刻单 server；App 顶替既有 headless server | `src/serverRegistry.js` (`takeoverExistingServer`); `src/cli/headless-server.js` (`maybeTakeoverExistingServer`); `src/main/main.js` (`discoverServer` + `takeoverExistingServer`); `src/http/server.js` (`/api/server/shutdown`) | 同上 | COVERED |
| 单 server 验证：旧 server 收到 shutdown 退出，注册表收敛为单条活跃记录 | `src/cli/headless-server.js` (`server.on("close")` 退出); `src/http/server.js` (`stopServer` + 注册表 owner); `src/serverRegistry.js` (`registerServerRecord`/`unregisterServerRecord`) | 同上 | COVERED |
| 单 server 验证：调度器/通道只在新 server 注册（status 端点 seam） | `src/http/server.js` (`/api/server/status`) | 同上 | COVERED |
| REQ-WORKSPACE-010：旧 `userData/data.db` 存在且新路径不存在时复制迁移 | `src/db.js` (`migrateLegacyDb`); `src/main/main.js` (迁移调用) | 同上 | COVERED |
| 迁移结构化日志：含源/目标路径与耗时，不含数据内容 | `src/db.js` (`migrateLegacyDb` logger payload) | 同上 | COVERED |
| 迁移安全：新路径已存在时不迁移、不覆盖 | `src/db.js` (`migrateLegacyDb` 前置检查) | 同上 | COVERED |
| OP-6b：server 未运行时段的 schedule 到点不触发、不补偿 | 本切片未实现调度器；基础设施已保证单 server，调度语义由 S2 承接 | — | GAP |

#### 与 HTML 原型偏差

- N/A。本切片为基础设施层，无直接 UX 原型。DB 路径统一为 `~/.opc-workstation/data.db` 后，Settings 等模块的持久化路径已按 PRD §10 / tech-design 调整；Electron main 保留写入 `userData/server.json` 供 E2E fixtures 发现，未破坏现有行为。

#### 父代理验证记录

- 业务测试验证：`node --test tests/capabilities/workspace-management/server/2026-07-19-media-production-line/api/server.test.js` → 9/9 pass
- diff 范围检查：仅修改实现代码（`src/db.js`, `src/serverRegistry.js`, `src/cli/headless-server.js`, `src/cli/server.js`, `src/main/main.js`, `src/http/server.js`），未触碰业务测试
- PRD 对齐子代理：首次 `MISALIGNMENT_FOUND`（`main.js` takeover 失败后仍启动 server 导致双跑）；fix subagent 修复后复查为 `ALIGNED`
- Refactor subagent：完成安全重构，测试仍 9/9 pass
- 提交记录：
  - `[build] Slice 1: workspace server db` (`a03182ac`)
  - `[bugfix] S1: prevent dual server when takeover fails` (`0b6f3254`)
  - `[refactor] Slice 1: workspace server db` (`65aa1c7f`)

Slice 1 标记完成。

---

### S2 / scheduler-queue-artifacts-delivery

**状态**: DONE  
**测试命令**:
- `node --test tests/capabilities/scheduling-execution/schedule/2026-07-19-media-production-line/api/scheduleTriggers.test.js`
- `node --test tests/capabilities/flow-orchestration/flow-engine/2026-07-19-media-production-line/api/triggerVariables.test.js`
- `node --test tests/capabilities/scheduling-execution/execution/2026-07-19-media-production-line/api/executionQueue.test.js`
- `node --test tests/capabilities/scheduling-execution/execution/2026-07-19-media-production-line/api/artifacts.test.js`  
**测试结果**: 29/29 pass（调度 10 + trigger 变量 3 + 队列 7 + 产物/投递 9）

#### PRD→代码可追溯性表

| PRD 意图 | 实现文件 | 测试文件 | 状态 |
|---|---|---|---|
| §6.1 OP-3 步骤 2/3：Schedule cron 到点触发，发布 `schedule:triggered`，创建 trigger=schedule 的执行 | `src/services/schedulerService.js` (`loadAll`, `upsert`, `remove`, `validateCron`); `src/services/taskService.js` (`subscribeToScheduleTriggers`, `createTask`) | `tests/capabilities/scheduling-execution/schedule/2026-07-19-media-production-line/api/scheduleTriggers.test.js` | COVERED |
| §6.1 OP-3 步骤 2：schedule CRUD 成功后同进程同步 node-cron 任务 | `src/http/routes/schedules.js` (`handleSchedules` 调用 `schedulerService.upsert`/`remove`); `src/services/schedulerService.js` | 同上 | COVERED |
| §6.2 / §8：到点时 flow 为 draft/已删 → `E-SCHED-FLOW-INVALID`，不建执行 | `src/services/taskService.js` (`createTask` 对 trigger=schedule 检查 flow.status) | 同上 | COVERED |
| REQ-SCHEDULE-006：`schedules.variables` JSON 列 CRUD 透传，非法 cron 报 `E-SCHED-CRON` | `src/db.js` (`schedules.variables` 列 + 迁移); `src/services/taskService.js` (`createSchedule` 调用 `validateCron`); `src/http/routes/schedules.js` (透传/错误码); `src/cli/commands/schedule.js` (`--variables`/`--vars`) | 同上 | COVERED |
| REQ-SCHEDULE-006 AC2：schedule.variables 注入 execution.variables | `src/services/schedulerService.js` (`scheduleTask` payload 含 variables); `src/services/taskService.js` (`subscribeToScheduleTriggers` 透传 variables) | 同上 | COVERED |
| REQ-SCHEDULE-007：per-project 串行执行队列，上限 50，`getPosition` 正确 | `src/services/executionQueue.js` (`createExecutionQueue`, `enqueue`, `getPosition`) | `tests/capabilities/scheduling-execution/execution/2026-07-19-media-production-line/api/executionQueue.test.js` | COVERED |
| REQ-SCHEDULE-007 AC3：server 启动恢复孤儿执行（queued/running → error，reason=server-restart） | `src/services/executionQueue.js` (`recoverInterruptedExecutions`); `src/http/server.js` (`startServer` 启动时调用) | 同上 | COVERED |
| REQ-SCHEDULE-007 AC4：单个执行抛错不影响后续执行 | `src/services/executionQueue.js` (`dequeueNext` catch + continue) | 同上 | COVERED |
| REQ-SCHEDULE-008：`executions.artifacts` JSON 列，成功登记产物路径，失败不登记 | `src/db.js` (`executions.artifacts` 列 + 迁移); `src/services/taskService.js` (`collectArtifacts`, `completeExecution` 支持 artifacts, `rowToExecution` 暴露 artifacts) | `tests/capabilities/scheduling-execution/execution/2026-07-19-media-production-line/api/artifacts.test.js` | COVERED |
| REQ-SCHEDULE-008 AC3：执行详情 API/CLI 返回 artifacts | `src/http/routes/executions.js` (`GET /api/executions/:id` 透传); `src/cli/commands/task.js` (`get` 保持 `--id`) | 同上 | COVERED |
| REQ-SCHEDULE-009：终态投递钩子，按 `channelReply` 发送模板消息，失败不反转终态 | `src/services/taskService.js` (`deliverTerminalNotification`, `executeTask` finally 调用) | 同上 | COVERED |
| REQ-SCHEDULE-009 AC4：agent 节点实现不参与消息发送 | `src/flowEngine/executors/agentExecutor.js` / `agentAdapter.js` / `claudeAgentAdapter.js` 不引用 channelAdapter/feishu | 同上 | COVERED |
| REQ-FLOW-029：trigger 注入变量覆盖 defaultValue，未注入保留默认值，下游按 `节点ID.变量名` 可见 | `src/flowEngine/flowEngine.js` (`seedTriggerVariables`, `applyTriggerVariableOverrides`, `Object.assign(context, inputVariables)`); `src/flowEngine/executors/triggerExecutor.js` 返回 `{...context}` | `tests/capabilities/flow-orchestration/flow-engine/2026-07-19-media-production-line/api/triggerVariables.test.js` | COVERED |
| §6.1 OP-3 步骤 4/5：产物落盘并登记，server 启动加载调度器 | `src/http/server.js` (`startServer` 调用 `schedulerService.loadAll` 与 `recoverInterruptedExecutions`; `/api/server/status` 返回 `schedulerRegistered: true`) | `tests/capabilities/workspace-management/server/2026-07-19-media-production-line/api/server.test.js` | COVERED |
| 兼容性：既有测试/客户端依赖 `POST /api/executions` 返回 `id` | `src/services/taskService.js` (`createTask` 返回同时保留 `id` 与 `executionId`) | `tests/capabilities/workspace-management/server/2026-07-19-media-production-line/api/server.test.js` | COVERED |

#### 与 HTML 原型偏差

- N/A。本切片为调度/队列/执行终态层，无直接 UX 原型。

#### 父代理验证记录

- 业务测试验证（refactor 后）：
  - `scheduleTriggers.test.js` → 10/10 pass
  - `triggerVariables.test.js` → 3/3 pass
  - `executionQueue.test.js` → 7/7 pass
  - `artifacts.test.js` → 9/9 pass
  - S1 回归：`server.test.js` → 9/9 pass
  - 合计 38/38 pass
- diff 范围检查：仅修改实现代码，未触碰业务测试
- PRD 对齐子代理：首次 `MISALIGNMENT_FOUND`（生产未订阅 `schedule:triggered`、E-QUEUE-FULL 未穿透、status 硬编码）；fix subagent 修复后复查仍发现 `MISALIGNMENT_FOUND`（E-SCHED-FLOW-INVALID 对 flow 已删路径、schedule 异常标记）；第二次 fix 后复查为 `ALIGNED`
- Refactor subagent：完成安全重构，测试仍 38/38 pass
- 提交记录：
  - `[build] Slice 2: scheduler queue artifacts delivery` (`1d1c7f1`)
  - `[bugfix] S2: production wiring and queue-full handling` (`0915766`)
  - `[bugfix] S2: mark invalid schedule when target flow missing/draft` (`89b0cd5`)
  - `[refactor] Slice 2: scheduler queue artifacts delivery` (`d6d292c`)

Slice 2 标记完成。

---


### S3 / notification-service

**状态**: DONE  
**测试命令**:
- `node --test tests/capabilities/information-aggregation/notification/2026-07-19-media-production-line/api/notifications.test.js`  
**测试结果**: 6/6 pass

#### PRD→代码可追溯性表

| PRD 意图 | 实现文件 | 测试文件 | 状态 |
|---|---|---|---|
| §6.1 OP-7 / §10 稳定块 10：通知实体（类型/标题/摘要/时间/已读/关联执行） | `src/db.js` (`notifications` 表 + 索引); `src/services/notificationService.js` (`notify`/`list`/`markRead`, `rowToNotification` 暴露 `readAt`) | `tests/capabilities/information-aggregation/notification/2026-07-19-media-production-line/api/notifications.test.js` | COVERED |
| §6.1 OP-7 步骤 2：按时间倒序展示事件，类型包含产物产出/执行失败/通道状态 | `src/services/notificationService.js` (`list` ORDER BY createdAt DESC); `src/http/routes/notifications.js` (`GET /api/notifications` 返回 `{items, unreadCount}`) | 同上 | COVERED |
| §6.1 OP-7 步骤 3：标记已读后持久化，徽标清零 | `src/services/notificationService.js` (`markRead` 支持 `{ids}` 与 `{all: true}`); `src/http/routes/notifications.js` (`POST :id/read`, `POST read-all`) | 同上 | COVERED |
| §6.2 / §8：通知写入失败仅记日志 `E-NOTIFY-FAILED`，不阻断主流程 | `src/services/notificationService.js` (`notify` catch 写入失败并 console.error `E-NOTIFY-FAILED`，不抛错；关闭 DB 后清空缓存以便下次重连) | 同上 | COVERED |
| REQ-NOTIFY-001 AC1/AC2：`notifications` 表字段完整，type ∈ {artifact, execution-failed, channel-status} | `src/db.js` (DDL); `src/services/notificationService.js` (类型校验与写入) | 同上 | COVERED |
| REQ-NOTIFY-001 AC3：API 列表 + 未读数 + 单条/全部已读 + `unreadOnly` 过滤 | `src/http/routes/notifications.js`; `src/services/notificationService.js` | 同上 | COVERED |
| REQ-NOTIFY-001 AC3：CLI `notify list [--unread]` / `notify read --id <id> \| --all` 等价 | `src/cli/commands/notify.js`; `src/cli/opc-workstation.js` (`notify` 实体注册) | 同上 | COVERED |
| §10 / tech-design：执行终态触发通知（产物产出/执行失败） | `src/services/taskService.js` (`writeExecutionNotification` 在 `executeTask` finally 中调用；success+artifacts → type="artifact"；error → type="execution-failed") | 同上（API 面）+ S2 产物/投递测试回归 | COVERED |
| §10 / tech-design：通道掉线/恢复通知由 S5 真实接入，S3 service 层支持 type="channel-status" | `src/services/notificationService.js` (类型校验接受 channel-status)；S5 负责实际调用 | — | PREPARED |

#### 与 HTML 原型偏差

- 通知中心 UI（侧边栏徽标、列表页、类型配色、产物产出跳转）属 S8 / REQ-NOTIFY-002，本切片仅实现服务层与 API/CLI，UI 尚未接入。偏差：N/A（按计划分层）。

#### 父代理验证记录

- 业务测试验证：`node --test tests/capabilities/information-aggregation/notification/2026-07-19-media-production-line/api/notifications.test.js` → 6/6 pass
- S1/S2 回归测试：共 38/38 pass
- diff 范围检查：仅修改实现代码，未触碰业务测试
- 提交记录：
  - `[build] Slice 3: notification service` (待写入)

Slice 3 标记完成。

---
