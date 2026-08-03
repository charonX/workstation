# 06 — 对话 agent 的授权与安全边界

- **Type**: grilling
- **Mode**: HITL
- **Status**: resolved
- **Blocks**: 03
- **Blocked by**:

## Question

对话 agent 能执行写操作（创建任务/触发 flow）时，**谁授权、需要什么确认**？飞书侧用户身份（open_id）如何映射到权限？哪些操作允许直接执行、哪些必须人工确认（在飞书里二次确认还是应用内确认）？平台现有语义（channel_bindings 绑定到 flow/project）能否作为授权基础？

## Resolution

2026-08-02 用户拍板（三个维度）：

1. **飞书身份**：单用户绑定——settings 绑定一个飞书 open_id（首次对话引导绑定），未绑定者拒绝写操作；绑定用户是唯一可操作者。
2. **确认等级**：高危操作确认——下发/触发类直接执行；取消执行、删除、改配置等高危操作卡片二次确认（复用 CardKit 卡片能力）。
3. **授权基础 = CLI 即控制面**：agent 的能力**越大越好**，但**写路径统一走 CLI**（opc-workstation 命令是 agent 的工具面），尽量不直接修改代码或数据（不给 agent 原始 FS/DB 级工具）；**CLI 层是中间保险层**，后续可在 CLI 层做能力控制（命令白名单/确认钩子）。

**对 05 遗留子问题的回答**：执行层 = agent 以 CLI 为工具面下发/操作 → CLI → HTTP API → 服务层 → Task/FlowEngine（"翻译官"路线，控制点在 CLI）。03 票在此基础上划 MVP 工具面范围。
