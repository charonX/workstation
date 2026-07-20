# 需求契约 — 媒体生产线 · 收集管线

> 故事 ID：`2026-07-19-media-production-line`
> 来源：`prd.md` v0.4 + `tech-design.md` v0.2（REQ-ID 沿用项目既有域前缀约定，与 business-capabilities.md 一致）
> 版本：v1（2026-07-19）

---

## REQ-WORKSPACE-008 统一 DB 路径

- 优先级 P0 / 必须 / intra-module / db, cli / workspace-management / server / 集成
- 验收标准：
  1. `defaultDbPath()` 未显式传参时返回 `~/.opc-workstation/data.db`；`:memory:` 仅在显式传入时使用。
  2. CLI 自起 headless server 后，该文件真实存在；执行一次 flow 后重启查询，执行记录仍在。
- 边界与错误：目录不可写 → server 启动失败并报 `E-DB-UNWRITABLE`。
- seam/测试：`tests/capabilities/workspace-management/server/2026-07-19-media-production-line/api/`（临时 HOME 目录）。

## REQ-WORKSPACE-009 单 server 顶替

- 优先级 P0 / 必须 / cross-module / serverRegistry, electron main, http server / workspace-management / server / 集成
- 接口契约：tech-design「模块与边界」+ ADR-006；shutdown 握手（发现既有 server 存活 → 请求其退出 → 接管注册表）。
- 验收标准：
  1. 常驻 headless 运行中启动 App：旧 server 收到 shutdown 并退出，注册表最终只有 App server 一条活跃记录。
  2. 顶替完成后调度器与飞书通道只在新 server 注册（无双重注册）。
  3. 旧 server 拒不退让（超时）→ App 侧报错提示，不双跑。
- 边界与错误：顶替期间到达的 cron tick 至多触发一次（无双触发）。
- seam/测试：同上目录（双进程集成）。

## REQ-WORKSPACE-010 旧库迁移

- 优先级 P1 / 必须 / intra-module / db, electron main / workspace-management / server / 集成
- 验收标准：
  1. App 启动检测旧 `userData/data.db` 存在且 `~/.opc-workstation/data.db` 不存在 → 复制（非移动）→ 原有 projects/flows/executions 可查。
  2. 迁移结果写入结构化日志（含源/目标路径与耗时，不含数据内容）。
  3. 新路径已存在时不迁移、不覆盖。
- seam/测试：同上目录（临时目录模拟双路径）。

## REQ-SCHEDULE-005 调度接通

- 优先级 P0 / 必须 / cross-module / schedulerService, taskService, eventBus / scheduling-execution / schedule / 单元+集成
- 接口契约：tech-design「schedulerService」「taskService.createTask」。
- 验收标准：
  1. server 启动 `loadAll()` 为全部 enabled schedule 注册 node-cron 任务。
  2. 到点 publish `schedule:triggered`，payload 为 `{projectId, flowId, variables}`；taskService 订阅者创建 execution（`trigger="schedule"`，status=queued）。
  3. schedule CRUD 成功后同进程调用 `upsert`/`remove` 同步 node-cron 任务（不经 eventBus）。
  4. 到点时 flow 为 draft/已删 → 不建执行，记日志 `E-SCHED-FLOW-INVALID`；manual 触发不受 draft 限制（用已发布快照）；debug 走 `debugFlow`，语义不变。
  5. server 未运行期间的到点不补偿。
- seam/测试：`tests/capabilities/scheduling-execution/schedule/2026-07-19-media-production-line/api/`（短周期 cron 注入）。

## REQ-SCHEDULE-006 schedule 变量

- 优先级 P0 / 必须 / intra-module / db, taskService / scheduling-execution / schedule / 单元+集成
- 验收标准：
  1. `schedules` 表新增 `variables` JSON 列，CRUD 透传；非法 cron 报 `E-SCHED-CRON`。
  2. 触发时 variables 注入 execution.variables。
- seam/测试：同上目录。

## REQ-SCHEDULE-007 执行队列

- 优先级 P0 / 必须 / intra-module / executionQueue, taskService / scheduling-execution / execution / 集成
- 接口契约：tech-design「executionQueue」。
- 验收标准：
  1. 同一 projectId 的执行严格串行；不同 projectId 可并行；`getPosition` 返回正确排队位置。
  2. 单 project 排队上限 50，超出拒绝并返回"队列已满"（通道场景回执该文案）。
  3. server 启动时将 status∈{queued,running} 的 execution 标记 error（reason=server-restart），不重跑。
  4. 单个执行抛错不影响队列后续执行。
- seam/测试：`tests/capabilities/scheduling-execution/execution/2026-07-19-media-production-line/api/`。

## REQ-SCHEDULE-008 产物登记

- 优先级 P0 / 必须 / intra-module / taskService, db / scheduling-execution / execution / 集成
- 验收标准：
  1. `executions` 表新增 `artifacts` JSON 列；执行成功且产出文件时登记相对/绝对路径列表。
  2. 执行失败不登记半成品文件。
  3. 执行详情 API/CLI 返回 artifacts。
- seam/测试：同上目录。

## REQ-SCHEDULE-009 终态投递钩子

- 优先级 P0 / 必须 / cross-module / taskService, channelAdapter / scheduling-execution / execution / 集成
- 接口契约：tech-design「系统层投递规则」。
- 验收标准：
  1. execution 到终态时，若 `variables.channelReply={channelType, chatId, messageId}` 存在 → 调 `channelAdapter.send` 发送模板消息（成功：产物路径/文档链接；失败：错误摘要）。
  2. 无 `channelReply` 时不投递。
  3. 投递失败不反转 execution 终态，记告警日志。
  4. agent 节点实现不参与消息发送（代码结构断言）。
- seam/测试：同上目录（mock channelAdapter）。

## REQ-FLOW-029 trigger 注入变量覆盖

- 优先级 P0 / 必须 / intra-module / flowEngine / flow-orchestration / flow-engine / 单元
- 验收标准：
  1. trigger 节点执行时，`createTask` 注入的 variables 覆盖 `config.outputVariables[].defaultValue`；未注入的变量仍用默认值。
  2. 注入变量对下游节点按 `节点ID.变量名` 可见（沿用变量注册表）。
- seam/测试：`tests/capabilities/flow-orchestration/flow-engine/2026-07-19-media-production-line/api/`。

## REQ-FLOW-030 Executions 产物 tab 与打开动作

- 优先级 P1 / 应该 / cross-module / renderer, preload / flow-orchestration / execution / E2E+单元 / UX 参照 `ux/execution-detail.html`
- 验收标准：
  1. 执行详情页展示 artifacts 列表（文件名、路径）；无产物显示空态。
  2. "打开"/"在文件夹中显示"调用 preload 暴露的 `shell.openPath`/`showItemInFolder`；**路径在项目目录之外时拒绝**（白名单校验，单元测试覆盖越界路径）。
  3. 失败执行（无登记产物）产物 tab 为空态。
- seam/测试：`tests/capabilities/flow-orchestration/execution/2026-07-19-media-production-line/{api,e2e}/`。

## REQ-CHANNEL-001 飞书通道生命周期

- 优先级 P0 / 必须 / intra-module / feishuChannelAdapter, settingsService / channel-integration / channel / 单元+集成
- 验收标准：
  1. 凭据（App ID/Secret）存 `settings.json`，文件权限 chmod 600；凭据不明文入日志。
  2. `start` 建立长连接；`getStatus()` 三态 `connecting/online/offline` 正确迁移。
  3. 连接断开依赖 SDK 自动重连；重连失败置 `offline` 并写"通道掉线"通知；恢复置 `online` 并写恢复通知。
  4. 凭据无效 → `E-CHANNEL-CRED`，状态 offline 并提示检查凭据。
- seam/测试：`tests/capabilities/channel-integration/channel/2026-07-19-media-production-line/api/`（adapter fake seam；WSClient domain 可配置性 spike 结果决定是否加 fake WS server）。

## REQ-CHANNEL-002 IM 接收、去重与路由

- 优先级 P0 / 必须 / cross-module / feishuChannelAdapter, channel_bindings, executionQueue / channel-integration / channel / 集成
- 接口契约：tech-design「通道绑定与 IM 路由」。
- 验收标准：
  1. 收到 `im.message.receive_v1` → 按 `message_id` 查 `channel_messages` 去重，重复消息丢弃且不再处理。
  2. 文本含 http(s) URL → 查 `channel_bindings`（channelType='feishu'）→ 唯一绑定得 `{projectId, flowId}` → 入队并立即回执"收到，排队中（第 N 位）"。
  3. 无 URL → 回复使用提示，不建执行。
  4. 无绑定 → 回复"未绑定链接速存 flow，请先从模板创建"；绑定指向 flow 已删/draft → 回复配置异常并写"通道状态"通知。
  5. 事件回调在模拟长耗时场景下 3 秒内返回（回调内只做解析+入队）。
- seam/测试：同上目录。

## REQ-CHANNEL-003 通道发送

- 优先级 P0 / 必须 / intra-module / feishuChannelAdapter / channel-integration / channel / 集成
- 验收标准：
  1. `send({chatId, text})` 与 `reply({messageId, text})` 调通（fake 断言请求结构与 receive_id_type）。
  2. 发送失败按次重试（≤3），仍失败记 `E-CHANNEL-SEND` 告警日志；不阻断调用方主流程。
- seam/测试：同上目录。

## REQ-CHANNEL-004 通道绑定管理

- 优先级 P0 / 必须 / intra-module / db, taskService / channel-integration / channel / 集成
- 验收标准：
  1. `channel_bindings` 表：`id/channelType/flowId/projectId/createdAt`，`channelType` 唯一约束（单绑定）。
  2. 重复绑定默认报 `E-BINDING-EXISTS`；`force` 参数替换为同事务删旧写新。
  3. 绑定关系 API/CLI 可查（当前绑定 → flow/项目）。
- seam/测试：同上目录。

## REQ-CHANNEL-005 飞书文档同步端点

- 优先级 P1 / 应该 / cross-module / feishuChannelAdapter, feishu-doc-sync skill / channel-integration / channel / 集成
- 验收标准：
  1. 系统层提供文档同步能力：输入 markdown + 标题 → 调 docx `blocks/convert` + 创建文档 + `tenant_readable` 链接分享 → 返回文档 URL。
  2. 任一步失败 → 返回 `E-DOC-SYNC-FAILED`，调用方降级（仅文件+文字消息），execution 不置 error。
- seam/测试：同上目录（fake docx API：convert/create/permission 三端点）。

## REQ-SRC-001 内容源 CRUD

- 优先级 P0 / 必须 / intra-module / contentSourceService, db, http, cli / collection-pipeline / content-source / 单元+集成
- 验收标准：
  1. `content_sources` 表（全局归属，无 projectId）：`id/name/type/tags/config/enabled/createdAt`。
  2. CRUD 经 `/api/content-sources` + `opc-workstation source`；校验：name 1–64 必填、type 枚举 `webpage/rss/x/wechat`、tags ≥1 且单个 ≤16、config 按类型（webpage/rss 合法 http(s) URL；x/wechat 非空），违反分别报 `E-SRC-NAME/TYPE/TAG/CONFIG`。
  3. name 全局唯一，重复报 `E-SRC-DUP`。
- seam/测试：`tests/capabilities/collection-pipeline/content-source/2026-07-19-media-production-line/{api,cli}/`。

## REQ-SRC-002 tag 筛选查询

- 优先级 P0 / 必须 / intra-module / contentSourceService, cli / collection-pipeline / content-source / 集成
- 验收标准：
  1. `opc-workstation source list --tag <t> --enabled` 仅返回启用且含该 tag 的内容源（机器可读输出，供 agent 消费）。
  2. 无匹配返回空列表（退出码 0）。
- seam/测试：同上 cli 目录。

## REQ-SRC-003 内容源管理 UI

- 优先级 P1 / 应该 / intra-module / renderer / collection-pipeline / content-source / E2E / UX 参照 `ux/sources.html`
- 验收标准：
  1. Sources 页列表展示名称/类型/tags/配置摘要/启停；新建/编辑表单含 tag 编辑器（增删、去重、≤16 字符）与类型联动 config 字段。
  2. 校验错误态与 API 错误一致；操作后列表实时刷新；删除为普通确认（无引用警告）。
  3. UI 与 API 数据一致（E2E 创建 → API 查询可见）。
- seam/测试：`tests/capabilities/collection-pipeline/content-source/2026-07-19-media-production-line/e2e/`。

## REQ-COLL-001 场景 A · 定时日报端到端

- 优先级 P0 / 必须 / cross-module / schedulerService, taskService, flowEngine, agent, feishuChannelAdapter, notificationService / collection-pipeline / collection / E2E 集成
- 验收标准（mock agent + fake 飞书 + 真实临时项目目录）：
  1. cron 到点（注入 tick）→ 创建执行（trigger=schedule，variables 含 topic）。
  2. 执行完成后 `outputs/daily/<date>-<topic>.md` **真实存在**，frontmatter 含 topic/sources/generatedAt，正文条目引用登记内容源的 URL。
  3. fake 飞书收到日报摘要消息；executions.artifacts 含日报路径；通知列表含"产物产出"。
  4. agent 执行失败（重试耗尽）→ 执行 error，飞书收到失败通知，通知中心落"执行失败"，无产物登记。
- seam/测试：`tests/capabilities/collection-pipeline/collection/2026-07-19-media-production-line/{api,e2e}/`。

## REQ-COLL-002 场景 B · 链接速存端到端

- 优先级 P0 / 必须 / cross-module / feishuChannelAdapter, executionQueue, flowEngine, agent, notificationService / collection-pipeline / collection / E2E 集成
- 验收标准（同上 mock/fake/真实目录）：
  1. fake 飞书发送含 URL 消息 → 立即收到排队回执（含位置）。
  2. 执行完成后 `materials/<date>-<slug>.md` **真实存在**，frontmatter 含 source url/title/fetchedAt；索引文件追加一行。
  3. fake 飞书收到"已存：<路径>"完成回复；artifacts 登记；通知落"产物产出"。
  4. 抓取失败（fake 源返回 404/超时）→ 无文件落盘、无索引追加，飞书收到 `E-FETCH-FAILED` 原因回复。
- seam/测试：同上目录。

## REQ-COLL-003 收集 skill 包与安全约束

- 优先级 P0 / 必须 / intra-module / skillService, skills(fetch-to-markdown, topic-daily-digest, feishu-doc-sync) / collection-pipeline / collection / 集成
- 验收标准：
  1. 三个 skill 以 skill repo 形式交付，经现有 skillService 安装并注入项目（`.opc/skills/...` symlink 存在）。
  2. `fetch-to-markdown`：URL 解析拒绝私网 IP（SSRF 阻断，单测覆盖 127.0.0.0/8、10.0.0.0/8、169.254.0.0/16 等）；抓取内容以"不可信数据"标记包裹后供 agent 使用。
  3. skill 不依赖系统内核内部 API（仅经公开 CLI/文件交互）。
- seam/测试：`tests/capabilities/collection-pipeline/collection/2026-07-19-media-production-line/api/`（fixture 项目真实 I/O）。

## REQ-TPL-001 模板实例化

- 优先级 P1 / 应该 / cross-module / http, taskService, skillService / collection-pipeline / template / 集成
- 验收标准：
  1. 内置 2 个模板（定时日报、链接速存）可列出；`POST /api/templates/:id/instantiate` 生成 draft flow（含 agent 节点与 skill 引用）并关联收集 skill 包到项目。
  2. 链接速存模板实例化**同事务**写入 channel_bindings；已有绑定时无 force 报 `E-BINDING-EXISTS`。
  3. CLI `opc-workstation template list/instantiate` 等价可用。
- seam/测试：`tests/capabilities/collection-pipeline/template/2026-07-19-media-production-line/api/`。

## REQ-NOTIFY-001 通知服务

- 优先级 P0 / 必须 / intra-module / notificationService, db, http, cli / information-aggregation / notification / 集成
- 验收标准：
  1. `notifications` 表：`id/type/title/body/executionId?/createdAt/readAt`；type ∈ `artifact/execution-failed/channel-status`。
  2. 三类事件源写入：产物产出、执行失败、通道掉线/恢复。
  3. `/api/notifications` 列表（按时间倒序）+ 未读数 + 标记已读（单条/全部）；CLI `notify list/read` 等价。
  4. 写入失败仅记日志（`E-NOTIFY-FAILED`），不阻断主流程。
- seam/测试：`tests/capabilities/information-aggregation/notification/2026-07-19-media-production-line/api/`。

## REQ-NOTIFY-002 通知中心 UI

- 优先级 P1 / 应该 / intra-module / renderer / information-aggregation / notification / E2E / UX 参照 `ux/notifications.html`
- 验收标准：
  1. 侧边栏入口显示未读徽标，计数与 API 一致。
  2. 列表页按时间倒序、类型配色正确（产物产出/执行失败/通道状态）；单条与全部已读后徽标清零。
  3. "产物产出"类通知点击跳转对应执行详情；其余类型仅展示。
- seam/测试：`tests/capabilities/information-aggregation/notification/2026-07-19-media-production-line/e2e/`。

---

## REFLECT 人工验收备注

以下不进入 REQ 自动化验收，留 Gate 2 人工判断：

1. 四张 UX 原型的视觉观感在真实实现中的还原度（token 一致、密度、暗色表现）。
2. 真实飞书环境冒烟一次：真实凭据建连、收/发消息、创建文档（凭据不入库不入测试）。
3. 日报内容质量（agent 摘要可读性）——属 skill 迭代范畴。
4. 通道掉线→恢复在真实网络抖动下的体感。

## 稳定块 → REQ 追溯

| PRD 稳定块 | REQ-ID |
|---|---|
| 1 调度接通 | REQ-SCHEDULE-005, REQ-SCHEDULE-006, REQ-FLOW-029 |
| 2 headless 持久化与顶替 | REQ-WORKSPACE-008, REQ-WORKSPACE-009, REQ-WORKSPACE-010 |
| 3 内容源 + 管理 UI | REQ-SRC-001, REQ-SRC-002, REQ-SRC-003 |
| 4 场景 A 定时日报 | REQ-COLL-001 |
| 5 飞书通道 | REQ-CHANNEL-001, REQ-CHANNEL-002, REQ-CHANNEL-003 |
| 6 场景 B 链接速存 | REQ-COLL-002 |
| 7 飞书文档同步 | REQ-CHANNEL-005 |
| 8 产物登记 | REQ-SCHEDULE-008, REQ-FLOW-030 |
| 9 收集 skill 化 | REQ-COLL-003 |
| 10 通知中心 | REQ-NOTIFY-001, REQ-NOTIFY-002 |
| 11 开箱模板 | REQ-TPL-001 |
| （横切）执行队列/投递钩子/绑定 | REQ-SCHEDULE-007, REQ-SCHEDULE-009, REQ-CHANNEL-004 |

## 版本记录

| 版本 | 日期 | 变更 | 作者 |
|---|---|---|---|
| v1 | 2026-07-19 | 首次结晶：11 稳定块 → 24 REQ | AI + 人 |
