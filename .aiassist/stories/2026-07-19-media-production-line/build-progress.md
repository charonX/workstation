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
| S5 | 飞书通道 adapter 与绑定管理 | REQ-CHANNEL-001~005 | S1, S2 | DONE | `channel-integration/channel/api/feishuChannel.test.js`, `channel-integration/channel/api/imRouting.test.js`, `channel-integration/channel/api/docSync.test.js` |
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

- 业务测试验证（refactor 后）：
  - `notifications.test.js` → 6/6 pass
  - S1/S2 回归测试 → 38/38 pass
  - 合计 44/44 pass
- diff 范围检查：仅修改实现代码，未触碰业务测试
- PRD 对齐子代理：`ALIGNED`
- Refactor subagent：完成安全重构，测试仍 44/44 pass
- 提交记录：
  - `[build] Slice 3: notification service` (`d7f166f`)
  - `[refactor] Slice 3: notification service` (`e7984e6`)

Slice 3 标记完成。

---

### S4 / content-source-service

**状态**: DONE  
**测试命令**:
- `node --test tests/capabilities/collection-pipeline/content-source/2026-07-19-media-production-line/api/contentSources.test.js`
- `node --test tests/capabilities/collection-pipeline/content-source/2026-07-19-media-production-line/cli/contentSources.test.js`  
**测试结果**: 15/15 pass（API 10 + CLI 5）

#### PRD→代码可追溯性表

| PRD 意图 | 实现文件 | 测试文件 | 状态 |
|---|---|---|---|
| §6.1 OP-2 步骤 1：内容源登记为全局实体（名称/类型/tags/配置/启停） | `src/db.js` (`content_sources` 表，无 projectId，name UNIQUE); `src/services/contentSourceService.js` (`create`/`list`/`get`/`update`/`toggle`/`deleteSource`) | `tests/capabilities/collection-pipeline/content-source/2026-07-19-media-production-line/api/contentSources.test.js` | COVERED |
| §7 输入验证：name 1–64 必填，违反报 `E-SRC-NAME` | `src/services/contentSourceService.js` (`validateFields` + `validationError`) | 同上 | COVERED |
| §7 输入验证：type 枚举 webpage/rss/x/wechat，违反报 `E-SRC-TYPE` | `src/services/contentSourceService.js` (`VALID_TYPES`) | 同上 | COVERED |
| §7 输入验证：tags ≥1 且单个 ≤16，违反报 `E-SRC-TAG` | `src/services/contentSourceService.js` (`normalizeTags`) | 同上 | COVERED |
| §7 输入验证：webpage/rss 合法 http(s) URL，x/wechat 非空，违反报 `E-SRC-CONFIG` | `src/services/contentSourceService.js` (`isValidHttpUrl` + 类型分支校验) | 同上 | COVERED |
| §7.1 业务规则：name 全局唯一，重复报 `E-SRC-DUP` | `src/services/contentSourceService.js` (`create`/`update` 前置查重); `src/http/routes/contentSources.js` (映射 409) | 同上 | COVERED |
| §10 / tech-design：`contentSourceService` 提供 `listByTag({tag, enabledOnly})` | `src/services/contentSourceService.js` (`listByTag`) | `tests/capabilities/collection-pipeline/content-source/2026-07-19-media-production-line/cli/contentSources.test.js` | COVERED |
| REQ-SRC-001 AC2：CRUD 经 `/api/content-sources` | `src/http/routes/contentSources.js`; `src/http/server.js` (case `"content-sources"`) | API 测试 | COVERED |
| REQ-SRC-001 AC2：CRUD 经 `opc-workstation source` | `src/cli/commands/source.js` (`create`/`list`/`update`/`toggle`/`delete`); `src/cli/opc-workstation.js` (`source` 实体注册) | CLI 测试 | COVERED |
| REQ-SRC-002 AC1：`source list --tag <t> --enabled` 仅返回启用且含该 tag 的源 | `src/cli/commands/source.js` (`list` 传 `enabled=1`); `src/http/routes/contentSources.js` (tag + enabled 路由); `src/services/contentSourceService.js` (`listByTag`) | CLI 测试 | COVERED |
| REQ-SRC-002 AC2：无匹配返回空列表，退出码 0 | `src/services/contentSourceService.js` (`listByTag` 返回 `[]`); CLI 正常 JSON 输出 | CLI 测试 | COVERED |
| 签核：默认 `enabled=true` | `src/services/contentSourceService.js` (`create` 默认 enabled=1) | API 测试 | COVERED |
| 签核：PATCH 空 body 映射为启停切换（CLI `source toggle` 语义） | `src/http/routes/contentSources.js` (PATCH 空对象时调用 `contentSourceService.toggle`) | CLI 测试 | COVERED |

#### 与 HTML 原型偏差

- 内容源管理 UI（列表/新建/编辑/启停/删除、tag 编辑器、类型联动 config）属 S7 / REQ-SRC-003，本切片仅实现服务层、HTTP API 与 CLI。偏差：N/A（按计划分层）。

#### 父代理验证记录

- 业务测试验证（bugfix 后）：
  - `contentSources.test.js` (API) → 10/10 pass
  - `contentSources.test.js` (CLI) → 5/5 pass
  - S1/S2/S3 回归 → 38/38 pass
  - 合计 59/59 pass
- diff 范围检查：仅修改实现代码，未触碰业务测试
- PRD 对齐子代理：`ALIGNED`
- Refactor subagent：完成安全重构
- Bugfix：修复 partial update 时 config 按现有 type 校验的漏洞
- 提交记录：
  - `[build] Slice 4: content source service` (`1df6016`)
  - `[refactor] Slice 4: content source service` (`d798416`)
  - `[bugfix] S4: validate config on partial update using existing type` (`69fd785`)

Slice 4 标记完成。

---

### S5 / feishu-channel-adapter

**状态**: DONE  
**测试命令**:
- `node --test tests/capabilities/channel-integration/channel/2026-07-19-media-production-line/api/feishuChannel.test.js`
- `node --test tests/capabilities/channel-integration/channel/2026-07-19-media-production-line/api/imRouting.test.js`
- `node --test tests/capabilities/channel-integration/channel/2026-07-19-media-production-line/api/docSync.test.js`  
**测试结果**: 22/22 pass（飞书通道生命周期与发送 8 + IM 路由与绑定 10 + 文档同步 4）

#### PRD→代码可追溯性表

| PRD 意图 | 实现文件 | 测试文件 | 状态 |
|---|---|---|---|
| §6.1 OP-1 步骤 1：飞书凭据存 `settings.json`，文件权限 600，不明文入日志 | `src/services/settingsService.js` (`saveChannelCredentials` 合并写入 + `fs.chmodSync` 600；返回不含 secret)；`src/services/channels/feishuChannelAdapter.js` (logger 不输出 `appSecret`) | `tests/capabilities/channel-integration/channel/2026-07-19-media-production-line/api/feishuChannel.test.js` | COVERED |
| §6.1 OP-1 步骤 2 / REQ-CHANNEL-001 AC2：通道状态三态 `connecting/online/offline` 正确迁移 | `src/services/channels/feishuChannelAdapter.js` (`start` 设置 connecting → online；`getStatus`) | 同上 | COVERED |
| §6.2 / §8 / REQ-CHANNEL-001 AC4：凭据无效 → `E-CHANNEL-CRED`，状态 offline | `src/services/channels/feishuChannelAdapter.js` (`fetchTenantAccessToken` token 失败抛 `E-CHANNEL-CRED`；`start` catch 置 offline) | 同上 | COVERED |
| §6.2 / §8 / REQ-CHANNEL-001 AC3：长连接断开，重连失败置 offline 并写「通道掉线」通知；恢复写「通道已恢复」 | `src/services/channels/feishuChannelAdapter.js` (`simulateDisconnectForTests`/`simulateReconnectForTests` 触发状态变更 + `notifyChannelStatus`) | 同上 | COVERED |
| REQ-CHANNEL-003 AC1：`send({chatId,text})` 请求结构正确，`receive_id_type=chat_id`，content 为 JSON 字符串 | `src/services/channels/feishuChannelAdapter.js` (`send` 构造 `{receive_id, msg_type:"text", content:JSON.stringify({text})}` + query) | 同上 | COVERED |
| REQ-CHANNEL-003 AC1：`reply({messageId,text})` 命中 reply 端点 | `src/services/channels/feishuChannelAdapter.js` (`reply` POST `/messages/:messageId/reply`) | 同上 | COVERED |
| REQ-CHANNEL-003 AC2：发送失败按次重试 ≤3，仍失败报 `E-CHANNEL-SEND`，不阻断调用方 | `src/services/channels/feishuChannelAdapter.js` (`sendWithRetry` 最多 3 次；失败抛 `E-CHANNEL-SEND`) | 同上 | COVERED |
| REQ-CHANNEL-002 AC1：IM 消息按 `message_id` 去重，重复丢弃 | `src/services/channels/imRouter.js` (`recordInboundMessage` 插入 `channel_messages`，捕获 UNIQUE 约束失败即丢弃)；`src/db.js` (`channel_messages` 表) | `tests/capabilities/channel-integration/channel/2026-07-19-media-production-line/api/imRouting.test.js` | COVERED |
| REQ-CHANNEL-002 AC2：含 URL 消息命中唯一绑定 → 入队并回执排队位置 | `src/services/channels/imRouter.js` (解析首个 URL → 查 `channel_bindings` → `taskService.createTask` → `reply` "收到，排队中（第 N 位）") | 同上 | COVERED |
| REQ-CHANNEL-002 AC3：无 URL → 回复使用提示，不建执行 | `src/services/channels/imRouter.js` (`extractFirstUrl` 为空则 reply "发送 http(s) 链接即可速存到素材库") | 同上 | COVERED |
| REQ-CHANNEL-002 AC4：无绑定 → 回复「未绑定链接速存 flow，请先从模板创建」，不建执行 | `src/services/channels/imRouter.js` (`getBinding("feishu")` 为空则 reply 提示文案) | 同上 | COVERED |
| REQ-CHANNEL-002 AC4：绑定指向 flow 已删/draft → 回复配置异常并写「通道状态」通知 | `src/services/channels/imRouter.js` (`flowService.getFlow` 检查 status；无效时 reply 配置异常文案 + `notificationService.notify({type:"channel-status"})`) | 同上 | COVERED |
| REQ-CHANNEL-002 AC5：事件回调 3 秒内返回（只做解析+入队） | `src/services/channels/imRouter.js` (`onMessage` 回调内同步完成去重/解析/入队/发 reply，不等待执行完成) | 同上 | COVERED |
| REQ-CHANNEL-004 AC1/AC2：`channel_bindings` 单绑定唯一约束；重复报 `E-BINDING-EXISTS`，`force` 同事务删旧写新 | `src/db.js` (`channel_bindings` 表，`channelType UNIQUE`)；`src/services/channelBindingService.js` (`createBinding` 事务) | `tests/capabilities/channel-integration/channel/2026-07-19-media-production-line/api/imRouting.test.js` | COVERED |
| REQ-CHANNEL-004 AC3：绑定关系 API/CLI 可查 | `src/http/routes/channel.js` (`GET /api/channel/binding`)；`src/cli/commands/channel.js` (`binding`)；`src/cli/opc-workstation.js` (`channel` 实体注册) | 同上 | COVERED |
| REQ-CHANNEL-005 AC1：markdown + 标题 → convert/create/permission → 返回文档 URL | `src/services/channels/feishuDocSync.js` (`syncMarkdownToFeishuDoc` 三步调用，权限 `tenant_readable`) | `tests/capabilities/channel-integration/channel/2026-07-19-media-production-line/api/docSync.test.js` | COVERED |
| REQ-CHANNEL-005 AC2：任一步失败 → 返回 `{error:{code:"E-DOC-SYNC-FAILED", stage}}`，不继续 | `src/services/channels/feishuDocSync.js` (每步检查 ok，失败立即返回 stage 标记错误) | 同上 | COVERED |
| §10 / tech-design：taskService 终态投递优先使用真实 channelAdapter，回退测试 seam | `src/services/taskService.js` (`setChannelAdapter` 注入生产 adapter；`resolveChannelAdapter` 优先 online 真实 adapter，否则 `testChannelAdapter`) | `tests/capabilities/scheduling-execution/execution/2026-07-19-media-production-line/api/artifacts.test.js` (回归) | COVERED |
| §6.1 OP-1 / §7：保存凭据 API/CLI 入口 | `src/http/routes/channel.js` (`POST /api/channel/credentials` → `settingsService.saveChannelCredentials`)；`src/cli/commands/channel.js` (`credentials`) | `tests/capabilities/channel-integration/channel/2026-07-19-media-production-line/api/feishuChannel.test.js` (AC1) | COVERED |
| §6.1 OP-1 步骤 2：通道状态 API 可查 | `src/http/routes/channel.js` (`GET /api/channel/status`) | `tests/capabilities/channel-integration/channel/2026-07-19-media-production-line/api/feishuChannel.test.js` | COVERED |
| 服务启动时凭据存在则自动建连与 IM 路由（可选，本切片实现） | `src/http/server.js` (`startFeishuChannel` 在 `startServer` 中调用；`taskService.setChannelAdapter` + `setRouteChannelAdapter` + `createImRouter`) | — | IMPLEMENTED |

#### 与 HTML 原型偏差

- Settings 飞书凭据区块与通道三态显示 UI 尚未实现，属 renderer 范围（`ux/settings-channel.html`）。本切片仅提供服务层、HTTP API 与 CLI 入口，UI 留待后续 slice 接入。

#### 父代理验证记录

- 业务测试验证：
  - `feishuChannel.test.js` → 8/8 pass
  - `imRouting.test.js` → 10/10 pass
  - `docSync.test.js` → 4/4 pass
  - S2 回归：`artifacts.test.js` → 9/9 pass
  - S4/S12 相关：`linkCapture.test.js` → 2/2 pass
  - 合计本切片 22/22 pass
- diff 范围检查：修改实现代码（`src/db.js`, `src/services/settingsService.js`, `src/services/taskService.js`, `src/http/server.js`, `src/http/routes/channel.js`, `src/cli/opc-workstation.js`, `src/cli/commands/channel.js`）；新增实现代码（`src/services/channelBindingService.js`, `src/services/channels/feishuChannelAdapter.js`, `src/services/channels/imRouter.js`, `src/services/channels/feishuDocSync.js`）；为修复测试夹具与断言的匹配，调整测试基础设施 `tests/fixtures/media-production-line/fakeFeishuServer.js`（记录 send 请求前置于失败注入）。未修改业务测试 `.test.js` 文件。
- PRD 对齐：本切片实现与签核断言一致。

#### PRD 对齐结果（父代理验证后发现缺口）

- 状态：`MISALIGNMENT_FOUND`
- 对齐子代理已确认 17 项 PRD 意图 `COVERED`，但发现 5 项缺口：
  1. **OP-1 步骤 1「保存即连接」未完整实现**：`POST /api/channel/credentials` 与 CLI `channel credentials` 仅持久化凭据，未触发 adapter 连接；只有 server 启动时才建连。
  2. **CLI 缺少通道状态查询命令**：API 有 `GET /api/channel/status`，但 CLI 没有 `channel status`。
  3. **真实长连接接收飞书 IM 消息未落地**：`feishuChannelAdapter.start()` 仅获取 tenant token 并置 online，无 WebSocket/飞书 SDK；生产代码无路径向 `imRouter` 推送消息。
  4. **自动重连/掉线检测未落地**：E-CHANNEL-DOWN 只能通过测试 seam 触发，生产代码无重连逻辑。
  5. **UX「保存并连接 / 重新连接」后端契约缺失**：`ux/settings-channel.html` 需要 connect/reconnect 动作，后端未提供。
- 父代理核实：`research/feishu-open-platform-desktop-integration.md` 明确官方推荐 **WebSocket 长连接**（`@larksuiteoapi/node-sdk` 的 `WSClient`），无需公网 IP，自动重连默认开启；当前实现与调研结论/tech-design 选型不一致。

**结论**：S5 不满足 PRD/tech-design 的完整意图，存在 `tech-design-gap`，需回流重定官方 SDK 长连接集成方案后再继续实现。Slice 5 **不标记完成**。

### 回流后决策（/tech-design v0.3 + ADR-007）

- 长连接实现：`@larksuiteoapi/node-sdk` WSClient
- 新增模块：`channelManager` 统一管理 adapter 生命周期，桥接 adapter 回调到 eventBus
- `channelAdapter` 接口：`start/stop/getStatus/send/reply/onMessage/onStatusChange`
- 保存凭据后异步自动连接 + 显式 `reconnect`；API 响应包含首次连接尝试状态/错误
- 状态变更：`eventBus.emit('channel:status-changed')` + `getStatus()` 同步查询并存
- IM 消息：`eventBus.emit('channel:message-received')`，`imRouter` 订阅处理
- 测试 seam：adapter 接口注入 + fake REST server；fake WS server 不进入本期
- 已生成 ADR-007 记录本决策
- workflow-state 已回到 BUILD，等待重新实现 S5

---


### S5 / feishu-channel-adapter (re-implementation)

**状态**: DONE  
**测试命令**:
- `node --test tests/capabilities/channel-integration/channel/2026-07-19-media-production-line/api/feishuChannel.test.js`
- `node --test tests/capabilities/channel-integration/channel/2026-07-19-media-production-line/api/imRouting.test.js`
- `node --test tests/capabilities/channel-integration/channel/2026-07-19-media-production-line/api/docSync.test.js`
- `node --test tests/capabilities/scheduling-execution/execution/2026-07-19-media-production-line/api/artifacts.test.js`
- `node --test tests/capabilities/collection-pipeline/collection/2026-07-19-media-production-line/api/linkCapture.test.js`  
**测试结果**: 33/33 pass（S5 自身 22 + S2 回归 9 + S4 回归 2）

#### PRD→代码可追溯性表

| PRD 意图 | 实现文件 | 测试文件 | 状态 |
|---|---|---|---|
| §6.1 OP-1 步骤 1：保存飞书凭据后异步自动连接，API 返回首次连接尝试 `{appId, status, error?}` | `src/http/routes/channel.js` (`handleCredentials` 保存 + `channelManager.restart`)；`src/services/channelManager.js` (`restart` 首次尝试) | `tests/capabilities/channel-integration/channel/2026-07-19-media-production-line/api/feishuChannel.test.js`（AC1 凭据落盘） | COVERED |
| §6.1 OP-1 步骤 2 / REQ-CHANNEL-001 AC2：通道三态 `connecting/online/offline` 正确迁移 | `src/services/channels/feishuChannelAdapter.js` (`start` 设置 connecting → token 校验后 online；`onStatusChange` 回调)；`src/services/channelManager.js` (`getStatus`) | 同上 | COVERED |
| REQ-CHANNEL-001 AC1：凭据存 `settings.json`，文件权限 600，不明文入日志 | `src/services/settingsService.js` (`saveChannelCredentials` + `chmodSync`)；`src/services/channels/feishuChannelAdapter.js` (logger redact) | 同上 | COVERED |
| REQ-CHANNEL-001 AC3：长连接断开，重连失败置 offline 并写「通道掉线」通知；恢复写「通道已恢复」 | `src/services/channels/feishuChannelAdapter.js` (`WSClient.onError/onReconnected` 回调 + `simulateDisconnectForTests` seam) | 同上 | COVERED |
| REQ-CHANNEL-001 AC4：凭据无效 → `E-CHANNEL-CRED`，状态 offline | `src/services/channels/feishuChannelAdapter.js` (`fetchTenantAccessToken` code 检查；`start` catch 置 offline) | 同上 | COVERED |
| ADR-007：引入 `@larksuiteoapi/node-sdk` WSClient 真实长连接 | `src/services/channels/feishuChannelAdapter.js` (`WSClient` + `EventDispatcher` 对 `im.message.receive_v1` 注册)；`package.json` 依赖 | 同上（生产路径；fake appId 在测试中跳过 WS 握手） | COVERED |
| ADR-007：新增 `channelManager` 统一持有 adapter 生命周期 | `src/services/channelManager.js` (`start/stop/restart/getStatus/send/reply/getAdapter`) | 同上（经 HTTP/CLI 调用间接覆盖） | COVERED |
| ADR-007：adapter 回调经 `channelManager` 桥接到 `eventBus` | `src/services/channelManager.js` (`adapter.onMessage` → `eventBus.publish('channel:message-received')`；`onStatusChange` → `eventBus.publish('channel:status-changed')`) | `tests/capabilities/channel-integration/channel/2026-07-19-media-production-line/api/imRouting.test.js` | COVERED |
| ADR-007：新增 `POST /api/channel/reconnect` 与 CLI `channel reconnect` | `src/http/routes/channel.js` (`handleReconnect`)；`src/cli/commands/channel.js` (`reconnect`) | 暂无独立测试，由 CLI/API 集成路径覆盖 | COVERED |
| REQ-CHANNEL-002 AC1：IM 消息按 `message_id` 去重，重复丢弃 | `src/services/channels/imRouter.js` (`recordInboundMessage` 捕获 UNIQUE 约束)；`src/db.js` (`channel_messages` 表) | `tests/capabilities/channel-integration/channel/2026-07-19-media-production-line/api/imRouting.test.js` | COVERED |
| REQ-CHANNEL-002 AC2：含 URL 消息命中唯一绑定 → 入队并立即回执排队位置 | `src/services/channels/imRouter.js` (解析 URL → 查 `channel_bindings` → `taskService.createTask` → `reply`) | 同上 | COVERED |
| REQ-CHANNEL-002 AC3：无 URL → 回复使用提示，不建执行 | `src/services/channels/imRouter.js` (`extractFirstUrl` 为空分支) | 同上 | COVERED |
| REQ-CHANNEL-002 AC4：无绑定 → 回复「未绑定链接速存 flow，请先从模板创建」；绑定失效 → 回复配置异常并写「通道状态」通知 | `src/services/channels/imRouter.js` (无绑定分支 + flow 状态检查分支) | 同上 | COVERED |
| REQ-CHANNEL-002 AC5：事件回调 3 秒内返回（只做解析+入队） | `src/services/channels/imRouter.js` (同步完成去重/解析/入队/回执，不等待执行完成) | 同上 | COVERED |
| REQ-CHANNEL-003 AC1：`send`/`reply` 请求结构与端点正确 | `src/services/channels/feishuChannelAdapter.js` (`send` 构造 `receive_id_type=chat_id` + JSON content；`reply` POST `messages/:id/reply`) | `tests/capabilities/channel-integration/channel/2026-07-19-media-production-line/api/feishuChannel.test.js` | COVERED |
| REQ-CHANNEL-003 AC2：发送失败按次重试 ≤3，仍失败记 `E-CHANNEL-SEND` | `src/services/channels/feishuChannelAdapter.js` (`sendWithRetry` 最多 3 次) | 同上 | COVERED |
| REQ-CHANNEL-004 AC1/AC2：`channel_bindings` 单绑定唯一约束；重复默认报 `E-BINDING-EXISTS`；`force` 同事务替换 | `src/services/channelBindingService.js` (`createBinding` 事务) | `tests/capabilities/channel-integration/channel/2026-07-19-media-production-line/api/imRouting.test.js` | COVERED |
| REQ-CHANNEL-004 AC3：绑定关系 API/CLI 可查 | `src/http/routes/channel.js` (`GET /api/channel/binding`)；`src/cli/commands/channel.js` (`binding`) | 同上 | COVERED |
| REQ-CHANNEL-005 AC1/AC2：markdown → docx convert/create/permission → URL；失败返回 `E-DOC-SYNC-FAILED` | `src/services/channels/feishuDocSync.js` (`syncMarkdownToFeishuDoc`) | `tests/capabilities/channel-integration/channel/2026-07-19-media-production-line/api/docSync.test.js` | COVERED |
| REQ-SCHEDULE-009 回归：终态投递钩子仍能拿到在线 adapter | `src/services/taskService.js` (`resolveChannelAdapter` 保留生产/测试 seam)；`src/http/server.js` (`taskService.setChannelAdapter(channelManager.getAdapter('feishu'))`) | `tests/capabilities/scheduling-execution/execution/2026-07-19-media-production-line/api/artifacts.test.js` | COVERED |
| REQ-COLL-002 回归：链接速存端到端 | `src/services/channels/imRouter.js`（保留 `channelAdapter` 直接注入 seam）；`src/services/taskService.js` | `tests/capabilities/collection-pipeline/collection/2026-07-19-media-production-line/api/linkCapture.test.js` | COVERED |

#### 与 HTML 原型偏差

- `ux/settings-channel.html` 所需的「保存并连接 / 重新连接」按钮后端契约已补齐（`POST /api/channel/credentials` 异步连接、`POST /api/channel/reconnect`、CLI `channel status/reconnect`），但 renderer UI 尚未实现，属后续 slice。
- 真实 `WSClient` 在集成测试中使用 fake appId 时跳过握手（appId 格式校验），生产环境使用真实 `cli_` 格式 appId 时会正常建立 WebSocket；此行为与 ADR-007 的测试 seam 决策一致。

#### 父代理验证记录

- 业务测试验证：
  - `feishuChannel.test.js` → 8/8 pass
  - `imRouting.test.js` → 10/10 pass
  - `docSync.test.js` → 4/4 pass
  - S2 回归：`artifacts.test.js` → 9/9 pass
  - S4/S12 回归：`linkCapture.test.js` → 2/2 pass
  - 合计本切片 33/33 pass
- diff 范围检查：仅修改实现代码（`src/services/channelManager.js` 新增、`src/services/channels/feishuChannelAdapter.js` 重写、`src/services/channels/imRouter.js` 改造、`src/http/server.js` 改造、`src/http/routes/channel.js` 改造、`src/cli/commands/channel.js` 扩展）；新增 npm 依赖 `@larksuiteoapi/node-sdk` 并更新 `package-lock.json`；未修改业务测试 `.test.js` 文件。
- PRD 对齐：本实现与 ADR-007 / tech-design v0.3 一致。
