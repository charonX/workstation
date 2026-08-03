# Research: PI 两种集成形态——进程内 SDK（createAgentSession）vs `--mode rpc` 子进程（JSONL over stdio）

> 调研日期：2026-08-03
> 主题：为"Electron 桌面应用主进程集成"提供事实依据——生命周期、隔离性、稳定性、流式事件、多会话管理、持久化的差异
> 来源：primary sources（GitHub 源码 `earendil-works/pi` main 分支、官方文档 pi.dev/docs、npm registry `@earendil-works/pi-coding-agent@0.83.0`）
> 版本基线：pi-coding-agent 0.83.0（engines: node >=22.19.0），源码 main 分支 2026-08-03 快照

## 执行摘要

1. **两种形态共享同一套 agent 运行时，差异只在"进程边界"**：`--mode rpc` 是 `pi` CLI 以 `--mode rpc` 启动的**一个长驻子进程**，内部跑 `runRpcMode(runtime)`——与进程内 SDK 调用 `createAgentSessionRuntime()` 用的是同一层 `AgentSessionRuntime`（官方原文："This is the same layer used by the built-in interactive, print, and RPC modes"）。协议为 stdin/stdout 严格 JSONL（LF 唯一分隔符），请求-响应按可选 `id` 关联，事件全部流式打到 stdout。[packages/coding-agent/docs/rpc.md](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/rpc.md)、[packages/coding-agent/docs/sdk.md](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md)
2. **关键差异 1——进程模型/崩溃面**：SDK 形态 agent 跑在宿主 Node.js 进程的**同一事件循环**（agent 循环无 worker thread，`worker_threads` 仅用于 image-resize 工具），宿主崩溃=agent 崩溃、agent 致命错误=宿主崩溃，**零隔离**；RPC 形态是独立 OS 进程，崩溃面在进程边界切断，客户端通过 `exit`/`error` 事件检测并自行重启（pi 不提供看门狗/自动重启）。[rpc-client.ts 源码](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/modes/rpc/rpc-client.ts)、[npm 0.83.0 tarball 内 dist 扫描 worker_threads 仅 image-resize]
3. **关键差异 2——多会话并发模型**：SDK 可在一个进程内创建**多个 `AgentSession` 实例**（每会话独立订阅、独立 JSONL 文件），共享一个事件循环与 ModelRuntime；RPC **一个进程 = 一个活动会话**（`new_session`/`switch_session`/`fork`/`clone` 都是"替换当前会话"并重新绑定订阅），多对话空间并发需要**每会话一个子进程**。[src/modes/rpc/rpc-mode.ts](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/modes/rpc/rpc-mode.ts)（`session = runtimeHost.session` 单例 + `rebindSession()`）
4. **关键差异 3——重启恢复**：两种形态共用同一持久化层——append-only JSONL 会话树（默认 `~/.pi/agent/sessions/--<cwd>--/`，每条消息在 `message_end` 时**同步 append**，流式增量不落盘）。崩溃/杀进程只丢"流式中的半条消息"，已完成消息全部可恢复：SDK 用 `SessionManager.open(path)`/`continueRecent(cwd)` 重建；RPC 子进程用 `--session <path>`/`--continue` 重启后从 JSONL 树重建上下文，客户端可用 `get_entries(since=最后见过的 entryId)` 做跨重启游标续传（官方明示 entry id 是 durable cursor）。[src/core/session-manager.ts](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/session-manager.ts)、[packages/coding-agent/docs/rpc.md](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/rpc.md)（get_entries 一节）
5. **官方推荐**：Node.js/TypeScript 宿主**优先 SDK**（同进程、类型安全、直接访问 agent 状态）；RPC 是给"其他语言 / 要进程隔离 / 语言无关客户端"的场景——即官方文档把 RPC 的进程隔离性列为**明确卖点**。两者都要求 Node >=22.19.0。[rpc.md 开头 Note](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/rpc.md)、[sdk.md "RPC Mode Alternative"](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md)

## 详细发现

### 1. `--mode rpc` 子进程模式的确切语义

**启动与进程模型**
- 唯一 npm bin 是 `pi` → `dist/cli.js`；`rpc-entry.ts`（`process.title = "pi-rpc"`）是独立入口，最终也是 `main(["--mode", "rpc", ...])`。[package.json bin](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/package.json)、[src/rpc-entry.ts](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/rpc-entry.ts)
- 官方 TypeScript 客户端 `RpcClient.start()` 的 spawn 方式：`spawn("node", [cliPath, "--mode", "rpc", "--provider", ...], { cwd, env, stdio: ["pipe","pipe","pipe"] })`——即**普通子进程 + 三条管道**，stdin/stdout 为协议通道，stderr 收集调试信息。[src/modes/rpc/rpc-client.ts](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/modes/rpc/rpc-client.ts)
- `runRpcMode(runtimeHost): Promise<never>`——"Keep process alive forever"，进程不主动退出。[src/modes/rpc/rpc-mode.ts 末尾](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/modes/rpc/rpc-mode.ts)
- **stdout 接管**：`takeOverStdout()` 把一切 `process.stdout.write`（如扩展里 console.log）重定向到 stderr，保证 stdout 只有协议 JSONL；`writeRawStdoutChunk` 等待写回调、遇 `ENOBUFS/EAGAIN` 以 10ms 间隔重试——**客户端不读 stdout 时 agent 会被反压暂停**（rpc-mode 还额外 `session.agent.subscribe` 等待 `waitForRawStdoutBackpressure()`）。[src/core/output-guard.ts](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/output-guard.ts)、[rpc-mode.ts rebindSession](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/modes/rpc/rpc-mode.ts)

**协议（JSONL over stdio）**
- 严格 JSONL：LF（`\n`）唯一记录分隔符，客户端可容忍 `\r\n`；**官方警告 Node `readline` 不合规**（它会把 JSON 字符串内合法的 U+2028/U+2029 当行分隔）。[rpc.md Framing 一节](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/rpc.md)
- 指令 = 一行 JSON 命令对象（`type` + 可选 `id`），响应 = `{"type":"response","command":...,"success":true|false,"data"|"error"}`，响应带请求的 `id`；事件 = 无 `id` 的 `AgentSessionEvent` 流（唯一例外：`bash_execution_update` 带其 `bash` 命令的 id）。[rpc.md Protocol Overview](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/rpc.md)
- 全部命令（rpc-types 联合类型枚举）：`prompt`、`steer`、`follow_up`、`abort`、`new_session`、`get_state`、`get_messages`、`set_model`、`cycle_model`、`get_available_models`、`set_thinking_level`、`cycle_thinking_level`、`get_available_thinking_levels`、`set_steering_mode`、`set_follow_up_mode`、`compact`、`set_auto_compaction`、`set_auto_retry`、`abort_retry`、`bash`、`abort_bash`、`get_session_stats`、`export_html`、`switch_session`、`fork`、`clone`、`get_fork_messages`、`get_entries`、`get_tree`、`get_last_assistant_text`、`set_session_name`、`get_commands`。[npm 0.83.0 dist/modes/rpc/rpc-types.d.ts](https://www.npmjs.com/package/@earendil-works/pi-coding-agent)（本地解包 grep `type: "..."`）
- 创建会话/发 prompt：`{"type":"prompt","message":"..."}` 的响应在 **preflight 通过即返回**（accepted/queued），**不代表跑完**；`success:true` 后的一切失败走事件流，不会再有第二个 response。[rpc.md prompt 一节](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/rpc.md)、[rpc-mode.ts handleCommand prompt 分支](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/modes/rpc/rpc-mode.ts)
- 流式事件：`message_update`（`assistantMessageEvent` 内 `text_delta`/`thinking_delta`/`toolcall_delta` 等 12 种增量）、`tool_execution_start/update/end`（update 带**累积** partialResult，非增量）、`turn_start/end`、`message_start/end`、`agent_start/end/settled`、`queue_update`、`compaction_start/end`、`auto_retry_start/end`、`extension_error` 等；结束判定用 `agent_settled`（官方客户端 `waitForIdle()` 就是等它）。[rpc.md Events 一节](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/rpc.md)、[rpc-client.ts waitForIdle](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/modes/rpc/rpc-client.ts)
- 扩展 UI 子协议：`ctx.ui.select/confirm/input/editor` 发 `extension_ui_request`（带 id），阻塞等客户端回 `extension_ui_response`；`notify/setStatus/setWidget/setTitle/set_editor_text` fire-and-forget；TUI 专属方法（`custom()`、主题、`getEditorText()`）降级/返回空。[rpc.md Extension UI Protocol](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/rpc.md)、[rpc-mode.ts createExtensionUIContext](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/modes/rpc/rpc-mode.ts)

**退出/崩溃检测与恢复**
- 服务端退出路径：① stdin EOF（客户端关闭管道）→ `shutdown()` → `runtimeHost.dispose()` → `process.exit(0)`；② SIGTERM → exit 143、SIGHUP（非 Windows）→ exit 129，两者先 `killTrackedDetachedChildren()` 杀掉跟踪的 detached 子进程（bash 工具起的进程树）；③ 扩展 `shutdownHandler`（如内置 `/exit` 类扩展命令）→ 置 `shutdownRequested`，在 `agent_settled` 或每个命令处理后检查并退出；④ 未捕获异常/崩溃 → 进程直接死。[rpc-mode.ts shutdown/registerSignalHandlers/onInputEnd](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/modes/rpc/rpc-mode.ts)、[src/utils/shell.ts](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/utils/shell.ts)
- **协议内没有 shutdown 命令**（命令联合类型里无 `shutdown`/`exit`）——客户端要优雅停止只能关 stdin 或杀进程。[rpc-types.d.ts 命令枚举](https://www.npmjs.com/package/@earendil-works/pi-coding-agent)
- 客户端检测：官方 `RpcClient` 监听 `childProcess.once("exit"/"error")` → 构造 `Agent process exited (code=... signal=...)` 错误 → **reject 所有 pending 请求**；此后 `send()` 直接抛错；`stop()` 先 SIGTERM、1 秒未退再 SIGKILL。**没有自动重启、没有看门狗**——恢复是集成方的职责。[rpc-client.ts start/stop/rejectPendingRequests](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/modes/rpc/rpc-client.ts)
- 恢复手段：重启进程时用 `--session <path>`（打开指定文件）或 `--continue`（最近会话），会话上下文从 JSONL 重建；客户端侧 `get_entries(since)` 用 entry id 做 durable cursor 补拉错过的条目（`since` 无效则 `success:false`）。[rpc.md get_entries](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/rpc.md)、[main.ts createSessionManager](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/main.ts)
- RPC 启动参数与普通模式共用会话解析：默认 `SessionManager.create(cwd)`（新会话）；`--no-session` → in-memory；`--continue`/`--session`/`--resume`/`--fork`/`--session-id` 均可用；`--session-dir <path>` 与 env `PI_CODING_AGENT_SESSION_DIR` 自定义目录；`--name` 启动时设会话名；`@file` 参数不支持、管道 stdin 内容不读（stdin 是协议）。[rpc.md Starting RPC Mode](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/rpc.md)、[main.ts](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/main.ts)（`appMode !== "rpc"` 才读 stdin、RPC 拒绝 fileArgs）、[src/config.ts](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/config.ts)

### 2. 进程内 SDK 模式

- **生命周期**：`createAgentSession()` 返回 `AgentSession`（单会话）；`AgentSessionRuntime`（`createAgentSessionRuntime()`）负责会话**替换**（`newSession/switchSession/fork/clone/importFromJsonl`）并重建 cwd-bound 运行时状态；`session.dispose()` 中止 retry/compaction/branch-summary/bash/agent 并清空监听器。[sdk.md](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md)、[src/core/agent-session.ts dispose](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/agent-session.ts)
- **事件订阅**：`session.subscribe(listener)` 返回 unsubscribe；监听器是**同进程同步回调**（内部 `_handleAgentEvent` → `_emit`）；订阅绑定在具体 `AgentSession` 实例上，会话被替换后必须重新订阅（官方示例：先 `unsubscribe()` 再对 `runtime.session` 重新 `subscribe`）。[sdk.md AgentSessionRuntime 一节](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md)、[agent-session.ts subscribe](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/agent-session.ts)
- **宿主事件循环**：agent 循环（pi-agent-core）与宿主**同进程、同事件循环**；agent 无 worker thread（0.83.0 tarball 内 `worker_threads` 仅出现在 image-resize 工具）。LLM 调用是 async HTTP（undici），bash 工具是 OS 子进程，其余工具是 fs 操作——意味着：① 宿主主进程的同步阻塞（Electron 主进程重同步任务）会**直接拖慢 agent**；② agent 没有独立的 CPU 时间片/崩溃域。
- **崩溃/卡死连带**：致命错误（未捕获异常、OOM、native crash）在 SDK 形态**就是宿主进程的崩溃**——没有进程边界，无法用"重启子进程"恢复；宿主只能靠自己的错误边界兜底。这是与 RPC 形态最本质的稳定性差异。
- **流式与队列语义与 RPC 相同**（同一 `AgentSession.prompt()`）：流式中 prompt 必须给 `streamingBehavior: "steer" | "followUp"` 否则 throw；`prompt()` 的 Promise 在**整个被接受的 run 跑完（含 retries）**后才 resolve；preflight 结果经 `preflightResult` 回调。[sdk.md Prompting and Message Queueing](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md)、[agent-session.ts prompt](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/agent-session.ts)
- **可注入性**：SDK 可直接传 `customTools`、`ResourceLoader`（扩展/skills/prompt/AGENTS.md/systemPromptOverride）、`SettingsManager`（含 inMemory）、`ModelRuntime`（含 `InMemoryCredentialStore`、自定义 authPath/modelsPath）——这些在 RPC 形态只能靠文件系统发现，是 SDK 的独有能力。[sdk.md Options Reference](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md)

### 3. 多会话并发支持差异

- **SDK**：一个进程可持有**多个 `AgentSession` 实例**（每会话一个订阅、一个会话文件），共享事件循环/ModelRuntime/SettingsManager；会话间并发是**协作式**的（同一事件循环，无并行执行，但 async I/O 期间可交错）。官方没有"会话池/并发上限"概念，多会话就是多次 `createAgentSession()`/`createAgentSessionRuntime()`。
- **RPC**：`runRpcMode` 内部 `session = runtimeHost.session`——**单活动会话**；`new_session`/`switch_session`/`fork`/`clone` 都通过 `runtimeHost` **替换**活动会话并 `rebindSession()`（重绑扩展 + 重订阅事件，旧订阅先 unsubscribe）。多对话空间同时活跃 = **每会话一个 `pi --mode rpc` 进程**（每进程一个 JSONL 文件），`RpcClient` 一个实例对应一个子进程。这是两种形态在"多会话并发"上的结构性差异。[rpc-mode.ts](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/modes/rpc/rpc-mode.ts)（`runtimeHost.setRebindSession`/`rebindSession`/`new_session`/`switch_session` 分支）、[rpc-client.ts](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/modes/rpc/rpc-client.ts)（每实例 spawn 一个进程）

### 4. 官方文档的推荐场景与 caveats

- **推荐**（sdk.md "RPC Mode Alternative" 原文）：
  - SDK 优先：同一 Node.js 进程、要类型安全、要直接访问 agent 状态、要程序化定制 tools/extensions；
  - RPC 优先：**跨语言集成、要进程隔离、语言无关客户端**。
  - rpc.md 开头还有一句针对 Node/TS 用户的 Note：**"如果你在写 Node.js 应用，考虑直接用 `AgentSession` 而不是 spawn 子进程"**。[sdk.md](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md)、[rpc.md](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/rpc.md)
- **caveats（文档已明示的坑）**：
  1. 流式中 prompt 不带 `streamingBehavior` → SDK throw / RPC 返回 error（`"steer"` 在当前 assistant turn 的 tool calls 之后投递，`"followUp"` 等 agent 停再投递）。[sdk.md](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md)、[rpc.md](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/rpc.md)
  2. 订阅绑定具体 `AgentSession`，会话替换后需重新订阅；用扩展时还要对新 session 重新 `bindExtensions()`。[sdk.md AgentSessionRuntime](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md)
  3. `prompt()` 的 resolve 时机是"整个 run 含 retries 完成"，不是"被接受"；流式期间的失败走事件流而不是第二个 response。[sdk.md](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md)、[rpc.md prompt 一节](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/rpc.md)
  4. RPC 的扩展 UI 降级（dialog 子协议 + fire-and-forget；`custom()`/主题/编辑器访问等方法不可用），扩展作者需用 `ctx.mode === "rpc"` 分支。[rpc.md Extension UI Protocol](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/rpc.md)
  5. JSONL 帧协议不能用 Node `readline`（U+2028/U+2029）。[rpc.md Framing](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/rpc.md)
  6. 官方客户端 `send()` 每请求 30s 超时、`waitForIdle()` 60s 超时——长任务的"完成判定"需按 `agent_settled` 事件自己做。[rpc-client.ts](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/modes/rpc/rpc-client.ts)
  7. RPC 反压：客户端不消费 stdout → agent 暂停（等 drain）。[output-guard.ts](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/output-guard.ts)

### 5. 两种模式下的持久化关系

- **同一持久化层，与形态无关**：`SessionManager` 把会话存成 **append-only JSONL 树**（entry 带 `id/parentId`，版本 v3），默认位置 `~/.pi/agent/sessions/--<cwd>--/<timestamp>_<sessionId>.jsonl`（cwd 编码进目录名）；可 `--session-dir`/`PI_CODING_AGENT_SESSION_DIR` 自定义；`--no-session`/`SessionManager.inMemory()` 不落盘。[session-format.md](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/session-format.md)、[src/core/session-manager.ts](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/session-manager.ts)、[src/config.ts](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/config.ts)
- **写入时机**：每条 user/assistant/toolResult 消息在 `message_end` 事件时 `appendMessage()` **同步 append**（`appendFileSync`）；文件在第一条 assistant 消息时创建；**流式增量（text_delta）不落盘**。因此崩溃/杀进程只丢"尚未 message_end 的半条消息"。[agent-session.ts `_handleAgentEvent`](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/agent-session.ts)（"Session persistence is handled internally (saves messages on message_end)"）、[session-manager.ts `_persist`](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/session-manager.ts)
- **重启后重建**：加载 JSONL → 自动迁移版本 → `buildSessionContext()` 从树还原 LLM 消息（含 compaction summary/branch summary 折叠、model/thinking 状态从 `model_change`/`thinking_level_change`/assistant 消息恢复）。[session-manager.ts `_setSessionFile`/`buildSessionContext`](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/session-manager.ts)
- **SDK 恢复**：`SessionManager.open(path)`（指定文件）、`continueRecent(cwd)`（最近）、`create(cwd)`（新会话）、`list/listAll`（枚举，按 modified 排序）。[sdk.md Session Management](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md)
- **RPC 恢复**：进程重启时 `--session <path>` 或 `--continue` 打开同一文件；或运行中 `switch_session` 命令换文件。会话 id 稳定（header 内 uuidv7），客户端可用 `get_entries(since)` 续传。[rpc.md](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/rpc.md)、[main.ts](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/main.ts)
- **注意**：会话文件写是**进程内同步**的，多个进程同时写同一 JSONL 文件没有并发保护（多 RPC 进程应各用各的会话文件；pi 会话文件默认按 cwd 目录分组、文件名含唯一 sessionId）。

### 6. 结论性事实清单（进程/资源模型差异，不决策）

| 维度 | 进程内 SDK（createAgentSession） | `--mode rpc` 子进程 |
|---|---|---|
| 进程 | 宿主 Node.js 进程内，无额外进程 | 独立 OS 子进程（`node dist/cli.js --mode rpc`），stdio pipe x3 |
| 事件循环 | 与宿主共享同一事件循环 | 独立事件循环；反压时等待 stdout drain |
| 崩溃隔离 | 无——agent 致命错误 = 宿主崩溃 | 有——崩溃限于子进程；客户端检测 exit/error 后重启 |
| 通信 | 进程内函数调用 + 同步回调 | stdin/stdout 严格 JSONL（LF），`id` 关联请求-响应 |
| 流式事件 | `session.subscribe` 同进程同步回调 | stdout JSON 行事件流（同一 AgentSessionEvent 集合） |
| 多会话并发 | 一进程多 `AgentSession` 实例（协作式共享事件循环） | 一进程一活动会话；并发 = 每会话一进程 |
| 会话替换 | `AgentSessionRuntime.newSession/switchSession/fork/clone` + 重订阅 | `new_session`/`switch_session`/`fork`/`clone` 命令 + 服务端 `rebindSession()` |
| 持久化 | 同一 SessionManager JSONL 树；message_end 同步 append；流式增量不落盘 | 相同；重启用 `--session`/`--continue` 恢复，`get_entries(since)` 续传 |
| 崩溃恢复 | 无内置——宿主自担；可用 SessionManager.open 恢复 | 无内置看门狗——客户端自担重启；恢复语义同上 |
| 优雅停止 | `session.dispose()`（宿主进程内） | stdin EOF（exit 0）/ SIGTERM（143）/ SIGHUP（129），先杀 tracked 子进程 |
| 依赖环境 | 需要宿主运行时为 Node >=22.19（Electron 内置 Node 需满足，或经 RPC 用系统 Node） | 子进程用外部 Node >=22.19，与 Electron 内置 Node 解耦 |
| 官方推荐 | 同进程 Node/TS 应用、类型安全、直接状态访问、程序化定制 | 跨语言、进程隔离、语言无关客户端 |
| 能力差异 | 可直接注入 tools/ResourceLoader/SettingsManager/凭证存储（含 inMemory） | 扩展/tools 只能走文件系统发现；扩展 UI 降级 |

## 不确定 / 待验证

- 本文基于源码与文档静态分析，未实测"RPC 子进程在 Electron 打包环境（asar/asarUnpack、fuses）下的 spawn 路径"——`cliPath` 定位 `dist/cli.js` 在打包后的具体行为需集成验证。
- 0.83.0 的 `legacy-node20` dist-tag 与 engines 抬升（>=22.19）之间的兼容边界未逐一核对；Electron 内置 Node 版本与 `>=22.19` 的满足度需按目标 Electron 版本查证。
- 多 RPC 进程并发写同一会话文件未做实证（正常用法是每进程一文件，无并发保护是源码事实）。
- 未验证 pi.dev 官网页面与 GitHub docs 的同步滞后（本文以 GitHub docs 为准，pi.dev `/docs/latest/sdk`、`/docs/latest/rpc` 内容与之一致）。

## 开放问题（留给 /tech-design 决策，本调研不决策）

- Electron 主进程崩溃 = 应用崩溃的约束下，SDK 形态的"零隔离"与 RPC 形态的"每会话一进程"如何取舍（进程数 vs 崩溃面）。
- 多对话空间并发若走 RPC：进程生命周期管理（常驻池、空闲回收）、`--session` 定位与 `get_entries(since)` 续传协议是否由平台侧统一封装。
- 若走 SDK：宿主侧对 agent 循环的看门狗/超时（`waitForIdle`、`agent_settled`）与恢复（SessionManager.open）策略。
- 会话文件目录策略：默认 `~/.pi/agent/sessions/--<cwd>--/` vs 平台自定义 `--session-dir`/`PI_CODING_AGENT_SESSION_DIR`。

## 参考来源清单

| 来源 | URL/路径 | 访问日期 | 用途 |
|---|---|---|---|
| RPC 模式文档（源码 docs） | https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/rpc.md | 2026-08-03 | 协议/命令/事件/启动/错误处理 |
| SDK 文档（源码 docs） | https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md | 2026-08-03 | SDK 生命周期/订阅/队列/会话管理/推荐场景 |
| rpc-mode.ts（源码） | https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/modes/rpc/rpc-mode.ts | 2026-08-03 | 单会话模型、rebind、退出路径、信号处理 |
| rpc-client.ts（源码） | https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/modes/rpc/rpc-client.ts | 2026-08-03 | spawn/退出检测/超时/无自动重启 |
| session-manager.ts（源码） | https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/session-manager.ts | 2026-08-03 | JSONL 树、同步 append、open/continueRecent/迁移 |
| agent-session.ts（源码） | https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/agent-session.ts | 2026-08-03 | subscribe/dispose/prompt 语义/message_end 持久化 |
| main.ts（源码） | https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/main.ts | 2026-08-03 | RPC 会话解析（--session/--continue/--no-session 等） |
| output-guard.ts / shell.ts（源码） | https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/output-guard.ts 、 https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/utils/shell.ts | 2026-08-03 | stdout 接管/反压、detached 子进程跟踪 |
| session-format.md / sessions.md（源码 docs） | https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/session-format.md 、 .../docs/sessions.md | 2026-08-03 | 文件位置/版本迁移/会话命令 |
| rpc-entry.ts / config.ts（源码） | https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/rpc-entry.ts 、 .../src/config.ts | 2026-08-03 | pi-rpc 入口、PI_CODING_AGENT_SESSION_DIR |
| npm registry（0.83.0 tarball，本地解包） | https://registry.npmjs.org/@earendil-works/pi-coding-agent | 2026-08-03 | rpc-types 命令枚举、worker_threads 仅 image-resize、bash executor |
| 官方文档站 SDK/RPC 页 | https://pi.dev/docs/latest/sdk 、 https://pi.dev/docs/latest/rpc | 2026-08-03 | 与 GitHub docs 交叉确认（内容一致） |
