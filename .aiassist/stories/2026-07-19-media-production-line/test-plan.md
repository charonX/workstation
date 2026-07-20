# 测试计划 — 媒体生产线 · 收集管线

> 故事 ID：`2026-07-19-media-production-line`
> 对应：`requirements.md` v1（hash `de43bc86…fab9`）+ `tech-design.md` v1
> 阶段：/test-author 产出 + 签核落地（业务验收测试；ASSERTIONS-SIGNED: true，签核记录见 §5）
> 测试根目录约定：`tests/capabilities/<capability>/<entity>/2026-07-19-media-production-line/{api,cli,e2e}/`

---

## 1. 运行方式

| 层 | 命令 | 说明 |
|---|---|---|
| api / cli（node --test） | `npm run test:unit` | 收集 `tests/capabilities/**/{api,cli}/*.test.js`；先 `npm run rebuild:node`（better-sqlite3 ABI） |
| e2e（Playwright Electron） | `npm run test:e2e` / `npx playwright test` | 收集 `tests/**/*.test.cjs`；先 `npm run rebuild:electron` |
| 单文件 | `node --test <file>` / `npx playwright test <file>` | 开发期定向运行 |

当前状态（功能未实现）：全部新用例按预期红——红在断言、404、命令不存在或 seam 缺失断言上；无语法/夹具错误。两个用例意外转绿（见 §5）。

## 2. REQ → 测试映射总表

| REQ | 测试文件（相对 tests/capabilities/） | 测试类型 / seam | 验证点摘要 |
|---|---|---|---|
| REQ-WORKSPACE-008 | `workspace-management/server/…/api/server.test.js` | 集成 / 临时 HOME + 双进程 headless server | defaultDbPath 指向 `~/.opc-workstation/data.db`；CLI 自起 server 落盘且重启后执行记录在；目录不可写报 `E-DB-UNWRITABLE` |
| REQ-WORKSPACE-009 | 同上 | 集成 / 双进程 + serverRegistry | 顶替握手旧 server 退出、注册表单条活跃；调度/通道不双注册（`/api/server/status` 建议 seam）；拒不退让→报错不双跑；tick 竞争窗口（骨架，握手 seam 就绪后补全） |
| REQ-WORKSPACE-010 | 同上 | 集成 / 临时目录双路径 + better-sqlite3 | 旧库复制迁移（非移动）且数据可查；结构化日志含源/目标/耗时、不含数据内容；新路径存在则不迁移不覆盖 |
| REQ-SCHEDULE-005 | `scheduling-execution/schedule/…/api/scheduleTriggers.test.js` | 单元+集成 / schedulerService seam + 秒级 cron 注入 + eventBus | loadAll 注册；`schedule:triggered` payload `{projectId, flowId, variables}`；execution trigger=schedule status=queued；CRUD 同进程同步 cron；draft flow 不建执行+日志；manual 不受 draft 限制；停机不补偿 |
| REQ-SCHEDULE-006 | 同上 | 单元+集成 / `/api/schedules` | schedules.variables JSON 列 CRUD 透传；非法 cron 报 `E-SCHED-CRON`；触发时 variables 注入 execution.variables |
| REQ-SCHEDULE-007 | `scheduling-execution/execution/…/api/executionQueue.test.js` | 集成 / executionQueue seam（`createExecutionQueue`） | 同 project 串行/跨 project 并行；getPosition；单 project 上限 50（`E-QUEUE-FULL`）；启动恢复置 error(reason=server-restart) 不重跑；单执行抛错不阻塞队列；createTask 返回 `{executionId, queuePosition}` |
| REQ-SCHEDULE-008 | `scheduling-execution/execution/…/api/artifacts.test.js` | 集成 / mock agent 注入（`setAgentExecutorForTests`）+ 临时项目目录 | executions.artifacts JSON 列；成功登记产物路径（真实 I/O）；失败不登记半成品；API/CLI 详情返回 artifacts |
| REQ-SCHEDULE-009 | 同上 | 集成 / mock channelAdapter 注入（`setChannelAdapterForTests`） | channelReply 触发终态投递（成功含产物路径、失败含错误摘要）；无 channelReply 不投递；投递失败不反转终态；agent 节点代码结构断言不引用通道层 |
| REQ-FLOW-029 | `flow-orchestration/flow-engine/…/api/triggerVariables.test.js` | 单元 / flowEngine `run(flow, opts, inputVariables)` | 注入变量覆盖 trigger outputVariables 默认值；未注入保留默认；下游按 `节点ID.变量名` 可见；falsy 注入值也覆盖 |
| REQ-FLOW-030 | `flow-orchestration/execution/…/api/artifactOpenPath.test.js` + `…/e2e/artifactsTab.test.cjs` | 单元（白名单）+ E2E / `artifactPathGuard` seam、Electron | 白名单放行项目内路径、拒绝越界/绝对外部/symlink 逃逸；产物 tab 存在；列表含文件名/路径/打开按钮；失败执行空态；默认 tab 行为 |
| REQ-CHANNEL-001 | `channel-integration/channel/…/api/feishuChannel.test.js` | 单元+集成 / fake 飞书 server + adapter seam | settings.json chmod 600；凭据不明文入日志；getStatus 三态迁移；掉线/恢复写通知；无效凭据 `E-CHANNEL-CRED` + offline |
| REQ-CHANNEL-002 | `channel-integration/channel/…/api/imRouting.test.js` | 集成 / imRouter seam + mock adapter | message_id 去重；URL+绑定→入队+回执「排队中（第 N 位）」；无 URL 提示；无绑定文案；绑定失效→配置异常+通道状态通知；回调 <3s |
| REQ-CHANNEL-003 | `channel-integration/channel/…/api/feishuChannel.test.js` | 集成 / fake 飞书 server 请求结构断言 | send/reply 请求结构（receive_id_type、msg_type、content.text）；失败重试 ≤3 后 `E-CHANNEL-SEND`；不阻断调用方 |
| REQ-CHANNEL-004 | `channel-integration/channel/…/api/imRouting.test.js` | 集成 / channelBindingService seam + `/api/channel/binding` | channelType 单绑定唯一；重复 `E-BINDING-EXISTS`；force 同事务删旧写新；API/CLI 可查 |
| REQ-CHANNEL-005 | `channel-integration/channel/…/api/docSync.test.js` | 集成 / fake 飞书 docx 三端点 | convert→create→tenant_readable 全链路返回 URL；任一步失败返回 `E-DOC-SYNC-FAILED`（不抛出，调用方降级） |
| REQ-SRC-001 | `collection-pipeline/content-source/…/api/contentSources.test.js` + `…/cli/contentSources.test.js` | 集成 / `/api/content-sources` + `opc-workstation source` | 字段完整（全局归属无 projectId）；CRUD；`E-SRC-NAME/TYPE/TAG/CONFIG/DUP` 五类校验；CLI 等价、错误退出码 1 |
| REQ-SRC-002 | `collection-pipeline/content-source/…/cli/contentSources.test.js` | 集成 / `source list --tag --enabled` | tag+enabled 过滤（机器可读 JSON）；无匹配空列表退出码 0 |
| REQ-SRC-003 | `collection-pipeline/content-source/…/e2e/sourcesPage.test.cjs` | E2E / Electron + API 播种 | 见 §3 UX 映射（sources.html） |
| REQ-COLL-001 | `collection-pipeline/collection/…/api/dailyDigest.test.js` | E2E 集成 / 秒级 cron + mock agent + mock adapter + 真实临时项目目录 | tick→执行(trigger=schedule, variables 含 topic)；日报真实落盘（frontmatter topic/sources/generatedAt、正文引用源 URL）；飞书摘要；artifacts 登记；通知「产物产出」；agent 失败→error+失败通知+无登记 |
| REQ-COLL-002 | `collection-pipeline/collection/…/api/linkCapture.test.js` | E2E 集成 / mock adapter + imRouter + fake 内容源 + 真实目录 | 排队回执（含位置）；素材落盘（frontmatter source/title/fetchedAt）+索引追加一行；「已存：<路径>」回复；artifacts；通知；404 抓取失败→无落盘无索引+`E-FETCH-FAILED` 回复 |
| REQ-COLL-003 | `collection-pipeline/collection/…/api/collectionSkills.test.js` | 集成 / 内置 skill 包资产 + skillService 真实 link | 三 skill 以 repo 形式交付；link 后 `.opc/skills/...` symlink 真实存在且指向正确；SSRF 拒绝 127/10/169.254/192.168/172.16/0.0.0.0/localhost；不可信标记约定；不依赖内核内部 API（结构断言） |
| REQ-TPL-001 | `collection-pipeline/template/…/api/templates.test.js` | 集成 / `/api/templates` | 2 内置模板可列；instantiate 生成 draft flow（agent 节点+skill 引用）并关联 skill 包；链接速存同事务写绑定、重复 `E-BINDING-EXISTS`、force 替换；`E-TPL-NOT-FOUND`/`E-TPL-PROJECT-INVALID`；CLI 等价 |
| REQ-NOTIFY-001 | `information-aggregation/notification/…/api/notifications.test.js` | 集成 / notificationService seam + `/api/notifications` + CLI | 三类事件源写入、字段完整；倒序+未读数；单条/全部已读；unreadOnly 过滤；CLI `notify list/read`；写入失败仅记日志不阻断 |
| REQ-NOTIFY-002 | `information-aggregation/notification/…/e2e/notificationCenter.test.cjs` | E2E / Electron + 通知播种 | 见 §3 UX 映射（notifications.html） |

24 条 REQ 全部 ≥1 个自动化测试，无遗漏。

## 3. UX 原型 → E2E 映射

| UX 原型 | E2E 文件 | 提取的可验证项 |
|---|---|---|
| `ux/sources.html` | `content-source/…/e2e/sourcesPage.test.cjs` | 侧边栏「内容源」导航；表头 名称/类型/配置/标签/状态/操作；行内类型徽标/tag chips/启停 switch(role=switch)/编辑/删除；空态「暂无内容源」；新建/编辑 dialog；4 类型选项；tag 编辑器（回车添加、去重「标签已存在」、>16 报错「每个标签不超过 16 字符」、× 删除）；类型联动 config label/placeholder（X 账号/@username ↔ 页面 URL）；校验错误态；删除普通确认（无引用警告）；列表实时刷新；UI↔API 一致 |
| `ux/notifications.html` | `notification/…/e2e/notificationCenter.test.cjs` | 侧边栏「通知」入口+未读徽标（计数与 API 一致、0 时隐藏）；过滤 tab 全部/产物产出/执行失败/通道状态（带计数）；倒序；未读 pill+「标为已读」；空态「该分类下暂无通知」；「全部标为已读」（无未读 disabled）；artifact 类点击跳执行详情、其余类型仅展示（不可点击） |
| `ux/execution-detail.html` | `flow-orchestration/execution/…/e2e/artifactsTab.test.cjs` | 详情面板 tab 序列含「产物」(role=tab)；产物行含文件名/路径/「打开」「在文件夹中显示」按钮；失败执行空态「本次执行未登记产物」；选中执行的默认 tab（成功→产物、失败→日志） |
| `ux/settings-channel.html` | —（无对应 UI 类 REQ） | 提取项落到 REQ-CHANNEL-001 的 api 级断言：三态 connecting/online/offline（`feishuChannel.test.js` getStatus 迁移）、凭据 600、掉线通知。纯 UI 部分（状态 pill、掉线 alert、secret 显示/隐藏）无 REQ 挂钩，视觉还原度留 REFLECT 人工验收 |

E2E 均不断言像素/颜色/尺寸；文案类断言均标 `TODO: HUMAN ASSERTION`。

## 4. 测试夹具（tests/fixtures/media-production-line/）

| 夹具 | 接口 | 状态 |
|---|---|---|
| `fakeFeishuServer.js` | `startFakeFeishuServer()` → token/send/reply/docx convert/create/permission 端点 + 请求记录 + `setCredentialsValid` + `failNext(prefix, times)`（最长前缀优先）+ `injectMessage/onInject` | 完整可用；WS 侧 TODO（待 WSClient domain spike 结论） |
| `mockChannelAdapter.js` | channelAdapter 接口 fake：`start/send/reply/getStatus/onMessage` + `emitMessage/setStatus/failNextSend` + 调用记录 | 完整可用 |
| `mockAgent.js` | `createMockAgentExecutor(handler)` / `createFileWritingAgentExecutor(baseDir, files)` / `createFailingAgentExecutor(reason)`（flowEngine executor 签名） | 完整可用 |
| `tmpProjectDir.js` | `makeTmpProjectDir()` / `makeTmpDir()` / `readFileIfExists()` | 完整可用 |
| `fakeContentServer.js` | `startFakeContentServer(routes)` → 运行时 `setRoute`、状态码/延迟注入、`requestedPaths` | 完整可用 |

依赖的产品 seam（测试中以显式断言门控，缺失即「功能未实现」红，BUILD 阶段落地）：

| seam（建议落点） | 用于 |
|---|---|
| `src/services/schedulerService.js`（loadAll/upsert/remove/removeAll） | REQ-SCHEDULE-005/006、REQ-COLL-001 |
| `src/services/executionQueue.js`（createExecutionQueue、recoverInterruptedExecutions） | REQ-SCHEDULE-007 |
| `taskService.setAgentExecutorForTests` / `setChannelAdapterForTests` | REQ-SCHEDULE-008/009、REQ-COLL-001/002 |
| `src/services/channels/feishuChannelAdapter.js`（createFeishuChannelAdapter，domain 可配） | REQ-CHANNEL-001/003 |
| `src/services/channels/imRouter.js`（createImRouter） | REQ-CHANNEL-002、REQ-COLL-002 |
| `src/services/channelBindingService.js`（createBinding/getBinding） | REQ-CHANNEL-002/004、REQ-COLL-002 |
| `src/services/channels/feishuDocSync.js`（syncMarkdownToFeishuDoc） | REQ-CHANNEL-005 |
| `src/services/notificationService.js`（notify/list/markRead） | REQ-NOTIFY-001 |
| `src/preload/artifactPathGuard.js`（isArtifactPathAllowed） | REQ-FLOW-030 |
| `src/db.js` 导出 `defaultDbPath()` / `migrateLegacyDb({legacyPath,targetPath,logger})` | REQ-WORKSPACE-008/010 |
| `serverRegistry.takeoverExistingServer({port,timeoutMs})` | REQ-WORKSPACE-009 |
| `settingsService.saveChannelCredentials({appId,appSecret})` | REQ-CHANNEL-001 |
| 路由 `/api/content-sources` `/api/notifications` `/api/channel/binding` `/api/templates` `/api/server/status` | 各 API 测试 |
| 内置资产 `src/assets/skill-repos/opc-collection-skills/`（skills/fetch-to-markdown、topic-daily-digest、feishu-doc-sync，各含 SKILL.md；fetch-to-markdown/scripts/validateUrl.js 导出 assertPublicUrl） | REQ-COLL-003 |

## 5. 断言签核记录

签核日期：2026-07-19　签核状态：**已签**（50 处占位断言已全部落地为正式断言，测试文件头 `ASSERTIONS-SIGNED: true`）

| # | 决策项 | 签核结果 |
|---|---|---|
| 1 | draft flow 到点日志码 | **`E-SCHED-FLOW-INVALID`**（全文统一，REQ 与 tech-design 冲突以此为准） |
| 2 | `E-SRC-DUP` HTTP 状态码 | **409** |
| 3 | 通知 E2E 播种方式 | **不开放 POST 写入面**；`notificationCenter.test.cjs` 改为经 `tests/e2e/helpers/notifications.cjs` 在 Electron 主进程内用 better-sqlite3 直写 notifications 表（表不存在时按 REQ-NOTIFY-001 契约建表，属测试基础设施） |
| 4 | §5 其余建议预期值 | **整体批准**：回执「收到，排队中（第 N 位）」「队列已满，稍后再发」（码 `E-QUEUE-FULL`）；无 URL 提示「发送 http(s) 链接即可速存到素材库」；绑定失效「链接速存 flow 配置异常（flow 不存在或未发布），请检查模板实例」；模板 id `daily-digest`/`link-capture`（名「定时日报」「链接速存」）；通知 API 面 `{items, unreadCount}` + `POST :id/read` + `POST read-all`；CLI `--tags` 逗号分隔、`task get --id`、`channel binding`、`notify list/read [--unread]`、`template list/instantiate`；码值 `E-SERVER-TAKEOVER-TIMEOUT`、`E-DB-UNWRITABLE`；日报文件名 `outputs/daily/<date>-<topic-slug>.md`（摘要含日期/条数/来源数/产物路径）；索引文件 `materials/LIBRARY.md`；docSync 失败契约 `{error:{code:"E-DOC-SYNC-FAILED", stage}}`；E2E 文案按 UX 原型；内置资产落点 `src/assets/skill-repos/opc-collection-skills/`；校验错误体形状 `{ error: <码值>, message }` |

落地差异说明（断言与签核值的对应关系）：

- 排队位置口径：运行中=第 1 位，其后依次 2/3（executionQueue.test.js）。
- 孤儿执行恢复：`executions` 记录含 `server-restart`（executionQueue.test.js）。
- 飞书发送重试：总尝试次数 ≤3（含首次），仍失败 `E-CHANNEL-SEND`（feishuChannel.test.js）。
- 不可信标记锚点：SKILL.md 须同时含 `UNTRUSTED` 与「不可信」（collectionSkills.test.js）。
- 凭据无效/投递失败契约：`E-CHANNEL-CRED` reject；失败投递摘要含 `E-AGENT-FAILED`/`E-FETCH-FAILED` 之一；成功投递含「已存：<产物路径>」。

当前意外转绿（功能未实现但已通过，属有效行为契约）：`REQ-SCHEDULE-005 AC4 manual 触发不受 draft 限制`（现状即放行）、`REQ-SCHEDULE-009 AC4 agent 节点结构断言`（现状即不引用通道层）。

### 既有缺陷暴露（记录给 BUILD / bug 循环）

`POST /api/schedules` 携带非法 cron 时：`createSchedule` 不校验 cron，路由在 `writeHead(201)` 之后才经 `toListView → getCronDescription` 抛错 → `ERR_HTTP_HEADERS_SENT`，响应头已发但 body 永不结束，客户端挂起直至超时（复现：`scheduleTriggers.test.js`「非法 cron 报 E-SCHED-CRON」，测试内以 8s `AbortSignal.timeout` 把挂起转成可读失败）。REQ-SCHEDULE-006 落地（创建期校验 `E-SCHED-CRON`）后此用例按 400 断言转正。

## 6. REFLECT 人工验收项（不进自动化）

| 项 | 理由 |
|---|---|
| 四张 UX 原型在真实实现中的视觉还原度（token/密度/暗色） | 纯视觉审美，自动化只验结构与行为 |
| 真实飞书环境冒烟（真实凭据建连/收发/建文档） | 凭据不入库不入测试；外部依赖 |
| 日报内容质量（agent 摘要可读性） | skill 迭代范畴，非契约 |
| 通道掉线→恢复在真实网络抖动下的体感 | 网络环境不可重现 |
| settings-channel 设置页 UI 区块（状态 pill/掉线 alert/secret 显隐） | 无 UI 类 REQ 挂钩；行为已在 api 层覆盖 |
| 顶替握手在真实 App 打包形态下的端到端（Electron main 触发） | 自动化以双进程 headless 模拟；真实 App 形态需人工 |

## 7. 隔离与红线自查

- 隔离：临时 HOME（`makeTmpDir`）、临时项目目录（`makeTmpProjectDir`）、独立端口（`startServer`/`startFakeFeishuServer` 均 listen 0）、`:memory:` DB；每个用例独立 setup/teardown。
- 文件副作用全部真实 I/O 断言（data.db、日报/素材文件、LIBRARY.md、`.opc/skills` symlink）。
- 无共享可变状态；eventBus/cron/executor 注入在 afterEach 归位。
- 文件头六行注释齐全（REQ-TRACE/REQ-VERSION/CAPABILITY-TRACE/ENTITY-TRACE/TEST-AUTHOR/ASSERTIONS-SIGNED）。
