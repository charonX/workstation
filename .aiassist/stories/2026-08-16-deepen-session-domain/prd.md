# Session Domain 深化——会话领域逻辑搬出路由层

> 状态：已完结（历史记录）——REFLECT 门 2 通过（2026-08-18），本 story spec 降级为历史记录；逻辑真值看代码，意图真值看全局文档（ADR-030 / engineering-lessons / STANDARDS / business-capabilities）。
> 故事 ID：`2026-08-16-deepen-session-domain`
> 最后更新：2026-08-17
>
> 来源：architecture-review-2026-08-16 候选 #4（报告存档
> `.aiassist/global/architecture-reviews/architecture-review-2026-08-16.html`）+
> 一轮 frontier 访谈（interview-notes.md，五项 GUESS 全部确认，方向 A 拍板）。

---

## 1. 问题陈述

928 行的路由模块 `agentSessions.js` 承载会话领域逻辑（历史投影/分页/spaceKey
解析/SSE 订阅注册表/附件规则/config 装配），`server.js` 反向 import 其 2 个领域
函数（`buildSessionConfig`/`attachPendingSseSubs`）才能复用（另 2 个 import 名是
handler，属 server→route 正常分层），SSE 注册表（模块级 `pendingSseSubs` Map）
被三层之外的三处外部
驱动（server.js 确认回调、server.js 懒解析接线、路由 handlePostMessage）。开发者
改会话语义要在路由文件里翻找，投影/分页/key 解析只能透 HTTP 端到端打——一句话
痛点：**会话领域逻辑住在路由层，依赖方向倒置，seam 泄漏到调用者**。

## 2. 解决方案

新建 session-domain 模块，把五块会话领域职责收进一个家：config 装配、历史投影
+分页、spaceKey 解析、SSE 订阅注册表（per-instance，由 server.js 持有注入）、
附件规则。server.js 改为只 import domain 模块（依赖方向回正）；路由瘦成纯转发
（~600 行），仅 re-export `projectMessagesFromJsonl` 保既有测试导入面零改动
（tech-design 事实核查：既有测试实际仅直用此 1 名）。行为字节级不变——纯结构搬迁。

## 3. 用户故事

1. 作为开发者，我想要会话领域知识只有一个模块属主，以便改会话语义一处生效。
2. 作为开发者，我想要历史投影/分页/spaceKey 解析可以直接单测，以便不再透
   HTTP 端到端才能验证纯函数行为。
3. 作为开发者，我想要 SSE 订阅注册表随实例走（非模块级全局），以便测试隔离
   且「谁驱动注册表」一目了然。
4. 作为调用方（server.js 接线），我想要从 domain 模块 import 领域函数，以便
   依赖方向不再倒置。
5. 作为既有功能的守护者，我想要 10 个既有测试文件零改动全绿，以便确认本次
   搬迁无任何行为漂移。

## 4. 稳定块（已稳定，可结晶为 REQ）

| # | 稳定块 | 为什么不再推翻 |
|---|---|---|
| 1 | session-domain 新模块骨架 + config 装配搬迁（`buildSessionConfig` 及其依赖链） | 访谈 Q1 拍板五块全搬；消灭 server.js 反向 import 的最小核心 |
| 2 | 历史投影 + 分页搬迁（`projectMessagesFromJsonl`/`partText`/`paginateMessages`/`normalizeLimit`），获得直接单测 | 纯函数无侧效应，搬迁零风险；评审明确「Projection gains unit tests」 |
| 3 | spaceKey 解析搬迁（`uiGroupPrefixFor`/`projectIdOf`/`newUiSpaceKeyFor`），获得直接单测 | ADR-016 语法的纯函数，无争议 |
| 4 | SSE 订阅注册表收编为 per-instance：`createSseSubscription` + 挂起注册表 + `attachPendingSseSubs` 随实例走（`createSseSubscriptionRegistry()` 工厂实例，三方法：`createSubscription`/`registerPending`/`attachPending`），三处驱动点改为注入（server.js 持实例直调 ×2 + 路由 context 袋 `getSseRegistry`） | 访谈 Q2 + tech-design #1/#3 拍板（评审 "registry travels with instance" 字面落实） |
| 5 | 附件规则搬迁（`attachmentsError` + `IMAGE_MIME_TYPES`/`MAX_ATTACHMENTS`/`MAX_ATTACHMENT_BYTES` 三常量） | 纯校验函数，随 domain 走 |
| 6 | server.js 依赖方向回正 + 路由 re-export 保测试面：路由保留两个 handler（`handleAgentSessions`/`handleAgentLastMode`）+ **仅 re-export `projectMessagesFromJsonl`**（测试唯一实际使用的导出名——tech-design 事实核查：动态 import 路由的 8 个测试文件中 6 个纯 seam 存在性门，historyToolFilter 兼直调投影函数，feishuReadonly 兼静态读源码断言）；server.js 从 domain/registry 模块 import 领域函数 | 访谈 Q3 拍板 + tech-design 事实纠正（re-export 面 4→1）；execution-runner「兼容转发保旧契约」先例；既有测试文件零改动是硬约束 |

## 5. 移动块（还在动，暂不入 REQ）

> 全部已解决（/tech-design 深潜，2026-08-17，四问逐题拍板）：
> #1 注册表形态 → `createSseSubscriptionRegistry()` 工厂实例 + context 袋注入，
>    `createSseSubscription` 收编为实例方法 `createSubscription`（§10.2/§10.4）；
> #2 逐函数搬迁清单 → 41 顶层函数 + 6 常量全量分类定稿（§10.2，2026-08-17
>    review 复核修正计数——原述「34」未含全部 handleXxx 与 web 杂务），三边界判定：
>    `gitStateForSpace` 搬（会话元数据投影）、列表拼装五函数留（HTTP presentation
>    编排就近路由）、`messageTextError` 留（HTTP 输入校验）。
> 当前无移动块。

## 6. 用户操作流（Operation Flows）

> 本 story 是纯结构搬迁，「操作流」= 被保全的既有行为。所有流程的现状语义
> 逐字节保持；锚点值均取自现行代码（agentSessions.js 2026-08-17 快照）。

### 6.1 主流程 / Happy Path

| 步骤 | 用户动作 | 系统响应 | 验收锚点 |
|---|---|---|---|
| 1 | GET /api/agent/sessions（列表） | 会话行 + 项目名/空间元数据拼装返回 | 返回形状不变（既有 sessionList 测试绿） |
| 2 | GET /api/agent/sessions/:spaceKey/messages | JSONL 历史投影 + 分页窗口返回 | 投影/分页逻辑改由 domain 模块承载，响应体不变 |
| 3 | POST /api/agent/sessions/:spaceKey/messages | 202 `{messageId}`；`buildSessionConfig` 装配配置建句柄；挂起 SSE 订阅补挂接 | config 装配与挂接改由 domain/实例承载，行为不变 |
| 4 | GET /api/agent/sessions/:spaceKey/events | SSE 流：session-git 首帧 → 增量事件 → 15s 心跳；无句柄时挂起登记 | SSE 帧序列字节级不变（既有 sessionEvents 测试绿） |
| 5 | POST reset / stop / mode / provider 各端点 | 转发到对应服务，响应不变 | 纯转发路径，路由保留 |
| 6 | server.js 确认回调「稍后处理」回投 | `buildSessionConfig` 建句柄 + `attachPendingSseSubs` 挂接——import 来源改为 domain 模块 | server.js:217/226/369 三处接线的行为不变 |

### 6.2 分支与异常

| 触发条件 | 分支结果 | 对应错误状态 |
|---|---|---|
| 会话不存在 | 404 | E-SESSION-NOT-FOUND |
| 附件类型非图片白名单 | 400 | E-ATTACH-TYPE「仅支持图片（jpeg/png/gif/webp/bmp/heic/heif）」 |
| 附件 >10 个 | 400 | E-ATTACH-COUNT「每条消息最多附加 10 个文件」 |
| 单附件 >10MB | 400 | E-ATTACH-SIZE「图片过大（单图 ≤10MB）」 |
| 附件路径不存在 | 400 | E-ATTACH-PATH「文件不存在」 |
| JSONL 文件缺失/单行损坏 | 投影返回 [] / 跳过该行 | —（正常降级） |
| 分页 limit 非法（0/负/NaN/非整数） | 按默认 100 处理 | —（正常降级） |
| SSE 写帧失败（连接已死） | sub.detach 自清理，服务不崩 | —（正常降级） |
| events 连接先于首条消息（无句柄） | 挂起登记，句柄创建后补挂接 | —（正常路径） |

### 6.3 预期值锚点（Expected-Value Anchors）

| 稳定块 | 输入 | 预期输出/结果 | 依据（需求 / 已签标准 / 真实 JSON） |
|---|---|---|---|
| 2 投影 | JSONL 含 `{type:"message", id:"m1", timestamp:"2026-08-01T10:00:00Z", message:{role:"user", content:"你好"}}` 一行 | `[{messageId:"m1", role:"user", createdAt:"2026-08-01T10:00:00Z", text:"你好"}]` | 现行 `projectMessagesFromJsonl` |
| 2 投影 | message 行 `role:"toolResult"`，或 assistant 行 content 无 text 段 | 该行不投影（剔除） | BUG-009 修复语义（REQ-AGENT-054） |
| 2 投影 | content 数组含 `{type:"image", name:"tiny.png"}` | text 含字面子串 `[图片: tiny.png]` | REQ-AGENT-097 |
| 2 投影 | 文件路径不存在 | 返回 `[]` | 现行代码 catch → [] |
| 2 分页 | `paginateMessages(msgs, {limit: 0})` / `{limit: -3}` / `{limit: 2.5}` | 等价 `{limit: 100}`（取最新 100 条窗口） | 现行 `normalizeLimit`（signoff 裁决 5） |
| 2 分页 | `before="mX"` 且 mX 不在数组中 | 视为无游标，返回最新窗口 | 现行 `paginateMessages` |
| 2 分页 | `before="m3"`（在数组中），limit=2 | 严格早于 m3 的窗口取最新 2 条 | 现行 `paginateMessages` |
| 3 key 解析 | `uiGroupPrefixFor("ui:project:p1:s1")` | `"ui:project:p1:"` | 现行代码（ADR-016 语法） |
| 3 key 解析 | `uiGroupPrefixFor("ui:copilot:abc")` | `"ui:copilot:"` | 现行代码 |
| 3 key 解析 | `uiGroupPrefixFor("feishu:xxx")` | `undefined` | 现行代码 |
| 3 key 解析 | `projectIdOf("ui:project:p1:s1")` | `"p1"`；`projectIdOf("ui:copilot:abc")` → `undefined` | 现行代码 |
| 3 key 解析 | `newUiSpaceKeyFor("ui:project:p1:s1")` | 字符串以 `"ui:project:p1:"` 为前缀、余段为新 UUID；非 ui 空间 → `undefined` | 现行代码 |
| 1 config | `buildSessionConfig(undefined, undefined)`（无参/无行） | 返回默认组合 `{provider: DEFAULT_PROVIDER, model, apiKey, identity}`（resolveSessionModelConfig 单点解析） | 现行代码「无参调用 → 默认组合，行为不变」 |
| 1 config | settings 无已配置 providers（`providers: []`）时 `buildSessionConfig(undefined, undefined)` | `{provider:"deepseek", model:"", apiKey:undefined, identity:""}`（resolved.provider 空 → DEFAULT_PROVIDER="deepseek" 回落；entry 空 → entryApiKey → undefined） | 现行代码（resolveSessionModelConfig 空 providers 短路 + 回落语义） |
| 5 附件 | 11 个合法图片附件 | `{code:"E-ATTACH-COUNT", message:"每条消息最多附加 10 个文件"}` | 现行 MAX_ATTACHMENTS=10 |
| 5 附件 | `[{mimeType:"text/plain", size:1, path:"/tmp/x"}]` | `{code:"E-ATTACH-TYPE", ...}` | 现行 IMAGE_MIME_TYPES 白名单 |
| 5 附件 | 单附件 size = 10*1024*1024 + 1 | `{code:"E-ATTACH-SIZE", ...}` | 现行 MAX_ATTACHMENT_BYTES |
| 4 SSE 注册表 | events 连接先于句柄创建；随后 handlePostMessage 建句柄 | 订阅从「挂起」转「挂接」，事件自下一轮回流起持续收流；无挂起订阅时 attach 为 no-op | 现行 `pendingSseSubs`/`attachPendingSseSubs` 语义（REQ-AGENT-028 标准 5） |
| 6 依赖方向 | 模块依赖图扫描 | server.js → session-domain、route → session-domain；不存在 server.js → route 内部函数、不存在 domain → route | 模块图无环手段（engineering-lessons 已沉淀） |

## 7. 表单与输入验证（Form / Input Validation）

本 story 无用户输入表单（纯内部架构重构）。接口级校验保持现状，规则全部已在
§6.2/§6.3 锚定（附件四规则、分页 limit 归一化、会话存在性）。路由层 HTTP 参数
decode（`decodeParam`：decodeURIComponent 失败回落原值）语义不变。

### 7.1 跨字段/业务规则

| 规则 | 触发时机 | 例子（触发 → 期望结果） | 错误状态 |
|---|---|---|---|
| 附件四规则短路顺序：类型 → 数量 → 大小 → 路径 | POST messages 带附件 | 同时违反类型与数量 → 先报 E-ATTACH-TYPE | 400 |

## 8. 错误状态与失败响应（Error States / Failure Responses）

| 场景 | 触发条件 | 错误码/消息 | 用户可见状态 | 副作用/回滚 |
|---|---|---|---|---|
| 会话不存在 | store.get(spaceKey) 无行 | E-SESSION-NOT-FOUND「会话不存在」 | HTTP 404 | 无 |
| 附件类型越界 | mimeType 不在白名单 | E-ATTACH-TYPE | HTTP 400 | 消息不发送 |
| 附件数量越界 | >10 个 | E-ATTACH-COUNT | HTTP 400 | 消息不发送 |
| 附件大小越界 | 单图 >10MB | E-ATTACH-SIZE | HTTP 400 | 消息不发送 |
| 附件路径失效 | 文件不存在 | E-ATTACH-PATH | HTTP 400 | 消息不发送 |
| SSE 连接死亡 | res write 抛错 | —（静默 detach） | 客户端断流，可重连再建 | 订阅自清理，服务不崩 |
| JSONL 缺失/损坏 | 文件不存在/单行非法 JSON | — | 空历史/跳过坏行 | 无（降级语义保持） |

> 全部错误码/消息/HTTP 状态为现状保全项，本 story 不新增、不修改任何错误契约。

## 9. 复杂度分级

| 维度 | 取值/说明 |
|---|---|
| 复杂度 | **complex** |
| 判断理由 | 触碰 3 个模块（路由 / 新 domain 模块 / server.js）+ 10 个既有测试文件的导入面约束；SSE 注册表 per-instance 化涉及实例生命周期与三个注入点设计（非平凡接线决策）；契约保持面大（SSE 帧序列、HTTP 形状、server.js 反向 import 的 4 名中 2 领域函数 + 2 handler）；需要 tech-design 深潜注册表 API 形态与逐函数搬迁清单 |

- 结晶路径：`PRD → TECH-DESIGN → CRYSTALLIZE`（§10 由 /tech-design 深潜补全）。

## 10. 技术方案（Implementation Decisions）

> 已由 `/tech-design` 深潜定稿（2026-08-17，四问逐题拍板：①注册表工厂实例 +
> context 袋注入 + `createSseSubscription` 收编 ②逐函数搬迁清单含三边界判定
> ③注册表三方法契约 + admission 编排留路由 + re-export 收缩 ④两文件拆分）。
> 决策落盘 ADR-030。

### 10.1 设计目标

会话领域知识收进两个内聚模块（无内部可变状态的 domain 函数组 + 有状态 SSE
注册表），依赖方向回正（server.js → domain/registry、route → domain/registry），
注册表随 server 实例走，路由瘦成纯转发（~600 行）——HTTP/SSE 行为字节级不变，
依赖方向静态可验。

### 10.2 模块与边界

| 模块 | 职责 | 是否新增 |
|---|---|---|
| `src/services/sessionDomain.js` | **领域函数域**（无内部可变状态、不持有连接；含只读 I/O——读 JSONL/DB/settings）：`buildSessionConfig`+`DEFAULT_PROVIDER`；`uiGroupPrefixFor`/`projectIdOf`/`newUiSpaceKeyFor`+`PROJECT_PREFIX_RE`；`projectMessagesFromJsonl`/`partText`/`normalizeLimit`/`paginateMessages`；`attachmentsError`+`IMAGE_MIME_TYPES`/`MAX_ATTACHMENTS`/`MAX_ATTACHMENT_BYTES`；`gitStateForSpace`（边界判定①：会话元数据投影，与 key 解析同源） | 是 |
| `src/services/sessionSseRegistry.js` | **有状态域**：`createSseSubscriptionRegistry()` 工厂 → 实例三方法 `createSubscription(res, spaceKey)`（收编现 `createSseSubscription`：事件转发/轮次边界 text_start 宣告/15s 心跳/confirmation-pending 过滤/detach 自清理）、`registerPending(spaceKey, sub)`、`attachPending(spaceKey, svc)`（收编现 `attachPendingSseSubs`+`peekSession`，内部持有挂起 Map） | 是 |
| `src/http/routes/agentSessions.js` | HTTP 转发层（~928 → ~600 行，上限 650 含注释余量——review 算术复核：搬走 ~300-330 行后留存 ~600，原 ~300 目标不可行，2026-08-17 人拍板重定阈值）：两个导出 handler + 全部 `handleXxx` 端点函数 + admission 编排（`handleGetEvents` 的 404/writeHead/首帧推送/attach-or-pend 五行编排）+ 列表拼装五函数（`listSessions`/`loadProjectNameMap`/`loadSpaceMetaMap`/`isOrphanSpace`/`projectExists`——边界判定②留：HTTP presentation 编排就近路由；`isOrphanSpace` 亦被 `handlePostMessage` 复用、「孤儿会话禁止发送」领域规则编码在内，`projectExists` 被 `handleCreateSession` 复用）+ `messageTextError`+`MAX_MESSAGE_CHARS`（边界判定③留）+ context 袋适配与 web 杂务（`decodeParam`/`sendJson`/`sendError`/`ok`/`validationError`/`notFound`/`resolveAgentService`/`resolveModeService`/`peekAgentService`/`getSessionRowOrError`/`mapProviderError`/`parsePaginationQuery`/`createUiRow`）；**仅 re-export `projectMessagesFromJsonl`** | 否（瘦身） |
| `src/http/server.js` | import 改向：领域函数从 `sessionDomain.js`、注册表从 `sessionSseRegistry.js`；持有 registry 实例（`server._opcSseRegistry` 惰性工厂同型），两处驱动点（确认回调回投 :217-226、懒解析接线 :369）直调实例方法；context 袋新增 `getSseRegistry` 注入路由；handler 仍从路由 import（server → route 为正常分层） | 否（接线变化） |
| sessionStore / settingsService / agentService / eventBus | 无变化（本 story 不动 DB 访问方式与服务接口；registry 模块 import eventBus 的 `subscribe` 随 `createSseSubscription` 一同迁入） | 否 |

#### 模块关系图

```
                 ┌──────────────────────────────────────┐
                 │ server.js                            │
                 │  持有 registry 实例（_opcSseRegistry） │
                 │  确认回调/懒解析两处直调实例方法        │
                 └───────┬───────────────┬──────────────┘
            import handler│               │import 领域函数+工厂
                         ▼               ▼
   ┌──────────────────────────┐   ┌─────────────────────────────┐
   │ routes/agentSessions.js  │   │ services/sessionDomain.js   │
   │  纯转发 + admission 编排  │──>│  纯函数：config/投影/key/    │
   │  re-export               │   │  附件/gitState              │
   │  projectMessagesFromJsonl│   └─────────────────────────────┘
   └──────────┬───────────────┘
              │ context.getSseRegistry / createSubscription
              ▼
   ┌─────────────────────────────┐
   │ services/sessionSseRegistry.js│
   │  per-instance 挂起 Map +      │
   │  订阅生命周期（心跳/边界/清理） │
   └─────────────────────────────┘

依赖方向：server → route、server → domain/registry、route → domain/registry。
不存在 route ← domain、不存在 server → route 内部函数。
```

### 10.3 数据流

1. **历史查询**：GET messages → 路由校验/分页参数解析 → `domain.projectMessagesFromJsonl`
   + `domain.paginateMessages` → 响应拼装。行为不变（§6.3 锚点逐条保持）。
2. **发消息**：POST messages → 路由校验（`messageTextError` 留路由 +
   `domain.attachmentsError`）→ `domain.buildSessionConfig` 装配 → 建句柄 →
   `context.getSseRegistry().attachPending(spaceKey, svc)` 补挂接 → 202。
3. **SSE 连接（admission 编排留路由）**：GET events → store 404 检查 →
   writeHead+flushHeaders → `registry.createSubscription(res, spaceKey)` →
   `sub.pushFrame({type:"session-git", ...domain.gitStateForSpace(spaceKey)})` →
   有句柄（peek，不触发惰性创建，ADR-009）→ `sub.attach(existing)`；
   无句柄 → `registry.registerPending(spaceKey, sub)`。
4. **server.js 两处驱动点**：确认回调回投（句柄缺失 → `domain.buildSessionConfig`
   建句柄）+ 懒解析接线 → `registry.attachPending(spaceKey, svc)` 无条件调用
   （无挂起为 no-op，现状语义保持）。
5. **断开/清理**：res close/error/write 失败 → sub.detach 自清（心跳清除、
   事件退订、挂起集自移除）——逐字节搬运不重写。

### 10.4 接口契约

#### 接口名称：createSseSubscriptionRegistry（工厂）

| 项目 | 说明 |
|---|---|
| 调用方 | server.js（持有一个实例，`_opcSseRegistry` 惰性工厂同型接线） |
| 被调用方 | services/sessionSseRegistry.js |
| 输入 | 无 |
| 输出 | registry 实例 `{createSubscription, registerPending, attachPending}` |
| 业务错误 | 无 |
| 系统错误 | 无（纯内存结构构造） |
| 副作用 | 创建实例私有挂起 Map（spaceKey → Set\<sub\>） |
| 幂等性 | 否（每次调用一个独立实例——测试隔离的来源） |

#### 接口名称：registry.createSubscription

| 项目 | 说明 |
|---|---|
| 调用方 | 路由 `handleGetEvents`（admission 编排内） |
| 输入 | `res`（已 writeHead 的 SSE 响应流）、`spaceKey` |
| 输出 | sub `{pushFrame(event), attach(session), detach()}` |
| 业务错误 | 无 |
| 系统错误 | 无（res 写失败 → 自 detach，不上播） |
| 副作用 | 起 15s 心跳注释帧；订阅 eventBus `confirmation-pending`（按 spaceKey 过滤转发，sessionKey 不出帧）；res close/error/写失败 → 自 detach |
| 幂等性 | 否（每连接一个 sub） |

**样例（golden values）**：行为锚点 = 现状逐字节保持——首帧 `data: {"type":"session-git",...}`、心跳 `": keep-alive"` 注释帧 15s、轮次首文本事件前补 `text_start`、单帧 ≤256KB（源头截断单真源 = ADR-029 turnEventPipeline.limitSize，本层不二次截断）。既有 sessionEvents 测试为契约载体。

#### 接口名称：registry.registerPending

| 项目 | 说明 |
|---|---|
| 调用方 | 路由 `handleGetEvents`（无既有句柄分支） |
| 输入 | `spaceKey`、`sub` |
| 输出 | undefined |
| 业务错误 | 无 |
| 系统错误 | 无 |
| 副作用 | 登记进实例挂起 Map；sub.detach 时自移除（现状语义保持） |
| 幂等性 | 同 sub 重复登记被 Set 去重 |

#### 接口名称：registry.attachPending

| 项目 | 说明 |
|---|---|
| 调用方 | server.js 确认回调回投、server.js 懒解析接线、路由 handlePostMessage |
| 输入 | `spaceKey`、`svc`（agentService） |
| 输出 | undefined |
| 业务错误 | 无 |
| 系统错误 | 无（svc 未接线/句柄未创建 → no-op） |
| 副作用 | 有挂起且 `svc.getSession(spaceKey)` 返回既有句柄（不同步惰性创建，ADR-009）→ 逐个 `sub.attach(session)` 并删除该 key 挂起集；任一无 → no-op |
| 幂等性 | 是（无条件调用安全，现状语义保持） |

#### 接口名称：domain 领域函数组（sessionDomain.js 导出）

| 项目 | 说明 |
|---|---|
| 调用方 | 路由（转发路径）、server.js（buildSessionConfig）、既有测试（projectMessagesFromJsonl，经路由 re-export） |
| 输入/输出/错误 | 与现状函数签名完全一致（§6.3 锚点逐条为 golden values）；无新错误形态 |
| 副作用 | `projectMessagesFromJsonl`/`gitStateForSpace` 读文件/DB（只读）；其余纯计算 |
| 幂等性 | 是 |

#### 接口名称：context 袋扩展（server.js → 路由）

| 项目 | 说明 |
|---|---|
| 变更 | context 袋新增 `getSseRegistry: () => registry`（与 `getSessionStore`/`getAgentService` 惰性工厂同型） |
| 消费方 | 路由 `handlePostMessage`（attachPending）、`handleGetEvents`（createSubscription/registerPending） |
| 兼容性 | 既有四项不变；生产 server 必提供新项（同其他工厂项的接线纪律） |
| 未接线语义 | `getSseRegistry` 缺失 → 调用点抛带明确信息的 Error（`getSseRegistry 未接线`）——fail-fast，接线纪律为硬前提（review I3 修订：原契约未规定缺失行为，TypeError 裸崩不可接受；生产 server 恒提供，此分支仅在测试/headless 自建 context 时可达） |

### 10.5 关键决策

| 决策 | 选项 | 选择理由 | 风险 |
|---|---|---|---|
| 注册表形态 | A 工厂实例+context 袋注入 / B class / C 模块级单例 | **A**（人拍板）：与 `_opcXxx` 惰性工厂模式同构；测试隔离自然；C 是全局 Map 换皮（=已被否的方向 C） | 多动三处接线；缓解：接线点少且全部已定位 |
| `createSseSubscription` 归属 | 收编为实例方法 / 留路由 | **收编**（人拍板）：挂起/挂接/清理是同一生命周期，散在两处正是现状的病 | 搬运面 +150 行；缓解：逐字节剪切不重写 |
| 逐函数清单三边界判定 | gitStateForSpace 搬 / 列表拼装五函数留 / messageTextError 留 | **按建议**（人拍板）：评审清单字面范围 + 单端点 presentation 不搬 + HTTP 输入校验留路由 | 范围争议已在 PRD 固化，BUILD 无裁量空间 |
| 文件组织 | A 两文件（纯/有状态分离） / B 单文件 | **A**（人拍板）：与 sessionStore/confirmationService 粒度一致；execution-runner runner+queue 先例；纯函数单测不加载 SSE 机制 | 多一个文件；无实质风险 |
| re-export 面 | 4 名 / 1 名 | **1 名**（tech-design 事实纠正后确认）：测试实际只用 `projectMessagesFromJsonl`；最小兼容面 | 若有隐藏消费者会断——已全仓 grep 排除（仅 server.js + 测试） |
| 依赖方向验证 | 设计纪律审读 / 静态源码测试 | **新增静态 seam 测试**（domain/registry 源码不得 import routes/；server.js 不得从路由 import 领域函数）——feishuReadonly 同款先例，方向回正变机器可验 | 静态测试脆性（import 语句文本匹配）；可接受 |

### 10.6 风险与回流点

| 假设 | 如果错了会怎样 | 回流到 | 能否快速验证 |
|---|---|---|---|
| per-instance 注入面可控（三处接线点已全定位） | 接线发散出第四处隐藏驱动点 | TECH-DESIGN（重审注册表形态）；极端时降级方向 C（需人拍板 + signoff 记录降级理由） | 能：全仓 grep 已定位三处 |
| 既有测试不依赖「模块级 Map 跨 server 实例泄漏」语义 | 某测试隐性依赖旧泄漏 → 红 | BUG（test-gap 裁决）；大概率不成立（挂起 sub 持有死连接 res，跨实例 attach 无意义） | 能：BUILD 切片 1 即跑全量 |
| SSE 行为逐字节搬运无漂移 | 心跳/边界/过滤语义漂移 → sessionEvents 红 | BUG（code-defect，修复搬运偏差） | 能：既有 SSE 测试即契约 |
| 路由瘦身后不含 sendCard/channelManager/cardRenderer 字样 | feishuReadonly 静态断言红 | BUG（code-defect，清理路由注释/引用） | 能：静态断言秒级反馈 |

### 10.7 安全/性能/可观测性

- **安全**：`buildSessionConfig` 的 apiKey 一次性注入、明文不落盘语义原样搬迁（ADR-026 解析单点不变）；feishuReadonly「UI 会话无飞书消息桥」静态断言面保持（路由不引入 sendCard/channelManager/cardRenderer）；图片附件白名单/大小/路径校验规则与短路顺序不变（§7.1）。
- **性能**：无新关键路径；挂起 Map 查找 O(1) 不变；投影/分页算法不变。注册表 per-instance 消除同进程跨实例状态堆积（轻微正向）。
- **可观测性**：无新关键路径，不新增 telemetry seam（对齐 checklists/observability.md——纯结构搬迁不改变运行时可观测面）。

## 11. 测试决策（Testing Decisions）

### 11.1 覆盖接缝（coverage seams，CLI 优先）

| 稳定块 | Seam | 测试类型 | 依赖处理 |
|---|---|---|---|
| 1 config 装配 | `sessionDomain.buildSessionConfig` | 单元 | store stub（`{get()}`）；settingsService 真实（现状测试即如此） |
| 2 投影/分页 | `sessionDomain.projectMessagesFromJsonl`/`paginateMessages` | 单元 | 临时 JSONL 文件真实写读；分页纯函数直调 |
| 3 key 解析 | `sessionDomain.uiGroupPrefixFor`/`projectIdOf`/`newUiSpaceKeyFor` | 单元 | 纯函数直调 |
| 4 SSE 注册表 | `sessionSseRegistry.createSseSubscriptionRegistry()` → 实例三方法 | 单元 | svc stub（`getSession`）；res stub 验帧/心跳/detach；eventBus 真实（进程内 pub/sub） |
| 5 附件规则 | `sessionDomain.attachmentsError` | 单元 | 临时文件真实 existsSync |
| 6 依赖方向/兼容面 | ① 既有测试文件（路由 seam 门 + HTTP 驱动 + `projectMessagesFromJsonl` re-export）零改动全绿；② **新增静态 seam**：读 `sessionDomain.js`/`sessionSseRegistry.js`/`server.js` 源码断言 import 方向（domain/registry 不得 import routes/；server.js 不得从路由 import 领域函数）——feishuReadonly.test.js 同款先例 | 集成（既有回归）+ 静态 | 真实 |

### 11.2 测试策略与先例

- 只测外部行为：domain 模块的导出函数契约（输入→输出/副作用），不测内部组织。
- 新增单测全部打 domain 模块 seam；既有 10 文件继续打路由 re-export（证明兼容面）。
- 先例：execution-runner「测试 seam 迁入 runner + taskService 兼容转发」（REQ-FLOW-053）；
  本 story 的 re-export 保面与之同构。既有先例测试：
  `tests/capabilities/agent-dialogue/conversation-space/2026-08-02-ui-copilot/api/sessionEvents.test.js` 等 10 文件。

## 12. 范围外

- SSE 事件契约/payload 任何变更（含帧字段、心跳间隔、text_start 宣告逻辑）。
- HTTP API 形状/状态码/错误码任何变更。
- sessionStore/DB 访问方式改造（归 `2026-08-16-deepen-db-per-path-cache`）。
- permission 确认链收编（归 `2026-08-16-deepen-permission-adjudication`）。
- `cardRenderer.js`（仅注释提及路由，无代码依赖）。
- UX 面：本 story 无用户界面（DESIGN 阶段 N/A，跳过）。

## 13. 补充说明

- 兄弟 story 边界：本 story 先行（结构搬迁先落定），db-per-path-cache 后做改的是
  sessionStore 内部实现，冲突面最小（访谈 Q4 拍板）。
- 若实施中发现 per-instance 注册表注入面过大，可退到方向 C（注册表保持模块级
  全局只换住处）——但需人拍板，且要在 signoff 记录降级理由。
- ADR 关联：ADR-016（ui 空间 key 语法）、ADR-009（events 连接不惰性启动 agent）、
  ADR-026（会话模型配置解析单点）。本次决策落盘 **ADR-030**（session-domain 收编 +
  per-instance SSE 注册表 + 依赖方向回正，/tech-design 产出）。
- §14 技术方案行：§10 已补全（10.1-10.7），GAP 消解。

## 14. PRD 完整性自检查

| 检查项 | 状态 | 备注 |
|---|---|---|
| 操作流 | PASS | §6.1 六条 happy path + §6.2 分支异常，覆盖六个稳定块 |
| 输入验证 | PASS | §7 无表单声明 + 接口级规则锚定（含有效/无效例子，§6.3） |
| 错误状态 | PASS | §8 七场景全为现状保全项 |
| 预期值锚点 | PASS | 块 1/2/3/5 在 §6.3 ≥2 条字面值锚点；块 4（SSE golden）/块 6（依赖方向静态 seam）锚点分布于 §10.4/§11.1；全部取自现行代码快照（review 修正原「每块 ≥2 条」字面声明） |
| 复杂度分级 | complex | §9 |
| 技术方案（§10） | PASS | complex：§10.1-10.7 已由 /tech-design 深潜补全（四问拍板，2026-08-17） |

---

## 版本记录

| 版本 | 日期 | 变更 | 作者 |
|---|---|---|---|
| v0.1 | 2026-08-17 | 初稿（访谈五项 GUESS 全确认，方向 A） | AI + 人 |
| v0.2 | 2026-08-17 | tech-design 定稿（§10.1-10.7 / ADR-030，四问逐题拍板）+ §5 移动块清空 + §4 块6/§11.1 re-export 1 名反向同步 | AI + 人 |
| v0.3 | 2026-08-17 | signoff 就地补（§2 re-export 1 名更正 + §6.3 空 providers 锚点行）+ **review 修订**（FAIL 两项阻塞消解：路由行数目标 ~300→~600/阈值 ≤650 人拍板；gitState 正分支改直测承载 人拍板；§1「2 领域函数」措辞、函数清单 41 点名、「纯函数」标签修正、context 袋未接线语义 fail-fast、§10.4 错误行补齐 + 改引 ADR-029 单真源、§14 锚点声明修正） | AI + 人 |
