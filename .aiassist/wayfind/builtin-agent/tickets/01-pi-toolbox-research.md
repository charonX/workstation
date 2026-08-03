# 01 — PI 工具箱（earendil-works/pi）是什么，能否承载"对话式任务分发"

- **Type**: research
- **Mode**: AFK
- **Status**: resolved
- **Blocks**: 05
- **Blocked by**:

## Question

github.com/earendil-works/pi 是一个什么样的项目？它的定位、功能、成熟度、许可证、依赖、维护状态如何？它能否承载我们的诉求（对话下发任务 + 流式输出 + 查询执行状态）？它与我们已采用的 Claude Agent SDK（ADR-005）是什么关系——替代、互补还是无关？

## Resolution

**结论：PI 可以承载"对话式任务分发"**——其 SDK 原生支持进程内嵌入、多轮对话（`prompt()/steer()/followUp()`）与流式事件输出（`message_update` 的 `text_delta` 增量等），MIT 许可证、极活跃维护（82k+ stars、日更、Node >=22.19 与本平台兼容）；但**飞书接入非原生**（官方 pi-chat 仅支持 Discord/Telegram），需自研适配层；且 PI 是自研 agent 循环（仅依赖 `@anthropic-ai/sdk`，不依赖 `@anthropic-ai/claude-agent-sdk`），与现有 flow agent 节点是替代关系而非封装关系。

详见调研笔记：[`research/pi-toolbox.md`](../research/pi-toolbox.md)
