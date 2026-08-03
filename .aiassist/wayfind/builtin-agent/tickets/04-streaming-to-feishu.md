# 04 — 飞书消息流式输出的技术可行性

- **Type**: research
- **Mode**: AFK
- **Status**: resolved
- **Blocks**:
- **Blocked by**:

## Question

"流式输出到飞书"在飞书开放平台上如何实现？现有能力（长连接 WS + 消息发送，REQ-CHANNEL-001~005）是否支持：消息发送后**追加/编辑**内容（streaming 效果）、长任务中途的状态更新、频率限制（限流阈值）、消息大小限制？已知平台事实：当前用官方 SDK WSClient（ADR-007）。调研给出可行的实现路径（发多条 vs 编辑单条）与约束数字。

## Resolution

**结论：可行，推荐官方 CardKit 卡片流式更新路径**——编辑单条消息路径被"每条消息最多编辑 20 次（错误码 230072）"封死，发多条消息路径受"同用户/同群 5 QPS"限制且无打字机效果；官方专为 AI 打字机效果设计的卡片流式（`streaming_mode` + `cardkit.v1.card.element.content`）在流式期间不触发接口频率限制（QPS）、单次更新内容上限 100,000 字符，是最可行路径（约束：客户端 7.20+/7.23+、卡片实体一次性发送、流式模式 10 分钟自动关闭）。详见 [调研笔记](../research/feishu-streaming.md)。
