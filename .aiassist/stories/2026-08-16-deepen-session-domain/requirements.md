# Requirements — Session Domain 深化（会话领域逻辑搬出路由层）

> 故事 ID：`2026-08-16-deepen-session-domain`
> 版本：v2
> 最后更新：2026-08-17
> 来源：`prd.md` v0.3（§4 六稳定块；§10 技术方案已由 /tech-design 深潜定稿，
> 四问逐题人拍板 2026-08-17；/review 修订——行数阈值 ≤650 与 gitState 正分支
> 直测承载，两项阻塞人拍板 2026-08-17）
> v1 → v2 变更：REQ-112 AC1 措辞修正（provider 空→回落）+ 空 providers golden 落 AC；
> REQ-113 契约补 normalizeLimit；REQ-114 契约删幻影字段 worktree? + AC4 正分支
> 改直测承载；REQ-116 AC4 回归载体更正为 imageAttachment；REQ-117 AC4 回归清单
> 改全量表述 + AC5 行数 ≤350→≤650；REQ-112 AC3 代码审查挪 REFLECT 备注
> 移动块：无（§5 已清空，两块全解决）
> UX 参照：N/A（纯内部架构重构，无用户界面；DESIGN/DOMAIN-MODEL 阶段跳过）
> ADR：ADR-030（sessionDomain 纯函数 + sessionSseRegistry per-instance +
> 依赖方向回正 + re-export 最小面 + 行为字节级不变）
> 测试目录：`tests/capabilities/agent-dialogue/conversation-space/2026-08-16-deepen-session-domain/api/`
> 硬约束：既有测试文件零改动全绿（兼容面 = 路由文件存在 + `projectMessagesFromJsonl`
> re-export + HTTP/SSE 行为不变）；本 story 不动 sessionStore 接口与 DB 访问方式
> （归 2026-08-16-deepen-db-per-path-cache）。

---

## REQ-AGENT-112 sessionDomain 模块新建与 config 装配搬迁

- 优先级 P0 / 必须 / cross-module / sessionDomain（新增）+ routes/agentSessions（瘦身）+ server.js（import 改向）/ agent-dialogue / conversation-space / 单元 + 集成
- 接口契约：`buildSessionConfig(spaceKey, store) → {provider, model, apiKey, identity}`，签名与语义与现状逐字节一致；从 `src/services/sessionDomain.js` 导出

验收标准：
1. `buildSessionConfig` 从 `src/services/sessionDomain.js` 导出且行为不变：无参/无行调用 `buildSessionConfig(undefined, undefined)` → 返回默认组合（`resolveSessionModelConfig` 单点解析，resolved.provider **为空** → 回落 DEFAULT_PROVIDER="deepseek"）；settings 无已配置 providers（`providers: []`）→ `{provider:"deepseek", model:"", apiKey:undefined, identity:""}`（§6.3 锚点字面值）（单元：store stub）。
2. 行值优先语义保持：store 行 `{provider, model}` 有值 → 按行解析；NULL/条目已删 → 回落默认组合（单元：store stub 三态——有行/NULL 列/条目已删）。
3. apiKey 明文不落盘语义保持：返回对象含 `apiKey: settingsService.entryApiKey(resolved.entry)`（单元断言字段存在与取值）；装配路径不产生任何持久化写——由 REFLECT diff 审读人工确认（人眼判断不进 AC 断言）。
4. server.js 确认回调回投路径（server.js:217 区域）改从 sessionDomain import，「稍后处理」场景建句柄行为不变（集成：assistantConfirm 既有测试绿）。

## REQ-AGENT-113 历史投影与分页搬迁

- 优先级 P0 / 必须 / intra-module / sessionDomain（新增）/ agent-dialogue / conversation-space / 单元
- 接口契约：`projectMessagesFromJsonl(sessionRef) → [{messageId, role, createdAt, text}]`；`paginateMessages(messages, {limit=100, before}) → messages[]`；`normalizeLimit(limit) → 正整数或默认 100`（路由 HTTP 层直接调用）；签名语义逐字节一致

验收标准：
1. 投影 golden case：JSONL 含 `{"type":"message","id":"m1","timestamp":"2026-08-01T10:00:00Z","message":{"role":"user","content":"你好"}}` 一行 → 返回 `[{messageId:"m1", role:"user", createdAt:"2026-08-01T10:00:00Z", text:"你好"}]`（单元：临时 JSONL 真实写读）。
2. 工具不落历史（BUG-009 语义）：`role:"toolResult"` 行与无 text 段的 assistant 行不投影；空文本行（text 段 trim 后为空，user/assistant 均生效）同样剔除（单元）。
3. 附件名标记（REQ-AGENT-097 语义）：content 数组含 `{type:"image", name:"tiny.png"}` → text 含字面子串 `[图片: tiny.png]`；无 name → `[图片]`（单元）。
4. 降级语义：文件不存在 → `[]`；单行非法 JSON → 跳过该行不阻断其余；`type!=="message"` 行（session 头/事件/compaction）跳过（单元）。
5. 分页 limit 归一化：`limit` 为 0 / -3 / 2.5 / NaN / 非数字 → 按 100 处理；正整数原样（单元，§6.3 锚点）。
6. before 游标语义：`before="m3"`（在数组中）→ 严格早于 m3 的窗口取最新 limit 条；游标不在数组中 → 视为无游标返回最新窗口；返回数组保持时间升序（单元）。
7. 直测 seam 成立：以上断言全部直调 `sessionDomain` 导出函数完成，不经 HTTP（单元测试文件存在且全绿即证）。

## REQ-AGENT-114 空间 key 解析与会话元数据投影搬迁

- 优先级 P0 / 必须 / intra-module / sessionDomain（新增）/ agent-dialogue / conversation-space / 单元
- 接口契约：`uiGroupPrefixFor(spaceKey) → string|undefined`；`projectIdOf(spaceKey) → string|undefined`；`newUiSpaceKeyFor(spaceKey) → string|undefined`；`gitStateForSpace(spaceKey) → {state, branch?}`（三态 branch/detached/none——readGitBranch 现行返回形状，无 worktree 字段；v1 契约的 `worktree?` 系幻影字段，v2 删除）；ADR-016 语法不变

验收标准：
1. `uiGroupPrefixFor("ui:project:p1:s1")` → `"ui:project:p1:"`；`uiGroupPrefixFor("ui:copilot:abc")` → `"ui:copilot:"`；`uiGroupPrefixFor("feishu:xxx")` → `undefined`（单元，§6.3 锚点）。
2. `projectIdOf("ui:project:p1:s1")` → `"p1"`；`projectIdOf("ui:copilot:abc")` → `undefined`；非字符串输入（null/undefined/数字）→ `undefined`（String 包裹语义保持）（单元）。
3. `newUiSpaceKeyFor("ui:project:p1:s1")` → 以 `"ui:project:p1:"` 为前缀、余段为合法 UUID；非 ui 空间 → `undefined`（单元）。
4. `gitStateForSpace` 三态保持：非项目空间/项目已删/localPath 空/DB 异常 → `{state:"none"}`（单元直测）；**正分支直测**（v2 修订——review 实证既有测试零覆盖且 DB 读取为 catch-all，none 断言钉不住 DB 路径搬坏）：DB_PATH 临时库 seed projects 行（localPath → 真实临时 git 仓，sessionStats _fixture 先例）→ `{state:"branch", branch:<名>}`；临时仓 detached HEAD → `{state:"detached"}`（单元）。

## REQ-AGENT-115 SSE 订阅注册表 per-instance 收编

- 优先级 P0 / 必须 / cross-module / sessionSseRegistry（新增）+ server.js（实例持有+两处直调）+ routes/agentSessions（context 袋消费）/ agent-dialogue / conversation-space / 单元 + 集成
- 接口契约：
  - `createSseSubscriptionRegistry() → {createSubscription, registerPending, attachPending}`（实例私有挂起 Map：spaceKey → Set\<sub\>）
  - `createSubscription(res, spaceKey) → sub {pushFrame(event), attach(session), detach()}`
  - `registerPending(spaceKey, sub) → undefined`（Set 去重；detach 自移除）
  - `attachPending(spaceKey, svc) → undefined`（有挂起且 `svc.getSession(spaceKey)` 返回既有句柄 → 逐个 attach 并清该 key 挂起集；否则 no-op，幂等）
  - context 袋新增 `getSseRegistry: () => registry`（惰性工厂同型）

验收标准：
1. 实例隔离：两个 `createSseSubscriptionRegistry()` 实例的挂起状态互不可见——实例 A 的 registerPending 不被实例 B 的 attachPending 消费（单元；模块级全局 Map 消亡的直接证据）。
2. attachPending 幂等 no-op 矩阵：无挂起 → no-op；有挂起但 `svc.getSession` 返回 null/undefined → no-op 且挂起集保留；有挂起且有句柄 → 全部 sub.attach(session) 后该 key 挂起集清空（单元：svc stub 三态 + sub stub 计数）。
3. createSubscription 生命周期：attach 后 session 的 "session-event" 事件原样转发为 `data: <json>\n\n` 帧；轮次首个文本事件（text_delta/text_end）前补发 text_start、text_end 后重置；15s 心跳注释帧 `: keep-alive`；confirmation-pending 按 spaceKey 过滤转发且帧不含 sessionKey 字段（单元：res stub 验帧 + eventBus 真实 + 假时钟）。
4. detach 自清理：res close/error/write 抛错 → sub 自动 detach（心跳清除、事件退订、挂起集移除）；重复 detach 安全（单元）。
5. 三处驱动点接线：server.js 确认回调回投与懒解析接线直调实例 `attachPending`；路由 handlePostMessage 经 `context.getSseRegistry()` 调实例（集成：既有 sessionEvents/assistantConfirm 测试绿即证）。
6. 挂起→挂接全链路：events 连接先于首条消息打开（挂起登记）→ POST messages 建句柄 → 事件自下一轮回流起持续收流（集成：既有 sessionEvents 测试绿即证；REQ-AGENT-028 标准 5 语义不变）。

## REQ-AGENT-116 附件规则搬迁

- 优先级 P0 / 必须 / intra-module / sessionDomain（新增）/ agent-dialogue / conversation-space / 单元
- 接口契约：`attachmentsError(attachments) → {code, message}|undefined`；常量 `IMAGE_MIME_TYPES`/`MAX_ATTACHMENTS=10`/`MAX_ATTACHMENT_BYTES=10*1024*1024` 随迁；校验短路顺序：类型 → 数量 → 大小 → 路径

验收标准：
1. 四规则 golden values：非白名单 mimeType（如 `text/plain`）→ `{code:"E-ATTACH-TYPE", message:"仅支持图片（jpeg/png/gif/webp/bmp/heic/heif）"}`；11 个合法附件 → `{code:"E-ATTACH-COUNT", message:"每条消息最多附加 10 个文件"}`；单附件 size=10*1024*1024+1 → `{code:"E-ATTACH-SIZE", message:"图片过大（单图 ≤10MB）"}`；path 不存在 → `{code:"E-ATTACH-PATH", message:"文件不存在"}`（单元，§6.3 锚点逐字）。
2. 合法附件数组 → `undefined`；mimeType/size/path 非期望类型（非 string/非 number）→ 对应规则命中（单元）。
3. 短路顺序：同时违反类型与数量 → 先报 E-ATTACH-TYPE（单元，§7.1）。
4. HTTP 面不变：POST messages 带违规附件 → 400 + 对应错误码封套（集成：既有 **imageAttachment** 测试绿即证——v2 更正：E-ATTACH-* HTTP 断言实测在 imageAttachment.test.js:188-222，v1 误写 sessionMessage）。

## REQ-AGENT-117 依赖方向回正与路由瘦身

- 优先级 P0 / 必须 / cross-module / routes/agentSessions（瘦身 ~928→~600 行）+ server.js（import 改向）+ sessionDomain/sessionSseRegistry / agent-dialogue / conversation-space / 集成 + 静态
- 接口契约：路由保留导出 `handleAgentSessions`/`handleAgentLastMode`（handler 本就住路由，server → route 为正常分层）+ 仅 re-export `projectMessagesFromJsonl`（测试唯一实际使用名）；server.js 的领域函数 import 全部来自 services 层新模块

验收标准：
1. 静态方向断言：`src/services/sessionDomain.js` 与 `src/services/sessionSseRegistry.js` 源码不 import `routes/` 下任何模块；`src/http/server.js` 不从 `routes/agentSessions.js` import `buildSessionConfig`/`attachPendingSseSubs`（静态：读源码正则断言，feishuReadonly.test.js 同款先例）。
2. 兼容面保全：路由文件存在且 re-export `projectMessagesFromJsonl` 可用（既有测试 seam 门 + historyToolFilter 直调绿即证）；既有测试文件零改动。
3. 无消息桥断言保持：瘦身后的路由源码不含 `sendCard`/`channelManager`/`cardRenderer` 字样（既有 feishuReadonly 静态断言绿即证）。
4. HTTP/SSE 行为字节级不变：既有测试全量零改动全绿（v2 改全量表述——v1 清单枚举 10 文件名，实测含不消费 HTTP 面的 cardStream 且漏 imageAttachment/sessionStop 等真实消费方；硬约束由头部「既有测试文件零改动」兜底）（集成回归）。
5. 路由瘦身实证：`src/http/routes/agentSessions.js` 行数 ≤ 650 行（转发 + admission 编排 + 列表拼装 + web 杂务；目标 ~600——v2 修订：review 算术复核搬走 ~300-330 行后留存 ~600，v1 的 ~300/≤350 不可行，2026-08-17 人拍板重定；650 为含注释余量上限）（静态：行数断言）。

---

## REFLECT 人工验收备注

- 无纯审美判断项（本 story 无 UI）。最终验收 = 既有回归全绿 + 新增单测全绿 +
  依赖方向静态断言绿 + diff 审读（逐字节搬运纪律）。
