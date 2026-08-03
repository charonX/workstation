# Research: PI（earendil-works/pi）工具箱调研

> 调研日期：2026-08-02
> 主题：PI 的定位、成熟度、许可证、能力匹配（对话式任务分发/流式输出/飞书接入/状态查询）、与 Claude Agent SDK 的关系、已知风险
> 来源：primary sources（GitHub 仓库/源码、npm registry、官方文档 pi.dev）

## 执行摘要

1. **PI 是一个自研 agent harness（不是库也不是 SDK 封装）**：TypeScript monorepo，四个 npm 包——`@earendil-works/pi-ai`（统一多供应商 LLM API）、`pi-agent-core`（agent 运行时：工具调用+状态管理）、`pi-coding-agent`（编码 agent CLI + SDK，主产物）、`pi-tui`（终端 UI 库）。定位"minimal terminal coding harness"，通过 TypeScript 扩展/skills/prompt 模板/主题扩展。[github.com/earendil-works/pi](https://github.com/earendil-works/pi)、[pi.dev/docs/latest](https://pi.dev/docs/latest)
2. **成熟度高且非常活跃**：82,222 stars / 10,165 forks / 100+ 贡献者，2025-08 创建，最近提交 2026-08-02（当日）；npm 最新版 0.83.0（2026-07-29），2026-05-07 首次发布后已 38 个版本（约每周迭代）。MIT 许可证。CI 有 vitest 测试、biome lint、npm audit、release smoke test、依赖精确锁定。[api.github.com/repos/earendil-works/pi](https://api.github.com/repos/earendil-works/pi)、[registry.npmjs.org](https://registry.npmjs.org/@earendil-works/pi-coding-agent)
3. **SDK 原生支持对话式任务分发 + 流式输出 + 状态事件**：`createAgentSession()` 嵌入 Node.js 进程，`session.prompt()/steer()/followUp()` 多轮对话，`session.subscribe()` 流式事件（`message_update` 的 `text_delta/thinking_delta`、`tool_execution_*`、`turn_start/end` 等）；另有 `--mode rpc`（stdin/stdout JSONL）与 JSON 事件流打印模式。[packages/coding-agent/docs/sdk.md](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md)
4. **飞书接入不是原生能力**：官方 IM 桥接是独立仓库 `earendil-works/pi-chat`，仅支持 Discord 和 Telegram（每通道一个 Gondolin 微 VM 沙箱、流式预览响应、`/chat-status` + 每 15 秒 worker 状态快照），**无飞书/Lark/WeCom/Slack**；飞书需要自研扩展（Pi 扩展系统允许，但属定制工作）。[github.com/earendil-works/pi-chat](https://github.com/earendil-works/pi-chat)
5. **与 Claude Agent SDK 是替代关系（竞争 agent harness），不是基于它的库**：pi-ai 的 Anthropic provider 直接依赖官方 `@anthropic-ai/sdk`（Messages API SDK，0.91.1），但**不依赖** `@anthropic-ai/claude-agent-sdk`，agent 循环（pi-agent-core）完全自研。若平台对话 agent 选 PI，现有 flow agent 节点（ADR-005, Claude Agent SDK）可并存但意味着两个独立 agent 运行时。[registry.npmjs.org/@earendil-works/pi-ai](https://registry.npmjs.org/@earendil-works/pi-ai)

## 详细发现

### 1. 定位、核心功能、架构形态

- **定位**：`AI agent toolkit: unified LLM API, agent loop, TUI, coding agent CLI`——"Pi Agent Harness"项目，含"self extensible coding agent"（自扩展编码 agent）。README 官方描述："Pi is a minimal terminal coding harness. It is designed to stay small at the core while being extended through TypeScript extensions, skills, prompt templates, themes, and pi packages." — [GitHub README](https://github.com/earendil-works/pi)、[docs index](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/index.md)
- **架构形态：三者兼备**（CLI 为主 + 可嵌入库 + 独立 agent 运行时）：
  - CLI：`@earendil-works/pi-coding-agent`，`bin: pi`，全局 npm 安装（`npm install -g --ignore-scripts @earendil-works/pi-coding-agent`），也可 `curl -fsSL https://pi.dev/install.sh | sh`，还可用 Bun 编译成独立二进制。[npm registry](https://registry.npmjs.org/@earendil-works/pi-coding-agent)、[docs index](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/index.md)
  - 库/SDK：`createAgentSession()` 等 API 供 Node.js 进程内嵌入；另有 RPC 模式（stdin/stdout JSONL，跨语言/进程隔离）和 JSON 事件流模式（print 模式结构化事件）。[sdk.md](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md)
  - 多供应商 LLM 统一层：`@earendil-works/pi-ai`，"Unified LLM API with automatic model discovery and provider configuration"；**只收录支持工具调用（function calling）的模型**。[pi-ai README](https://github.com/earendil-works/pi/blob/main/packages/ai/README.md)
- **无内置权限/沙箱**："Pi does not include a built-in permission system for restricting filesystem, process, network, or credential access... By default, it runs with the permissions of the user and process that launched it." 沙箱靠外部方案：Gondolin 微 VM 扩展、Docker、OpenShell。[GitHub README](https://github.com/earendil-works/pi)
- **模型/API 支持**（内置目录，[providers.md](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/providers.md)）：
  - 订阅登录（OAuth）：ChatGPT Plus/Pro (Codex)、Claude Pro/Max、GitHub Copilot、xAI、OpenRouter、Radius
  - API key：Anthropic、Ant Ling、Azure OpenAI、OpenAI、DeepSeek、NVIDIA NIM、Google Gemini、Amazon Bedrock、Mistral、Groq、Cerebras、Cloudflare、xAI、OpenRouter、Vercel AI Gateway、ZAI、OpenCode、Hugging Face、Fireworks、Together、Kimi、MiniMax、Qwen、小米 MiMo 等（含多家中国供应商国内/海外双端点）
  - 任意 OpenAI 兼容 API（Ollama、vLLM、LM Studio 等）；本地 llama.cpp 路由（`/llama`）
- **关键基础设施**：依赖精确锁定（`save-exact=true`、`min-release-age=2`）、lockfile 为准、shrinkwrap + 生命周期脚本白名单、CI 定期 `npm audit`、release smoke test（隔离 npm/Bun 安装）——供应链加固明显是项目一等公民。[GitHub README](https://github.com/earendil-works/pi)

### 2. 成熟度

- **GitHub 指标**（2026-08-02 API 快照）：82,222 stars、10,165 forks、274 watching、90 open issues、100+ contributors；仓库创建于 2025-08-09，`pushed_at` 2026-08-02（当日仍有提交）。[api.github.com](https://api.github.com/repos/earendil-works/pi)
- **发布节奏**：npm `@earendil-works/pi-coding-agent` 首版 0.74.0（2026-05-07），最新 0.83.0（2026-07-29），3 个月内 38 个版本，约每周一次；同期主仓库日更。[npm registry time 字段](https://registry.npmjs.org/@earendil-works/pi-coding-agent)
- **Node 版本要求**：latest 0.83.0 `engines: node >=22.19.0`（0.74.x 为 >=20.6.0，另有 `legacy-node20` dist-tag 0.74.2）；与本项目 Node 22+ 要求兼容。[npm registry](https://registry.npmjs.org/@earendil-works/pi-coding-agent)
- **核心依赖**（pi-coding-agent 0.83.0）：`@earendil-works/pi-ai`、`pi-agent-core`、`pi-tui` + 通用小库（diff/glob/yaml/chalk/undici/typebox/minimatch 等），无重型框架依赖；pi-ai 的依赖含 `@anthropic-ai/sdk 0.91.1`、`openai 6.26.0`、`@google/genai 1.52.0`、`@mistralai/mistralai`、AWS Bedrock SDK 等。[npm registry](https://registry.npmjs.org/@earendil-works/pi-coding-agent)
- **测试/CI**：monorepo 用 vitest + biome（tsconfig/vitest 在 README 工具链中可见）；CI 跑 `npm ci --ignore-scripts`、`npm audit`、release smoke test（`npm run release:local`：打包后隔离安装再发布）；README 声明"release binaries are built via ./scripts/build-binaries.sh"。无公开 CI badge 数据页可引用，属源码可见事实。[GitHub README](https://github.com/earendil-works/pi)
- **维护模式**：新贡献者 issue/PR 默认自动关闭（维护者每日审阅）——核心团队主导、贡献面受控。[GitHub README](https://github.com/earendil-works/pi)

### 3. 许可证

- **主仓库 + 全部 npm 包：MIT**（npm metadata `license: MIT`；GitHub license 检测 `MIT`）。MIT 允许商业闭源使用、修改、再分发，无 copyleft 义务。[registry.npmjs.org](https://registry.npmjs.org/@earendil-works/pi-coding-agent)、[api.github.com license](https://api.github.com/repos/earendil-works/pi)
- **pi-chat（IM 桥接扩展）：存在不一致**——GitHub API/license 侧栏显示 **Apache-2.0**，其 README 底部写 MIT。Apache-2.0 同样允许商业闭源使用（仅需保留 NOTICE/attribution），风险低但需在接入前核实实际 LICENSE 文件。[api.github.com/repos/earendil-works/pi-chat](https://api.github.com/repos/earendil-works/pi-chat)、[pi-chat README](https://github.com/earendil-works/pi-chat)
- 结论：许可证维度**不构成商业闭源桌面应用的障碍**。

### 4. 能力匹配（对话式任务分发 / 流式输出 / 飞书 / 状态查询）

- **对话式任务分发：原生支持（SDK 进程内嵌入）**。最小示例（[sdk.md](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md) 原文）：
  ```typescript
  const modelRuntime = await ModelRuntime.create();
  const { session } = await createAgentSession({ sessionManager: SessionManager.inMemory(), modelRuntime });
  session.subscribe((event) => { /* message_update -> text_delta */ });
  await session.prompt("What files are in the current directory?");
  ```
  `AgentSession` 提供 `prompt()/steer()/followUp()/setModel()/compact()/abort()/navigateTree()/dispose()`——多轮对话、中途改向、会话树分支/恢复均在 API 内。[sdk.md](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md)
- **流式输出：原生支持**。`session.subscribe()` 事件类型：`message_update`（含 `text_delta` / `thinking_delta` 流式增量）、`tool_execution_start/update/end`、`message_start/end`、`agent_start/end`、`turn_start/end`、`queue_update`、`compaction_*`；pi-ai 层面有 `streamSimple/completeSimple` 与 "Streaming Thinking Content"（推理内容流式）。[sdk.md](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md)、[pi-ai README](https://github.com/earendil-works/pi/blob/main/packages/ai/README.md)
- **IM（飞书）接入：非原生**。官方方案 `earendil-works/pi-chat`——"a pi extension that bridges Discord and Telegram channels to a sandboxed pi session"，**仅 Discord server 频道和 Telegram DM/群**；每通道独立 Gondolin 微 VM、流式预览响应（edit-in-place，vendored Vercel Chat SDK 渲染逻辑）、`/chat-status`、worker 状态每 15 秒写 `~/.pi/agent/chat/worker-status/`。**无飞书/Lark/WeCom/Slack**（主仓库 README 的 "For Slack/chat automation... see pi-chat" 与 pi-chat 实际支持面也不一致）。[pi-chat README](https://github.com/earendil-works/pi-chat)、[GitHub README](https://github.com/earendil-works/pi)
- **查询任务/执行状态：可行**。SDK 有 `SessionManager`（JSONL 会话树：`list()/getTree()/branch()`）、`queue_update` 事件、`tool_execution_*` 事件；pi-chat 验证了"状态快照 + 状态查询命令"模式。平台侧若做飞书适配，可在自己的状态模型上重建（参考 pi-chat 的 worker-status 模式），或直接用 SessionManager API。[sdk.md](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md)、[pi-chat README](https://github.com/earendil-works/pi-chat)
- **集成形态选项**：SDK 进程内嵌入（"You're in the same Node.js process"）或 RPC 子进程（"want process isolation"、"integrating from another language"）——后者与平台"CLI + 本地 HTTP API 共享服务层（ADR-001）"形态更契合。[sdk.md](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md)
- **注**：`prompt()` 在未传 `streamingBehavior` 时流式期间会 throw；事件订阅绑定在具体 `AgentSession`，会话替换后需重新订阅——嵌入细节有坑但文档已明示。[sdk.md](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md)

### 5. 与 Claude Agent SDK 的关系

- **事实**：pi-ai 的 Anthropic provider 直接依赖官方 `@anthropic-ai/sdk@0.91.1`（Messages API 级 SDK）；**未发现对 `@anthropic-ai/claude-agent-sdk`（Claude Agent SDK）的任何依赖或引用**（主 README 全文无 Claude Code / Agent SDK 提及）。agent 循环由 `pi-agent-core` 自研。[npm registry pi-ai deps](https://registry.npmjs.org/@earendil-works/pi-ai)、[GitHub README](https://github.com/earendil-works/pi)
- **定性：竞争/替代品**——PI 与 Claude Agent SDK 属于同一生态位（"agent harness"），实现方式不同（自研循环 vs Anthropic 官方 Agent SDK）。社区已有桥接两者的事实性先例：`claude-pi-bridge`（MCP server，让 Claude Code 用 `--mode rpc` 无头 spawn/steer/查状态多个 pi agent）、`bridge-harness`（NATS 实时桥）。[claude-pi-bridge (npm)](https://www.npmjs.com/package/claude-pi-bridge)、[RFC #2715](https://github.com/earendil-works/pi/issues/2715)
- **对本平台的推论**：若对话 agent 选 PI，与现有 flow agent 节点（ADR-005，Claude Agent SDK）**无代码级冲突**（两套独立运行时），但意味着应用内存在两个 agent 运行时、两套凭证解析路径；双方都可通过 `ANTHROPIC_API_KEY`/本机凭证工作。关系取舍是架构决策（T-05 的输入），本调研只陈述事实。
- **凭证风险提示**：pi 支持 Claude 订阅 OAuth 登录（Claude Pro/Max），官方文档称第三方 harness 用量走"extra usage"按 token 计费；但社区讨论 #1510 指出用订阅配额跑第三方 harness 有违反 ToS/封号风险（Gemini 订阅有封号报告）。平台复用本机凭证（ADR-005）时需确认走 API key 而非订阅授权。[providers.md](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/providers.md)、[Discussion #1510](https://github.com/earendil-works/pi/discussions/1510)

### 6. 已知风险

- **飞书接入需自研**：pi-chat 只做 Discord/Telegram，且其 README 与主仓库 README 的平台描述不一致；飞书通道需自行实现（Pi 扩展系统支持自定义 tool/command/event，SDK/RPC 可承载），工作量和维护成本自担。此为最大能力缺口。[pi-chat README](https://github.com/earendil-works/pi-chat)
- **无内置权限系统**：默认以启动用户全权限运行——桌面应用内嵌 PI 意味着 agent 拥有用户进程权限，需自行叠加沙箱（Gondolin/Docker/OpenShell 或平台自己的策略），安全责任在集成方。[GitHub README](https://github.com/earendil-works/pi)
- **版本演进快、API 未稳定**：0.74→0.83 三个月内 38 版；`engines` 从 node >=20.6 抬到 >=22.19（0.74 起另开 `legacy-node20` tag）——嵌入后需跟随升级或锁版本；SDK API 存在 breaking 面（如 `streamingBehavior` 行为差异）。[npm registry](https://registry.npmjs.org/@earendil-works/pi-coding-agent)、[sdk.md](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md)
- **pi-chat 相对年轻且活跃度下降**：2026-04-20 创建、353 stars、仅 16 commits、最后推送 2026-06-05（约 2 个月无更新）；许可证标识不一致（Apache-2.0 vs MIT）需核实。若依赖其模式需 fork 自持。[api.github.com pi-chat](https://api.github.com/repos/earendil-works/pi-chat)
- **文档质量**：整体良好（docs 分 Start here/Programmatic usage/Reference/Platform setup，含 SDK 示例、providers、安全、容器化、RFC 规划），但无 FAQ、部分页面无 Node 版本说明；文档主要面向终端编码场景，进程内嵌入的坑（订阅生命周期、streamingBehavior）散落在 SDK 页 caveats 中。[pi.dev/docs/latest](https://pi.dev/docs/latest)

## 不确定 / 待验证

- **测试/CI 的客观证据**：vitest/biome/audit 从仓库工具链可见，但未逐一核对 GitHub Actions 工作流文件；本调研未做 CI 绿色状态的实证。
- **pi-chat 许可证**：GitHub API 与 README 冲突（Apache-2.0 vs MIT），需读其实际 LICENSE 文件确认。
- **"Slack"描述**：主仓库 README 称 pi-chat 用于 "Slack/chat automation"，但 pi-chat README 只列 Discord/Telegram——不确定是 README 过时还是 Slack 支持已移除/未发布。

## 开放问题（留给 /tech-design 决策）

- 集成形态：SDK 进程内嵌入 vs `--mode rpc` 子进程（与 ADR-001 的 CLI/HTTP 服务层如何对齐）。
- 飞书适配的实现边界：自研 pi 扩展 vs 平台侧独立桥接层（复用 ADR-007 长连接通道）vs 放弃 PI 改由 Claude Agent SDK 直做对话面。
- 双 agent 运行时（PI + Claude Agent SDK）是否可接受，还是统一到一个运行时（T-05 主问题）。
- 凭证策略：走 ANTHROPIC_API_KEY（安全）还是复用本机 Claude 订阅凭证（有 ToS 风险）。

## 参考来源清单

| 来源 | URL/路径 | 访问日期 | 用途 |
|---|---|---|---|
| GitHub 仓库 | https://github.com/earendil-works/pi | 2026-08-02 | 项目首页/定位 |
| GitHub README | https://github.com/earendil-works/pi/blob/main/README.md | 2026-08-02 | 定位、权限、供应链、pi-chat 指引 |
| GitHub API（repo 元数据） | https://api.github.com/repos/earendil-works/pi | 2026-08-02 | stars/forks/commit 活跃度/许可证 |
| GitHub API（pi-chat） | https://api.github.com/repos/earendil-works/pi-chat | 2026-08-02 | pi-chat 元数据/许可证 |
| npm registry（pi-coding-agent） | https://registry.npmjs.org/@earendil-works/pi-coding-agent | 2026-08-02 | 版本/engines/依赖/许可证/发布时间线 |
| npm registry（pi-ai） | https://registry.npmjs.org/@earendil-works/pi-ai | 2026-08-02 | providers 实现依赖（@anthropic-ai/sdk） |
| 官方文档 | https://pi.dev/docs/latest | 2026-08-02 | 定位、安装、结构 |
| docs/sdk.md（源码） | https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md | 2026-08-02 | SDK 嵌入、事件流、API |
| docs/providers.md（源码） | https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/providers.md | 2026-08-02 | 供应商/模型清单、订阅登录 |
| pi-ai README（源码） | https://github.com/earendil-works/pi/blob/main/packages/ai/README.md | 2026-08-02 | pi-ai 能力（streaming/tools/推理） |
| pi-chat 仓库/README | https://github.com/earendil-works/pi-chat | 2026-08-02 | IM 桥接支持面（Discord/Telegram） |
| Discussion #1510 | https://github.com/earendil-works/pi/discussions/1510 | 2026-08-02 | 订阅凭证 ToS 风险（社区） |
| claude-pi-bridge | https://www.npmjs.com/package/claude-pi-bridge | 2026-08-02 | PI 与 Claude Code 桥接先例（secondary） |
