# BUILD 进度 — 2026-08-02-ui-copilot

> phase: BUILD（门 1 已签核，2026-08-06）
> 模式：子代理调度（implementer default）
> 里程碑：M1 会话中心骨架（REQ-AGENT-026~030）→ M2 项目空间增强（031~033，spike H3/H4/H5 前置）→ M3 飞书只读（034，随 M1 列表/只读能力部分交付）

## 切片计划

| Slice | 内容 | REQ | 测试文件 | 依赖 |
|---|---|---|---|---|
| 1 | 空间=会话数据层：spaceKey 语法 + title 列 + reset=新行语义 + 会话创建端点 | 027 | sessionSpace.test.js, sessionReset.test.js | — |
| 2 | 会话列表与历史：分组列表（join 项目/孤儿/agent_space_meta）+ 分页历史 | 029 | sessionList.test.js, feishuReadonly.test.js | 1 |
| 3 | 消息发送 + SSE 流式：POST messages（错误映射）+ GET events（SSE 契约） | 028 | sessionMessage.test.js, sessionEvents.test.js | 1 |
| 4 | 内联确认卡桥：UI 空间高危 → 挂起队列 + SSE confirmation-pending + 渲染确认卡 | 030 | uiConfirmation.test.js, assistantConfirm.test.cjs | 2,3 |
| 5 | 双区渲染层：默认路由 /assistant + 会话列表/对话窗 UI + 管理区 nav-notifications + 种子 seam×2 + E2E 全绿 | 026 | assistantNav/Chat/Sessions/Feishu.test.cjs | 1-4 |

## Slice 记录

（各 slice 完成后追加：`Slice N: complete (<base7>..<head7>, tests green, PRD alignment passed)` + refactor 行）

- Slice 1: complete (52171f1..425705d, 业务测试 9/10 绿 + 既有回归全绿；1 红 = 业务测试自身前置断言缺陷，见「已知偏差」) + refactor: 无（本切片改动面小，route 纯函数导出即最终形态）— 2026-08-06
- Slice 2: complete (425705d..9fc8c83, 业务测试 7/7 绿 + 回归 18/19) + refactor: 97429ef（数据层聚合重构 2 文件，重构后 19/19 绿，无回滚）— 2026-08-06
- PRD 对齐 Slice 1+2: ALIGNED（实现零缺失；T-1~T-3 test-gap 候选 + Slice 5 前置 2 项已登记）— 2026-08-06
- Slice 3: complete (97429ef..8edd068, 业务测试 12/12 绿 + 回归 25/26 仅已知 T-1) + refactor: b560d21（SSE 工厂提取，重构后 24/24 绿，无回滚）— 2026-08-06
- PRD 对齐 Slice 3: ALIGNED（错误优先级链/SSE 契约/256KB 单位实证；O-1~O-3 → T-4~T-6 登记）— 2026-08-06
- Slice 2: complete (51add70..c7f5acb, 业务测试 7/7 绿 + Slice 1 两套件/builtin-agent sessionStore+sessionRestore 回归全绿（仅已知 sessionSpace 用例 4 fixture 红）+ 单元 seam 自测 5/5 绿后自删) + refactor: 无（分页窗口抽为导出纯函数 paginateMessages 即最终形态，与 Slice 1 投影纯函数同型）— 2026-08-06
- Slice 3: complete (97429ef.., 业务测试 12/12 绿（sessionMessage 7 + sessionEvents 5）+ 回归 25/26（仅已知 sessionSpace 用例 4 fixture 红）+ builtin-agent api 33/33 全绿 + lint 干净) + refactor: 无（SSE 挂起订阅/轮次边界宣告即最终形态，改动面收敛于 routes 单文件 + server.js context 1 行）— 2026-08-06
- Slice 4: complete (8edd068.., 业务测试 6/6 绿（uiConfirmation：3 红 3 绿基线 → 全绿）+ 回归：Slice 1-3 六套件全绿（sessionSpace 仅已知 T-1 fixture 红）+ builtin-agent confirmation/sessionStore/sessionRestore 16/16 绿 + lint 干净；M2 五套件（permissionPolicy/authorizerBridge/skillInjection/toolSurface/workerAssembly）仍红 = seam 未就绪（M2 模块未实现，本切片范围外）) + refactor: 无（eventBus 发布/订阅分流即最终形态——测试 seam 直接 svc.submit 与生产 confirm-request 同构，发布点收敛于 confirmationService.submit 单点）— 2026-08-06
- PRD 对齐 Slice 4: ALIGNED（S5 后端全链：空间前缀分流/裁决 11 字段/裁决 8 回投语义/幂等与解耦回归；「卡片留历史」渲染层语义随 Slice 5 + GET confirmations 全量对齐）— 2026-08-06

## PRD → 代码 可追溯性表

（由各 slice 子代理写入）

### Slice 1（REQ-AGENT-027 空间=会话数据层）

| REQ-AGENT-027 验收标准 | 意图（PRD §2/§7.1/§10.1） | 实现文件 | 测试文件 | 状态 |
|---|---|---|---|---|
| 1. `POST /api/agent/sessions {spaceKind:"general"}` → 200 `{spaceKey}` 匹配 `^ui:copilot:.+`，建行 + JSONL 占位 | S2 空间=会话 + F4 新对话归属（顶部新对话 = 通用空间） | `src/http/routes/agentSessions.js`（handleCreateSession/createUiRow）、`src/services/sessionStore.js`（getOrCreate 既有） | `.../api/sessionSpace.test.js` 用例 1 | COVERED |
| 2. `{spaceKind:"project", projectId}` → `^ui:project:<pid>:.+`；无效 projectId → 400 `E-SESSION-CREATE` 且不建行 | S2 空间 key 语法 `ui:project:<pid>:<sid>` + 项目行内＋ | `src/http/routes/agentSessions.js`（projectExists 校验 projects 表 + handleCreateSession） | `.../api/sessionSpace.test.js` 用例 2/3 | COVERED |
| 3. 首条用户消息后 `title` = 截断 ≤40 字（slice(0,40) 无省略号）；后续消息不更新 | S1 会话标题 = 首条消息截断（拍板默认值）+ F1.4 title 首次写入 | `src/http/routes/agentSessions.js`（handlePostMessage 202 受理后 setTitleIfEmpty）、`src/services/sessionStore.js`（setTitleIfEmpty：WHERE title IS NULL 原子首条即定） | `.../api/sessionSpace.test.js` 用例 4 | PARTIAL（实现经 e2e 手工验证绿：截断/不更新/无省略号均符合；签核测试自身前置断言缺陷 `firstText.length > 40` 与 fixture 36 字矛盾，需 test-author 修正 fixture，见「已知偏差」） |
| 4. `POST .../reset`（UI 空间）→ 新 spaceKey 同分组新行；旧行保留、历史可读、可继续发送 | S2 UI 空间 /reset = 新建会话并切换（F4，不触发世代机制） | `src/http/routes/agentSessions.js`（handleReset/newUiSpaceKeyFor/uiGroupPrefixFor）、`src/services/sessionStore.js`（getOrCreate 新行） | `.../api/sessionReset.test.js` 用例 1/2/3 | COVERED |
| 5. `feishu:*` /reset 世代制不变（既有语义回归） | 7.1 飞书空间 /reset 维持世代制；signoff 裁决 9：feishu HTTP reset → 403 E-SESSION-READONLY | `src/services/sessionStore.js`（reset 既有，未动）、`src/http/routes/agentSessions.js`（handleReset feishu 分支 403） | `.../api/sessionReset.test.js` 用例 4/5 | COVERED |
| 6. 表迁移：既有 `feishu:*` 行无损，`title` 列 NULL 兼容 | 持久化复用 agent_sessions 表，不引入新存储（§10.1） | `src/db.js`（initSchema title 列 + migrateSchema ALTER TABLE 补列） | `.../api/sessionSpace.test.js` 用例 5 | COVERED |

> 支撑性实现（本切片内为测试 seam 所需的最小形态，完整契约随 REQ-AGENT-028/029）：`POST/GET .../messages`（202 `{messageId}`、JSONL 投影 `{messages:[...]}`，signoff 裁决 3/12）、`GET /api/agent/sessions`（最小分组 general/projects/feishu，裁决 17 字段集）；路由接线 `src/http/server.js`（resource="agent" subPath[0]="sessions" → handleAgentSessions，惰性工厂 `_opcSessionStoreFactory`/`_opcAgentServiceFactory`）。

### Slice 2（REQ-AGENT-029 分组会话列表与历史回看）

| REQ-AGENT-029 验收标准 | 意图（PRD §4 S4/§6.2/§7.1） | 实现文件 | 测试文件 | 状态 |
|---|---|---|---|---|
| 1. `GET /api/agent/sessions` → `{ general, projects: [{projectId, projectName, orphan, sessions}], feishu }`；项目名 join `projects` 表 | S4 分组列表（左栏通用/项目/飞书分组）+ F5 按 key 前缀分组、join projects 取名 | `src/http/routes/agentSessions.js`（listSessions 完整分组 + loadProjectNameMap 项目名 map）、`src/services/sessionStore.js`（list 既有） | `.../api/sessionList.test.js` 用例 1 | COVERED |
| 2. projectId 不存在 → `orphan: true`；前端划线且只读（发送 409 由 REQ-AGENT-028 兜底） | 7.1 孤儿会话（项目删除保留可回看）+ CONTEXT.md 孤儿会话；signoff 裁决 16（孤儿 projectName = null 不回填 pid） | `src/http/routes/agentSessions.js`（listSessions orphan 判定：projectNames.has(pid) 缺失 → orphan:true + projectName:null） | `.../api/sessionList.test.js` 用例 2（划线呈现/发送 409 属前端 Slice 5 与 REQ-028） | COVERED |
| 3. 各组内会话按 `lastActiveAt` 倒序 | F5 列表按 lastActiveAt 倒序（恢复最近活跃会话） | `src/http/routes/agentSessions.js`（listSessions byActiveDesc 各组排序，既有） | `.../api/sessionList.test.js` 用例 3 | COVERED |
| 4. `GET .../messages?limit&before` 按时间序返回；分页参数生效；默认 limit=100 | tech-design 性能节 JSONL 历史投影分页；signoff 裁决 5（默认最新 limit 条、数组时间升序、before = messageId） | `src/http/routes/agentSessions.js`（handleGetMessages + parsePaginationQuery + 导出纯函数 paginateMessages） | `.../api/sessionList.test.js` 用例 4 | COVERED |
| 5. 飞书会话出现在 `feishu` 组，显示名取通道元数据 chat 名 | S9 飞书会话进列表（M3 列表能力随本切片交付）；signoff 裁决 10 候选 A（agent_space_meta 侧表，表/行缺失 fallback spaceKey 或空） | `src/db.js`（initSchema/migrateSchema/resetDb 建 agent_space_meta 表）、`src/services/sessionStore.js`（listSpaceMeta 只读方法）、`src/http/routes/agentSessions.js`（listSessions displayName join） | `.../api/sessionList.test.js` 用例 5（通道侧写入在 M3，测试经 better-sqlite3 直插） | COVERED |
| 6. E2E：点会话 → 右栏完整历史；左栏 active 态；项目分组展开/收起 | S1 左栏交互 | 前端 Slice 5（assistantSessions.test.cjs） | 本切片不涉及 | DEFERRED（Slice 5） |

> 支撑性实现：`feishu:*` 发送 → 403 `E-SESSION-READONLY` 与「无消息桥」为 Slice 1 既有行为，本切片经 `feishuReadonly.test.js` 全链路回归确认（含静态代码审查断言：routes 模块无 sendCard/channelManager/cardRenderer 引用）。孤儿/只读发送拦截的 409/403 完整错误映射随 REQ-AGENT-028（Slice 3）。

### Slice 3（REQ-AGENT-028 对话收发与 SSE 流式渲染）

| REQ-AGENT-028 验收标准 | 意图（PRD §4 S3/§7/§8/§10.1 + signoff 裁决） | 实现文件 | 测试文件 | 状态 |
|---|---|---|---|---|
| 1. `POST .../messages {text}` 合法 → 202 `{messageId}`；trim 后空 → 400；超 enforceSizeLimit 上限 → 400 | S3 消息发送（F1 输入校验）+ PRD §7 唯一输入面验证规则 + 裁决 12（300KB 明确越界 → 400，精确边界不额外断言） | `src/http/routes/agentSessions.js`（handlePostMessage + messageTextError；MAX_MESSAGE_CHARS = 256KB 字符，与 enforceSizeLimit 同单位） | `.../api/sessionMessage.test.js` 用例 1/2/3 | COVERED |
| 2. `GET .../events`（SSE）推送 session-event 序列（FAUX 下 text_start/text_delta×N/text_end 有序 + 拼接一致）；含 confirmation-pending 事件类型 | S3 流式渲染（F2）+ D4 流式 = SSE + 裁决 11（子序列严格有序 + 拼接一致；允许辅助事件交错） | `src/http/routes/agentSessions.js`（handleGetEvents：会话句柄 session-event 原样转发 + 轮次边界 text_start 宣告 + 15s 心跳注释帧）、`src/http/server.js`（context 增 peekAgentService 同步窥探） | `.../api/sessionEvents.test.js` 用例 2（confirmation-pending 结构断言属 REQ-AGENT-030 uiConfirmation，本切片接通「事件流经 SSE 转发」通道） | COVERED |
| 3. 错误映射：agent 未配置 → 409 E-AGENT-CONFIG；孤儿 → 409 E-SESSION-ORPHAN；feishu:* → 403 E-SESSION-READONLY；spaceKey 不存在 → 404 | PRD §8 错误状态表 + 裁决 1/2（403 只读先于 409）+ PRD §7.1/CONTEXT.md 孤儿会话（项目已删除不可发送） | `src/http/routes/agentSessions.js`（handlePostMessage 校验顺序：400 → 404 → 403 → 孤儿 409 → 未配置 409；isOrphanSpace 复用 projectIdOf/projectExists） | `.../api/sessionMessage.test.js` 用例 4/5/6/7 | COVERED |
| 4. E2E：用户气泡即时出现；agent 气泡流式增量；完成后按钮恢复；流式中按钮置灰 | S3 操作流 + 7.1 双击防护 | 前端 Slice 5（assistantChat.test.cjs） | 本切片不涉及 | DEFERRED（Slice 5） |
| 5. SSE 断线重连：重连后先 `GET .../messages` 全量对齐再续流（E2E 断言历史完整） | F2 断线语义（SSE 只推增量，不做事件回溯） | 端点侧语义本切片交付：断线不崩、后续消息仍受理、重连可再建（handleGetEvents detach 清理 + 挂起订阅再挂接）；渲染层全量对齐在 Slice 5 | `.../api/sessionEvents.test.js` 用例 4/5（端点侧）；E2E 在 `.../e2e/assistantChat.test.cjs` | PARTIAL（端点侧绿；渲染层部分属 Slice 5） |
| 6. 单事件 >256KB 截断契约沿用（既有回归不断言新行为，跑通即可） | 裁决 12 + enforceSizeLimit 既有回归（agentDialogue「单条 IPC 消息 ≤ 256KB」） | `src/services/agentService.js` enforceSizeLimit（既有，未动）；SSE 层不二次截断（非文本事件如 confirmation-pending 无 content/delta 载体，二次截断会丢字段） | `.../api/sessionEvents.test.js` 用例 3 | COVERED |

> 支撑性实现：① **300KB 单位确认**（Slice 5 前置 UNCERTAIN 项之一落地）：enforceSizeLimit 按 `JSON.stringify(event).length` 与 256KB 比较——单位 = 字符（String.length / UTF-16 code units），既有回归同单位断言；输入上限统一为 256KB 字符（PRD §7「长度上限沿用 enforceSizeLimit」），300KB 明确越界 → 400。Slice 1-2 占位上限 300KB（`>` 判断）会让恰 300KB 输入放行（sessionMessage 超限用例当时红 + 87s 拖尾），本切片修正。② **text_start 来源**：worker 未映射 PI turn_start/turn_end（worker 仅产 text_delta/text_end），轮次边界由 SSE 层宣告（imRouter stream_start 同型先例）——每轮首个文本事件前补发 text_start，text_end 后重置。③ **SSE 连接先于首条消息打开**（用例 2/3/4/5 均如此）：挂起订阅注册表 pendingSseSubs，handlePostMessage 在 createSession 后补挂接；peekAgentService 为同步窥探（未创建 → null），打开 events 连接不启动 agent 子进程（ADR-009 保持）。

### Slice 4（REQ-AGENT-030 内联确认卡桥——后端部分）

> 范围：M1 确认桥形态 = **命令保险层分类直桥**（tech-design 里程碑切分：授权桥雏形，不含 gotgenes）。后端 = UI 空间高危 → 挂起行 + SSE confirmation-pending + approve/reject 既有端点复用 + 结果回投 agent 消息。渲染层确认卡 UI 属 Slice 5（assistantConfirm.test.cjs）。
> 关键设计：**确认卡渲染目标按 spaceKey 前缀分流**（tech-design 模块关系图 / F3 / CONTEXT.md 授权桥——一套队列、按空间前缀分流渲染）——`ui:*` 空间新建挂起行 → eventBus `confirmation-pending` 发布（confirmationService submit 内，**不依赖特定入队路径**：worker confirm-request 与测试直桥 submit 同构）→ SSE 路由按空间订阅过滤转发（裁决 11 字段 confirmId/operation/description）；`feishu:*` → 既有 sendCard 路径全链不动。approve/reject 回投走既有语义（裁决 8）：approve → 执行结果经 notify-result 注入（FAUX 回声含「执行结果已就绪」注入提示词）；reject → 不执行 + 回投「操作已取消」（confirmationService 既有注入）。挂起队列 = SQLite 真相（agent_confirmations），暂不处理稍后仍有效、重复回调幂等——既有语义回归（本套件 3 例设计使然绿）。

| REQ-AGENT-030 验收标准 | 意图（PRD §4 S5/§6.2/§8 + signoff 裁决） | 实现文件 | 测试文件 | 状态 |
|---|---|---|---|---|
| 1. CLI 高危（既有命令保险层分类）在 UI 空间触发 → 挂起行创建 + SSE confirmation-pending（含确认 id、操作描述） | S5 内联高危确认卡（通用空间 CLI 工具面天然含删除/配置变更高危，挂起后 UI 必须能确认）+ tech-design F3.1 + 裁决 11（confirmation-pending 字段 = confirmId/operation/description） | `src/services/confirmationService.js`（submit：ui:* 空间分支 publishPending → eventBus 发布；isUiSpaceKey/buildPendingDescription 纯函数）、`src/http/routes/agentSessions.js`（createSseSubscription：subscribe confirmation-pending 按 spaceKey 过滤转发 + detach 摘除） | `.../api/uiConfirmation.test.js` 用例 1 | COVERED |
| 2. 点确认 → 调既有端点 → 执行结果以 agent 消息流式呈现；点拒绝 → agent 告知已取消 | PRD §6 S5 操作流（确认 → 操作执行结果以 agent 消息呈现；拒绝 → 中止告知）+ tech-design F3.2/3.3 + 裁决 8（approve 回投执行结果语义 / reject 回投「操作已取消」confirmationService 既有注入） | 既有端点 `src/http/routes/agentConfirmations.js` + `src/http/server.js`（approve → executeToolCommand C2 同模块执行 + notifyResult → agentService → worker notify-result 回投；reject 不执行）——本切片零改动（既有全链接线复用），确认服务语义未动 | `.../api/uiConfirmation.test.js` 用例 2/3（FAUX 回声断言「执行结果已就绪」/「操作已取消」） | COVERED |
| 3. 暂不处理：卡片留历史、稍后点击仍有效（确认与执行解耦，挂起队列 = SQLite 真相） | PRD §6.2 S5 分支（稍后处理 → 卡片留历史可后点）+ tech-design 授权桥契约幂等性 | 既有 `src/services/confirmationService.js`（agent_confirmations SQLite 持久化 + 幂等认领，未动语义） | `.../api/uiConfirmation.test.js` 用例 4（队列级；「卡片保留在历史中」渲染层由 E2E assistantConfirm.test.cjs 覆盖） | COVERED |
| 4. 已处理卡片置灰「已处理」；重复回调幂等（既有语义回归） | PRD §8（确认回调过期/重复 → 置灰「已处理」）+ REQ-AGENT-016 标准 4 既有幂等 | 既有 `src/services/confirmationService.js`（claimPending 非 pending 认领失败 → 返回当前状态不执行，未动）；「置灰」渲染层 Slice 5 | `.../api/uiConfirmation.test.js` 用例 5 | COVERED |
| 5. 飞书空间确认卡片路径回归：同一挂起队列，飞书渲染与回调不变 | S5 飞书卡片路径完全不变（一套队列一张卡；渲染目标按 spaceKey 前缀分流）+ tech-design F3.4 | `src/services/confirmationService.js`（submit 非 ui:* 空间走既有 sendCard 分支，零行为变化） | `.../api/uiConfirmation.test.js` 用例 6（跨空间共存/互不干扰）+ builtin-agent `confirmation.test.js` 全套 7/7 回归 | COVERED |

> 支撑性实现：① **空间前缀分流接线**——confirmationService 新增依赖仅 `eventBus`（服务侧发布先例：taskService execution 事件）；`ui:*` 空间跳过 sendCard（避免误向飞书通道发卡，chatchatId 语义不属于 UI 空间）；feishuReadonly 静态审查（routes 无 sendCard/channelManager/cardRenderer）继续通过。② **SSE 通道扩展**——confirmation-pending 经 eventBus 直达 SSE 订阅（不经 session 句柄），与 handle session-event 通道互不干扰（非文本事件不参与轮次边界宣告）；SSE 只推增量（发布时连接不在 → 丢失，渲染层以 GET /api/agent/confirmations 全量对齐——「卡片留历史」数据源）。③ **生产直桥路径全链复用**：worker 工具面 confirm 级 → IPC confirm-request（sessionKey = ui 空间 key）→ agentService onConfirmRequest → server.js getConfirmationService().submit → 发布 + 入队——本切片无 server.js/worker/agentService 改动（Slice 8 既有接线即 M1 直桥入队点）。④ 单元测试 /tdd 自写自删（3 例：ui:* 发布字段/feishu 不发布/重复 submit 不重复发布，红→绿→删）。


## 已知偏差

（实现与 HTML 原型/契约的偏差显式记录）

- **Slice 1 单红测试 = 业务测试自身缺陷（非实现缺陷）**：`sessionSpace.test.js` 用例 4 前置断言 `assert.ok(firstText.length > 40)` 与 fixture「请帮我分析一下这个项目最近三次执行失败的根本原因并给出具体的改进建议清单」实际长度 36 矛盾（该 fixture 与断言均出自签核 commit c88f72c，工作树未改）。实现侧已按契约意图实现并经手工 e2e 验证：>40 字消息 → title = slice(0,40) 无省略号、第二条消息不更新。修复归属 /bug（test-gap 分类，test-author 修正 fixture 或调前置断言）——实现者按契约不得改业务测试，故留红。
- 列表端点 `{general, projects, feishu}` 为最小分组形态：项目名 join/孤儿标记/agent_space_meta/按 lastActiveAt 倒序细节随 REQ-AGENT-029（Slice 2）完整化（本切片内仅承担惰性迁移触发，迁移用例只断言 200）。

## 待 /bug 项（test-gap 候选，PRD 对齐子代理 2026-08-06 增补）

| # | 缺陷 | 建议 |
|---|---|---|
| T-1 | sessionSpace 用例 4 fixture 36 字 < 前置断言 40（已知） | test-author 加长 fixture ≥41 字 |
| T-2 | sessionList 用例 2 孤儿 projectName 弱断言（`null || string`），无法捕获裁决 16 回归 | 收紧为 `=== null` |
| T-3 | sessionReset 无 `ui:project:*` 组 reset 用例（仅 general 覆盖） | 补一条同分组前缀断言（低危） |
| T-4 | 错误优先级无判别性测试（feishu 403 / 孤儿 409 用例均已配 agent，E-AGENT-CONFIG 提前也全绿）——裁决 2 未被捕获（Slice 3 对齐 O-1） | 补两条：feishu+未配置→403；孤儿+未配置→409 E-SESSION-ORPHAN |
| T-5 | SSE 直接挂接路径（连接打开时会话已存在）无测试（仅挂起路径覆盖）（O-2） | 补一条 attach(existing) 用例（低危） |
| T-6 | `GET events` 对不存在 spaceKey 404 无测试（O-3） | 补一条（极低危） |
> O-4 信息项：用例 3 字节断言 vs enforceSizeLimit 字符口径，CJK fixture 时注意（当前 ASCII 恒绿，不动）

## Slice 5 前置确认项（PRD 对齐子代理 UNCERTAIN）

- 孤儿组前端标签来源：API 返回 projectName=null（裁决 16），UX 原型孤儿行显示划线项目名——前端需定显示映射（「项目已删除」占位 vs 会话标题推断），Slice 5 前确认
- ~~300KB 上限单位：实现以字符计（307200 chars），Slice 3 接 enforceSizeLimit 时确认统一（字节/字符）~~ → **已确认（Slice 3）**：enforceSizeLimit 按 `JSON.stringify(event).length`（字符）计，输入上限统一为 256KB 字符，300KB 明确越界 → 400；见 Slice 3 可追溯性表支撑性实现①
