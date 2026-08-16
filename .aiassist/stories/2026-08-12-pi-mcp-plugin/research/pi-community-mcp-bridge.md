# Research: pi 社区 MCP 桥 extension 调研

> 调研日期：2026-08-12
> 主题：pi 社区有无现成 MCP 桥 extension；候选的配置注入与权限挂接可行性

## 执行摘要

1. **社区已有多个现成 MCP 桥，且存在明显的事实标准**：`pi-mcp-adapter`（nicobailon，GitHub 1.2k stars、MIT、近 30 天 npm 下载 ~354K，当前 2.23.0，2026-08-11 仍在活跃发布），同时出现在 pi.dev/packages 官方包画廊中（画廊只收录带 `pi-package` keyword 的包）。来源：npm registry、`https://github.com/nicobailon/pi-mcp-adapter`、`https://pi.dev/packages`。
2. **pi 官方确认无内置 MCP，MCP 由 extension/package 承担**：README「No MCP. Build ... an extension that adds MCP support」（本地包 `node_modules/@earendil-works/pi-coding-agent/README.md` L495）；`docs/usage.md` L296 同样说明 intentionally does not include built-in MCP。官方 repo（`github.com/badlogic/pi-mono`，现跳转 `earendil-works/pi`）根目录无 MCP 相关 example/目录。
3. **配置注入可行**：`pi-mcp-adapter` 除文件配置（`.mcp.json` 等 6 层 precedence）外，提供程序化 API `createMcpAdapter({ config })` 注入完整隔离的内存配置快照（不与任何文件 merge、不被 mutate），以及 `createMcpAdapter({ configPath })` 指定任意配置文件路径。来源：tarball `README.md`「SDK configuration」节、`index.ts` L883。
4. **权限挂接有双层事实**：（a）适配器所有工具（代理工具 `mcp`、`mcpScript`、direct tools）都通过 `pi.registerTool` 注册（`index.ts` L154/L648/L693），pi 的 `tool_call` 事件在工具执行前触发且可 block、可 mutate input（本地 `docs/extensions.md` L749-764）；（b）适配器另有自己的审批中介事件 `pi-mcp-adapter:tool-approval-request`，外部权限系统可同步 claim 并返回 `allow_once | allow_for_session | deny | abstain`，对每次未缓存的 MCP 调用生效，携带 `serverName/originalToolName/args/origin`。来源：tarball `README.md` 审批节（约 L364-381）、`tool-approval.ts`。
5. **官方 MCP SDK**：`@modelcontextprotocol/sdk` npm 最新 1.30.0（registry 实测）；另已拆出 `@modelcontextprotocol/client` 2.0.0 独立客户端包（pi-mcp-adapter 2.23.0 即依赖它与 `@modelcontextprotocol/core` 2.0.0）。TS SDK 客户端含 stdio / StreamableHTTP / SSE transport（pi-mcp-adapter `server-manager.ts` L5-15 即从这些子路径 import）。

## 详细发现

### 候选清单

以 npm registry 搜索（`text=pi mcp`、`keywords:pi-package`）+ pi.dev/packages 画廊 + GitHub 为准，按活跃度排序：

| 包 | 最新版本 | 近30天下载 | 仓库 | 备注 |
|---|---|---|---|---|
| `pi-mcp-adapter` | 2.23.0（2026-08-11） | ~354K | github.com/nicobailon/pi-mcp-adapter（1.2k stars, MIT） | 事实标准；代理工具模式（一个 `mcp` 工具 ~200 tokens，按需 search/describe/call），lazy 连接，OAuth，direct tools 提升 |
| `pi-mcp-extension` | 1.5.0 | ~8.9K | github.com/irahardianto/pi-mcp-extension | 独立实现，MCP client extension |
| `@spences10/pi-mcp` | 0.0.59 | ~2.7K | github.com/spences10/my-pi（packages/pi-mcp） | 个人项目子包 |
| `@qianhuan-lxs/pi-mcp-bridge` | 0.5.6 | ~2.8K | github.com/qianhuan-lxs/pi-mcp-bridge | 两个动态上下文工具（CallMcpTool + …）桥接 |
| `@nklisch/pi-mcp-adapter` | 2.20.1-nklisch.0 | ~2.6K | github.com/nklisch/pi-extensions（packages/pi-mcp-adapter） | pi-mcp-adapter fork，自称「programmatic source lifecycle」 |
| `pi-mcp-adapter-turbo` | 2.19.2 | ~288 | github.com/patlux/pi-mcp-adapter | pi-mcp-adapter 性能 fork |
| `@tinysnake/pi-mcp` | 0.1.0 | ~202 | github.com/tinysnake/pi-snake-extensions | in-process MCP SDK connector |
| `@0xkobold/pi-mcp` | 0.4.0 | ~204 | github.com/0xKobold/pi-mcp | 描述含 stdio/SSE（截断） |
| `pi-mcp-router` | 1.4.0 | ~192 | 无 repository 字段 | 路径作用域多账号 MCP 路由（依赖上游适配器） |
| `pi-mcp-sidecar` | 0.1.0 | 未查 | — | 从独立 sidecar extension 整体 block/restore pi-mcp-adapter servers |
| 其他 fork | — | — | — | `@pixu1980/pi-mcp`、`@vllnt/pi-mcp`、`pi-tidy-mcp-adapter`、`@diegopetrucci/pi-mcp-adapter`、`@schovest/pi-mcp-adapter` 等均为 pi-mcp-adapter 衍生 |

pi.dev/packages 画廊中明确 MCP 相关的包为 `pi-mcp-adapter`（标注 ~354.4K/mo，type: extension）；`context-mode`（73.4K/mo）虽描述含 "MCP plugin" 但它是面向 Claude Code/Gemini CLI 等的省上下文插件，**不是** pi 的 MCP client 桥（不确定其 pi 集成形态）。

pi 官方 repo（`earendil-works/pi`，88.1k stars）issue 区有 MCP 相关使用痕迹：#7763「RpcClient hardcoded 60s timeout … long-running MCP/extension tool calls get cancelled」（closed）、#7774「mcp 2.0」（closed）、#6930「Make renderPage / oauth html functions public」（open，与 pi-mcp-adapter 的 OAuth 回调页面相关）。本地包 `examples/extensions/` 59 个示例中**无** MCP 示例（官方立场是交给社区）。

以下评估均针对事实标准 `pi-mcp-adapter@2.23.0`（tarball 解包源码，`/tmp/pi-mcp-research/package/`）；其余候选未深入源码评估。

### 候选评估：配置注入（pi-mcp-adapter@2.23.0）

**配置来源（文件层）**：按 precedence 读取 6 层（README「Config/File Layout」节 + `config.ts` L12-18）：
1. `~/.config/mcp/mcp.json` 2. `~/.agents/mcp.json` 3. `~/.agents/mcp/mcp.json` 4. `<Pi agent dir>/mcp.json` 5. `.mcp.json`（项目） 6. `.pi/mcp.json`（项目 override）
另可检测但不自动加载 Cursor/Claude Code/Windsurf/VS Code 等宿主配置（`settings.hostConfigDiscovery` 默认 `"off"`；`config.ts` L65-81）。

**宿主运行时注入（程序化层）——支持**：
- `createMcpAdapter({ config })`（`index.ts` L883-891）：传入完整内存配置快照。README 明确：「A supplied `config` is a complete, isolated snapshot. It is not merged with files, imports, global config, project config, or `--mcp-config`, and it is never mutated. Each adapter factory and session receives its own clone」。此模式下 `/mcp setup` 等写配置的命令不可用（`index.ts` L523/L548），server status/reconnect/proxy 调用/direct tools 均正常。
- `createMcpAdapter({ configPath })`：指定任意配置文件路径，优先级高于 argv 和 `--mcp-config`（README「SDK configuration」节）。
- 返回值是一个 `function mcpAdapter(pi: ExtensionAPI)`，由宿主（pi 的 ResourceLoader / `createAgentSession`）注册；`docs/sdk.md` L50/L575 确认 `createAgentSession()` 通过 `ResourceLoader` 供 extensions，extension 经 `pi.registerTool()` 注册工具。
- 注意（README 明确）：包只发 TS 源码，standalone Node 进程 import 需要 TypeScript-capable loader（如 `node --import tsx`）。

**Transport 支持**（`server-manager.ts` L5-15, L368, L766-767；README「Server Options」表）：
- **stdio**：`command`/`args`，支持 `env`/`cwd` 变量插值（`${VAR}`、`$env:VAR`）。
- **HTTP**：`url` → `StreamableHTTPClientTransport`，SSE fallback（`SSEClientTransport`）；`headers` 支持插值与命令执行（`!` 前缀）。
- **Unix domain socket**：`socket` 字段，自有 `UnixSocketClientTransport`（`unix-socket-transport.ts`），面向共享 `rmcp-mux` 进程。
- 协议版本协商：`"legacy"`（默认）/`"auto"`/`"2026-07-28"` 钉版（`types.ts` L405 附近有 `httpTransport?: "streamable-http" | "sse"`）。
- 认证：per-server `auth: "bearer" | "oauth"`，OAuth token 存 OS 凭据库、按 server 名+URL 绑定；公开子路径 `pi-mcp-adapter/oauth` 供协作 extension 读/更新 token。
- 生命周期：lazy 默认（首次调用才连接），`lifecycle: "eager"`、`idleTimeout`（默认 10 分钟）、`requestTimeoutMs` 可配。

### 候选评估：权限挂接（pi-mcp-adapter@2.23.0）

**工具注册方式**：全部经 `pi.registerTool`（`index.ts` L154 `registerDirectTool`、L648 `mcpScript`、L693 代理工具 `mcp`）。即：代理模式下一个 `mcp` 工具 + 可选 `mcpScript` 编排工具 + 可选提升为原生工具的 direct tools（带 `server_` 前缀名）+ resource 工具。

**pi 层拦截（tool_call 事件）——事实**：
- pi 的 `tool_call` 事件「Fired after `tool_execution_start`, before the tool executes. **Can block.**」（本地 `docs/extensions.md` L751-753），handler 返回 `{ block: true, reason }` 可阻止执行；`event.input` 可变（L759-764）。官方示例（L70-75）即演示按 toolName+input 拦截 bash。
- 推论性事实（基于以上两条一手事实的组合）：适配器注册的工具走 pi 的工具管线，宿主可用 `pi.on("tool_call", ...)` 拦截。**粒度注意**：代理模式下 pi 层看到的 toolName 是 `"mcp"`，具体 MCP server/tool 名在 `event.input.tool`/`event.input.args` 里；只有被提升为 direct tool 的 MCP 工具才以前缀名出现在 toolName。此点未在适配器文档中显式陈述，属从两侧源码/文档拼合的推断（标注：不确定度低，但未经运行验证）。

**适配器自有审批中介（对接外部权限系统的设计）——支持**：
- `approveTools` 设置：全局或 per-server，`true` / glob 数组（如 `["github_delete_*"]`）；匹配调用在交互模式弹「Allow once / Allow for session / Deny」，headless 模式 fail closed 返回 `approval_required`（README 约 L332/L364；判定逻辑 `tool-approval.ts` `isToolCallApprovalRequired`）。
- **Broker 事件**：`pi-mcp-adapter:tool-approval-request`（导出常量 `MCP_TOOL_APPROVAL_REQUEST_EVENT`，`types.ts`）。权限 extension 同步 `request.claim(async () => "allow_once" | "allow_for_session" | "deny" | "abstain")`，第一个同步 claim 获胜。README 原文：「Brokered approval runs for every uncached MCP call regardless of `approveTools` configuration, across proxy, direct, `mcpScript`, resource, and iframe origins.」请求载荷含 `serverName`、`originalToolName`、`prefixedToolName`、`args`、`origin`、`signal`。
- 即无论是否配置 `approveTools`，宿主都能挂到每次 MCP 调用上做决策——这正是「对接外部权限系统」的官方设计面。
- 另有 consent-manager（`consent-manager.ts`）管理 MCP UI iframe 的工具调用同意。

**其他相关面**：输出护栏（output guard，50 KiB/2000 行截断 + 临时文件落盘）、`excludeTools` 整体移除工具、`pi.unregisterTool()` 在刷新时清理过期 direct tools。

### 官方 MCP SDK 能力

- `@modelcontextprotocol/sdk` npm 最新版本 **1.30.0**（registry 实测，2026-08-12），描述「Model Context Protocol implementation for TypeScript」，exports 含 `./client`、`./server`、`./experimental` 等。
- 生态已出现拆包形态 `@modelcontextprotocol/client@2.0.0`（「…TypeScript - Client package」）与 `@modelcontextprotocol/core@2.0.0`，pi-mcp-adapter 2.23.0 依赖之。
- TS SDK 客户端提供 stdio / StreamableHTTP / SSE transport 类（`StdioClientTransport`、`StreamableHTTPClientTransport`、`SSEClientTransport`）——证据：pi-mcp-adapter `server-manager.ts` L5-15 从 `@modelcontextprotocol/client/stdio` 等子路径 import 这三个类。

## 不确定 / 待验证

1. **pi 层 `tool_call` 对 extension 注册工具的适用性**：`docs/extensions.md` 的表述是泛化的（未区分内置/扩展工具），pi-mcp-adapter 经 `pi.registerTool` 注册，组合推断可拦截；但未运行验证，且代理模式下 pi 层只能看到 `mcp` 包装调用（内部 tool 名在 input 里），细粒度拦截依赖适配器自己的 broker 事件更稳。
2. **`@modelcontextprotocol/sdk` 与 `@modelcontextprotocol/client` 2.x 的关系**：registry 上两者并存（sdk 1.30.0 vs client/core 2.0.0），拆包/版本线关系未读官方迁移说明，不确定。
3. **context-mode（73.4K/mo）**：出现在 pi.dev 画廊且描述含 "MCP plugin"，但它自称服务 Claude Code/Gemini CLI 等，其 pi 侧形态（是否为 pi extension、是否提供 MCP client 能力）未核实。
4. **次候选（pi-mcp-extension、@qianhuan-lxs/pi-mcp-bridge 等）未做源码级评估**：仅取了 registry 元数据与下载量；若 pi-mcp-adapter 被否决，需对这些补做同等评估。
5. **pi-mcp-adapter 的 peer 依赖**：`package.json` peerDependencies 要求 `@earendil-works/pi-ai ^0.84.1`（本机安装为 0.83.0，registry 最新 pi-coding-agent 0.84.1）——版本对齐影响未评估。

## 开放问题

1. 宿主应用集成 pi 的方式（CLI 包裹 vs SDK `createAgentSession`）会决定配置注入的实际路径：`createMcpAdapter({ config })` 需要宿主持有 extension 工厂引用；纯 CLI/`pi install` 路径下只能走文件/`configPath`。
2. broker 事件 `pi-mcp-adapter:tool-approval-request` 在 headless/RPC 模式下的投递语义（同步 claim 的超时、无人 claim 时 headless 的 fail-closed 边界）需实测。
3. 适配器 lazy 生命周期 + 空闲断开与宿主期望的长驻 server 模型是否匹配。
4. pi-mcp-adapter 只发 TS 源码，宿主打包/运行时（是否需要 tsx/jiti 类 loader）的工程代价。

## 参考来源清单

| 来源 | URL/路径 | 访问日期 | 用途 |
|---|---|---|---|
| npm registry：pi-mcp-adapter 元数据 | https://registry.npmjs.org/pi-mcp-adapter | 2026-08-12 | 版本、依赖、repo、发布频率 |
| pi-mcp-adapter tarball 源码（解包至 /tmp/pi-mcp-research/package/）| npm dist tarball（index.ts / config.ts / server-manager.ts / tool-approval.ts / types.ts / README.md / package.json） | 2026-08-12 | 配置注入、transport、注册方式、审批 broker 的一手源码证据 |
| pi-mcp-adapter GitHub | https://github.com/nicobailon/pi-mcp-adapter | 2026-08-12 | stars(1.2k)/license(MIT)/README 概述 |
| npm 搜索 `text=pi mcp` / `keywords:pi-package` | https://registry.npmjs.org/-/v1/search?text=pi+mcp 等 | 2026-08-12 | 候选清单 |
| npm 下载量 API | https://api.npmjs.org/downloads/point/last-month/… | 2026-08-12 | 各候选近 30 天下载量 |
| pi.dev 包画廊 | https://pi.dev/packages | 2026-08-12 | 官方收录确认（pi-mcp-adapter 在列） |
| 本地 pi 包 README | /Users/zhanglei/charon/code/workspace/workstation/node_modules/@earendil-works/pi-coding-agent/README.md L495 | 2026-08-12 | 官方「无内置 MCP」立场 |
| 本地 pi docs/usage.md | 同上/docs/usage.md L296 | 2026-08-12 | 官方不内置 MCP 的设计说明 |
| 本地 pi docs/extensions.md | 同上/docs/extensions.md L70-75, L749-764 | 2026-08-12 | `pi.registerTool`、`tool_call` 事件可 block/mutate |
| 本地 pi docs/sdk.md | 同上/docs/sdk.md L50, L575 | 2026-08-12 | `createAgentSession` ResourceLoader 加载 extension、extension 注册工具 |
| 本地 pi docs/packages.md | 同上/docs/packages.md L118-142 | 2026-08-12 | 画廊收录规则（`pi-package` keyword） |
| pi 官方 GitHub | https://github.com/earendil-works/pi（badlogic/pi-mono 跳转） | 2026-08-12 | 88.1k stars；根目录无 MCP 示例；issues #7763/#7774/#6930 |
| npm registry：@modelcontextprotocol/sdk | https://registry.npmjs.org/@modelcontextprotocol%2Fsdk/latest | 2026-08-12 | 最新 1.30.0 |
| npm registry：@modelcontextprotocol/client | https://registry.npmjs.org/@modelcontextprotocol%2Fclient/latest | 2026-08-12 | 2.0.0 独立客户端包 |
