# ADR-005: Claude Agent 节点采用 Claude Agent SDK 并复用本机凭证

- **状态**: 已接受
- **日期**: 2026-07-17
- **相关 story**: 2026-07-16-flow-refinement
- **相关 REQ**: REQ-FLOW-020、REQ-FLOW-026、REQ-FLOW-027、REQ-FLOW-028

## 背景

Flow 细化 story 需要让 Claude Agent 节点真实调用 agent。已签核契约中，REQ-FLOW-027 要求 adapter 把 flow 所属项目的本地路径作为**工作目录**使用，路径不可读时返回 error；PRD 的示例场景（"读取项目文件 → 让 agent 分析 → 分支处理"）要求 agent 能在项目目录内实际操作文件。

凭证方面，产品形态是本地单机桌面应用 + headless CLI 双运行时，目标用户本机已有 claude code 使用环境。

## 决策

1. **底层 SDK 采用 `@anthropic-ai/claude-agent-sdk`**：adapter 把统一输入 `{ prompt, model, projectPath, options, apiKey? }` 映射到 `query({ prompt, options: { cwd, model, ... } })`，汇聚流式消息为文本输出。
2. **应用不存储 API 凭证**：依赖用户本机 claude code 的登录态（或其自行配置的环境变量）。adapter 的 `apiKey` 入参保留为可选透传缝，应用自身不填充。
3. **执行模式 `permissionMode: "bypassPermissions"`**：无人值守/定时执行无法应答权限交互；flow 由用户本人编排，agent 在其项目目录内工作。
4. **参数透传 allowlist**：节点 `config.options` 仅接受 `systemPrompt` / `maxTurns`；不支持 `temperature` / `maxTokens`（SDK 无此选项，静默忽略会误导用户）。

## 替代方案

1. **Anthropic Messages API（`@anthropic-ai/sdk`）**：轻量、纯文本进出。但"工作目录"对无工具的单次 API 调用无意义，REQ-FLOW-027 只能退化为路径存在性空校验；PRD 的文件操作场景不成立。拒绝。
2. **多 provider 抽象（同时支持 OpenAI 等）**：adapter 接口本身已是抽象缝，当前再建 provider 注册表属于过度设计。拒绝（未来可加）。
3. **凭证存 settings.json / Electron safeStorage**：settings 明文落盘有安全顾虑；safeStorage 在 headless CLI（非 Electron）运行时不可用，两条路径分叉。均被"复用本机 claude code"取代。
4. **调用用户本机 `claude` CLI（child_process）**：PRD 已把"本地 CLI agent 扫描"划为范围外；SDK 捆绑运行时，不依赖用户 PATH。拒绝。

## 影响

- 新增依赖 `@anthropic-ai/claude-agent-sdk`；其捆绑 CLI 需加入 Electron asar unpack 配置；子进程运行时在 Electron 下需 `ELECTRON_RUN_AS_NODE=1`。打包形态 spike 列为 BUILD 第一切片。
- 应用无凭证设置 UI；鉴权失败在运行时以节点错误呈现，错误消息指引用户完成本机 claude code 登录。
- `bypassPermissions` 使 agent 可在项目目录内读写执行：这是产品形态（自动化无人值守）的有意取舍，风险与缓解记录在 tech-design §9。
- 逆转成本：adapter 接口（已签核）保持不变，更换 SDK 只需重写 adapter 内部；但打包配置、spike 验证与 TDD 测试投入会作废，故视为难逆转决策。

## 相关文件

- `.aiassist/stories/2026-07-16-flow-refinement/tech-design.md`
- `.aiassist/stories/2026-07-16-flow-refinement/prd.md`（移动块 1/2/5）
- `src/flowEngine/agentAdapter.js`（现为 mock stub，BUILD 阶段替换/新增 claudeAgentAdapter）
