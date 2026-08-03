# Wayfind: builtin-agent

## Destination

决定平台**是否内置一个对话式 AI Agent**（候选底层：github.com/earendil-works/pi）；如果做，划清 MVP 范围（入口、能力边界、与现有架构的关系）。产出 `→ Story` 或 `→ ADR` 决议，不写产品代码。

## Notes

- 用户原始诉求（2026-08-02 访谈）："通过对话的方式，比如对接飞书，来下发任务，流式输出到飞书，可以了解项目的一些正在进行的任务"。CLI 已存在，是 agent 的天然调用入口。
- 形态偏好：UI 对话助手（copilot）。**张力**：诉求描述以飞书 IM 对话为主，形态选的是 UI 面板——入口优先级待 T-02 澄清。
- 平台现状（事实基础）：
  - 飞书通道已存在：长连接收发、IM 路由、通道绑定 → createTask、飞书文档同步（REQ-CHANNEL-001~005，ADR-007）；**settings 中已有飞书关联配置**（用户确认，2026-08-02），内置 agent 飞书入口复用现有通道配置与绑定语义。
  - Flow agent 节点已存在：Claude Agent SDK 做 provider（ADR-005，复用本机凭证）；agent 作为**编排资源**，不是常驻对话面。
  - CLI + 本地 HTTP API 共享服务层（ADR-001），无头 server 可独立启动。
  - 多 agent skill 分发（ADR-011）；单 server 运行时（ADR-006）；事件总线 + 通知（notificationService）。
- 当前有进行中 story `2026-08-01-macos-distribution`（QA 阶段），本探索与其无冲突。

## Decisions so far

<!-- index —— 每个已关闭的票一行：摘要 + 链接。不在此处重复票的细节，细节在票文件里。 -->

- [02 — 对话入口](tickets/02-conversation-entry.md) — 飞书 IM 与 UI copilot **两者都做**；飞书入口含流式输出 + 命令支持；横切 session 管理（2026-08-02）
- [04 — 飞书流式输出](tickets/04-streaming-to-feishu.md) — 可行；官方 CardKit 卡片流式更新（streaming_mode）是唯一可行路径，流式期间不限流；编辑单条（20 次上限）与发多条（5 QPS）皆不可行（2026-08-02）
- [01 — PI 工具箱](tickets/01-pi-toolbox-research.md) — PI 可承载对话式任务分发（SDK 进程内嵌入 + 流式事件 + MIT + 日更），但飞书接入非原生需自研；与 Claude Agent SDK 是**替代关系**，双运行时问题待 05 决策（2026-08-02）
- [05 — 架构关系](tickets/05-architecture-relationship.md) — 底层**用 PI**：新用户无本机 Claude Code 环境、用不了 Claude Agent SDK，PI 零依赖可随应用分发；flow agent 节点保持 SDK（双运行时）；执行层问题移交 03（2026-08-02）
- [06 — 授权边界](tickets/06-authorization.md) — 飞书单用户绑定（open_id）+ 高危操作卡片确认 + **CLI 即控制面**（写路径统一走 CLI，CLI 层为保险层可后续收紧；不给原始 FS/DB 工具）（2026-08-02）
- [03 — 能力划线](tickets/03-capability-scope.md) — 工具面 = **除 release 外全量 CLI 命令**；高危规则化（删除/配置变更/流程取消类卡片确认，下发与查询直跑）；MVP 不做 release 触发与 flow 图编辑（2026-08-02）
- [07 — session 管理](tickets/07-session-management.md) — 按对话空间分 session（飞书单聊/群聊/UI 各一）；SQLite 持久化 + 不超时 + 显式重置；对话过长滚动摘要压缩；上下文不流入执行（2026-08-02）
- [08 — 飞书命令](tickets/08-feishu-commands.md) — 双轨（斜杠命令确定性直通 + NL 走 agent）；命令集 = /status /list /reset /help（无 /run /cancel）；飞书指令菜单呈现（tech-design 验证，降级纯文本）（2026-08-02）

**决议去向（2026-08-02 完成评审，用户拍板）**：

| 决议 | 去向 |
|---|---|
| 内置对话 agent（做） | 拆 2 个 story：S1+S2 合并为 `2026-08-02-builtin-agent`（内核：PI 集成 + session + CLI 工具面 + 授权钩子；飞书入口：适配 + CardKit 流式 + 命令 + 单用户绑定）——2026-08-02 用户拍板合并：飞书入口即内核验证 seam，无需内核临时文本入口；S3 独立为 `2026-08-02-ui-copilot`（UI 面板）。均已创建 |
| "内置 agent 采用 PI，与 SDK 双运行时" | → ADR: 013（已写） |

## Not yet specified

- PI 的**具体集成形态**（进程内 SDK `createAgentSession()` vs `--mode rpc` 子进程）——05 已定用 PI，形态细节留待 story 的 tech-design。
- UI copilot 面板的**具体形态**（位置、交互、能否编辑 flow 图形）。
- **成本/限额**（LLM 调用费用、飞书消息频率限制对体验的约束）。
- 与 flow 内 agent 节点的**深层整合**（对话是否可调用 flow 作为工具）。

## Out of scope

- 任何产品代码或原型（wayfind 只做决策，不实现）。
- 平台之外的通用 agent 产品（本探索只关心平台内置面）。
- 飞书之外的通道接入（多通道扩展是后续 story 的事，T-02 只定入口优先级）。
- **flow 内 agent 节点运行时策略**（用户方向 2026-08-02：settings 新增配置**扫描本机已装 agent**，无则回退用 PI agent 运行；05 揭示 SDK 对新用户有门槛）。独立于本探索，另开 story。

Status: completed（2026-08-02，前沿为空，决议去向已记录）
