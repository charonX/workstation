# Signoff — 2026-07-19-media-production-line

> ✅ **attempt-3 重新签核完成（2026-07-21）**：用户确认 `feishuMessage` 触发节点输出语义从「解析 URL」改为「原始 text/sender/messageId」；IM 路由层不再解析 URL，由下游 skill/agent 从 `text` 中提取。下方表格为 attempt-2 历史记录，仅作追溯；本次 Assertion Signoff 覆盖 attempt-3 更新后的 REQ/测试契约。

## Assertion Signoff

**日期**：2026-07-21
**签核人**：用户（重新签核）

### REQ 覆盖

| REQ-ID | 标题 | 测试文件 | 签核状态 |
|---|---|---|---|
| REQ-WORKSPACE-008 | 统一 DB 路径 | `workspace-management/server/api/server.test.js` | ✅ |
| REQ-WORKSPACE-009 | 单 server 顶替 | `workspace-management/server/api/server.test.js` | ✅ |
| REQ-WORKSPACE-010 | 旧库迁移 | `workspace-management/server/api/server.test.js` | ✅ |
| REQ-SCHEDULE-005 | 调度接通 | `scheduling-execution/schedule/api/scheduleTriggers.test.js` | ✅ |
| REQ-SCHEDULE-006 | schedule 变量 | `scheduling-execution/schedule/api/scheduleTriggers.test.js` | ✅ |
| REQ-SCHEDULE-007 | 执行队列 | `scheduling-execution/execution/api/executionQueue.test.js` | ✅ |
| REQ-SCHEDULE-008 | 产物登记 | `scheduling-execution/execution/api/artifacts.test.js` | ✅ |
| REQ-SCHEDULE-009 | 终态投递钩子 | `scheduling-execution/execution/api/artifacts.test.js` | ✅ |
| REQ-FLOW-029 | trigger 注入变量覆盖 | `flow-orchestration/flow-engine/api/triggerVariables.test.js` | ✅ |
| REQ-FLOW-030 | Executions 产物 tab 与打开动作 | `flow-orchestration/execution/api/artifactOpenPath.test.js`<br>`flow-orchestration/execution/e2e/artifactsTab.test.cjs` | ✅ |
| REQ-FLOW-031 | 飞书消息触发节点 | `flow-orchestration/flow-engine/api/feishuMessageNode.test.js`<br>`flow-orchestration/flow-engine/e2e/feishuMessageNode.test.cjs` | ✅ |
| REQ-CHANNEL-001 | 飞书通道生命周期 | `channel-integration/channel/api/feishuChannel.test.js` | ✅ |
| REQ-CHANNEL-002 | IM 接收、去重与路由 | `channel-integration/channel/api/imRouting.test.js` | ✅ |
| REQ-CHANNEL-003 | 通道发送 | `channel-integration/channel/api/feishuChannel.test.js` | ✅ |
| REQ-CHANNEL-004 | 通道绑定管理 | `channel-integration/channel/api/imRouting.test.js` | ✅ |
| REQ-CHANNEL-005 | 飞书文档同步端点 | `channel-integration/channel/api/docSync.test.js` | ✅ |
| REQ-SRC-001 | 内容源 CRUD | `collection-pipeline/content-source/api/contentSources.test.js`<br>`collection-pipeline/content-source/cli/contentSources.test.js` | ✅ |
| REQ-SRC-002 | tag 筛选查询 | `collection-pipeline/content-source/cli/contentSources.test.js` | ✅ |
| REQ-SRC-003 | 内容源管理 UI | `collection-pipeline/content-source/e2e/sourcesPage.test.cjs` | ✅ |
| REQ-COLL-001 | 场景 A · 定时日报端到端 | `collection-pipeline/collection/api/dailyDigest.test.js` | ✅ |
| REQ-COLL-002 | 场景 B · 链接速存端到端 | `collection-pipeline/collection/api/linkCapture.test.js` | ✅ | 2026-07-21 随稳定块 12 回流更新测试：flow 首节点改为 `feishuMessage` |
| REQ-COLL-003 | 收集 skill 包与安全约束 | `collection-pipeline/collection/api/collectionSkills.test.js` | ✅ |
| REQ-TPL-001 | 模板实例化 | `collection-pipeline/template/api/templates.test.js` | ✅ |
| REQ-NOTIFY-001 | 通知服务 | `information-aggregation/notification/api/notifications.test.js` | ✅ |
| REQ-NOTIFY-002 | 通知中心 UI | `information-aggregation/notification/e2e/notificationCenter.test.cjs` | ✅ |

（测试文件均位于 `tests/capabilities/` 下，目录含 story-id `2026-07-19-media-production-line`。）

### 检查清单

- [x] 不存在未关闭的 `prd-gap-report.md`
- [x] PRD 第 6-8 节已覆盖或已声明 N/A
- [x] 每个 REQ-ID 都有对应测试（25/25）
- [x] 每个测试文件都有 `REQ-TRACE`、`REQ-VERSION`、`CAPABILITY-TRACE`、`ENTITY-TRACE`
- [x] 每个 REQ 的 capability/entity 与 `business-capabilities.md` 一致
- [x] 无 `// TODO: HUMAN ASSERTION` 占位（50 处全部落地清零）
- [x] 预期值来源清晰，非代码输出（人签核，见下方决策记录）
- [x] 无快照当判定依据
- [x] 边界/错误 case 已覆盖
- [x] `signoff.md` Assertion 部分已创建

### 关键签核决策

1. **draft 日志码统一**：`E-SCHED-FLOW-INVALID`（REQ 与 tech-design 冲突项，已与 PRD 对齐）。
2. **E-SRC-DUP 状态码**：**409 Conflict**（资源冲突语义）。
3. **通知 E2E 播种**：**DB 直写**（`tests/e2e/helpers/notifications.cjs`），不开放 `POST /api/notifications` 写入面。
4. **§5 建议预期值整体批准**：回执「收到，排队中（第 N 位）」「队列已满，稍后再发」；模板 id `daily-digest`/`link-capture`；通知 API 面 `{items, unreadCount}` + `POST :id/read` + `POST read-all`；CLI `--tags` 逗号分隔、`task get --id`、`channel binding`、`notify list/read`、`template list/instantiate`；码值 `E-QUEUE-FULL`、`E-SERVER-TAKEOVER-TIMEOUT`、`E-DB-UNWRITABLE`；日报文件名 `outputs/daily/<date>-<topic-slug>.md`；索引文件 `materials/LIBRARY.md`；docSync 失败契约 `{error:{code:"E-DOC-SYNC-FAILED", stage}}`。
5. **全等文案断言**（绑定失效提示）：BUILD 必须逐字一致，属硬约束。IM 消息无 URL 的处理已下沉到下游 skill/agent，不再作为路由层硬约束文案。

### 遗留问题

- **既有缺陷**：`POST /api/schedules` 收非法 cron 时不校验，`writeHead(201)` 后抛错导致 `ERR_HTTP_HEADERS_SENT` 响应挂起（test-plan §5 已记录）。→ 进 bug 循环处理；REQ-SCHEDULE-006 落地后该用例按 400 断言。
- 通知 E2E 播种 helper 未经运行时验证（依赖 Electron 主进程 ESM import better-sqlite3），首次 E2E 若失败改经 src/db.js 路径 import。
- E2E 未实际运行（需 `rebuild:electron`，属 QA 阶段）。

### attempt-3 重新签核决策

2026-07-21 用户重新签核确认以下变更（原 attempt-2 签核作废）：

1. **REQ-FLOW-031 输出语义**：`feishuMessage` 节点固定输出 `text`/`sender`/`messageId`（不可删除/重命名，可改 defaultValue）；不再在节点层解析 URL。
2. **REQ-CHANNEL-002 路由语义**：IM 路由层只透传原始 `text/sender/messageId`；**URL 等业务解析不在路由层做**；无 URL 的任意文本消息也正常入队。
3. **REQ-TPL-001 模板语义**：链接速存模板首节点为 `feishuMessage`，固定输出 `text`/`sender/messageId`。
4. **下游职责**：链接抓取/URL 提取由 `fetch-to-markdown` skill 或下游 agent 从 `text` 中自行完成；失败原因 `E-MSG-NO-URL` / `E-FETCH-FAILED` 由 skill 决定。
5. **签核历史**：attempt-2 的 Assertion Signoff 已作废；本次为 attempt-3 重新签核后的 Assertion Signoff。

`requirements.md` v1.2 hash：`aeebbee331c0863144ca7b891e8faf8da12fde2bfbceb0ad525049febf3f1d48`（已签核）。
