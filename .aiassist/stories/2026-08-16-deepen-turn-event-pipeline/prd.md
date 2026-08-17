# 回合事件管线深化——turnEventPipeline

> 状态：结晶中
> 故事 ID：`2026-08-16-deepen-turn-event-pipeline`
> 最后更新：2026-08-17

---

## 1. 问题陈述

worker.js 是不可导入的 1854 行进程入口：一回合的事件状态机碎在三处——text_end
延迟转发（pendingTextEnds + 5s 兜底）、abort 合成收尾（stopReason=aborted →
合成 text_end）、淘汰清理（8 个状态 Map 手工配对，且与重置清理是两份近亲复制，
已抄岔：重置版漏 toolContexts/sessionQueues；两个诊断计数 Map 只在成功路径删，
报错/淘汰/重置都不删——长期泄漏）。这些纯函数（转发/映射/截断/合成）零直测——
全项目 BUG 密度最高的区域（BUG-002/003/004/006/007/010/014 均出自这里）却无法
透过 interface 测。256KB 尺寸契约双实现已实证漂移：主进程那份（agentService
`enforceSizeLimit`）没有工具事件数据载体分支，工具事件超限会整条降级成
`{type, truncated}`，把 toolCallId/name/status/isError 全丢。

一句话痛点：**回合状态机的知识没有属主，BUG 密度最高的区域却无法透过
interface 测。**

## 2. 解决方案

新建可 import 的 turnEventPipeline 模块：一回合的事件转发/映射/延迟收尾/abort
合成/尺寸截断 + 回合状态 Map 收进一个家；淘汰与重置清理统一为**注册表一条路径**
（装配态 Map 也登记，worker 仍持有）；256KB 截断单真源（worker 那份强的成为唯一
实现，agentService 三处调用点改 import）。worker.js 退回 IPC + 装配壳（保持
spawn-only、零导出、零 import）。事件形状/转发顺序/abort 语义/淘汰副作用全部
照旧；唯二行为变化：① 主进程侧工具事件超限不再整条降级（保契约字段）；
② 清理统一后重置补删 2 个装配态 Map、淘汰/重置必清 2 个诊断计数（修泄漏）。

## 3. 用户故事

1. 作为开发者，我想要回合事件状态机只有一个可 import 的模块，以便直接写单元测试
   （注入 send/时钟）而不必 spawn 真进程。
2. 作为开发者，我想要淘汰/重置的清理清单只有一个真源，以便不再手抄两份清单。
3. 作为开发者，我想要 256KB 截断只有一个实现（worker 那份强的），以便主进程工具
   事件超限不再整条降级丢契约字段。
4. 作为开发者，我想要 worker.js 仍是 spawn-only 零导出的进程入口，以便既有打包
   （vite.worker.config.js）与启动链路不破。

## 4. 稳定块（已稳定，可结晶为 REQ）

| # | 稳定块 | 为什么不再推翻 |
|---|---|---|
| 1 | turnEventPipeline 模块：可 import、import 无副作用（注入 send/时钟）；收编 forwardEvent / mapToContractEvent / limitSize / 延迟 text_end（pendingTextEnds + 5s 兜底）/ abort 合成 / 回合状态 Map（lastReplies / turnEventCounts / sdkEventCounts / turnStartedAt / pendingTextEnds） | 需求洞察 Q1 人拍板；评审 #2 方向；sessionLifecycle 同模式先例已实证可抽离 |
| 2 | 会话状态注册表统一清理：registerSessionMap + clearSessionState(sessionKey)——淘汰/重置一条代码路径清全部登记 Map；装配态 Map（toolContexts / sessionQueues / sessionModes / judgeModels）登记但 worker 持有；顺手修「两份清单抄岔 + 计数泄漏」 | 需求洞察 Q1 人拍板「按你说的，顺手修掉」 |
| 3 | 256KB 截断单真源 + 主进程行为修复：limitSize（worker 强实现）为唯一真源；agentService enforceSizeLimit 删除、3 个调用点（emitErrorEvent / inMemory runTurn / 子进程消息回传）改 import；MAX_IPC_BYTES 常量单源 | 需求洞察 Q2 人拍板「修」 |
| 4 | worker.js 接线保持：spawn-only 零导出零 import；forwardEvent 调用点迁入管线入口；handlePrompt 经管线接口读 lastReply/诊断计数；淘汰/重置 handler 改用 clearSessionState；行为契约不变 | 需求洞察 Q4 澄清 + 硬约束（打包/启动链路） |

## 5. 移动块（已全部解决，2026-08-17 /tech-design 深潜；历史留痕）

> 全部已解决（/tech-design 深潜，2026-08-17）：
> #1 注册表 API → registerSessionScopedMap(map) + registerSessionCleanup(fn) +
> clearSessionState(sessionKey)（§10.4）；
> #2 管线接口集 → onSessionEvent / beginTurn / takeLastReply / takeTurnDiagnostics /
> clearSessionState / limitSize 六接口（§10.4）；
> #3 reset 补删 → 实证 lifecycle.remove 不碰 worker 侧 Map、sessionQueues 残留真实
> 存在；人拍板「A：清」（reset 丢排队操作，§8 记录）；
> #4 双入口 → 实证模块零外部依赖（仅全局 timer/Date）、services→agent import 有
> toolAdapter 先例（permissionPolicy.js:32）。当前无移动块。

## 6. 用户操作流（Operation Flows）

### 6.1 主流程 / Happy Path

| 步骤 | 用户动作（开发者可观察行为） | 系统响应 | 验收锚点 |
|---|---|---|---|
| 1 | 注入 send/假时钟直调管线入口，喂 message_update text_delta×2 + text_end + message_end | text_delta×2 即时转发；text_end 延迟到 message_end 后转发，带 meta{durationMs, tokensIn, tokensOut} | 事件顺序 text_delta…text_end；meta 三字段齐全（usage 完备时） |
| 2 | message_end 缺失（异常中断） | 5s 兜底定时器触发，text_end 照发（仅 durationMs） | 假时钟推进 5000ms → flush 发生，tokens 字段缺失 |
| 3 | message_end stopReason=aborted 且无 pending | 合成 text_end（content = 已生成文本拼接）后冲刷 | content 非空；text_end 已发；prompt-result reply 有值 |
| 4 | 淘汰会话（TTL/LRU/同组） | clearSessionState 清全部登记 Map（含诊断计数）；session-evicted 照发；pending 定时器 clear 不悬挂 | 计数 Map 无该 key；无后续补发 text_end |
| 5 | 重置会话（/reset） | clearSessionState 清全部登记 Map（含装配态 2 Map + 诊断计数） | 各登记 Map 无该 key |
| 6 | 超限工具事件经主进程出口（子进程回传 / inMemory） | limitSize 截断数据载体（input/output），保 toolCallId/name/status/isError + truncated:true | 契约字段齐全；序列化 ≤ 262144 |
| 7 | 超限文本事件（content/delta） | 载体截断 + truncated:true | 序列化 ≤ 262144 |

### 6.2 分支与异常

| 触发条件 | 分支结果 | 对应错误状态 |
|---|---|---|
| 未知 sessionKey | 事件照常计数/转发/延迟收尾/出站；仅生命周期活动刷新为 no-op（review B3 实证：forwardEvent 无 key 守卫，消息乱序容忍=事件不丢失） | —（正常态，保持现状） |
| 超限且无载体（非 content/delta/input/output） | { type, truncated:true } 兜底 | 截断降级（保持现状） |
| usage 缺失（兜底路径） | meta 仅 durationMs | —（正常态，renderer 显示「-」） |
| FAUX usage 空/0 | tokensIn/Out 按值原样带（0 → renderer 显示「-」） | —（正常态） |
| 淘汰时 pending 未冲刷（message_end 先于淘汰未到） | 定时器 clear，不补发 text_end | —（正常态，已生成的回合收尾放弃） |
| abort 时已有 pending（正常 text_end 已到） | 不合成，走正常冲刷 | —（正常态） |

### 6.3 预期值锚点（Expected-Value Anchors）

| 稳定块 | 输入 | 预期输出/结果 | 依据（需求 / 已签标准 / 真实代码） |
|---|---|---|---|
| 1 | 直调入口：text_delta×2 + text_end + message_end(usage={input:1000, output:2000}) | 转发 2 条 text_delta；text_end 在 message_end 后转发，meta = {durationMs ≥ 0, tokensIn: 1000, tokensOut: 2000} | worker.js:640-647 现状（REQ-AGENT-057） |
| 1 | 假时钟推进 5000ms，期间无 message_end | text_end 照发，meta 仅含 durationMs（无 tokensIn/tokensOut 字段） | worker.js:622, 633-649（PENDING_TEXT_END_FALLBACK_MS=5000） |
| 1 | message_end{stopReason:"aborted"} 且 pending 空 | 合成 text_end，content = msg.content 中 type=text 段拼接；随后冲刷 | worker.js:686-695（BUG-010 修复，REQ-AGENT-091） |
| 1 | 直调入口：text_delta×2 + text_end + tool_execution_start 各一 | 诊断计数 turnEventCounts = {delta: 2, end: 1, tool: 1} | worker.js:654-661（BUG-002 诊断） |
| 2 | clearSessionState(key)（淘汰/重置触发） | 注册表内全部登记 Map 无该 key——含 toolContexts / sessionQueues / sessionModes / judgeModels / lastReplies / turnEventCounts / sdkEventCounts / turnStartedAt / pendingTextEnds | handleSessionEvicted 语义 + 修泄漏（interview 确认） |
| 3 | tool_execution_end 携带 input=300KB 字符串 | 保 toolCallId/name/status/isError；input 截断；truncated:true；序列化 ≤ 262144 | worker.js:524-538（REQ-AGENT-055 加法扩展） |
| 3 | text_end 携带 content=300KB 字符串 | content 截断 + truncated:true；序列化 ≤ 262144 | worker.js:518-520（MAX_IPC_BYTES = 256×1024 = 262144） |
| 4 | spawn 全链路：prompt → session-event 出站 text_delta×N + text_end（带 meta.durationMs）+ prompt-result reply 非空且含本轮文本 | 事件顺序 delta…end；reply = 本轮文本（连续两轮不串轮） | workerWiring seam（既有 REQ-AGENT-006/028/057/091 契约） |

## 7. 表单与输入验证（Form / Input Validation）

本 story 无用户输入表单（纯内部架构重构）。接口级校验保持现状——事件形状由既有
契约（REQ-AGENT-006/009/012/055/057/091）锁定，管线入口的事件协议契约在
§10.4（/tech-design 深潜定稿）承载，不在此节。

### 7.1 跨字段/业务规则

| 规则 | 触发时机 | 例子（触发 → 期望结果） | 错误状态 |
|---|---|---|---|
| 单条 session-event 出站恒 ≤ 262144 | 每次转发/冲刷 | 300KB 事件 → 截断后出站 ≤ 262144 | truncated 标记（保契约字段优先） |
| abort 合成仅当「stopReason=aborted 且无 pending」 | message_end 到达 | aborted + pending 空 → 合成；aborted + pending 非空 → 不合成 | — |

## 8. 错误状态与失败响应（Error States / Failure Responses）

| 场景 | 触发条件 | 错误码/消息 | 用户可见状态 | 副作用/回滚 |
|---|---|---|---|---|
| 事件超限（文本载体） | JSON 长度 > 262144 | truncated:true，content/delta 截断 | 事件完整形状、文本尾部截断 | 无 |
| 事件超限（工具数据载体） | input/output > 262144 | truncated:true，数据载体截断（迭代收紧） | 契约字段保留（主进程侧行为修复，Q2 批准） | 无 |
| 事件超限（无载体） | 其余形状超限 | { type, truncated:true } 整条降级 | 仅 type 可见（保持现状兜底） | 无 |
| message_end 缺失 | 异常中断 | 5s 兜底照发 | text_end 仅 durationMs | 定时器 unref；不悬挂 |
| abort 掐断流 | stopReason=aborted | 合成 text_end | 已生成文本保留；UI streaming 复位；reply 有值 | lastReplies 更新 |
| 淘汰时 pending 未冲刷 | evict 先于 message_end | 定时器 clear 不补发 | 无悬挂、无幽灵事件 | 状态随 clearSessionState 清 |
| 未知 sessionKey | 消息乱序 | 静默 no-op | 保持现状 | 无 |
| 主进程兜底超限 | 子进程事件仍超限 | limitSize 截断 | 保契约字段（不再整条降级） | 无 |
| reset 时排队操作 | reset 到达前已入队未出队 | **场景不存在**（review B1 实证：全局串行队列——reset-session 排在在途 prompt 之后处理，prompt 必然先完成；「排队丢弃 + E-AGENT-RESET 回执」契约已撤销） | 在途/先到 prompt 按序完成；reset 后新 prompt 走既有 E-AGENT-NO-SESSION（直至新 session-config 重建） | 无（现状语义保持） |

## 9. 复杂度分级

| 维度 | 取值/说明 |
|---|---|
| 复杂度 | **complex** |
| 判断理由 | 12 个状态 Map / ~86 处引用迁移；事件协议映射多分支（message_update/工具事件/abort）；双进程入口（子进程 vite bundle + 主进程 node import）共用同一模块需打包确认；清理语义统一带行为变化（reset 补删 + 计数清理）；大量已签契约（REQ-AGENT-006/009/012/035/055/057/091）锁定事件形状，契约保持走查面大；需 /tech-design 深潜接口契约 |

## 10. 技术方案（Implementation Decisions）

> 已由 `/tech-design` 深潜定稿（2026-08-17）：两项对抗式决议（reset 清队列 A /
> 计数清时机 B）人拍板；六接口契约；§5 移动块四块全解决。

### 10.1 设计目标

一回合的事件状态机收进一个可 import 的工厂模块并直测；淘汰/重置清理清单单真源
（注册表一条路径，装配态 Map 登记、worker 持有）；256KB 截断契约单实现（取强）；
worker.js 保持 spawn-only 零导出；清理语义统一（reset 清队列，人拍板）。

### 10.2 模块与边界

| 模块 | 职责 | 是否新增 |
|---|---|---|
| turnEventPipeline（工厂 createTurnEventPipeline） | 事件转发/映射/截断/延迟收尾/abort 合成 + 回合状态 Map + 会话状态注册表；import 无副作用，注入 {send, log, touch, setTimeout, clearTimeout, now}；导出 limitSize + MAX_IPC_BYTES | 是 |
| worker.js | 瘦身：IPC 收发 + 会话装配 + lifecycle 接线 + 权限/FAUX/序列队列；副作用（dispose/send/log）保留；evict/reset handler 改调 clearSessionState | 否（瘦身） |
| agentService.js | enforceSizeLimit 删除 → 3 调用点（emitErrorEvent / inMemory runTurn / 子进程消息回传）import limitSize | 否（接线） |
| sessionLifecycle.js | 不动（onEvict 回调仍由 worker 侧注入，回调体改调 clearSessionState） | 否 |

#### 模块关系图

```
[PI SDK 事件] ──────────> [turnEventPipeline 工厂] ──send(注入)──> [worker IPC stdout]
      │                              │ 注册表（回合态自登记 + 装配态登记）
      │                              ├─clearSessionState ──<── [evict/reset handler(worker)]
[worker handlePrompt] ──beginTurn/takeLastReply/takeTurnDiagnostics──> ┘
[agentService 出口 ×3] ──limitSize(import 单真源)──────────────────> ┘
```

### 10.3 数据流

1. **触发**：SDK 事件 → onSessionEvent(sessionKey, ev)（forwardEvent 本体）。
2. **计数与起点**：text_delta/text_end/tool_execution 计数（turnEventCounts）；
   text_start/text_delta 首达记 turnStartedAt（无则首个 delta 兜底）。
3. **延迟队列**：text_end 入 pendingTextEnds（armed 5s 兜底定时器，unref）；message_end
   到达 → flush（usage 完备 → meta 三字段）。
4. **abort 合成**：message_end stopReason=aborted 且无 pending → 合成 text_end 入队后冲刷。
5. **映射与出站**：mapToContractEvent（契约形态透传）→ 事件实际映射出站时调用
   注入 touch(sessionKey)（恒 clearPending:false 语义由注入方承担——review B2：
   缺失会导致长回合 TTL 淘汰悬崖或组冷却双热回归，REQ-AGENT-037 M1）→ limitSize
   → send。
6. **清理**：evict/reset → clearSessionState(key)（先 dispose 后清，顺序保持现状）；
   prompt 开始 → beginTurn(key)（幂等清诊断计数）；prompt-result →
   takeTurnDiagnostics(key)（取出即删）+ takeLastReply(key)（读取不删）。

### 10.4 接口契约

#### 接口 1：onSessionEvent(sessionKey, ev)

| 项目 | 说明 |
|---|---|
| 调用方 | worker SDK onEvent 回调（forwardEvent 原调用点） |
| 被调用方 | turnEventPipeline 实例 |
| 输入 | sessionKey 字符串；PI SDK 事件（message_update / message_end / tool_execution_* / …） |
| 输出 | 无（副作用：计数/延迟队列/出站 send） |
| 业务错误 | 未知 sessionKey → 事件照常计数/转发/延迟收尾/出站；仅注入 touch 由注入方内部 no-op（review B3：消息乱序容忍 = 事件不丢失，保持现状） |
| 系统错误 | 无（send 失败由注入方兜底） |
| 副作用 | 出站前调注入 touch(sessionKey)（仅当事件实际映射出站时；恒 clearPending:false）；send session-event；计数更新；延迟队列维护 |
| 幂等性 | 否（按事件语义逐条处理） |

**样例（golden values）**：

| 场景 | 请求/输入 | 期望响应/输出 |
|---|---|---|
| 正常 | message_update{text_delta×2} + {text_end} + message_end(usage={input:1000, output:2000}) | 2×text_delta 即时出站；text_end 在 message_end 后出站，meta={durationMs≥0, tokensIn:1000, tokensOut:2000} |
| 兜底 | text_end 后 5000ms 无 message_end（假时钟推进） | text_end 出站，meta 仅 durationMs |
| abort | message_end{stopReason:"aborted"} 且 pending 空 | 合成 text_end（content=已生成文本拼接）后冲刷 |

#### 接口 2：beginTurn(sessionKey)

| 项目 | 说明 |
|---|---|
| 调用方 | worker handlePrompt（enqueue 后、LLM 调用前） |
| 输入/输出 | sessionKey → 无 |
| 业务错误 | 无 |
| 系统错误 | 无 |
| 语义 | 幂等清 turnEventCounts/sdkEventCounts（人拍板 B：失败轮残留不混轮） |
| 副作用 | 两计数 Map 清空 |
| 幂等性 | 是 |

#### 接口 3：takeLastReply(sessionKey) → string \| undefined

| 项目 | 说明 |
|---|---|
| 调用方 | worker handlePrompt（prompt-result 组装） |
| 输入/输出 | sessionKey → string \| undefined |
| 业务错误 | 无（无值 = undefined） |
| 系统错误 | 无 |
| 语义 | 读取不删（现状）；evict/reset 由 clearSessionState 清 |
| 副作用 | 无 |
| 幂等性 | 是（纯读取） |

#### 接口 4：takeTurnDiagnostics(sessionKey) → { turnStats: {delta, end, tool}, sdkStats }

| 项目 | 说明 |
|---|---|
| 调用方 | worker handlePrompt（prompt-result 日志） |
| 输入/输出 | sessionKey → { turnStats: {delta, end, tool}, sdkStats } |
| 业务错误 | 无（缺省 {delta:0,end:0,tool:0} / {}） |
| 系统错误 | 无 |
| 语义 | 取出即删（两计数 Map；人拍板 B） |
| 副作用 | 两计数 Map 清空 |
| 幂等性 | 否（取出即删，二次调用返回空） |

**配套写入接口（slice 2 补全，§10.4 接口 4 隐含的存/取/清闭环）**：

#### 接口 4b：recordSdkEvent(sessionKey, type)

| 项目 | 说明 |
|---|---|
| 调用方 | worker agentSession.subscribe 回调（SDK 事件到达计数，BUG-002 诊断 4；筛选条件保持：agent_start / agent_end / turn_start / turn_end / message_update） |
| 输入/输出 | sessionKey, type → 无 |
| 语义 | 累加 `sdkEventCounts[type]`；生命周期与 sdkStats 一致——beginTurn / takeTurnDiagnostics（取出即删）/ clearSessionState 清 |
| 业务错误 | 无 |
| 副作用 | 计数 Map 累加 |
| 幂等性 | 否（逐次累加） |

#### 接口 5：registerSessionScopedMap(map) / registerSessionCleanup(fn)

| 项目 | 说明 |
|---|---|
| 调用方 | worker 装配态登记（toolContexts / sessionQueues / sessionModes / judgeModels）；管线内部回合态自登记 |
| 语义 | registerSessionScopedMap：纯 Map 登记；registerSessionCleanup：特殊清理（pendingTextEnds 定时器 clear） |
| 幂等性 | 是（重复登记同一实例无副作用） |

#### 接口 6：clearSessionState(sessionKey)

| 项目 | 说明 |
|---|---|
| 调用方 | worker handleSessionEvicted / handleResetSession |
| 语义 | 遍历全部登记项：map.delete(key) + cleanup fn(key)；keySecrets / confirmAcks / permissionDecisions 不登记（保留语义） |
| 副作用（evict 调用） | 清全部登记项；不发回执（排队/流式会话本就淘汰豁免，sessionLifecycle F2/E1） |
| 副作用（reset 调用） | 清全部登记项（含计数泄漏修复）；**无排队丢弃语义**（review B1 实证全局串行队列——reset-session 排在在途 prompt 之后，队列恒空；E-AGENT-RESET 回执契约已撤销） |
| 幂等性 | 是 |

#### 接口 7：limitSize(event) → event（导出常量 MAX_IPC_BYTES = 262144）

| 项目 | 说明 |
|---|---|
| 调用方 | 管线内部 + agentService 3 调用点（248 / 346 / 963） |
| 语义 | 文本载体（content/delta）截断；工具数据载体（input/output）迭代收紧截断保契约字段；无载体兜底 {type, truncated:true} |

**样例（golden values）**：

| 场景 | 请求/输入 | 期望响应/输出 |
|---|---|---|
| 正常 | 100KB text_delta | 原样返回（≤ 262144） |
| 边界 | 300KB text_end（content 超限） | content 截断 + truncated:true，序列化 ≤ 262144 |
| 工具 | 300KB tool_execution_end（input 超限） | 保 toolCallId/name/status/isError + input 截断 + truncated:true，序列化 ≤ 262144 |
| 兜底 | 无载体字段的超限事件 | { type, truncated:true } |

### 10.5 关键决策

| 决策 | 选项 | 选择理由 | 风险 |
|---|---|---|---|
| 工厂模式 | createTurnEventPipeline 工厂 vs 模块级单例 | 同 sessionLifecycle 先例；每测试独立实例 | 无 |
| 注册表项形状 | 登记 {map, cleanup} 迭代 vs 手抄清单 | 单真源；pendingTextEnds 定时器需 cleanup 钩子 | 无 |
| reset 清队列（人拍板 A） | 清 vs 保 | reset = 清空重来；排队操作引用已重置上下文 | reset 丢排队操作（已批准；§8 记录） |
| 计数清时机（人拍板 B） | beginTurn 幂等清 + 取出即删 vs prompt-result 后清 | 失败轮残留混轮污染 BUG-002 诊断 | 失败轮计数不可见（不被消费，无损失） |
| 截断取强（人拍板 Q2） | worker 版 vs agentService 版 | 工具事件保契约字段（REQ-AGENT-055 语义） | 断言变更走签核（已实证无锁定） |
| inMemory 仅单源（人拍板 Q4） | 不接 forwardEvent | inMemory 无回合状态机；接 forwardEvent 改测试 seam 行为无生产价值 | 无 |
| limitSize 归属 | 管线模块导出 vs 新建 shared 目录 | toolAdapter 先例（services→agent import 成立）；项目无 shared 目录先例 | 无 |

### 10.6 风险与回流点

| 假设 | 如果错了会怎样 | 回流到 | 能否快速验证 |
|---|---|---|---|
| reset 清队列无既有断言锁定 | 黑盒回归红 → 契约修订或回退该点 | TECH-DESIGN | 能（grep + 黑盒回归） |
| 双入口 import 无打包冲突 | vite bundle / 主进程 import 冲突 | TECH-DESIGN | 能（已实证：模块零外部依赖；构建验证） |
| 弱降级无断言锁定 | 受影响断言修订走签核 | ASSERTION-SIGNOFF | 能（已实证 grep 零命中） |
| **touch 保真（review B2）**：管线在事件实际出站时调注入 touch（clearPending:false） | 长回合 TTL 淘汰悬崖（lastActiveAt 停回合起点）或组冷却双热回归（M1）——黑盒 idle 测试未必命中长回合 | TECH-DESIGN | 能（单元 touch spy + 长回合黑盒） |
| **E-AGENT-RESET 机制缺口（review B1）**：全局串行队列下排队丢弃场景不存在 | 契约死行 + 测试不可构造 | ASSERTION-SIGNOFF | 能（已实证：已撤销契约，见 §8/§10.4 接口 6） |

### 10.7 安全/性能/可观测性

- 可观测：BUG-002 诊断计数保留，beginTurn + 取出即删让诊断更准（不混轮）；
  abort 合成日志（注入 log）保留；淘汰日志带 reason（保持）。
- 性能：注册表清理 O(登记项数)；无新增轮询/睡眠；5s 兜底定时器 unref（保持）。
- 安全：无信任边界变化；keySecrets 不登记注册表（明文不落盘语义不动）；
  confirmAcks/permissionDecisions 超时兜底语义不动。

## 11. 测试决策（Testing Decisions）

### 11.1 覆盖接缝（coverage seams，CLI 优先）

| 稳定块 | Seam | 测试类型 | 依赖处理 |
|---|---|---|---|
| 1 管线模块 | 直接 import createTurnEventPipeline，注入 send + fake clock（setTimeout/clearTimeout/Date.now 注入） | 单元 | stub send + fake clock（5s 兜底：推进 5000ms 断言 flush；meta.durationMs 用注入 now 断言） |
| 2 注册表 | 同 seam：登记 Map ×N + cleanup fn → clearSessionState 断言全清（含计数/装配态）+ reset 黑盒（spawn + FAUX 排队 prompt 后 reset → 排队操作不执行） | 单元 + 集成 | 直接断言 + 真实 spawn（FAUX TPS 控速造排队窗口） |
| 3 截断单源 | limitSize 直测（三载体超限）+ agentService inMemory 集成（脚本化超限事件经 runTurn 出口） | 单元 + 集成 | 脚本化 provider |
| 4 worker 接线 | 既有黑盒回归：spawn + FAUX（workerToolEventExt / sessionEvents / sessionIdleEviction / agentModelResolveLocal 等） | 集成 / E2E | 真实 spawn + FAUX seam |

### 11.2 测试策略与先例

- **直测纯模块、只测外部行为**：转发顺序、事件形状、meta 字段、截断契约字段、
  注册表清理结果——不测内部 Map 细节（计数等经 takeTurnDiagnostics 接口断言）。
- **replace, don't layer**（execution-runner 教训）：管线直测就位后，不新增 spawn 层
  白盒断言；既有黑盒测试保留为契约回归（事件形状由 REQ-AGENT-006/009/012/055/
  057/091 锁定）。
- **先例**：`sessionIdleEviction.test.js`（直接 import sessionLifecycle + 注入
  onEvict 回调）——本 story 的管线直测照此模式。
- **契约修订**：若既有断言锁定 enforceSizeLimit 弱降级行为，断言随 Q2 批准的
  修复修订，走门 1 签核。

## 12. 范围外

- inMemory 内核事件流不接 forwardEvent（行为对齐不做——测试 seam 无状态机可对齐）。
- sessionLifecycle.js 本体不动（只改 worker 侧 onEvict 回调体）。
- keySecrets / confirmAcks / permissionDecisions 保留语义不动（不登记注册表）。
- auto-judge / 权限层 / FAUX seams / 序列队列 / stats 推送不碰。
- worker.js **不增加导出**；新增 import 仅限 src/agent/ 内部模块（同 sessionLifecycle
  先例，review 修订——「零 import」字面不可满足：worker 必须 import 管线才能接线），
  不新增外部依赖。

## 13. 补充说明

- 先例：sibling story `2026-08-16-deepen-execution-runner`（评审 #1）同模式——
  独立模块 + 直调、契约保持、seam 迁入、ADR 落盘。本 story 为评审 #2，同一模式
  第二次应用。
- 引用规则：已签契约 REQ-AGENT-006/009/012/035/055/057/091 的事件形状是契约真值，
  本次只动实现归属，不改契约（除 §10.5 人批准的截断行为修复）。
- ADR：ADR-029 已落盘（tech-design 2026-08-17：工厂模块 + 注册表统一清理 + 截断单源取强）。
- tech-design（2026-08-17）两项对抗式决议：reset 清队列（A）+ 计数清时机 beginTurn（B），
  均人拍板；§5 移动块四块全解决。
- 需求洞察完整记录：`interview-notes.md`（含实证行号与边界）。

## 14. PRD 完整性自检查

| 检查项 | 状态 | 备注 |
|---|---|---|
| 操作流 | PASS | §6.1 四稳定块各有 happy path；§6.2 分支与异常 6 条 |
| 输入验证 | PASS | §7 无用户输入（显式 N/A + 理由）；§7.1 跨字段规则 2 条 |
| 错误状态 | PASS | §8 九行（超限三载体 / 兜底 / abort / 淘汰 / 未知 key / 主进程兜底 / reset 排队场景不存在行） |
| 预期值锚点 | PASS | §6.3 每稳定块 ≥1 条具体值锚点（含字面值：262144 / 5000ms / 计数 {2,1,1} / meta 字段 / 块 4 spawn 全链锚点，review 修订补录） |
| 复杂度分级 | complex | §9 六维理由 |
| 技术方案（§10） | PASS | complex：§10.1-10.7 完整（/tech-design 深潜定稿，2026-08-17） |

> 无 GAP（§10 已由 /tech-design 完整填充；§5 移动块四块全解决）。

---

## 版本记录

| 版本 | 日期 | 变更 | 作者 |
|---|---|---|---|
| v0.1 | 2026-08-17 | 初稿（需求洞察确认方向 A；四稳定块 / 四移动块 / complex） | AI + 人 |
| v0.2 | 2026-08-17 | /tech-design 深潜定稿 §10（六接口契约 + 注册表 + 两项人拍板决议 A/B）；§5 移动块清空；ADR-029 落盘 | AI + 人 |
| v0.3 | 2026-08-17 | /review 全链修订（4 IMPORTANT + 16 警告全处理）：B1 撤销 E-AGENT-RESET（全局串行队列实证排队丢弃场景不存在）；B2 补 touch 注入钩子；B3 未知 key 照常转发修正；B4 REQ-111 AC2 text_start 表述修正；§6.3 补块 4 锚点；§10.4 接口 2/3/4/6 四要素补全、接口 6 按调用方分行；§10.6 风险表补两行；§12 零 import 修正；§5 标题/§14 计数/意图行数同步 | AI + 人 |
