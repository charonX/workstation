# ADR-013: 内置对话 agent 运行时采用 PI，与 flow 节点 Claude Agent SDK 双运行时并存

- **状态**: 已接受
- **日期**: 2026-08-02
- **相关 wayfind**: `.aiassist/wayfind/builtin-agent/`（map.md + tickets/01/03/05/06）
- **相关 REQ**: 待结晶（builtin-agent story）

## 背景

平台要内置对话式 AI agent（飞书 IM + UI copilot 双入口）。候选运行时两个：现有 flow agent 节点已采用的 `@anthropic-ai/claude-agent-sdk`（ADR-005，复用本机 Claude Code 凭证），或 `earendil-works/pi`（Node.js agent 工具箱）。

关键事实（wayfind 调研，`research/pi-toolbox.md`）：

1. **新用户门槛**：Claude Agent SDK 可用是因为本机安装了 Claude Code 并配置了 API；新用户安装应用（公开 GitHub Release 分发，ADR-012）没有该环境，**用不了 SDK**。
2. **PI 画像**：MIT 许可、Node ≥22.19（与平台兼容）、极活跃（82k+ stars、日更、npm 0.83.0）、SDK 进程内嵌入（`createAgentSession()`）+ 流式事件（`text_delta` 增量）+ 多轮对话（`prompt()/steer()/followUp()`），仅需 API key、零本机依赖、可随应用分发。
3. **替代关系**：PI 不依赖 `claude-agent-sdk`（仅依赖 `@anthropic-ai/sdk` 的 Messages API 层），agent 循环自研——与现有 flow agent 节点是生态位竞争，选 PI = 双运行时。
4. **飞书接入两者皆非原生**（PI 官方 pi-chat 仅 Discord/Telegram 且已停更）——适配层均为自研，不构成选型差异。

## 决策

1. **内置对话 agent 底层运行时 = PI**：LLM 供应商经 pi-ai 配置（API key），零本机依赖；飞书适配层 + CardKit 卡片流式（wayfind 票 04 结论）自研；`--mode rpc` 子进程模式或进程内 SDK 的取舍留待 story 的 tech-design。
2. **flow 内 agent 节点保持 Claude Agent SDK 不变**（ADR-005、REQ-FLOW-020/026/028 已签核契约不动）——**双运行时并存**。
3. **写路径统一走 CLI 即控制面**（wayfind 票 06）：agent 工具面 = `opc-workstation` 命令（除 release 外全量，wayfind 票 03），CLI 层为保险层（后续可加命令白名单/确认钩子）。
4. **flow 节点运行时未来策略**（扫描本机已装 agent、无则回退 PI）独立于本决策，另开 story（已入 wayfind Out of scope）。

## 后果

- 双运行时并存：两套 agent 循环（SDK 供 flow 节点、PI 供内置 agent），依赖与凭证模型各一套；未来统一运行时是独立演进项。
- 飞书适配层完全自研（PI 无原生 IM 桥），但飞书通道能力（REQ-CHANNEL-001~005、ADR-007）可复用。
- 新用户仅需配置 API key 即可用内置 agent；flow agent 节点对新用户仍有门槛（已知，待统一运行时 story）。

## 替代方案

- **A. 内置 agent 沿用 Claude Agent SDK**：代码与 flow 节点一致、无双运行时，但新用户无 Claude Code 环境用不了——排除。
- **B. 两套运行时统一迁移到 PI**（含 flow 节点）：消除双运行时，但触碰已签核契约（REQ-FLOW-020 等），改动面大——独立 story，本次不做。
- **C. 自研最小 agent 循环**：不引入第三方运行时，维护成本高、重复造轮子——排除。

## 相关文件

- wayfind: `.aiassist/wayfind/builtin-agent/map.md`、`tickets/01-pi-toolbox-research.md`、`tickets/03-capability-scope.md`、`tickets/05-architecture-relationship.md`、`tickets/06-authorization.md`
- research: `.aiassist/wayfind/builtin-agent/research/pi-toolbox.md`
