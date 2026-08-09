# Research: pi-coding-agent token/usage/成本与 git 分支能力

> 调研日期：2026-08-09
> 主题：@earendil-works/pi-coding-agent（0.83.0）/ pi-agent-core / pi-ai 是否提供 token 用量/成本/usage 数据接口，以及 git 分支获取的既有能力；workstation 现有实现盘点
> 来源：primary sources（node_modules 内已安装包 dist 源码 + 包内官方 docs）

## 执行摘要

1. **token/usage/成本数据在 pi 栈内完整存在，且有公共查询接口**：pi-ai 层 `AssistantMessage.usage: Usage` 为必填字段（pi-ai/dist/types.d.ts:297），包含 input/output/cacheRead/cacheWrite/totalTokens 与 `cost`（$ 金额，由 `calculateCost()` 按模型价目表实时算得，pi-ai/dist/models.js:371-390）。coding-agent 的 `AgentSession.getSessionStats()`（agent-session.d.ts:622）聚合整个会话（含 compaction/branch_summary/tool 嵌套 usage）返回 `SessionStats`（tokens/cost/contextUsage，agent-session.d.ts:174-191）。
2. **查询接口有三层，均基于同一份 JSONL 会话数据**：① SDK 内存态 `session.getSessionStats()` / `session.getContextUsage()`（agent-session.d.ts:622-623）；② RPC 协议命令 `get_session_stats`（rpc-mode.js:464-466，官方文档 rpc.md:531-568 声明"Get token usage, cost statistics, and current context window usage"）；③ 会话 JSONL 文件本身按消息记录 `usage` 字段（docs/session-format.md:104-117、:209 示例行）。**没有 usage 类会话事件**：`AgentSessionEvent` 联合类型（agent-session.d.ts:40-106）只有 compaction_start/end、bash_execution_update 等，usage 只能从 message_end/turn_end 事件携带的 assistant message 上读（该 message 含 usage），或轮询 stats。
3. **git 分支获取能力是 TUI footer 的既有功能，非独立 API**：`FooterDataProvider`（core/footer-data-provider.js:86-246）读 `.git/HEAD`（含 worktree 支持，:9-46），回退 `git --no-optional-locks symbolic-ref --quiet --short HEAD`（:48-56），返回 `getGitBranch(): string | null`（null=非仓库，`"detached"`=分离 HEAD，d.ts:35-36），并有 HEAD watcher + `onBranchChange()` 订阅（:122-125）。pi 工具面**没有** git 工具（tools/ 仅有 bash/edit/find/grep/ls/read/write），会话文件**不记录** git 分支（SessionHeader 仅 id/timestamp/cwd/parentSession，session-manager.d.ts:5-12）。
4. **workstation 现状**：`src/agent/worker.js` 用 `createAgentSession` SDK 内存态集成（worker.js:31、766），已订阅 AgentSession 事件流（worker.js:803）——message_end 事件里已携带带 usage 的 assistant message，但当前**没有**任何 usage/cost/token 展示；git 分支只在 `projectService.js` 里存"创建项目时的 branch 元数据"（:149-172），无实时分支读取。
5. **上下文用量暴露充分**：`ContextUsage { tokens|null, contextWindow, percent|null }`（extensions/types.d.ts:193-199）经 `session.getContextUsage()` 与 extension `ctx.getContextUsage()`（extensions/types.d.ts:243-244）暴露；compaction 事件（compaction_start/end）与 `CompactionEntry.tokensBefore` 记录压缩时 token 数（session-manager.d.ts:36-47）。

## 详细发现

### token/usage/成本

#### pi-ai 层（模型调用层）：usage 是必填字段，cost 在此层计算

- fact — `Usage` 接口：`{ input, output, cacheRead, cacheWrite, cacheWrite1h?, reasoning?, totalTokens, cost: { input, output, cacheRead, cacheWrite, total } }`。`reasoning` 为思考 token（是 output 的子集，仅支持报告的 provider 提供）；`cacheWrite1h` 仅 Anthropic 报告 — 源码: node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-ai/dist/types.d.ts:260-281
- fact — `AssistantMessage.usage: Usage` **必填**（非可选）——每条 assistant 消息都带用量 — 源码: 同上:297
- fact — `calculateCost(model, usage)`：按模型 `cost` 价目表（$/1M tokens）实时算金额，支持 input 分档 tier，Anthropic 1h cache write 按 2x input 计价；直接写入并返回 `usage.cost` — 源码: pi-ai/dist/models.js:371-390
- fact — provider 客户端从 API 响应抽取原始 token 数并立即计费：Anthropic 示例 `usage.input = event.message.usage.input_tokens`、`cacheRead = cache_read_input_tokens`、`cacheWrite = cache_creation_input_tokens`，然后 `totalTokens` 求和 + `calculateCost(model, usage)` — 源码: pi-ai/dist/api/anthropic-messages.js:386-394
- fact — 计费依赖模型价目表数据（`model.cost`，含分档），成本对自定义/未知定价模型可能为 0（cache-stats 注释"0 when pricing is unknown"）— 源码: pi-coding-agent/dist/core/cache-stats.d.ts:12-13；CHANGELOG.md:295（input-based pricing tiers 为较新能力）

#### coding-agent 层：聚合与查询

- fact — `SessionStats`：`{ sessionFile, sessionId, userMessages, assistantMessages, toolCalls, toolResults, totalMessages, tokens: { input, output, cacheRead, cacheWrite, total }, cost, contextUsage? }` — 源码: pi-coding-agent/dist/core/agent-session.d.ts:174-191
- fact — `AgentSession.getSessionStats()` 公共方法；实现遍历 `sessionManager.getEntries()` 全部条目：assistant 消息 usage + toolResult 消息 usage（工具嵌套 LLM 工作）+ compaction/branch_summary 条目的 usage 全部累加（`addUsageToTotals` 累加 `usage.cost.total`），`tokens.total = input+output+cacheRead+cacheWrite`。注释明言"token/cost totals reflect what was actually billed across the session"（含已压缩掉的历史）— 源码: pi-coding-agent/dist/core/agent-session.js:2488-2542
- fact — `AgentSession.getContextUsage()` 公共方法 — 源码: agent-session.d.ts:623
- fact — 内部工具 `UsageTotals` / `addUsageToTotals` / `getUsageCostBreakdown(entries)`（按 `provider/responseModel` 分组 + "Tools/summaries" 桶，按 cost 降序）存在于 dist 但**未从包根导出**（index.d.ts 无引用；内部被 getSessionStats/footer 使用）— 源码: pi-coding-agent/dist/core/usage-totals.js:1-41；index.d.ts:5（导出清单里无 usage-totals）
- fact — 包根导出（index.d.ts:5）的 usage 相关函数：`calculateContextTokens(usage)`、`estimateTokens(message)`（chars/4 启发式、保守高估）、`getLastAssistantUsage(entries)`、`generateSummaryWithUsage` — 源码: pi-coding-agent/dist/index.d.ts:5；dist/core/compaction/compaction.d.ts:38-62

#### 会话事件：无 usage 事件，usage 随消息流动

- fact — `AgentSessionEvent` 联合类型全清单：agent_end/agent_settled/queue_update/compaction_start/entry_appended/session_info_changed/thinking_level_changed/compaction_end/auto_retry_start/auto_retry_end/summarization_retry_*/bash_execution_update。**没有 usage/token/cost 类事件** — 源码: pi-coding-agent/dist/core/agent-session.d.ts:40-106
- fact — 底层 `AgentEvent`（pi-agent-core）：agent_start/agent_end/turn_start/turn_end/message_start/message_update/message_end/tool_execution_*。**同样无 usage 字段**；但 message_end/turn_end 携带的 `message: AgentMessage` 即 pi-ai AssistantMessage，内含必填 `usage` — 源码: node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-agent-core/dist/types.d.ts:368-420
- fact — `entry_appended` 事件仅用于 extension 自定义条目（agent-session.js:1868 唯一发射点），普通 LLM 消息不走此事件 — 源码: pi-coding-agent/dist/core/agent-session.js:1865-1869

#### RPC 接口

- fact — `RpcClient.getSessionStats(): Promise<SessionStats>`（rpc-client.d.ts:161），wire 命令 `{"type": "get_session_stats"}`（rpc-types.d.ts:94），服务端 `case "get_session_stats": session.getSessionStats()`（rpc-mode.js:464-466）— 源码: pi-coding-agent/dist/modes/rpc/rpc-client.d.ts:161、rpc-mode.js:464-466
- fact — 官方文档确认响应含 tokens/cost/contextUsage，并注明 `contextUsage.tokens/percent` 在刚压缩后为 null 直到下一条 post-compaction assistant 响应；tokens/cost 覆盖全会话 — 来源: pi-coding-agent/docs/rpc.md:531-568（"Get token usage, cost statistics, and current context window usage"）
- fact — `RpcSessionState`（get_state 命令）**不含** usage/token 字段 — 源码: pi-coding-agent/dist/modes/rpc/rpc-types.d.ts:145-158

#### 会话 JSONL 文件：usage 按消息落盘

- fact — JSONL 每条 `{"type":"message", ..., "message":{...}}` 持久化完整 AgentMessage，assistant 消息含 `"usage":{...}`（示例行可见）— 来源: pi-coding-agent/docs/session-format.md:207-210；接口定义 SessionMessageEntry 持 AgentMessage（session-manager.d.ts:23-26）
- fact — `CompactionEntry` 带 `tokensBefore` 与 `usage?`（生成 summary 的 LLM 调用用量）；`BranchSummaryEntry` 带 `usage?` — 源码: pi-coding-agent/dist/core/session-manager.d.ts:36-58
- fact — `ToolResultMessage.usage?`（"Usage from the final tool execution itself, if available. Not used for main LLM context accounting"）——工具自身嵌套 LLM 工作的用量也会进会话 — 源码: pi-agent-core/dist/types.d.ts:51-62
- fact — `SessionHeader` 仅 id/timestamp/cwd/parentSession，**无 usage 汇总字段**（汇总需遍历 entries 计算，即 getSessionStats 的做法）— 源码: pi-coding-agent/dist/core/session-manager.d.ts:5-12

#### workstation 现状（usage）

- fact — `src/agent/worker.js` 内存态 SDK 集成：`createAgentSession({...})`（worker.js:31、766），返回 `{ session: AgentSession, ... }`（sdk.d.ts:56-63）——`session.getSessionStats()`/`getContextUsage()` 在进程内直接可调，无需走 RPC
- fact — worker 已 `agentSession.subscribe((ev) => forwardEvent(sessionKey, ev))`（worker.js:803）：message_end 事件流已携带带 usage 的 assistant message 转发到主进程，但主进程/UI 目前未消费 usage/cost/token 字段（全 src 无 usage/cost 消费代码，grep 实证）
- fact — pi TUI 的 footer 是"消费方范本"：`FooterComponent` 自算 cumulative usage（遍历全部 session entries）并显示 token stats + context usage + git branch（footer.js:44-46、77-82、102-103）——workstation 若做 usage UI 可参照其计算口径

### git 分支

- fact — `findGitPaths(cwd)`：从 cwd 向上逐级找 `.git`，同时支持普通仓库（目录）与 worktree（`.git` 为 `gitdir:` 文件，解析 commondir），返回 `{repoDir, commonGitDir, headPath}` — 源码: pi-coding-agent/dist/core/footer-data-provider.js:9-46
- fact — 分支解析两条路：直接读 `.git/HEAD`（`ref: refs/heads/<name>` → 分支名，否则 `"detached"`）；HEAD 为 `.invalid` 时回退 `git --no-optional-locks symbolic-ref --quiet --short HEAD` — 源码: 同上:48-56、215-246
- fact — `FooterDataProvider.getGitBranch(): string | null`：null=不在仓库，`"detached"`=分离 HEAD；`onBranchChange(callback)` 订阅分支变化（HEAD/reftable watcher，500ms debounce，含 WSL/挂载盘轮询特判与 setCwd 重解析）— 源码: 同上:86-246；d.ts:35-36、40；WATCH_DEBOUNCE_MS=500 见:88
- fact — 消费方：TUI footer 显示分支（footer.js:102-103），interactive-mode 构造 provider 并订阅分支变化重渲染（interactive-mode.js:296、559）；`ReadonlyFooterDataProvider` 类型仅暴露 getGitBranch/getExtensionStatuses/getAvailableProviderCount/onBranchChange — 源码: footer-data-provider.d.ts:63
- fact — **pi 无 git 工具**：tools/ 目录只有 bash/edit/find/grep/ls/read/write（tool-definition 层无 git）；分支获取的唯一实现就是上述 footer provider — 源码: pi-coding-agent/dist/core/tools/（目录清单）
- fact — **会话文件不记录 git 分支**：SessionHeader/任何 entry 类型无 branch 字段（全 dist d.ts grep `gitBranch` 零命中）
- fact — workstation 现状：无实时分支读取。`projectService.js` 的 `branch` 是建项目时 git clone 用的元数据（`git clone --branch <branch>`，projectService.js:149-172、26、92）；src 其余 git 命中均为权限策略（git-force-push）/技能安装，与分支无关

### 上下文用量

- fact — `ContextUsage { tokens: number|null, contextWindow: number, percent: number|null }`（tokens null = 刚压缩后未知）— 源码: pi-coding-agent/dist/core/extensions/types.d.ts:193-199
- fact — 三处暴露：`AgentSession.getContextUsage()`（agent-session.d.ts:623）、extension `ctx.getContextUsage()`（extensions/types.d.ts:243-244；官方文档 extensions.md:1038-1047）、`SessionStats.contextUsage`（agent-session.d.ts:190，随 get_session_stats 返回）
- fact — 计算口径：优先用最近一条"压缩后"assistant usage 的 `calculateContextTokens(usage)`，之后新增消息用 `estimateTokens`（chars/4 启发式）估算；percent = tokens/contextWindow × 100；压缩后到下一次 assistant 响应前返回 `{tokens:null, percent:null}` — 源码: agent-session.js:2552-2584
- fact — 上下文相关**事件**：`compaction_start`/`compaction_end`（含 reason manual/threshold/overflow、aborted、errorMessage，agent-session.d.ts:53-55、65-71）；`CompactionEntry.tokensBefore` 记录压缩前的 token 数（session-manager.d.ts:36-47）；extension `ContextEvent`（`type:"context"`，每次 LLM 调用前触发）只含 messages，**不含** usage/上下文 token — 源码: extensions/types.d.ts:499-502
- fact — 压缩触发判定 `shouldCompact(contextTokens, contextWindow, settings)` 与 `DEFAULT_COMPACTION_SETTINGS` 均从包根导出 — 源码: pi-coding-agent/dist/core/compaction/compaction.d.ts:55-57

## 不确定 / 待验证

- `estimateTokens`（chars/4）与 provider 实际计费 token 数存在偏差（文档自述 conservative/overestimates，compaction.d.ts:59-62）；`getContextUsage()` 在长尾未响应消息场景下是估算值而非实测。
- 非 Anthropic provider 的 usage 字段来源与完整性未逐 provider 验证（如 llama.cpp 曾报零 usage，CHANGELOG.md:34 已修）；`reasoning`/`cacheWrite1h` 字段仅部分 provider 提供。
- `getUsageCostBreakdown` 未从包根导出——若需按模型成本分解，要么深路径导入（非 exports 白名单外路径，可能被 exports 限制拦截），要么基于 getEntries() 自己聚合；此项留给 tech-design 验证具体导入可行性。
- git watcher 的具体 reftable 实现细节（WSL 轮询分支逻辑）未逐行读全，但核心 getGitBranch/onBranchChange 语义已确认。

## 开放问题

（留给 /tech-design 决策，本笔记不下结论）

1. usage 数据获取方式：worker 内存态直接调 `session.getSessionStats()`（事件驱动/轮询），还是让主进程消费 message_end 事件里 assistant message 的 usage 增量累加？两者数据口径一致（都源于 JSONL entries），但事件路径延迟更低、stats 路径聚合成本 O(entries)。
2. cost 金额依赖模型价目表（model.cost），workstation 自定义/faux provider 模型的定价如何保证？`getContextUsage()` 需要 `session.model.contextWindow` 有效。
3. git 分支展示：复用 pi 的 `FooterDataProvider` 语义（读 .git/HEAD + watcher）自实现于 workstation 主进程侧，还是走 bash 工具/extension？pi 无现成可注入的 git 服务接口，需要自建。
4. 上下文用量 UI 的"压缩后 null"窗口期如何呈现（刚压缩后 tokens/percent 为 null）？
5. 会话切换/恢复（worker 的懒恢复/重建路径）后 SessionStats 的聚合口径是否需要与 UI 增量缓存对齐？

## 参考来源清单

| 来源 | 路径 | 用途 |
|---|---|---|
| pi-ai Usage 接口 | node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-ai/dist/types.d.ts:260-281、297 | token/cost 数据结构定义 |
| pi-ai 计费函数 | 同上 pi-ai/dist/models.js:371-390 | cost 计算（$金额、tier、1h cache 2x） |
| pi-ai Anthropic 客户端 | 同上 pi-ai/dist/api/anthropic-messages.js:386-394 | 原始 usage 抽取（input_tokens 等） |
| pi-agent-core AgentEvent | node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-agent-core/dist/types.d.ts:368-420、51-62 | 底层事件清单（无 usage 事件）；ToolResultMessage.usage |
| SessionStats/getSessionStats/getContextUsage | pi-coding-agent/dist/core/agent-session.d.ts:174-191、622-623；agent-session.js:2488-2542、2552-2584 | 核心查询接口与聚合口径 |
| usage-totals | pi-coding-agent/dist/core/usage-totals.js:1-41 | 累加/按模型成本分解（未导出） |
| cache-stats | pi-coding-agent/dist/core/cache-stats.d.ts:1-48 | cache miss 浪费分析（内部） |
| SessionEntry/JSONL | pi-coding-agent/dist/core/session-manager.d.ts:5-12、23-58 | 会话文件结构（usage 落盘、tokensBefore、无 git 字段） |
| 会话格式官方文档 | pi-coding-agent/docs/session-format.md:104-117、207-210 | JSONL 中 usage 字段的官方定义与示例 |
| RPC 接口 | pi-coding-agent/dist/modes/rpc/rpc-client.d.ts:161；rpc-mode.js:464-466；rpc-types.d.ts:94、145-158；docs/rpc.md:531-568 | get_session_stats 协议与响应语义 |
| ContextUsage/ContextEvent | pi-coding-agent/dist/core/extensions/types.d.ts:193-199、243-244、499-502；docs/extensions.md:1038-1047 | 上下文用量暴露面 |
| compaction token 工具 | pi-coding-agent/dist/core/compaction/compaction.d.ts:38-62；dist/index.d.ts:5 | estimateTokens/calculateContextTokens/getLastAssistantUsage（包根导出） |
| git 分支能力 | pi-coding-agent/dist/core/footer-data-provider.js:9-56、86-246；d.ts:35-36、40、63；modes/interactive/interactive-mode.js:296、559；modes/interactive/components/footer.js:44-46、77-82、102-103 | 唯一 git 分支实现（footer）与消费方 |
| workstation 现状 | workstation/src/agent/worker.js:31、766、803；src/services/projectService.js:149-172；src/services/policyRules.js:95-99 | 现有集成方式与缺失面 |
