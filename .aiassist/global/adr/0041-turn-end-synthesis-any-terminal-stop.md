# ADR-041: 回合收尾合成泛化——任何终态 stopReason 缺 text_end 均合成

- **状态**: 已接受
- **日期**: 2026-08-31
- **相关**: ADR-029(回合事件管线)、REQ-AGENT-091/REQ-AGENT-108(abort 合成收尾,BUG-010)
- **触发**: 2026-08-31 用户实证——app 内助手第二轮提问后 UI 永挂「回复中…」(全局基础设施独立修复,不挂活跃 story)

## 背景

REQ-AGENT-091(BUG-010)定义了「abort 中断(stopReason=aborted)且本轮无 text_end → 合成 text_end 收尾」——text_end 是 UI 回合收尾的唯一权威信号,缺失则 UI 流式状态永不复位。

2026-08-31 实证该缺口比 abort 更宽:用户向 app 内助手(deepseek-v4-flash,reasoning 模型)提问,模型整轮**只输出 thinking、正常 stop、零文本**(会话 JSONL 铁证:`stopReason=stop, content=[{thinking, 703字符}]`,无 text 块)。pi-ai 忠实转发 115 个 thinking 事件,无 text 块即无 text_delta/text_end;管道只在 aborted 时合成 → **UI 永挂「回复中…」**。附带缺陷:`lastReplies` 不按轮清理,prompt-result 把**上一轮的回复残留**当本轮 reply 回传(日志 reply=有 为假象;IM 通道场景下会把上一轮答案误发给用户)。

「正常 stop 但零文本事件」是 reasoning 模型的合法行为(模型可以整轮只思考),不是异常路径——但 REQ-AGENT-091 的签核语义只覆盖 aborted,此 case 未定义(req-gap)。

## 决策

1. **收尾合成泛化到所有终态 stopReason**:message_end 到达时,若本轮无 pending text_end(即未流式产生任何 text_end)且 stopReason 为终态(`stop`/`length`/`aborted`/`error`),一律从最终消息合成 text_end(content = text 块拼接,可为空字符串)后按既有路径冲刷出站。**不变量:每个回合必有收尾事件,UI 流式状态必复位。**
2. **中轮不合成**:`stopReason=toolUse`(工具调用中轮,agent loop 继续)与 `deferred` 不触发合成——这些消息天然无 text_end,合成会把 UI 流式状态在工具循环中途错误复位。既有「toolUse 消息带文本 → 正常流式 text_end 中轮冲刷」行为不变。
3. **beginTurn 清 lastReplies**:与诊断计数同一「失败轮残留不混轮」语义(REQ-AGENT-107 人拍板 B),消除跨轮 reply 残留;合成路径每轮 message_end 都会重写 lastReplies,正常读取时序(takeLastReply 在轮后、下轮 beginTurn 前)不受影响。
4. 合成 content 机械取 text 块拼接(可为 `""`)——不注入「模型未返回文本」等占位文案(非模型内容不进会话载体;空泡壳/空 reply 的产品层展示优化留作后续决策)。

## 替代方案

1. **只在 UI 层兜底**(渲染进程超时复位):权威信号分裂,worker/IM 通道(飞书 reply)仍拿不到收尾,prompt-result 残留缺陷照旧。
2. **pi-ai 层补 text 块**:vendor 层改动面大且「模型只产 thinking」是合法输出,不该在上游伪造文本事件。
3. **合成时注入占位文案**(如「(模型未返回文本)」):非模型内容进入 lastReplies/IM reply,污染会话真源。

## 影响

- `src/agent/turnEventPipeline.js`:handleMessageEnd 合成条件泛化(唯一实现点,~10 行);beginTurn 清 lastReplies。
- `tests/capabilities/agent-dialogue/conversation-space/2026-08-16-deepen-turn-event-pipeline/api/turnEventPipeline.test.js`:回归用例(零文本 stop 合成 / toolUse 不合成 / 残留清理)。
- REQ-AGENT-091/108 的 abort 合成语义被本决策包含(aborted ⊂ 终态集合),既有测试行为不变。
