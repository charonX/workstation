# Requirements — 回合事件管线深化（turnEventPipeline）

> 故事 ID：`2026-08-16-deepen-turn-event-pipeline`
> 版本：v3（2026-08-17 slice 2 接口补全）
> 最后更新：2026-08-17
> 来源：`prd.md` v0.3（§4 四稳定块；§10 技术方案 /tech-design 定稿 + /review 修订）
> 移动块：无（§5 已清空，四块全解决）
> UX 参照：N/A（纯内部架构重构，无用户界面；DESIGN/DOMAIN-MODEL 阶段跳过）
> 技术事实（tech-design 实证 + /review 修订）：reset 清队列人拍板 A（**v2 修订：
> E-AGENT-RESET 回执契约撤销**——review B1 实证 worker 全局串行队列，reset-session
> 排在在途 prompt 之后，排队丢弃场景不存在；reset 语义保持现状）；计数清时机人拍板
> B（beginTurn 幂等清 + 取出即删，失败轮残留不混轮）；**v2 补 touch 注入钩子**（review
> B2：事件实际出站时调注入 touch，恒 clearPending:false）；**v2 修正未知 key 语义**
> （review B3：事件照常转发，仅 touch no-op）；双入口 import 可行（模块零外部依赖 +
> toolAdapter 先例）；弱降级无既有断言锁定。
> ADR：ADR-029（tech-design 落盘；v2 修订注记见该文件）。
> 测试目录：`tests/capabilities/agent-dialogue/conversation-space/2026-08-16-deepen-turn-event-pipeline/`
> （4 文件：turnEventPipeline / limitSizeSingleSource / resetDropQueue / workerWiring）

---

## REQ-AGENT-106 turnEventPipeline 工厂模块——可 import 无副作用 + 接口集

- 优先级 P0 / 必须 / intra-module（turnEventPipeline 新增；agentService 消费 limitSize 归 REQ-AGENT-110）/ agent-dialogue / conversation-space / 单元
- 接口契约：
  - `createTurnEventPipeline({ send, log, touch, setTimeout, clearTimeout, now })` → 实例；import 无副作用
  - 实例接口：`onSessionEvent(sessionKey, ev)` / `beginTurn(sessionKey)` /
    `takeLastReply(sessionKey) → string | undefined` /
    `takeTurnDiagnostics(sessionKey) → { turnStats: {delta, end, tool}, sdkStats }` /
    `recordSdkEvent(sessionKey, type)`（v3 补全：sdkStats 写入接口——§10.4 接口 4
    存/取/清闭环，worker subscribe 调用，条件筛选保持现状）/
    `registerSessionScopedMap(map)` / `registerSessionCleanup(fn)` / `clearSessionState(sessionKey)`
  - **touch(sessionKey)**：注入钩子（review B2）——仅当事件实际映射出站时调用；
    恒 clearPending:false 语义由注入方（worker lifecycle.touch）承担
  - 模块级导出：`limitSize(event)` + `MAX_IPC_BYTES = 262144`
  - 错误：无（未知 sessionKey 语义见 REQ-AGENT-107 AC6）

验收标准：
1. import 无副作用：加载模块后注入的 send spy 零调用、无激活定时器（单元：直接 import + spy 注入）。
2. 工厂返回完整接口集：上述 7 个实例成员 + 2 个模块导出均为函数/常量（单元）。
3. `MAX_IPC_BYTES === 262144`（单元；§10.4-7 锚点）。
4. send 注入可用：onSessionEvent 触发转发 → spy 收到 `{type:"session-event", sessionKey, event}`（单元）。

## REQ-AGENT-107 事件转发与延迟 text_end（含计数与清时机）

- 优先级 P0 / 必须 / intra-module（管线模块内）/ agent-dialogue / conversation-space / 单元
- 接口契约：onSessionEvent 输入 = PI SDK 事件（message_update / message_end / tool_execution_*）；出站事件契约形状见 §10.4-1 样例（text_delta 即时、text_end 延迟、meta 三字段）
- 锚点：§6.3-1/2/4、§10.4-1 正常与兜底样例

验收标准：
1. text_delta×2 即时出站，形状 `{type:"text_delta", delta}`，顺序保持；此时 text_end 尚未出站（单元）。
2. text_end 延迟到 message_end 后转发：喂 message_update{text_delta×2, text_end} + message_end(usage={input:1000, output:2000}) → text_end 出站带 `meta = {durationMs ≥ 0, tokensIn: 1000, tokensOut: 2000}`（durationMs 用注入 now 固定值断言精确差）（单元）。
3. 5s 兜底：text_end 后注入 timer 推进 5000ms 无 message_end → text_end 照发，meta **仅含 durationMs**（无 tokensIn/tokensOut 字段）（单元；§6.3-2 锚点 5000）。
4. 计数更新：text_delta×2 + text_end + tool_execution_start 各一 → `takeTurnDiagnostics` = `{turnStats: {delta:2, end:1, tool:1}, sdkStats: {}}`（sdkStats 未注入时空对象）（单元；§6.3-4 锚点）。
5. beginTurn 幂等清 + 取出即删：一轮事件计数 → beginTurn → takeTurnDiagnostics 返回空；再取仍空；两轮各 1 事件、中间 beginTurn → 第二轮计数仅 `{delta:1, end:0, tool:0}`（失败残留不混轮，人拍板 B）（单元）。
6. 未知 sessionKey（review B3 修正）：`onSessionEvent("ghost-key", text_delta)` → 事件**照常转发出站**（send spy 收到事件）、touch 注入 spy 被调用（no-op 由注入方承担）、不抛异常（单元；消息乱序容忍 = 事件不丢失，保持现状）。

## REQ-AGENT-108 abort 合成收尾

- 优先级 P0 / 必须 / intra-module / agent-dialogue / conversation-space / 单元
- 接口契约：message_end{stopReason:"aborted"} 且无 pending → 合成 text_end（content = msg.content 中 type=text 段拼接）入 pending 后冲刷出站（§10.4-1 abort 样例；BUG-010/REQ-AGENT-091 语义）
- 锚点：§6.3-3

验收标准：
1. aborted 且无 pending：msg.content = [{type:"text", text:"已生成"}, {type:"text", text:"文本"}] → 合成 text_end 出站，content = "已生成文本"（单元）。
2. aborted 且已有 pending text_end：不合成——仅 1 条 text_end 出站，content = 原 pending 内容（单元；§6.2 分支「abort 时已有 pending 不合成」）。
3. 合成后 `takeLastReply(sessionKey)` = 合成 content（reply 不丢语义）（单元）。
4. abort 合成可观测：注入 log spy 收到含「abort 收尾」的调用（诊断日志保留）（单元；worker.js:694 现状语义）。

## REQ-AGENT-109 会话状态注册表统一清理

- 优先级 P0 / 必须 / cross-module / turnEventPipeline + worker.js（装配态登记）/ agent-dialogue / conversation-space / 单元 + 集成
- 接口契约：`registerSessionScopedMap(map)` 纯 Map 登记；`registerSessionCleanup(fn)` 特殊清理钩子（pendingTextEnds 定时器 clear）；`clearSessionState(sessionKey)` 遍历全部登记项 `map.delete(key)` + `fn(key)`；keySecrets / confirmAcks / permissionDecisions 不登记（保留语义）；装配态 Map（toolContexts / sessionQueues / sessionModes / judgeModels）由 worker 登记、worker 持有；**reset 语义保持现状（v2 撤销 E-AGENT-RESET——review B1 实证全局串行队列，排队丢弃场景不存在：在途/先到 prompt 按序完成，reset 后新 prompt 走既有 E-AGENT-NO-SESSION）**
- 锚点：§6.3-5（clearSessionState 清全部登记 Map）

验收标准：
1. 登记 Map×N（含外部传入的装配态 Map）→ clearSessionState 后全部 delete（单元：直接断言 Map 状态）。
2. cleanup 钩子调用：registerSessionCleanup spy → clearSessionState 后 spy 收到该 key（pendingTextEnds 定时器 clear 语义——注入 timer 断言 clearTimeout 被调用）（单元）。
3. 管线内部回合态随 clearSessionState 清：lastReplies / 计数 / turnStartedAt / pendingTextEnds——clear 后 takeLastReply undefined、takeTurnDiagnostics 空、无补发事件（单元）。
4. reset 语义保持（v2，review B1 撤销 E-AGENT-RESET）：spawn + FAUX——prompt1 流式中 store.reset(key) → prompt1 照常按序完成（prompt-result ok:true，reset 不掐断在途生成——串行队列保证 reset-session 排在 prompt 之后）；reset 后会话重建（新 session-config）→ 后续 prompt 正常（ok:true + 回声含其文本）；注册表 reset 清理（计数/toolContexts/sessionQueues 登记项）接入后会话流无回归（集成）。

## REQ-AGENT-110 256KB 截断单真源 + 主进程行为修复

- 优先级 P0 / 必须 / cross-module / turnEventPipeline（导出 limitSize）+ agentService.js（enforceSizeLimit 删除、3 调用点 249/346/963 改 import）/ agent-dialogue / conversation-space / 单元 + 集成
- 接口契约：`limitSize(event)`（§10.4-7 四分支：≤ 原样 / content 截断 / delta 截断 / 工具 input|output 迭代收紧保契约字段 / 无载体 {type, truncated:true}）；导出 `MAX_IPC_BYTES = 262144`
- 锚点：§6.3-6/7（300KB 工具事件保四字段、序列化 ≤ 262144）

验收标准：
1. ≤ 262144 事件原样返回（无 truncated 字段）（单元）。
2. content=300KB 字符串 → content 截断 + truncated:true + 序列化 ≤ 262144（单元；§6.3-7）。
3. delta=300KB 字符串 → 同上（单元）。
4. tool_execution_end 携带 input=300KB 字符串（含 toolCallId/name/status/isError）→ 保四字段 + input 截断 + truncated:true + 序列化 ≤ 262144（单元；§6.3-6 迭代收紧语义）。
5. 无载体字段的超限事件 → `{type, truncated:true}`（兜底保持）（单元）。
6. inMemory 集成：脚本化 provider 返回 300KB tool_execution_end → session-event 保 toolCallId/name/status/isError + truncated:true（主进程侧不再整条降级——行为修复实证）（集成）。
7. inMemory runTurn 300KB 文本 text_end → content 截断 + truncated:true（文本事件行为与弱实现等价——无回归）（集成）。

## REQ-AGENT-111 worker.js 接线保持（spawn-only + 契约回归）

- 优先级 P0 / 必须 / cross-module / worker.js（瘦身接线）/ agent-dialogue / conversation-space / 集成
- 接口契约：worker 保持 spawn-only 零导出零 import（打包/启动链路不破）；事件形状/转发顺序/abort 合成语义/淘汰副作用照旧；prompt-result 经 beginTurn / takeLastReply / takeTurnDiagnostics 读取
- 锚点：§6.1-1/3（事件链形状 + abort 合成 reply 有值）

验收标准：
1. spawn 启动照旧：worker 进程 ready 帧 + session-config 回执形状不变（spawn + stdin/stdout JSONL 直测，agentModelResolveLocal 同款 seam）（集成）。
2. 事件链形状契约：text_delta×N → text_end（带 meta.durationMs）顺序与形状不变（v2 修订：text_start **非 worker 契约流事件**——mapToContractEvent 只产 text_delta/text_end/tool_execution_*，SSE 层按裁决 11 合成 text_start，既有 REQ-AGENT-028 SSE 测试锁定，见 AC5 回归清单）（集成）。
3. prompt-result reply 语义：连续两轮 prompt，各自 reply 为**本轮** text_end.content（lastReplies 读取不删 + 每轮刷新；不串轮）（集成）。
4. stop-session 全链路：abort → 合成 text_end 出站 → prompt-result ok:true + reply 有值（BUG-010 语义回归）（集成）。
5. 既有黑盒回归全绿（QA 阶段验证清单）：workerToolEventExt / sessionEvents / sessionIdleEviction / agentModelResolveLocal / agentDialogue——事件形状契约由既有 REQ-AGENT-006/009/012/035/055/057/091 锁定，重构后不得红。
