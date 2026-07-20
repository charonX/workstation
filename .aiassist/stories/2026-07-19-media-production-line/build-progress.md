# BUILD Progress — 2026-07-19-media-production-line

> 父代理调度记录。每个 slice 完成后追加可追溯性声明。
> Story: 媒体生产线 · 收集管线
> Phase: BUILD (attempt 1)

---

## 切片计划

| Slice | 名称 | REQ-ID | 依赖 | 状态 | 测试文件 |
|---|---|---|---|---|---|
| S1 | Workspace/Server 基础与 DB 改造 | REQ-WORKSPACE-008~010 | 无 | done | `workspace-management/server/api/server.test.js` |
| S2 | 调度器、Schedule 变量与 Trigger 注入 | REQ-SCHEDULE-005~006, REQ-FLOW-029 | S1 | pending | `scheduling-execution/schedule/api/scheduleTriggers.test.js`, `flow-orchestration/flow-engine/api/triggerVariables.test.js` |
| S3 | 执行队列、产物登记与终态投递钩子 | REQ-SCHEDULE-007~009 | S1, S2 | pending | `scheduling-execution/execution/api/executionQueue.test.js`, `scheduling-execution/execution/api/artifacts.test.js` |
| S4 | 通知中心服务与 API/CLI | REQ-NOTIFY-001 | S1, S3 (事件源) | pending | `information-aggregation/notification/api/notifications.test.js` |
| S5 | 内容源服务与 API/CLI | REQ-SRC-001~002 | S1 | pending | `collection-pipeline/content-source/api/contentSources.test.js`, `collection-pipeline/content-source/cli/contentSources.test.js` |
| S6 | 飞书通道 adapter 与绑定管理 | REQ-CHANNEL-001~005 | S1, S3 | pending | `channel-integration/channel/api/feishuChannel.test.js`, `channel-integration/channel/api/imRouting.test.js`, `channel-integration/channel/api/docSync.test.js` |
| S7 | Execution 产物 tab 与打开动作 | REQ-FLOW-030 | S1, S3 | pending | `flow-orchestration/execution/api/artifactOpenPath.test.js`, `flow-orchestration/execution/e2e/artifactsTab.test.cjs` |
| S8 | 内容源管理 UI | REQ-SRC-003 | S1, S5 | pending | `collection-pipeline/content-source/e2e/sourcesPage.test.cjs` |
| S9 | 通知中心 UI | REQ-NOTIFY-002 | S1, S4 | pending | `information-aggregation/notification/e2e/notificationCenter.test.cjs` |
| S10 | 收集 skill 包 | REQ-COLL-003 | 无（依赖 skillService） | pending | `collection-pipeline/collection/api/collectionSkills.test.js` |
| S11 | 模板实例化 | REQ-TPL-001 | S1, S5, S6 | pending | `collection-pipeline/template/api/templates.test.js` |
| S12 | 场景 A · 定时日报端到端 | REQ-COLL-001 | S2, S3, S4, S6, S10 | pending | `collection-pipeline/collection/api/dailyDigest.test.js` |
| S13 | 场景 B · 链接速存端到端 | REQ-COLL-002 | S3, S4, S6, S10 | pending | `collection-pipeline/collection/api/linkCapture.test.js` |

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

---

