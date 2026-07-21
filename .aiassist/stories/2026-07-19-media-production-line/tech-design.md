# 技术方案 — 媒体生产线 · 收集管线

> 故事 ID：`2026-07-19-media-production-line`
> 版本：`v1`
> 最后更新：2026-07-19

---

## 设计目标

以"任一时刻单 server"的形态承载收集管线：统一触发层（cron / 飞书 IM）→ per-project 串行执行队列 → agent 收集 → 产物落项目素材库并同步飞书文档；无人值守可运行，全部行为可经 CLI / fake 飞书 seam 测试。

## 模块与边界

| 模块 | 职责 | 是否新增 |
|---|---|---|
| `schedulerService` | cron 任务注册/注销/触发；随 server 启动加载 enabled schedules；到点 publish `schedule:triggered`（payload `{projectId, flowId, variables}`）；CRUD 变更同步增删（同进程直接调用，见契约表） | 是 |
| `contentSourceService` | 内容源 CRUD、字段校验、tag 筛选查询；**全局归属**（`content_sources` 无 projectId 列） | 是 |
| `channelAdapter`（接口）+ `feishuChannelAdapter` | 长连接收发、消息解析（提取 URL）、连接状态管理（连接中/在线/掉线）；**不直接依赖 eventBus**，通过 `onMessage`/`onStatusChange` 回调暴露事件 | 是 |
| `channelManager` | 持有当前 `channelAdapter` 生命周期；把 adapter 回调桥接到 `eventBus`；提供 `start`/`restart`/`stop`/`getStatus` 给 server/API/CLI | 是 |
| `executionQueue` | per-project 串行执行队列；入队/出队/排队位置查询 | 是 |
| `notificationService` | 通知写入（执行终态/通道状态/产物产出）、列表、标记已读 | 是 |
| `taskService`（改造） | `createTask` 新增 **variables 透传 + 入队 + 终态投递钩子**（`trigger` 字段与 `executions.variables` 现状已存在，见 `taskService.js:193`，本项不再说"扩展 trigger/variables"）；执行终态写通知；产物路径登记 | 否 |
| `flowEngine` trigger executor（改造） | 注入变量覆盖 config 默认值；新增 `feishuMessage` 节点类型映射到 trigger executor，变量播种/覆盖范围扩展至 trigger-like 节点 | 否 |
| `db`（改造） | `defaultDbPath()` 统一 `~/.opc-workstation/data.db`；新表 `content_sources` / `notifications` / `channel_messages` / `channel_bindings`；executions 加 `artifacts` 列；schedules 加 `variables` JSON 列；启动迁移：旧 `userData/data.db` 存在且新路径不存在 → **复制**（非移动，留回滚）→ 记日志 | 否 |
| `serverRegistry` / Electron main（改造） | App 启动发现既有 server 时顶替（shutdown 握手 + 接管注册表）；统一 DB 路径 | 否 |
| `http server`（改造） | 新路由 `/api/content-sources`、`/api/notifications`、`/api/channel`、`/api/templates` | 否 |
| CLI（改造） | `source` / `notify` / `channel` / `server` / `template` 实体命令 | 否 |
| preload（改造） | 暴露 `shell.openPath` / `shell.showItemInFolder`，白名单限项目目录内路径 | 否 |
| renderer（改造） | Sources 管理页、通知入口+列表页、Settings 飞书区块、Executions 产物 tab；**Flow Editor 新增 `feishuMessage` 触发节点**：NodePalette Trigger 分组、NodeConfigPanel 固定输出 `text`/`sender`/`messageId`（不可删除，可改 defaultValue）（参照 `ux/` 原型） | 否 |
| 内置模板与收集 skill 包（资产） | flow 模板 ×2（定时日报、链接速存）+ skill ×3（fetch-to-markdown、topic-daily-digest、feishu-doc-sync） | 是 |

### 模块关系图

```
                      ┌───────────────── 唯一活着的 server ─────────────────┐
                      │                                                     │
 cron tick ──→ schedulerService ──publish──→ eventBus ──schedule:triggered─┐│
                      │                                                     ││
 飞书云 ←─WS(出方向)─ feishuChannelAdapter   callback    channelManager      ││
                      │    onMessage/onStatusChange   ──→ eventBus         ││
                      │                              channel:message-      ││
                      │                              received              ││
                      │                              channel:status-changed││
                      │                                                     ▼▼
                      │   imRouter.subscribe('channel:message-received')    ││
                      │        ↓ 回执"收到，排队中"                          ││
                      │                                                     ▼▼
                      │   taskService.createTask({trigger, variables}) ──→ executionQueue(per-project 串行)
                      │                                                     │
                      │   contentSourceService ←──tag 筛选查询──┐            ▼
                      │                                         │      flowEngine
                      │   notificationService ←──执行终态/产物──┤            │
                      │                                         │      agent 节点(Claude Code)
                      │   feishuChannelAdapter.send/reply ←─────┘            │
                      │        ↑ 完成回复/日报摘要                            ▼
                      │                                        产物文件 → 项目素材库（真实 I/O）
                      │                                                     │
                      └──────────────── DB: ~/.opc-workstation/data.db ──────┘

App 启动 ──→ serverRegistry 发现既有 server？──是──→ shutdown 握手顶替，接管调度/通道
```

## 数据流

### 场景 A · 定时日报

1. **触发**：`schedulerService` cron 到点 → publish `schedule:triggered`（携带 schedule.variables，含 topic）。
2. **入队**：`taskService.createTask({flowId, trigger:"schedule", variables})` → `executionQueue` 按 projectId 入队。
3. **核心处理**：flowEngine 执行已发布 flow；trigger 节点把注入变量合并进 context（覆盖默认值）；agent 节点经 CLI/API 按 tag 查询启用内容源 → 收集/搜索/合成 → 写 `outputs/daily/<date>-<topic>.md`（frontmatter 含 topic/sources/generatedAt）。
4. **副作用**：产物路径登记 `executions.artifacts`；`notificationService` 写"产物产出"；调用 `feishu-doc-sync` skill 创建飞书文档（失败降级，见错误处理）。
5. **输出**：taskService 执行终态钩子统一投递——读取 execution variables 中的 `channelReply` 与 `executions.artifacts`，经 `feishuChannelAdapter.send` 发模板化日报摘要（日期/条数/来源数/文档链接或文件路径；数据取自产物登记，不依赖 agent 输出文本）。

### 场景 B · 飞书链接速存

1. **触发**：`WSClient` 收到 `im.message.receive_v1` → `feishuChannelAdapter` 把原始事件转换成 `{messageId, chatId, senderId, text}` 并通过 `onMessage` 回调交给 `channelManager` → `channelManager` 发布 `eventBus.emit('channel:message-received', {channelType:'feishu', messageId, chatId, senderId, text})`。
2. **去重与路由**：`imRouter` 订阅该事件，按 `message_id` 查 `channel_messages` 去重（已见则丢弃并 ACK）。再查 `channel_bindings`（`channelType='feishu'`，单绑定）——**无绑定** → 回复"未绑定链接速存 flow，请先从模板创建"（不建执行）；**绑定指向的 flow 已删/draft** → 回复配置异常提示并写"通道状态"通知；**绑定指向的 flow 无 `feishuMessage` 触发节点** → 回复配置异常提示并写"通道状态"通知（`E-CHANNEL-FLOW-NO-TRIGGER`）。命中绑定 → 立即 `reply`"收到，排队中（第 N 位）"（满足 3 秒时限）→ `createTask({projectId, flowId, trigger:"channel", variables:{text, sender, messageId, channelReply:{channelType, chatId, messageId}}})` 入队。**URL 等业务解析不在路由层做**。
3. **核心处理**：轮到后 `flowEngine` 执行 flow；`feishuMessage` 节点把注入变量合并进 context，下游 agent 执行 `fetch-to-markdown` skill（从 `text` 中自行解析/提取 URL） → `materials/<date>-<slug>.md`（frontmatter：source url/title/fetchedAt）+ 索引文件追加。
4. **副作用**：产物登记、写通知。
5. **输出**：taskService 执行终态钩子统一投递——成功经 `channelReply` 回复"已存：`<路径>`"（回复原消息，可用 `reply_in_thread`）；失败投递模板化错误摘要（E-AGENT-FAILED / E-FETCH-FAILED 原因）。

## 接口契约

### channelAdapter 接口（通道实现 ↔ channelManager）

| 项目 | 说明 |
|---|---|
| 调用方 | `channelManager`（start/stop/getStatus）/ `taskService` 执行终态钩子（统一投递 send）/ `imRouter`（IM 入队回执 reply） |
| 被调用方 | `feishuChannelAdapter`（实现 channelAdapter 接口，未来企业微信/Telegram 同接口） |
| 输入 | `start({credentials})`；`stop()`；`send({chatId, text})`；`reply({messageId, text})`；`onMessage(callback)`；`onStatusChange(callback)` |
| 输出 | `getStatus()` → `connecting/online/offline`；`onMessage` 回调事件 `{messageId, chatId, senderId, text}`；`onStatusChange` 回调事件 `{status, previousStatus, reason?}` |
| 业务错误 | `E-CHANNEL-CRED`（凭据无效）、`E-CHANNEL-SEND`（发送失败，可重试） |
| 系统错误 | `E-CHANNEL-DOWN`（长连接断开且 SDK 自动重连失败） |
| 副作用 | WebSocket 长连接（由 `@larksuiteoapi/node-sdk` WSClient 管理）；adapter 本身不依赖 eventBus |
| 幂等性 | 发送不幂等（调用方负责）；接收由上层 `channel_messages` 去重 |

### channelManager 接口（系统 ↔ 通道层）

| 项目 | 说明 |
|---|---|
| 调用方 | `src/http/server.js`（启动/停止）、`/api/channel` 路由（credentials/reconnect/status）、CLI `channel` 命令 |
| 被调用方 | `channelManager` |
| 输入 | `start()`（按 settings 启动默认通道）；`restart(channelType, credentials?)`；`stop()`；`getStatus(channelType)`；`send(channelType, payload)`；`reply(channelType, payload)` |
| 输出 | `getStatus()` → `{status, error?}`；`restart()` 返回首次连接尝试结果 |
| 业务错误 | `E-CHANNEL-CRED` / `E-CHANNEL-SEND` / `E-BINDING-EXISTS`（由下层透传） |
| 系统错误 | `E-CHANNEL-DOWN`（状态事件） |
| 副作用 | 把 adapter `onMessage` 回调桥接为 `eventBus.emit('channel:message-received', payload)`；把 `onStatusChange` 桥接为 `eventBus.emit('channel:status-changed', payload)`；维护当前 adapter 实例 |
| 幂等性 | `restart` 会先 stop 旧实例再 start 新实例，避免双连接 |

**系统层投递规则（回复责任方裁决）**：触发方（通道 adapter）把标准变量 `channelReply={channelType, chatId, messageId}` 注入 execution variables；**taskService 执行终态钩子统一投递**——成功：场景 B 回复"已存：<产物路径>"，场景 A 发模板化日报摘要（日期/条数/来源数/文档链接或文件路径，数据取自 `executions.artifacts`，不依赖 agent 输出文本）；失败：模板化错误摘要（E-AGENT-FAILED / E-FETCH-FAILED 原因）。边界：taskService 只识别标准变量 `channelReply`，不感知通道语义（符合 PRD §10.1"不感知触发来源类型"）；agent 不参与消息发送，失败送达与 agent 存亡解耦。

### 通道绑定与 IM 路由

| 项目 | 说明 |
|---|---|
| 调用方 | `feishuChannelAdapter`（IM 路由查询）/ 模板实例化（绑定写入） |
| 被调用方 | `channel_bindings` 表（经 db 层） |
| 输入 | 查询：`channelType`；写入：`{channelType, flowId, projectId}` |
| 输出 | 查询 → 唯一绑定 `{projectId, flowId}` 或空 |
| 业务错误 | `E-BINDING-EXISTS`（重复实例化；支持 `force` 参数替换，同事务删旧写新） |
| 系统错误 | DB 写失败 |
| 副作用 | 新表 `channel_bindings`：`id TEXT PK / channelType TEXT NOT NULL / flowId TEXT NOT NULL / projectId TEXT NOT NULL / createdAt TEXT NOT NULL`，`channelType` 唯一（**单绑定**：每通道类型至多一条活跃绑定）；与模板实例化**同事务**写入 |
| 幂等性 | 路由查询是；绑定写入否 |
| 路由规则 | IM 消息 → adapter 查 `channel_bindings` where `channelType='feishu'` → 唯一绑定得 `{projectId, flowId}` → 校验 flow 存在且已发布，并包含 `feishuMessage` 触发节点 → `createTask`；**无绑定** → 回复"未绑定链接速存 flow，请先从模板创建"（不建执行）；**绑定指向的 flow 已删/draft** → 回复配置异常提示并写"通道状态"通知；**绑定指向的 flow 无 `feishuMessage` 触发节点** → 回复配置异常提示并写"通道状态"通知（`E-CHANNEL-FLOW-NO-TRIGGER`） |

### schedulerService

| 项目 | 说明 |
|---|---|
| 调用方 | http server 启动器（`loadAll`）/ taskService（schedule CRUD 成功后**同进程直接调用** `upsert`/`remove`，不经 eventBus） |
| 被调用方 | `schedulerService` |
| 输入 | `loadAll()`（server 启动加载全部 enabled schedules）；`upsert(schedule)`；`remove(scheduleId)` |
| 输出 | 注册/更新/注销 node-cron 任务 |
| 业务错误 | `E-SCHED-CRON`（cron 表达式不合法，upsert 拒绝） |
| 系统错误 | — |
| 副作用 | node-cron 任务增删（进程内，随 server 生命周期）；到点 publish `schedule:triggered`（payload `{projectId, flowId, variables}`） |
| 幂等性 | `upsert`/`remove` 幂等（同 id 覆盖/删无影响） |

### taskService.createTask（改造：variables 透传 + 入队 + 终态投递）

| 项目 | 说明 |
|---|---|
| 调用方 | schedulerService（经 eventBus）、feishuChannelAdapter（经 eventBus）、HTTP API |
| 被调用方 | `taskService` |
| 输入 | `{projectId, flowId, trigger: "manual"\|"schedule"\|"channel", variables?: object}`（schedule 场景 variables 来自 `schedules.variables`；channel 场景含标准变量 `channelReply`）。**debug 不走 createTask**——继续走 `debugFlow` 跑 draft 快照，语义不变 |
| 输出 | `{executionId, queuePosition}` |
| 业务错误 | `E-SCHED-FLOW-INVALID`（draft 拒绝**仅当 `trigger="schedule"`**；manual 使用已发布快照；flow 不存在/已删时各 trigger 均拒绝） |
| 系统错误 | DB 写失败 |
| 副作用 | 创建 execution（status=queued）；经 `executionQueue` 串行调度；终态写通知；终态投递钩子（见 channelAdapter 系统层投递规则） |
| 幂等性 | 否（每次调用一个新执行） |

### executionQueue

| 项目 | 说明 |
|---|---|
| 调用方 | `taskService` |
| 被调用方 | `executionQueue` |
| 输入 | `enqueue({projectId, run})`；`getPosition(executionId)` |
| 输出 | 排队位置；按 projectId 串行执行 `run()`，不同 projectId 可并行 |
| 业务错误 | — |
| 系统错误 | `run()` 抛错 → 执行置 error，继续下一个 |
| 副作用 | 内存队列；execution 状态 queued→running→success/error；server 启动时将 status∈{queued, running} 的 execution 标记为 error（reason=server-restart），不自动重跑 |
| 幂等性 | 否 |

### contentSourceService

| 项目 | 说明 |
|---|---|
| 调用方 | HTTP API / CLI / agent（经 CLI `source list --tag <t> --enabled`） |
| 被调用方 | `contentSourceService` |
| 输入 | CRUD `{name, type, tags[], config, enabled}`；查询 `listByTag({tag, enabledOnly})`（**全局归属**：`content_sources` 无 projectId 列，查询全局启用源） |
| 输出 | 内容源对象/列表 |
| 业务错误 | `E-SRC-NAME` / `E-SRC-TYPE` / `E-SRC-TAG` / `E-SRC-CONFIG` / `E-SRC-DUP`（全局 name 唯一） |
| 系统错误 | DB 写失败 |
| 副作用 | 写 `content_sources` 表 |
| 幂等性 | 查询是；写否 |

### notificationService

| 项目 | 说明 |
|---|---|
| 调用方 | taskService（执行终态）、feishuChannelAdapter（通道状态）、产物登记 |
| 被调用方 | `notificationService` |
| 输入 | `notify({type: "artifact"\|"execution-failed"\|"channel-status", title, body, executionId?})`；`list({unreadOnly?})`；`markRead({ids\|all})` |
| 输出 | 通知对象/列表/未读数 |
| 业务错误 | — |
| 系统错误 | 写入失败仅记日志（`E-NOTIFY-FAILED`，不阻断主流程） |
| 副作用 | 写 `notifications` 表 |
| 幂等性 | 否（写）；读是 |

### 模板实例化

| 项目 | 说明 |
|---|---|
| 调用方 | renderer / CLI |
| 被调用方 | `POST /api/templates/:id/instantiate` |
| 输入 | `{projectId, overrides?}`（如日报 topic、cron） |
| 输出 | 新建 flow（draft）：定时日报模板含通用 trigger 节点；链接速存模板含 `feishuMessage` 触发节点（固定输出 `text`/`sender`/`messageId`）+ agent 节点；链接速存模板同时在 `channel_bindings` 建立通道绑定（单绑定） |
| 业务错误 | `E-TPL-NOT-FOUND` / `E-TPL-PROJECT-INVALID` / `E-BINDING-EXISTS`（该通道类型已有绑定；支持 `force` 参数替换，同事务删旧写新） |
| 系统错误 | DB 写失败 |
| 副作用 | 写 flows 表 + `channel_bindings`（**同事务**）；安装/关联收集 skill 包到项目 |
| 幂等性 | 否 |

### flowEngine 节点类型扩展（`feishuMessage`）

| 项目 | 说明 |
|---|---|
| 调用方 | `flowEngine.run()` |
| 被调用方 | `triggerExecutor`（`feishuMessage` 复用 trigger 执行逻辑，不引入新 executor） |
| 输入 | node.type = `feishuMessage`；node.config.outputVariables 固定为 `[{name:"text",type:"string",defaultValue:""},{name:"sender",type:"string",defaultValue:""},{name:"messageId",type:"string",defaultValue:""}]` |
| 输出 | 与 trigger 节点一致：把 `createTask` 注入的 variables 合并进 context，供下游按 `节点ID.变量名` 读取 |
| 业务错误 | 节点固定输出缺失或类型非法 → flowService.validateNodeList / validateFlowNodes 拒绝保存（视作 `trigger` 类型校验） |
| 系统错误 | — |
| 副作用 | 无 |
| 幂等性 | 是 |
| 实现要点 | ① `defaultExecutors` 增加 `feishuMessage: triggerExecutor`；② `forEachTriggerVariable` / `seedTriggerVariables` / `applyTriggerVariableOverrides` 从"仅 type=trigger"扩展为"trigger-like 节点集合"（`trigger`、`feishuMessage`，未来可扩展）；③ 链接速存模板生成的 nodeList 首节点 type 为 `feishuMessage`；④ NodePalette 在 Trigger 分组列出；NodeConfigPanel 对 `feishuMessage` 渲染固定变量编辑器（禁用删除/重命名，允许改 defaultValue） |

## 测试 seams

| 稳定块 | Seam | 测试类型 | 依赖处理 |
|---|---|---|---|
| 1 调度接通 | `opc-workstation schedule create` + tick 注入（短周期 cron）+ eventBus 断言 + 执行记录 | 单元/集成/E2E | agent mock |
| 2 headless 持久化与顶替 | CLI 自起 server 断言 DB 文件；App 启动顶替握手集成测试；旧数据迁移集成测试（临时目录模拟双路径） | 集成 | 真实临时目录 |
| 3 内容源 + UI | `opc-workstation source` CRUD + 校验；管理页 E2E | 单元/集成/E2E | 真实 DB（临时） |
| 4 定时日报 | 场景 A 集成：tick→队列→执行→**真实文件断言**（frontmatter/内容）→fake 飞书收到摘要 | 集成/E2E | agent mock + fake 飞书 |
| 5 飞书通道 | **adapter 接口 fake 为主 seam**：`simulateReceiveForTests` 注入入方向消息；fake REST server 断言 send/reply 出方向请求。真实 `WSClient` 路径在 BUILD 中通过 `@larksuiteoapi/node-sdk` 落地，但 fake WS server 集成因协议复杂度**不进入本期验收** | 单元/集成 | mock + fake REST server |
| 6 链接速存 | 场景 B 集成：IM 消息→去重→两步回复→**真实文件断言** | 集成/E2E | fake 飞书 + agent mock |
| 7 文档同步 | fake 飞书 docx API（convert/create/permission）+ 降级分支 | 集成 | fake |
| 8 产物登记 | 执行详情 API/CLI 断言 artifacts；E2E 产物 tab | 集成/E2E | 真实文件 |
| 9 收集 skill 化 | skill 安装注入 fixture 项目 + 真实 I/O | 集成 | 真实文件系统 |
| 10 通知中心 | API 集成（写入/列表/已读）+ E2E 徽标与列表 | 集成/E2E | 真实 DB |
| 11 开箱模板 | `template instantiate` API/CLI 断言 flow+绑定+skill 关联 | 集成 | 真实 DB |

## 关键决策

| 决策 | 选项 | 选择理由 | 风险 |
|---|---|---|---|
| 单 server + 统一 DB + App 顶替 | A 单 server / B 双实例 / C 仅 App 有通道 | 双实例=双库双调度双触发（推死）；C 违反无人值守。→ ADR-006 | 顶替握手竞态 |
| per-project 串行队列 | A 串行 / B 并发+文件锁 / C 全局串行 | 3 秒时限+文件不冲突+不过度设计 | 日报执行期间 IM 速存排队 |
| 开箱模板 | A 内置模板+skill 包 / B 用户自拼 | 验收最短路径；拿来就用 | 模板与系统版本耦合升级 |
| 飞书消息触发节点 `feishuMessage` | A 专用节点 / B 通用 trigger 扩展 subtype / C 通道层隐式注入变量 | 用户明确要"专门的飞书接收消息节点"，避免任意 trigger 被 IM 消息触发；模板与路由语义清晰；复用 trigger executor 减少新抽象 | 新增节点类型需同步改 palette/config/validation/模板/路由 |
| 飞书 SDK `@larksuiteoapi/node-sdk` | 官方 SDK / 裸协议 / 企业微信 CLI | WSClient 自动重连+token 缓存+全 API 覆盖；adapter 抽象保可换；与 research 结论一致 | SDK 打包体积；fake WS server 复杂，本期只用 adapter 注入 seam |
| 凭据手工 App ID/Secret，settings.json 明文+600 | 手工 / registerApp 扫码 | registerApp 仅见 README 未实测；手工是原型已验收路径；实现须同步落地 chmod 600 | 明文凭据（后续加密 story） |
| 保存凭据后自动连接 + 显式 reconnect | A 自动 / B 手动 / C 混合 | PRD "保存即连接" + UX "重新连接" 按钮都需要 | 保存接口需返回首次连接尝试状态 |
| adapter 回调 → channelManager → eventBus | 直接调 imRouter / adapter 内部 emit eventBus / channelManager 桥接 | adapter 不依赖 eventBus，便于测试和替换；统一走 eventBus 解耦 | channelManager 多一层职责 |
| 状态变更 eventBus + getStatus 并存 | 纯事件 / 纯轮询 / 并存 | UI 实时更新 + API/CLI 同步查询 + 通知中心触发 | 需维护内存状态一致性 |
| Markdown→docx：`blocks/convert` | convert（同步） / import_tasks（异步） | 日报为纯文本 markdown，同步通路最直接；大图床场景后续再评 | 表格 merge_info/图片块额外流程 |
| 文档权限 `tenant_readable` | 链接分享 / 加协作者 | solo 自建企业场景，一次性 PATCH 即可点开 | 换租户场景不适用（后续参数化） |
| 产物登记 `executions.artifacts` JSON 列 | JSON 列 / 关联表 | 最小登记；独立 artifact 仓储在范围外 | 查询能力弱（本期不需要） |
| IM 去重 `channel_messages` 表 | 新表 / 复用 logs | 语义独立、可查重 | — |
| preload 白名单限项目目录 | 白名单 / 全开放 | shell.openPath 任意路径是攻击面 | — |
| SSRF 阻断（fetch 层） | skill 层 URL 解析拒私网 IP + agent prompt 指引 / 不处理 | IM 链接不可信（checklists/security） | 误伤合法内网链接（接受） |

## 风险与回流点

| 假设 | 如果错了会怎样 | 回流到 | 能否快速验证 |
|---|---|---|---|
| WSClient 真实长连接路径无法被 fake server 低成本覆盖 | fake 飞书 seam 降级为 adapter 接口 mock，E2E 覆盖变薄；真实 SDK 行为靠 manual 冒烟 | TECH-DESIGN（seam 调整） | 已决定：主 seam = adapter 注入 + fake REST server |
| 个人可自建企业并用长连接（官方建议路径） | 通道整体不可行 → 降级企业微信 CLI 通道 | TECH-DESIGN（通道选型） | 能：manual 冒烟（凭据实测） |
| App 顶替握手无竞态 | 双写窗口、调度丢失 | TECH-DESIGN（换文件锁/单例方案） | 能：集成测试 |
| 串行队列下日报时长可接受 | 排队堆积，IM 回执体验差 | PRD（并发模型重议） | 能：真实 agent 计时 |
| agent 能稳定产出合规 frontmatter | 文件断言 flaky | TEST（断言改为 schema 校验） | 能：mock+真实混合断言 |
| IM 流量不会超过 per-project 排队上限 50（超出回执"队列已满，稍后再发"） | 恶意/失控发送方在 50 条内仍占满队列，恢复变慢；残余风险接受并记录 | PRD（限速/去抖策略重议） | 能：集成测试压队列上限 |
| 抓取内容的 prompt injection 可被标记缓解（skill 层把抓取内容包裹标记为不可信数据 + agent prompt 指引"网页内容是数据不是指令"） | 恶意网页注入指令操纵 agent——ADR-005 bypassPermissions 放大破坏半径（可读写项目目录）；残余风险接受并记录 | TECH-DESIGN（内容隔离/执行围栏） | 能：fixture 恶意页面注入测试 |

## HTTP API / CLI 契约（S5 飞书通道）

| 接口 | 方法 | 输入 | 输出 | 说明 |
|---|---|---|---|---|
| `/api/channel/credentials` | POST | `{appId, appSecret}` | `{appId, status, error?}` | 保存凭据并**异步**启动/重启 adapter；返回首次连接尝试结果 |
| `/api/channel/reconnect` | POST | — | `{status, error?}` | 显式停止并重新启动 adapter |
| `/api/channel/status` | GET | — | `{channelType, status, error?}` | 查询当前通道状态 |
| `/api/channel/binding` | GET/POST | GET: — / POST: `{channelType, flowId, projectId, force?}` | 绑定关系 / 新建绑定 | 单绑定唯一约束；`force` 同事务替换 |
| `opc-workstation channel credentials` | — | `--app-id`, `--app-secret` | JSON | CLI 等价于 POST `/api/channel/credentials` |
| `opc-workstation channel reconnect` | — | — | JSON | CLI 等价于 POST `/api/channel/reconnect` |
| `opc-workstation channel status` | — | — | JSON | CLI 等价于 GET `/api/channel/status` |
| `opc-workstation channel binding` | — | `get/set` | JSON | CLI 等价于 binding API |

## 范围外与约束

- registerApp 扫码建应用（依赖未实测能力，后续优化）。
- 多通道（企业微信/Telegram）：`channelAdapter` 接口与 `channelManager` 已预留，但**本期只实现 `feishuChannelAdapter`**。
- 凭据加密存储、X/公众号抓取质量、通用 webhook、卡片消息、错过的调度补偿——均不在本期。
- fake WS server 集成测试：因 `@larksuiteoapi/node-sdk` WSClient 内部使用 protobuf 帧与握手协议，本期不强制实现完整 fake server；主 seam 为 adapter 接口注入 + fake REST server 断言收发。
- 安全约束：凭据不明文入日志；preload 仅放行项目目录内路径；fetch 层阻断私网 IP。
- 可观测性：通道状态变更/执行终态/队列长度写结构化日志（event 名稳定，不含凭据与消息全文）。

---

## 版本记录

| 版本 | 日期 | 变更 | 作者 |
|---|---|---|---|
| v0.1 | 2026-07-19 | 初稿（基于 prd v0.3 + research/feishu-open-platform-desktop-integration + 三轮对抗决策） | AI + 人 |
| v0.2 | 2026-07-19 | review 修复：3 阻塞（通道绑定模型与 IM 路由、内容源归属=全局、回复责任方=系统层投递）+ 6 警告（schedules.variables、schedulerService 契约、createTask trigger 语义、孤儿执行恢复、旧数据迁移、风险表补两行+凭据 600 落地） | AI + 人 |
| v0.3 | 2026-07-19 | BUILD S5 回流：明确引入 `@larksuiteoapi/node-sdk` WSClient；新增 `channelManager` 模块；adapter 通过回调与 channelManager 交互，由 channelManager 桥接到 eventBus；保存凭据后自动连接 + 显式 reconnect；状态变更 eventBus + `getStatus` 并存；测试 seam 明确为 adapter 注入 + fake REST server | AI + 人 |
| v0.4 | 2026-07-21 | BUG 阶段 PRD 回流：新增 `feishuMessage` 触发节点；更新模块边界、场景 B 数据流、IM 路由规则、模板实例化、关键决策 | AI + 人 |
