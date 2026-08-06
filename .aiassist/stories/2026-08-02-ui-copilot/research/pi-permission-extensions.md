# Research: PI 权限控制扩展能力

> 调研日期：2026-08-06
> 主题：PI agent 运行时（earendil-works/pi）的权限控制扩展能力——工具调用前拦截、异步人工确认、按工具/操作类型放行或拒绝、会话维度配置；面向 Electron 桌面应用 worker 子进程内嵌（Node SDK 集成）场景
> 来源：primary sources（GitHub 源码 main 分支 2026-08-06 浅克隆、npm registry、扩展仓库源码）
> 版本基线：`@earendil-works/pi-coding-agent` 0.83.0（engines: node >=22.19.0）；`@gotgenes/pi-permission-system` 24.0.0；`@aliou/pi-guardrails` 0.16.2

## 执行摘要

1. **PI 扩展 API 原生存在"工具调用前拦截"钩子 `tool_call`，且支持异步人工确认**：handler 是 async 函数，返回 `{ block: true, reason }` 即阻止执行，`reason` 会作为错误工具结果反馈给 LLM；handler 内可 `await ctx.ui.confirm()/select()/input()` 等待人工决定。官方文档把 "Permission gates (confirm before `rm -rf`, `sudo`, etc.)" 列为扩展首要用例，并随仓库提供 `permission-gate.ts`、`protected-paths.ts`、`tool-override.ts` 三个权限类示例扩展。拦截是 fail-safe 的：handler 抛异常也会阻断工具执行。[extensions.md](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md)（Quick Start、tool_call 一节、Error Handling）、[agent-loop.ts prepareToolCall](https://github.com/earendil-works/pi/blob/main/packages/agent/src/agent-loop.ts)、[examples/extensions/permission-gate.ts](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/examples/extensions/permission-gate.ts)
2. **社区存在成熟的权限扩展，用户记忆属实——最活跃的是 `@gotgenes/pi-permission-system`（npm，MIT，v24.0.0，170+ 个版本，2026-08-05 仍在更新）**：集中式 allow/ask/deny 策略引擎，覆盖工具、bash 命令（通配符 + tree-sitter 解析 + 链式命令分解）、MCP、skill、跨工具 path、cwd 边界六个 surface；`ask` 在 TUI 走 `ctx.ui.custom` 内联键盘对话框，**非 TUI 模式（RPC/前端）降级为 `ctx.ui.select()/input()` 流程**；无 UI 时默认拒绝（`confirmation_unavailable`）。另一个是 `@aliou/pi-guardrails`（MIT，v0.16.2）：文件保护策略 + 越界路径 + 危险命令确认三件套，同样 `ctx.ui.custom` 优先、`ctx.ui.select` 兜底。[npm](https://www.npmjs.com/package/@gotgenes/pi-permission-system)、[README](https://github.com/gotgenes/pi-packages/tree/main/packages/pi-permission-system)、[permission-prompt-component.ts](https://github.com/gotgenes/pi-packages/blob/main/packages/pi-permission-system/src/authority/permission-prompt-component.ts)、[pi-guardrails](https://github.com/aliou/pi-guardrails)
3. **SDK 嵌入形态下可注入自定义确认回调，有两条官方通道**：(a) `session.bindExtensions({ uiContext, mode })` 接受宿主自实现的 `ExtensionUIContext`（`select/confirm/input/notify/...` 全套接口），`ctx.hasUI` 随之变 true——即宿主可以把确认请求经 IPC 转发到 Electron 渲染进程等待人工裁决；(b) gotgenes 扩展还提供 `getPermissionsService().registerAuthorizer(name, authorize)` 编程式授权链 seam——下游扩展注册一个 async 回调对 `ask` 裁决 allow/deny/defer（需在 config 的 `authorizerChain` 中显式启用）。注意 `createAgentSession()` 的 options **没有** uiContext 字段，`bindExtensions` 是唯一注入点。[agent-session.ts ExtensionBindings](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/agent-session.ts)（L230-237、L2237-2260）、[sdk.ts CreateAgentSessionOptions](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/sdk.ts)（L38-85）、[service.ts registerAuthorizer](https://github.com/gotgenes/pi-packages/blob/main/packages/pi-permission-system/src/service.ts)（L167-170）
4. **会话（spaceKey）维度配置能力在 PI 核心成立**：`createAgentSession()` 的 `tools`（允许列表）、`excludeTools`（拒绝列表）、`noTools`、`customTools`、`resourceLoader`（含内联 `extensionFactories` 闭包）、`settingsManager`、`scopedModels` 全部是每次调用独立的参数；运行期还可用 `pi.setActiveTools()` 按会话动态启停工具。但 gotgenes 权限扩展自身的策略配置是**文件驱动**（全局 `~/.pi/agent/extensions/pi-permission-system/config.json` + 项目 `<cwd>/.pi/.../config.json` + per-agent frontmatter），无按会话编程式传参入口。[sdk.ts CreateAgentSessionOptions](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/sdk.ts)、[sdk.md Tools/Extensions](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md)、[gotgenes configuration.md](https://github.com/gotgenes/pi-packages/blob/main/packages/pi-permission-system/docs/configuration.md)
5. **自实现"高危拦截 + 人工确认"完全可行且有官方背书**：官方文档示例（Quick Start 第一个例子就是 `rm -rf` 确认后 block）+ 三个权限示例扩展 + fail-safe 语义（扩展错误 = 阻断）。挂载点就是 `pi.on("tool_call", ...)`；SDK 形态用 `DefaultResourceLoader({ extensionFactories: [...] })` 内联注入，无需文件系统发现。被 block 的工具以 `isError` 工具结果（含 reason）回到 LLM 上下文，agent 循环继续（LLM 可换方式重试），不会中断会话。[extensions.md Quick Start](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md)、[sdk.md Extensions](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md)（L599-658）

## 详细发现

### 1. PI TypeScript extension API 形态与钩子体系

**形态**：扩展是 TypeScript 模块，默认导出一个工厂函数 `export default function (pi: ExtensionAPI) { ... }`（可 async，pi 会 await 后再继续启动），经 jiti 加载、TS 免编译。发现位置：`~/.pi/agent/extensions/`（全局）、`.pi/extensions/`（项目级，需 project trust）、settings.json 的 `extensions`/`packages` 数组、`pi -e <path|npm:|git:>`；SDK 形态可用 `DefaultResourceLoader({ additionalExtensionPaths, extensionFactories })` 编程注入（内联工厂可命名 `InlineExtension = { name, factory }`）。[extensions.md Extension Locations/Writing an Extension](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md)、[sdk.md Extensions](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md)

**生命周期/事件体系**（`pi.on(event, handler)`，handler 全部可 async、按扩展加载顺序链式执行）：

- 资源/会话：`project_trust`、`resources_discover`、`session_start`、`session_shutdown`、`session_before_switch/fork/compact/tree`、`session_info_changed`
- agent 循环：`before_agent_start`（可注入消息/改 system prompt）、`agent_start/end/settled`、`turn_start/end`、`message_start/update/end`
- provider 层：`context`（改消息）、`before_provider_headers`、`before_provider_request`、`after_provider_response`
- **工具层（本调研核心）**：`tool_execution_start/update/end`（观察）、**`tool_call`（可阻断）**、**`tool_result`（可改结果）**、`user_bash`（用户 `!`/`!!` 命令，可拦截/替换执行后端）
- 输入：`input`（可 transform/handle/continue）
- 其他：`model_select`、`thinking_level_select`

[extensions.md Lifecycle Overview + Events](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md)（L273-348 生命周期图、L749-812 tool_call、L814-847 tool_result）

**注册能力**：`pi.registerTool()`（含覆盖同名内置工具）、`pi.registerCommand()`、`pi.registerShortcut()`、`pi.registerFlag()`、`pi.setActiveTools()/getActiveTools()/getAllTools()`、`pi.appendEntry()`、`pi.events`（跨扩展事件总线）、`pi.registerProvider()`、`pi.exec()`。

### 2. `tool_call` 拦截钩子的确切语义（源码级）

- **触发时序**：`tool_execution_start` 之后、工具执行之前；并行工具模式下同一 assistant 消息的兄弟调用先顺序 preflight 再并发执行，`tool_call` 不保证看到兄弟调用的结果。[extensions.md tool_call](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md)（L749-790）
- **阻断**：handler 返回 `{ block: true, reason?: string }`。扩展 runner 中**第一个 block 立即短路**（不再跑后续 handler）。[runner.ts emitToolCall](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/extensions/runner.ts)（L932-953）
- **阻断后果**：agent 循环生成错误工具结果 `createErrorToolResult(reason || "Tool execution was blocked")`，`isError: true` 回到 LLM 上下文——**LLM 会看到拒绝原因并可改变策略继续**，会话不中断。[agent-loop.ts prepareToolCall](https://github.com/earendil-works/pi/blob/main/packages/agent/src/agent-loop.ts)（L619-663）、[types.ts BeforeToolCallResult](https://github.com/earendil-works/pi/blob/main/packages/agent/src/types.ts)（L56-64 注释原文："The loop emits an error tool result instead. `reason` becomes the text shown in that error result."）
- **fail-safe**：handler 抛异常 → agent-session 包装层转为 `Extension failed, blocking execution: ...` 错误 → 同样产出错误工具结果阻断执行。官方文档明确："tool_call errors block the tool (fail-safe)"。注意 `emitToolCall` 本身故意不 try/catch（与 `user_bash`/`context` 不同），异常由 agent 循环统一兜底为错误工具结果。[agent-session.ts _installAgentToolHooks](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/agent-session.ts)（L479-499）、[extensions.md Error Handling](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md)（L2886-2890）
- **参数可变**：`event.input` 可原地修改（后续 handler 与真实执行都看到改动，无重新校验）——可在确认后改写参数再放行。`isToolCallEventType("bash", event)` 提供内置工具的输入类型收窄。[extensions.md tool_call](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md)（L759-765）
- **异步人工确认**：handler 是 await 的；`ctx.ui.confirm/select/input` 返回 Promise，人工不答工具就不执行。`ctx.ui` 对话框还支持 `timeout` 选项与 `AbortSignal`（超时自动取消，confirm 超时返回 false=拒绝）。[extensions.md Timed Dialogs](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md)（L2500-2549）
- **辅助 seam**：`tool_result` 可链式修改结果（content/details/isError/usage）；`user_bash` 可拦截用户 shell；同名 `registerTool` 可整体覆盖内置工具做访问控制（`tool-override.ts` 模式：审计日志 + 敏感路径拒绝 + 委托原实现，渲染自动继承内置）；内置工具还支持 pluggable operations（`ReadOperations`/`BashOperations` 等 7 个接口）与 bash `spawnHook`（改 command/cwd/env）。[extensions.md Overriding Built-in Tools / Remote Execution](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md)（L2046-2133）

**官方权限类示例扩展**（随仓库发布，非 npm 包）：

| 示例 | 能力 | 文件 |
|---|---|---|
| `permission-gate.ts` | bash 命令正则匹配（rm -rf/sudo/chmod 777）→ `ctx.ui.select` 确认，无 UI 默认 block | [link](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/examples/extensions/permission-gate.ts) |
| `protected-paths.ts` | write/edit 工具按路径片段（.env/.git/node_modules）直接 block | [link](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/examples/extensions/protected-paths.ts) |
| `tool-override.ts` | 覆盖内置 read：访问日志 + 敏感路径（.env/secrets/.ssh/.aws）拒绝 | [link](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/examples/extensions/tool-override.ts) |
| `timed-confirm.ts` | 带倒计时/AbortSignal 的超时确认对话框 | [link](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/examples/extensions/timed-confirm.ts) |

### 3. 社区开源权限扩展

#### 3.1 `@gotgenes/pi-permission-system`（最成熟、最活跃）

- **元数据**：npm latest 24.0.0（2026-07-26 发布，0.7.0 起 170+ 个版本）；仓库 [gotgenes/pi-packages](https://github.com/gotgenes/pi-packages)（137 stars，2026-08-05 有提交）；MIT；peerDeps `@earendil-works/pi-coding-agent >=0.79.0`（与 0.83.0 兼容）、node >=22；运行时依赖 tree-sitter-bash + web-tree-sitter + zod。**是 [MasuRii/pi-permission-system](https://github.com/MasuRii/pi-permission-system)（128 stars，2026-07-03 后无更新）的全量 fork，README 自述"在配置格式、内部架构、权限模型上已大幅 diverge"**；上游 npm 包 `pi-permission-system@0.8.0`（2026-07-03）相对停滞。[npm registry](https://registry.npmjs.org/@gotgenes/pi-permission-system)、[fork README](https://github.com/gotgenes/pi-packages/tree/main/packages/pi-permission-system)
- **策略模型**：单一 config.json，三态 `allow`/`ask`/`deny`；surface 包括：通用回退 `"*"`、按工具名（read/write/edit/grep/find/ls 及任意扩展/MCP 工具，含按工具 path 模式）、`bash`（通配符 `git *: ask`、`rm -rf *: deny`；tree-sitter 解析；`&&`/管道/命令替换等链式命令**分解后取最严**；`bash -c`/`eval`/`sudo`/`env`/`xargs`/`find -exec` 等间接包装一律升级为 ask）、`mcp`（server/工具粒度）、`skill`、`path`（跨切面：所有文件类工具 + bash + MCP 统一按路径模式门禁，符号链接解析后双匹配防绕过）、`external_directory`（cwd 边界，可按目录放行）。四层组合**最严胜出**（path → external_directory → per-tool → bash）。surface 内**最后匹配的规则胜出**。[README What It Does](https://github.com/gotgenes/pi-packages/tree/main/packages/pi-permission-system)、[configuration.md Policy Reference](https://github.com/gotgenes/pi-packages/blob/main/packages/pi-permission-system/docs/configuration.md)
- **执行机制**：挂 `before_agent_start`（restrict-only 过滤活动工具集 + 收窄 system prompt 的 Available tools 段 + 隐藏被拒 skill）、`tool_call`（逐调用门禁）、`input`（拦截 `/skill:`）；未注册工具名直接 block 防绕过；fail-closed（门禁内部错误阻断 + 不可解析 bash 升级为 ask）。[configuration.md Pi Integration Hooks](https://github.com/gotgenes/pi-packages/blob/main/packages/pi-permission-system/docs/configuration.md)（L895-916）、[README](https://github.com/gotgenes/pi-packages/tree/main/packages/pi-permission-system)（16.0.0 迁移说明）
- **人工确认 UI（关键）**：`ask` 的裁决者按上下文三选一（[authorizer.ts selectAuthorizer](https://github.com/gotgenes/pi-packages/blob/main/packages/pi-permission-system/src/authority/authorizer.ts)，L86-107）：
  1. `ctx.hasUI` → `LocalUserAuthorizer`：TUI 模式用 `ctx.ui.custom` 内联键盘对话框（y/s/n/r 热键、二次按压确认、可展开工具预览）；**非 TUI 模式（注释原文 "RPC / frontend — the #519 constraint"）走 `ctx.ui.select()`/`input()` 流程**——选项为 Yes / Yes,for this session / No / No,provide reason（拒绝可附"教学式"原因回喂 agent）。[permission-prompt-component.ts L58-61](https://github.com/gotgenes/pi-packages/blob/main/packages/pi-permission-system/src/authority/permission-prompt-component.ts)、[permission-dialog.ts](https://github.com/gotgenes/pi-packages/blob/main/packages/pi-permission-system/src/authority/permission-dialog.ts)
  2. 无 UI 但是 subagent → `ParentAuthorizer`：经转发目录文件/进程内 registry 把请求转发给父会话 UI 裁决
  3. 无 UI 且非 subagent → `DenyingAuthorizer`：拒绝，resolution 记为 `confirmation_unavailable`
- **编程式裁决 seam（自定义确认回调）**：`authorizerChain` 配置项点名启用已注册的授权链 link；下游扩展在 `permissions:ready` 处理器里 `getPermissionsService().registerAuthorizer(name, authorize)` 注册，`authorize(details, query, log): Promise<{kind:"allow"|"deny"|"defer"}>` 是 **async 回调**，可接任意人工/自动裁决源；链不变量：config 顺序定链序、缺失 link 跳过（fail-safe 为更多提示）、注册本身不授权（须 config 显式 opt-in）、`external_directory`/`path` surface 上 link 的 allow 被降级为 defer（有界委托）。第一方参考实现 `@gotgenes/pi-permission-model-judge`（轻量模型裁决）。[configuration.md Authorizer chain](https://github.com/gotgenes/pi-packages/blob/main/packages/pi-permission-system/docs/configuration.md)（L184-221）、[service.ts L145-170](https://github.com/gotgenes/pi-packages/blob/main/packages/pi-permission-system/src/service.ts)
- **跨扩展 API**：`globalThis[Symbol.for("@gotgenes/pi-permission-system:service")]` 服务（`checkPermission(surface, value, agentName)`、`getToolPermission(toolName)`、`registerToolInputFormatter`、`registerToolAccessExtractor`、`registerAuthorizer`）+ `pi.events` 广播（`permissions:ready` / `permissions:ui_prompt`（即将弹人工确认时）/ `permissions:decision`（每次裁决，含 resolution：`policy_allow`/`policy_deny`/`session_approved`/`user_approved`/`user_approved_for_session`/`user_denied`/`auto_approved`/`confirmation_unavailable`））。[cross-extension-api.md](https://github.com/gotgenes/pi-packages/blob/main/packages/pi-permission-system/docs/cross-extension-api.md)
- **会话级批准**：确认对话框内可选 "approve for this session"（按建议模式记录会话级规则，会话内不再提示）；`yoloMode` 运行旋钮（自动批准一切，resolution `auto_approved`）；审批/决策日志（review log，0600/0700 权限，敏感 key 值打码，但 bash 命令字符串整体明文——官方明示边界）。[README](https://github.com/gotgenes/pi-packages/tree/main/packages/pi-permission-system)、[configuration.md Log file sensitivity](https://github.com/gotgenes/pi-packages/blob/main/packages/pi-permission-system/docs/configuration.md)
- **配置入口**：全局 `~/.pi/agent/extensions/pi-permission-system/config.json` + 项目 `<cwd>/.pi/extensions/pi-permission-system/config.json`（项目配置需 project trust 才加载）+ per-agent YAML frontmatter（`~/.pi/agent/agents/<agent>.md` / `<cwd>/.pi/agents/<agent>.md`，服务 subagent 扩展生态的 agent 定义约定）。项目覆盖全局；JSON Schema 随包发布可校验。[configuration.md Config File Locations / Per-Agent Overrides](https://github.com/gotgenes/pi-packages/blob/main/packages/pi-permission-system/docs/configuration.md)

#### 3.2 `@aliou/pi-guardrails`

- **元数据**：npm 0.16.2（2026-08-03，活跃）；[aliou/pi-guardrails](https://github.com/aliou/pi-guardrails)；MIT；peerDeps 为 `*`（未锁版本）。一个包安装四个扩展。[npm registry](https://registry.npmjs.org/@aliou/pi-guardrails)
- **能力边界**：`guardrails`（文件保护策略 + `/guardrails:settings` 设置 UI + onboarding）；`path-access`（cwd 外路径 allow/block/ask，ask 可按文件/目录授权 once/session/always，授权存 settings）；`permission-gate`（危险 shell 命令确认：先 `ctx.ui.custom`，**返回 undefined（非 TUI）时回退 `ctx.ui.select`**——与 RPC/SDK 宿主 uiContext 兼容；`hasUI` false 直接 block 并给原因；支持 "Allow once"/"Allow for session"/"Decline and stop"）；`herdr`（把审批中状态经 `herdr:blocked` 事件报给 Herdr 编排器——**把权限确认提示路由到外部 UI 的先例**）。[README](https://github.com/aliou/pi-guardrails)、[extensions/permission-gate/index.ts](https://github.com/aliou/pi-guardrails/blob/main/extensions/permission-gate/index.ts)（L81-126）
- 与 gotgenes 相比：无 authorizer chain 类编程裁决 seam（以 settings 文件 + 命令 UI 为中心），无 MCP/skill surface，无 tree-sitter bash 分解（规则引擎细节本调研未深入）。

#### 3.3 官方路线（非权限提示，是隔离）

官方文档对"权限"的立场：`security.md` 明示 "No Built-in Sandbox"、"A partial in-process sandbox would be easy to misunderstand as a security boundary"，推荐容器/VM/micro-VM；随仓库提供 `sandbox/` 与 `gondolin/` 扩展示例（把内置工具执行路由进沙箱/微 VM）。这与"人工确认门禁"是正交的两条路线。[security.md](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/security.md)（L31-53）、[examples/extensions/](https://github.com/earendil-works/pi/tree/main/packages/coding-agent/examples/extensions)

### 4. SDK 嵌入形态的确认回调注入（本场景关键路径）

- **`CreateAgentSessionOptions` 无 uiContext 字段**（cwd/agentDir/modelRuntime/model/thinkingLevel/scopedModels/noTools/tools/excludeTools/customTools/resourceLoader/sessionManager/settingsManager/sessionStartEvent）。[sdk.ts L38-85](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/sdk.ts)
- **注入点**：`session.bindExtensions({ uiContext, mode, commandContextActions, abortHandler, shutdownHandler, onError })`。`ExtensionUIContext` 接口含 `select/confirm/input/notify/editor`（Promise 返回，可挂起等人工）+ `onTerminalInput/setStatus/setWidget/custom/...` 等。三种内置模式（interactive/print/rpc）都通过这个接口注入各自的 UI 实现。[agent-session.ts L230-237 ExtensionBindings](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/agent-session.ts)、[types.ts L131+ ExtensionUIContext](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/extensions/types.ts)、[print-mode.ts L76 / interactive-mode.ts L1802 / rpc-mode.ts L319](https://github.com/earendil-works/pi/tree/main/packages/coding-agent/src/modes)
- **默认行为**：不绑定时 runner 用 `noOpUIContext`——`confirm: async () => false`、`select: async () => undefined`、`mode: "print"`、`hasUI()` false（拒绝安全方向）；`hasUI()` 的判定就是 `uiContext !== noOpUIContext`——**注入任何自定义 uiContext 即视为有 UI**。[runner.ts L235-266、L433-444](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/extensions/runner.ts)
- **必须显式 bind**：`session_start` 事件在 `bindExtensions()` 内发射（agent-session.ts L2258）；SDK 示例 `13-session-runtime.ts` 即使空绑定也调 `await session.bindExtensions({})`。会话替换（newSession/fork 等）后需对新 session 重绑。[sdk.md L161-167](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md)、[examples/sdk/13-session-runtime.ts L43](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/examples/sdk/13-session-runtime.ts)
- **mode 标签由宿主给定**：`ExtensionMode = "tui" | "rpc" | "json" | "print"` 只是扩展可读的标签。gotgenes 扩展的非 TUI 分支只依赖 `ctx.ui.select`/`input`（L39 `Pick<... "select" | "input" | "custom" | ...>`），因此 SDK 宿主注入实现这两个方法的 uiContext + 非 "tui" mode 即可走其 select 流程。同理官方/社区凡用 `ctx.ui.confirm/select/input` 的扩展均可由宿主接管确认 UX。[types.ts L305](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/extensions/types.ts)、[permission-prompt-component.ts L39-70](https://github.com/gotgenes/pi-packages/blob/main/packages/pi-permission-system/src/authority/permission-prompt-component.ts)
- **RPC 形态对照**（备查，来自前次调研 + rpc.md）：`ctx.ui.select/confirm/input/editor` 在 RPC 模式走 `extension_ui_request`/`extension_ui_response` JSONL 阻塞子协议；`custom()` 在 RPC 返回 undefined。即 `--mode rpc` 子进程形态下基于 select/confirm 的权限确认同样可工作，客户端实现对话框即可。[rpc.md Extension UI Protocol](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/rpc.md)、[rpc-mode.ts createExtensionUIContext](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/modes/rpc/rpc-mode.ts)

### 5. 会话（spaceKey）维度配置能力

- **PI 核心：每次 `createAgentSession()` 调用全套独立配置**——`tools`（允许列表）/`excludeTools`/`noTools`（"all"/"builtin"）/`customTools`/`resourceLoader`/`settingsManager`（可 `SettingsManager.create(cwd, agentDir)` 或 inMemory）/`scopedModels`/`cwd`。一进程可持多个 `AgentSession`（共享事件循环，协作式并发）。[sdk.ts L38-85](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/sdk.ts)、[sdk.md Tools L509-561](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md)
- **按会话注入不同扩展**：每会话一个 `DefaultResourceLoader`，`extensionFactories` 内联工厂是普通闭包函数——可闭包捕获 spaceKey 等会话级值生成按会话定制的扩展；运行期还可在 `session_start` 里 `pi.setActiveTools()` 动态裁剪（gotgenes 扩展自己就这么做工具隐藏）。[sdk.md Extensions L599-658](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md)、[extensions.md pi.setActiveTools L1645-1665](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md)
- **共享 loader 的共享状态事实**：扩展工厂在 loader 加载时执行一次（`loadExtensionsCached`），多个 session 共享一个 loader 时拿到同一批 `Extension` 实例（各自 `new ExtensionRunner` 包装，但 handler 闭包与模块级状态共享）。要会话间完全隔离的扩展状态需每会话独立 loader。[resource-loader.ts getExtensions L303](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/resource-loader.ts)、[agent-session.ts L2580-2597](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/agent-session.ts)
- **RPC 形态对照**：扩展只能文件系统发现或 spawn 时 `-e` 传参——按会话不同扩展集 = 按子进程 spawn 参数区分（前次调研结论：RPC 一进程一活动会话）。
- **gotgenes 扩展的策略配置无按会话编程入口**：全局 + 项目 cwd 两个 config.json + per-agent frontmatter（frontmatter 面向 subagent 生态的 agent 定义文件约定，非任意会话标签）。`checkPermission` 第三参 `agentName` 走的是 per-agent 覆盖解析，不是任意 spaceKey。[configuration.md](https://github.com/gotgenes/pi-packages/blob/main/packages/pi-permission-system/docs/configuration.md)

### 6. 自实现"高危拦截 + 异步人工确认 + 放行/拒绝"的挂载点结论（事实陈述）

- 最小挂载点：`pi.on("tool_call", async (event, ctx) => { ... return { block: true, reason } | undefined })`；高危判定可访问 `event.toolName`（"bash"/"write"/"edit"/...）与 `event.input`（bash: `{command, timeout?}`；write/edit: `{path, ...}`；`isToolCallEventType` 类型收窄）。
- 确认回调：handler 内 await 任意 Promise——`ctx.ui.confirm/select`（宿主 uiContext 接管）、或直接调宿主自己的 IPC（扩展工厂闭包可捕获宿主注入的回调，无需经过 ctx.ui）。
- SDK 注入：`DefaultResourceLoader({ extensionFactories: [(pi) => {...}] })`（内联、免文件系统）；或 `additionalExtensionPaths` 指向打包内 .ts 文件。
- 拒绝反馈：reason 进 LLM 上下文（错误工具结果），支持"拒绝并教 agent 改正"模式；放行后还可在执行前原地改 `event.input`。
- 旁路风险点（事实）：自定义/扩展工具与 MCP 工具也都走 `tool_call`；但"用户 `!` bash"不走 `tool_call` 而走 `user_bash`（需单独拦截）；`bash` 工具内部命令语义（链式/间接执行）需自行解析或依赖 tree-sitter 方案。

## 不确定 / 待验证

1. **gotgenes 扩展在"一进程多独立会话"下的行为**：其服务发布在 `globalThis` 单槽（`Symbol.for`，session_start 时发布、后者覆盖前者），且扩展工厂闭包状态（ConfigStore/PermissionSession 等）在共享 loader 的多会话间共享。源码可见这些事实，但"多个并发独立会话各自加载该扩展"的实际正确性未实证。本场景若每 spaceKey 一个 worker 子进程（一进程一会话）则不受影响；单 worker 多会话需验证。
2. **gotgenes 扩展以 SDK `additionalExtensionPaths`/npm 包形式在非 CLI 启动路径加载的行为**：其启动读 `getAgentDir()`/`getPackageDir()` 与文件系统 config；SDK 嵌入（自定义 agentDir、无 `~/.pi` 布局）下 config 发现与 `piInfrastructureReadPaths` 自动放行的实际表现未实证。
3. **pi-guardrails 的规则引擎细节**（bash 判定规则来源、是否可被宿主编程改写 settings）未逐行读源码，仅确认其 UI 流程与 npm 元数据。
4. **`bindExtensions({ mode: "rpc" })` 在纯 SDK 形态下使用 "rpc" 标签的副作用面**：mode 只是扩展可读标签（`ctx.mode`），但 pi 本体是否另有分支读 mode 未全面排查（已知扩展侧用法：gotgenes 用它选对话框实现；官方示例用它 guard TUI 专属特性）。
5. **是否存在官方策划的扩展注册表页面**：未发现（README/文档无 awesome/生态页链接）；生态发现依赖 npm `pi-package` 关键字与 `pi install`。本调研的 npm 关键字检索（约 50 条结果）可能未穷尽所有权限类扩展（未带该关键字的包检索不到）。
6. **pi.dev 文档站与 GitHub docs 的同步**：本调研全部以 GitHub main 分支源码与文档为准，未逐页比对 pi.dev。

## 开放问题（留给 /tech-design）

- 权限层形态选择：直接用 gotgenes 扩展（+ authorizerChain 接宿主确认 UI）vs 自实现轻量 `tool_call` 拦截扩展（闭包接宿主 IPC 回调）vs pi-guardrails；三者对"按 spaceKey 动态策略"的适配成本。
- 按会话动态策略的实现路径：PI 核心 per-session `createAgentSession` 参数 / 独立 ResourceLoader 闭包扩展 vs gotgenes 文件配置 + per-agent frontmatter 的间接映射。
- 确认 UI 通道：宿主自实现 `ExtensionUIContext`（select/confirm/input）经 worker→主进程 IPC vs 绕过 ctx.ui 直接在扩展闭包内接宿主回调 vs authorizerChain link；对 `permissions:ui_prompt`/`permissions:decision` 广播的利用（通知/审计）。
- bash 高危判定深度：正则（官方示例级）vs tree-sitter 链式分解（gotgenes 级）；`user_bash` 事件是否需要同等门禁。
- 会话批准（"本会话不再询问"）状态的存放：扩展内存（随 session_shutdown 失效）vs `pi.appendEntry` 持久化 vs 宿主侧空间级策略。
- 与官方沙箱路线（Gondolin/Docker/OpenShell）的关系：人工确认门禁与执行隔离是否叠加，超出本调研范围。

## 参考来源清单

| 来源 | URL/路径 | 访问日期 | 用途 |
|---|---|---|---|
| PI extensions 文档 | https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md | 2026-08-06 | 扩展 API 形态、tool_call/tool_result/user_bash 钩子语义、对话框 API、官方示例索引 |
| PI sdk 文档 | https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md | 2026-08-06 | createAgentSession 选项、ResourceLoader 内联扩展、bindExtensions、按会话工具配置 |
| PI security 文档 | https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/security.md | 2026-08-06 | 官方"无内置沙箱"立场与隔离路线 |
| 扩展 runner 源码 | https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/extensions/runner.ts | 2026-08-06 | emitToolCall 短路语义、noOpUIContext、hasUI 判定、setUIContext |
| agent-session 源码 | https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/agent-session.ts | 2026-08-06 | ExtensionBindings、bindExtensions、beforeToolCall fail-safe 包装、每会话 ExtensionRunner |
| agent-core 源码 | https://github.com/earendil-works/pi/blob/main/packages/agent/src/agent-loop.ts 、 .../src/types.ts | 2026-08-06 | block → 错误工具结果回喂 LLM、BeforeToolCallResult 定义 |
| SDK 创建源码 | https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/sdk.ts | 2026-08-06 | CreateAgentSessionOptions 全集（无 uiContext）、tools/excludeTools 语义 |
| 扩展类型源码 | https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/extensions/types.ts | 2026-08-06 | ExtensionUIContext 接口全集、ExtensionMode 取值 |
| resource-loader 源码 | https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/resource-loader.ts | 2026-08-06 | 扩展加载缓存与 getExtensions 共享语义 |
| 官方权限示例扩展 | https://github.com/earendil-works/pi/tree/main/packages/coding-agent/examples/extensions （permission-gate.ts、protected-paths.ts、tool-override.ts、timed-confirm.ts） | 2026-08-06 | 官方权限拦截参考实现 |
| SDK 扩展示例 | https://github.com/earendil-works/pi/blob/main/packages/coding-agent/examples/sdk/06-extensions.ts 、 13-session-runtime.ts | 2026-08-06 | 内联 extensionFactories、bindExtensions({}) 用法 |
| gotgenes/pi-permission-system README + docs | https://github.com/gotgenes/pi-packages/tree/main/packages/pi-permission-system （README.md、docs/configuration.md、docs/cross-extension-api.md） | 2026-08-06 | 策略模型、UI 流程、authorizer chain、服务/事件 API、配置入口 |
| gotgenes 扩展源码 | https://github.com/gotgenes/pi-packages/tree/main/packages/pi-permission-system/src （authority/authorizer.ts、local-user-authorizer.ts、permission-dialog.ts、permission-prompt-component.ts、service.ts、index.ts、config-paths.ts、extension-config.ts） | 2026-08-06 | hasUI/subagent/deny 三向分派、select 兜底流程、registerAuthorizer、config 路径、yoloMode |
| npm：@gotgenes/pi-permission-system | https://registry.npmjs.org/@gotgenes/pi-permission-system | 2026-08-06 | 版本线（170+ 版本/24.0.0）、peerDeps、MIT、发布时间 |
| MasuRii 上游 | https://github.com/MasuRii/pi-permission-system 、 https://registry.npmjs.org/pi-permission-system | 2026-08-06 | 上游活跃度对比（0.8.0，2026-07-03） |
| pi-guardrails | https://github.com/aliou/pi-guardrails （README、extensions/permission-gate/index.ts、package.json）、https://registry.npmjs.org/@aliou/pi-guardrails | 2026-08-06 | 第二个权限扩展的能力边界与 UI 兜底模式 |
| npm pi-package 关键字检索 | https://registry.npmjs.org/-/v1/search?text=keywords:pi-package | 2026-08-06 | 生态扩展发现（约 50 个包，定位权限类候选） |
| RPC 模式文档 | https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/rpc.md | 2026-08-06 | extension_ui_request/response 子协议（备查） |
