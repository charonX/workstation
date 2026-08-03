# 05 — 对话 agent 与现有执行架构的关系：复用什么、新造什么？

- **Type**: grilling
- **Mode**: HITL
- **Status**: resolved
- **Blocks**:
- **Blocked by**: 01

## Question

对话 agent 要"下发任务"，平台已有三条执行通道：Task（手动/定时/通道触发 → FlowEngine 执行）、CLI（agent 可直接调用本地 HTTP API）、flow 内 agent 节点（Claude Agent SDK）。**对话 agent 站在哪一层**：

- 对话 → 复用通道绑定语义创建 Task → Flow 执行 → 结果回投（agent 是"翻译官"，执行引擎不变）？
- 对话 agent 直接作为执行者（调 CLI/API/工具，自己跑任务，流式汇报）？
- 两者并存（简单任务 agent 直跑，重任务走 Flow）？

这决定哪些模块是新建的、哪些是复用现有 channel/flow 体系的。T-01 的 PI 调研结果（能力形态）会约束本票选项。

## Resolution

2026-08-02 用户拍板：**底层用 PI**。

**决策理由**：Claude Agent SDK 能用是因为本机安装了 Claude Code 并配置了 API；**新用户安装我们的 App 没有这个环境，用不了 Claude Agent SDK**。PI 自带 agent 运行时 + 多供应商 LLM 支持（pi-ai，仅需 API key），零本机依赖，对全新用户友好、可随应用分发。

**含义**：
1. **双运行时成立**：内置对话 agent = PI；flow 内 agent 节点保持 Claude Agent SDK（ADR-005、REQ-FLOW-020/026/028 已签核契约不动）。
2. **飞书适配自研**：PI 无原生飞书桥（pi-chat 仅 Discord/Telegram 且已停更），飞书 IM 适配层 + CardKit 卡片流式（04 票结论）为自研新建模块。
3. **执行层问题移交 03**："对话 agent 是翻译官（复用 Task/FlowEngine）还是直接执行者（PI 工具直调 CLI/API）"——此子问题移交 03 票能力划线时定。
4. **观察**：同样的门槛问题适用于现有 flow 内 agent 节点（新用户同样用不了）——是否迁移到 PI 是独立决策，归入 Out of scope，不阻塞本探索。
