# ADR-014: 内置 agent 运行时采用"SDK 独立子进程"形态（偏离官方进程内推荐，换取崩溃隔离）

- **状态**: 已接受
- **日期**: 2026-08-03
- **相关 story**: 2026-08-02-builtin-agent
- **相关 REQ**: 待结晶（2026-08-02-builtin-agent）

## 背景

内置对话 agent 的底层运行时已定用 PI（ADR-013）。PI 官方提供两种集成形态：

1. **进程内 SDK**（`createAgentSession()`）：官方对 Node.js/TypeScript 宿主的推荐——"如果你在写 Node.js 应用，考虑直接用 `AgentSession` 而不是 spawn 子进程"（rpc.md Note）；同进程类型安全、程序化注入 tools/凭证/ResourceLoader、直接访问 agent 状态。
2. **`--mode rpc` 子进程**：官方对"跨语言 / 要进程隔离 / 语言无关客户端"场景的方案；但**一个进程 = 一个活动会话**，多对话空间并发 = 每会话一个子进程。

平台是 Electron 桌面应用（主进程内嵌 server，ADR-006）。关键事实（research/pi-sdk-vs-rpc-mode.md）：

- SDK 形态 agent 与宿主**同进程同事件循环**，agent 致命错误（未捕获异常/OOM/native crash）= 宿主崩溃，零隔离；可 try/catch 的错误（LLM 失败/工具失败/超时）PI 已结构化处理，不构成崩溃源。
- 本 story 需求**多对话空间并发**（飞书单聊/群聊各一 session，wayfind 07）——SDK 一进程多 `AgentSession` 实例匹配；RPC 每空间一常驻子进程过重。

## 决策

**PI SDK 运行在平台新增的独立 agent 子进程**（`node` 子进程，stdio JSONL 自建 IPC + 心跳看门狗），而不是 Electron 主进程内：

1. **崩溃隔离**：agent 致命错误（OOM/native crash/uncaught exception）只杀 agent 子进程，看门狗检测 exit 后重启；桌面应用（用户正在编辑 flow/设置）不受影响。可 try/catch 的错误（LLM/工具/超时）仍在 agent 进程内结构化处理。
2. **多会话**：SDK 一进程多 `AgentSession` 实例，每对话空间一个；IPC 协议按 `sessionKey` 分路。
3. **看门狗自建**：PI 无看门狗/自动重启（官方明示恢复是集成方职责）；主进程 `agentService` 负责 spawn/心跳/exit 检测/重启，会话经 JSONL 恢复（`SessionManager.open`，只丢半条流式消息）。
4. **官方推荐偏离的接受**：进程内 SDK 的编程优势（类型安全、程序化注入 tools/凭证）在子进程形态下**保留**（SDK 不绑定宿主进程）；损失的是"与宿主直接共享状态"与官方背书。

## 后果

- 自建 IPC 协议（prompt/事件/confirm-request/心跳等消息类型）与看门狗——新增量，见 tech-design §接口契约。
- 打包（asar）下子进程入口 spawn 路径需 spike 验证；兜底解包 asar 或独立 node 入口。
- 与 RPC 形态相比：无现成 RpcClient 可用，协议自持；换取"一进程多会话"与工具注入能力（C2 工具面需要 import 命令模块，RPC 形态无法做到进程内 import）。
- 未来若需跨语言宿主，可迁 RPC（运行时同层，`AgentSessionRuntime` 共享，迁移成本低）。

## 替代方案

- **A. 进程内 SDK（官方推荐）**：实现最简、有官方背书；但 agent 致命错误 = Electron 应用整体崩溃（用户正在编辑的数据/UI 操作丢失 + agent 任务中断）。低概率 × 高影响，桌面场景不可接受。
- **B. `--mode rpc` 每空间一子进程**：官方隔离方案、协议现成；但多对话空间 = N 个常驻进程（个人桌面应用过重），且工具注入能力受限（工具只能经文件系统发现，C2 保险层无法落地）。
- **C. 不隔离（A + 全局 uncaughtException 兜底）**：Node 官方不推荐用于恢复（状态可能已损坏），且 OOM/native crash 捕获不了——不是安全恢复。

## 相关文件

- story: `.aiassist/stories/2026-08-02-builtin-agent/{prd,tech-design}.md`
- research: `.aiassist/stories/2026-08-02-builtin-agent/research/pi-sdk-vs-rpc-mode.md`
- 前序决策: ADR-013（内置 agent 用 PI，双运行时）
