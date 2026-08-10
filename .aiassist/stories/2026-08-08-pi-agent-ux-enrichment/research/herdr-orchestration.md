# Research: herdr — 功能与本地 agent 编排能力

> 调研日期：2026-08-09
> 主题：herdr（herdr.dev）的功能全景，以及它能否支撑"Pi agent 调度本地其他 AI agent"的场景
> 来源：primary sources（herdr.dev 官方文档、GitHub 仓库 herdrdev/herdr 源码与文档，本地 clone 于 /tmp/herdr-repo）

## 执行摘要

- **herdr 是一个面向 AI coding agent 的终端复用器/后台运行时（Rust 单二进制），本质是"agent 版 tmux"**：终端常驻在后台 server 里，合盖/断网/重启不丢会话；它不是任务队列或分布式调度框架。（来源：README.md；docs/concepts；Cargo.toml）
- **编排能力是一等公民且官方明示支持"一个 agent 调度其他 agent"**：CLI 与本地 socket API（换行分隔 JSON over Unix socket/Windows named pipe）提供 `workspace/tab/pane/agent` 全套原语，包括 `agent start`（在已有 shell pane 中启动指定 kind 的 agent）、`agent prompt --wait`、`agent wait --until blocked`、`agent read`；官方文档原话："A script can control them, or one agent can create work for other agents, inspect their state, and collect their results."（来源：docs/socket-api；docs/agent-automation；socket-api.mdx）
- **Pi 本身是 herdr 内置支持（kind=`pi`）的 21 种 agent 之一**，另有 claude、codex、gemini、cursor、opencode、grok 等；Aider 不在支持列表，只能作为普通进程跑在 pane 里（无生命周期状态识别）。（来源：cli-reference.mdx；src/detect/manifests/*.toml）
- **官方随发行版附带一份 agent skill 文件（skills/herdr/SKILL.md），专门教运行在 herdr pane 内的 agent 如何调度其他 agent**：包含 split pane → `agent start` → `agent prompt --wait` → `agent read` 的完整编排 playbook 与安全规则。这正好对应"Pi agent 作为调度者"的场景。（来源：skills/herdr/SKILL.md；docs/agent-skill）
- **任务隔离基于 git worktree（`herdr worktree create/open/remove`），无容器隔离**；并行就是多个 pane 中各跑一个 agent，状态（working/blocked/idle/done）逐 pane 检测并汇总到 tab/workspace。（来源：cli-reference.mdx worktree 段；docs/agents）
- **开源 Apache-2.0，GitHub 约 26.2k stars（API 核实），当前版本 v0.8.0**；安装为一行 curl 脚本或 brew/mise/Nix；稳定版支持 macOS/Linux，Windows 为 beta。（来源：GitHub API；README.md；docs/install；Cargo.toml）

## 详细发现

### herdr 是什么 / 定位

- 官方自述："the runtime your coding agents live on"——一个后台常驻 server，终端活在 server 内；合盖、断网、重启后 agent 继续工作、会话可恢复，可从任何终端或 SSH 重新 attach。（来源：README.md；https://herdr.dev/）
- 文档将其明确定位为 **mouse-first 的终端复用器（terminal multiplexer）**：可点击 pane、拖边框、右键菜单分屏；对 tmux/zellij 用户，prefix 为 `ctrl+b`，pane 持久化、detach/reattach 行为符合预期。（来源：https://herdr.dev/docs/）
- 技术形态：**单个 Rust 二进制，无 Electron**；Cargo 项目，仓库含 `src/`（api、detect、pane、pty、persist、remote、plugin 等模块）、`tests/`、`docs/`、`skills/`、`website/`。（来源：README.md；仓库目录结构；Cargo.toml `version = "0.8.0"`）
- 它**不包装、不替换各 agent CLI**，"只是拥有它们的终端"（owns their terminals）。（来源：README.md）

### 功能清单

1. **常驻后台 server 与会话持久化**：detach（`ctrl+b q`）/reattach（再运行 `herdr`）；重启恢复布局并恢复 agent 会话（native agent resume）；pane 历史回放；命名 session；实验性 live handoff。（来源：docs/session-state；persistence-remote.mdx）
2. **agent 状态可视化**：每个 pane 标记 working / blocked / idle / done / unknown；blocked 上卷到 tab 和 workspace，一眼找到卡在等待输入的 agent。（来源：README.md；docs/agents）
3. **agent 识别与生命周期检测**：内置 19+ 个 TOML 检测 manifest（`src/detect/manifests/`，如 `claude.toml`、`pi.toml`），基于前台进程 + 屏幕底部缓冲快照匹配；有完整 lifecycle hooks 的 agent（如经 `herdr integration install claude` 接入的 Claude Code）用 hook 上报；manifest 可从 herdr.dev 远程更新，本地 override 放 `~/.config/herdr/agent-detection/<agent>.toml`。（来源：docs/agents；src/detect/manifests/）
4. **CLI + socket API 双程序化接口**（详见下节）。
5. **通知**：`herdr notification show "build failed" --body "api workspace"`。（来源：docs/socket-api CLI 示例）
6. **git worktree 管理**：`herdr worktree list/create/open/remove`。worktree 是带 Git checkout 来源信息的普通 herdr workspace，`worktree create` 创建 git worktree checkout 并作为 workspace 打开、与父 repo workspace 分组；`worktree remove` 执行 `git worktree remove`（不删分支，脏 checkout 需 `--force`）。（来源：cli-reference.mdx 第 138–146 行）
7. **插件系统**：本地可执行插件（manifest actions + event hooks），`herdr plugin install/link`，未来有 marketplace（GitHub 发布）。（来源：docs/plugins；docs/marketplace；cli-reference.mdx）
8. **远程 attach**：`herdr --remote workbox` / `herdr --remote ssh://you@server:2222`——本地 herdr 作为瘦客户端经 SSH 连远端 herdr server 并流式回传 UI；远端主机支持 Linux/macOS（x86_64/aarch64），Windows 不能作远端主机。（来源：persistence-remote.mdx）
9. **配置与集成**：keybindings、主题、sidebar、scrollback 配置（`docs/configuration`）；`herdr integration install claude` 等直接集成。（来源：docs/agents；docs/integrations）

### 支持的 agent 与接入方式

**`agent start --kind` 支持的 21 种 kind**（cli-reference.mdx 第 308 行原文）：
`pi`, `claude`, `codex`, `gemini`, `cursor`, `devin`, `agy`, `cline`, `omp`, `mastracode`, `opencode`, `copilot`, `kimi`, `kiro`, `droid`, `amp`, `grok`, `hermes`, `kilo`, `qodercli`, `maki`。

**内置检测 manifest**（src/detect/manifests/，共 19 个 toml）：amp, antigravity, claude, cline, codex, cursor, devin, droid, gemini, github-copilot, grok, hermes, kilo, kimi, kiro, maki, opencode, pi, qodercli。文档另注明 Gemini CLI 与 Cline "已检测但测试不充分"。（来源：https://herdr.dev/docs/agents/）

**接入方式**：
- 自动检测：在 pane 里手动启动受支持的 agent CLI，herdr 自动识别并可用 pane ID 寻址；`herdr agent rename w1:p2 reviewer` 赋予稳定名字。（来源：docs/agent-automation）
- 程序化启动：`herdr agent start <name> --kind <kind> --pane <pane-id> -- <agent-args>`；要求目标 pane 是空闲 shell（shell 在前台、无前台命令/编辑器/agent）；启动后 herdr 检测到预期 agent 并就绪才返回（默认 30s 超时）。`--kind` 选 herdr 的规范可执行名，`--` 后参数原样透传给该 CLI。（来源：cli-reference.mdx；docs/agent-automation）
- 沙箱/VM 包装器：在包装命令上设 `HERDR_AGENT=<agent>` 告知 herdr 用哪个 manifest。（来源：docs/agents）
- 深度集成：`herdr integration install claude` 用 hook/plugin 上报取代纯屏幕检测。（来源：docs/agents）
- 新增全新 agent 种类需要 herdr 二进制更新（不能只靠加 manifest）。（来源：docs/agents）
- **Aider 不在支持列表**；未被识别的 CLI 仍可用 `herdr pane run w1:p3 "aider ..."` 当普通进程跑，但没有 working/blocked 生命周期识别，`agent wait` 不可用，只能用 `pane wait-output --regex` 这类文本匹配。（来源：kind 列表 + pane 原语文档，推断边界）

### 程序化调度能力（CLI / API / daemon / 配置）

**daemon**：herdr 本体即后台 server；运行 `herdr` 启动或 attach TUI；`ctrl+b q` detach 后 server 与 pane 进程继续运行。（来源：README.md）

**CLI**（全部控制命令返回 JSON，ID 从响应解析）：核心组包括 `workspace / tab / pane / agent / worktree / terminal / notification / integration / session / plugin / server / api`。（来源：skills/herdr/SKILL.md；cli-reference.mdx）

**Socket API**（来源：docs/socket-api；socket-api.mdx）：
- 协议：换行分隔 JSON，Unix domain socket（Windows 为 named pipe）；默认路径 `~/.config/herdr/herdr.sock`，命名 session 在 `sessions/<name>/` 下；解析顺序 `--session` > `HERDR_SOCKET_PATH` > `HERDR_SESSION` > 默认。
- 方法域（点记法）：server（`ping`, `server.stop`, `server.agent_manifests`…）、workspace（`workspace.create/list/focus/close`…）、tab、pane（`pane.split/send_text/send_keys/read/wait_for_output/close`…）、agent（`agent.list/get/read/prompt/wait/rename/focus/start`）、events（`events.subscribe/wait`）、layout（`layout.export/apply`）、integration/plugin。
- `agent.prompt` 支持可选 `wait` 对象，一次请求内"提交+等待"，避免两次调用的竞态；`agent.wait` 是 server 端事件驱动。
- 事件订阅：`events.subscribe` 带过滤器如 `{"type":"pane.agent_status_changed","pane_id":"w1:p1","agent_status":"blocked"}`；`session.snapshot` 给一次性全量快照，之后靠资源事件保持本地缓存。
- CLI 可 dump 协议 schema：`herdr api schema --json`。

**状态语义**（编排的关键原语，来源：docs/agents；SKILL.md）：
- `idle` = 可接受输入且 tab 已被看过；`done` = 后台完成但未被查看的 idle；`working`；`blocked` = herdr 识别到审批/提问/权限 UI（严格匹配，只认已知屏幕形状）；`unknown` = 存在但无法分类。
- `agent prompt --wait` 与 `agent wait` 默认等到 `idle/done/blocked` 之一；`--until` 可指定精确状态；无默认超时，可无限等待；prompt 发出后 5 秒内无生命周期变化返回 `agent_prompt_stalled`。
- 语义状态也可由集成方通过 `pane.report_agent` 上报（`--source custom:indexer --agent docs-bot --state working`），驱动 wait/通知/上卷。

**编排语义是"原语"而非"任务框架"**：没有内置任务队列、依赖图、重试策略或结果结构化收集；编排者需自己用 start/prompt/wait/read 组合出分工逻辑，结果靠 `agent read` 读终端文本（全屏 agent 大段输出可能读不全，官方建议是让对方把结果写成 Markdown 文件再读文件）。（来源：docs/agent-automation；SKILL.md 第 183–185 行）

**配置文件**：`~/.config/herdr/` 下的配置（keybindings/主题/sidebar/通知/scrollback/高级项，见 docs/configuration 与 config-reference.mdx）；worktree 默认目录由 `<worktrees.directory>` 配置决定。（来源：docs/configuration；cli-reference.mdx）

### 任务隔离与并行机制

- **隔离单位 = git worktree**：`herdr worktree create` 创建 checkout 并开成分组 workspace，适合给每个并行 agent 一个独立工作副本。无容器/沙箱隔离；agent 进程直接跑在本机。（来源：cli-reference.mdx worktree 段）
- **并行 = 多 pane 多 agent**：workspace（w1）> tab（w1:t1）> pane（w1:p1）三级拓扑；每个 pane 一个 PTY；可任意 split；ID 是不透明稳定句柄，pane 跨 workspace 移动会换 ID（需从 `.result.move_result.pane.pane_id` 重新读）。（来源：SKILL.md；docs/socket-api）
- **本地与远程**：本地多 agent 并行是核心场景；远程模式是"本地瘦客户端 + 远端 herdr server"，agent 跑在远端主机上，但控制面仍走同一 CLI/socket 语义（remote 段文档未显示有跨主机统一编排 API——跨机器编排需各自连各自的 server，不确定，见末节）。
- **协调规则**（SKILL.md 安全节）：后台操作用 `--no-focus`；用 `--current`/显式 pane ID/唯一 agent 名，不依赖 UI 焦点 pane；不关闭非自己创建的拓扑；不要 kill 主 server 进程；实验用命名 session 隔离。

### 安装、依赖、开源状态

- **安装**：`curl -fsSL https://herdr.dev/install.sh | sh`；或 `brew install herdr`、`mise use -g herdr`、Nix、GitHub Releases 手动下载；Windows beta 用 PowerShell 脚本。（来源：README.md；docs/install）
- **平台**：稳定版支持 Linux 和 macOS；Windows 原生构建为 preview beta；远程主机仅 Linux/macOS。（来源：install.mdx Requirements；persistence-remote.mdx）
- **依赖**：单一 Rust 二进制，构建用 `cargo build --release`（rust-toolchain.toml 固定工具链）；运行时依赖 git（worktree 功能）、OpenSSH（远程）。（来源：README.md；Cargo.toml；cli-reference.mdx plugin/worktree 段）
- **开源与许可**：Apache License 2.0（LICENSE 文件 + GitHub API `license.spdx_id = Apache-2.0`）。仓库 github.com/herdrdev/herdr，创建于 2026-03-27，调研当日 API 返回 26,190 stars / 1,851 forks，最近 push 为调研当日（活跃）。当前版本 v0.8.0（Cargo.toml；官网 changelog 0.5.12→0.8.0）。
- 官网首页称 "Backed by Y Combinator"、"363,843 installs"——此为官网自述营销信息，未独立核实。

### 对"Pi agent 调度本地 agent"场景的适配度（只列事实边界）

**直接对应的事实**：
1. Pi 是 herdr 一等支持的 kind（`agent start --kind pi`，且有 `src/detect/manifests/pi.toml` 检测 manifest，识别其 "Working..." 等工作状态）。（来源：cli-reference.mdx；pi.toml）
2. 官方明确设计了"agent 调度 agent"路径：SKILL.md 是给运行在 herdr pane 内的 agent 的指令文件，教它检查 `HERDR_ENV=1` 后用 `herdr` CLI 分屏、启动 helper agent（`agent start reviewer --kind codex --pane <id>`）、派活（`agent prompt ... --wait`）、等阻塞（`agent wait --until blocked`）、读结果（`agent read`）。把这份 skill 装进 Pi（Pi 支持 skill/自定义指令的话）即获得官方维护的编排 playbook。（来源：skills/herdr/SKILL.md；docs/agent-skill）
3. 被调度的 Claude Code / Codex / Gemini 等各自在独立 pane（可配独立 worktree）中跑，herdr 负责启动、状态判定、文本提交与读取；调度者（Pi）只面对 herdr CLI 这一个控制面。（来源：docs/agent-automation）
4. herdr 不要求编排者必须在 TUI 内：socket 在本地文件系统（`~/.config/herdr/herdr.sock`），CLI 是无交互 JSON 输出；理论上本机任何进程都能驱动。但官方 skill 明确规定：不在 herdr pane 内（`HERDR_ENV!=1`）时不应控制 focused session——这是给 agent 的行为约束，不是技术强制。（来源：SKILL.md 第 10–16 行；docs/socket-api）

**边界/缺口（事实，非结论）**：
- 无任务队列/依赖编排/重试/结构化结果收集：分工逻辑、结果汇总、失败处理全部要调度者自己实现；agent 间"通信"实质是终端文本注入与屏幕文本读取（或约定写文件）。（来源：docs/agent-automation 全文的原语定位）
- 结果读取有容量限制：全屏 agent 的输出可能超出 herdr 能回读的行数（`agent_not_idle` / alternate screen 行不进 scrollback），官方兜底是让 agent 把结果写成 Markdown 文件。（来源：docs/agent-automation；SKILL.md）
- `blocked` 检测只匹配已知审批/提问 UI 形状；新型 UI 会被标为 `idle` 直到 herdr 学会该屏幕形状（manifest 可远程更新/本地 override）。（来源：docs/agents）
- 每个 `agent start` 需要一个先存在的空闲 shell pane（先 split 再 start，`agent start` 自己不做拓扑）。（来源：cli-reference.mdx）
- Aider 等非支持列表的 CLI 没有生命周期状态，只能当普通进程 + 文本匹配等待。（来源：kind 列表）
- 隔离到 git worktree 为止：没有资源限额、文件系统/网络沙箱；并行 agent 共享本机环境。（来源：cli-reference.mdx；全仓库未见容器相关模块）
- 新增 agent 种类需要 herdr 发版（manifest 只能更新已有种类的检测规则）。（来源：docs/agents）

## 不确定 / 待验证

1. **跨机器统一编排**：remote 文档只描述了"本地瘦客户端 attach 远端 server"的 UI 流；未确认 socket API 是否能经 SSH 隧道直接驱动远端 server（技术上 ssh 转发可行，但官方文档未述）。不确定。
2. **官网自述数据**："Backed by Y Combinator"、安装数 363,843 为官网营销文案，未独立核实；stars 26.2k 已经 GitHub API 核实。
3. **Pi 装载 herdr skill 的具体机制**：SKILL.md 是通用 markdown 指令文件，官方安装方式是 `npx skills add herdrdev/herdr --skill herdr -g`；该安装器是否覆盖 Pi agent 的 skill 目录，未在调研中验证。
4. **并发上限/性能**：未找到官方关于单 server 可承载 pane/agent 数量的数据。
5. **herdr server 崩溃时的 agent 进程命运**：session-state 文档述及重启恢复，但 server 异常退出（非用户 stop）时 pane 内进程是否存活的细节未细读确认。

## 开放问题

1. Pi agent 作为调度者时，是跑在 herdr pane 内（`HERDR_ENV=1`，走官方 skill 路径），还是跑在 herdr 外直接驱动本地 socket？两条路径的权限/安全模型差异需要技术设计阶段裁定。
2. 调度者需要的"结构化结果回收"走哪条路：屏幕文本读取 vs 约定写文件 vs 自定义 `pane.report_agent` 语义状态上报？
3. 被调度 agent 的权限审批（blocked 状态）由谁响应：调度者自动应答（`agent send-keys`）还是上浮给人？
4. 是否需要 worktree 级隔离，还是同目录多 agent 即可——取决于并行任务是否写同一代码库。

## 参考来源清单

| 来源 | URL/路径 | 访问日期 | 用途 |
|---|---|---|---|
| herdr 官网首页 | https://herdr.dev/ | 2026-08-09 | 定位、功能、slogan、安装、营销数据 |
| 官方文档索引 | https://herdr.dev/docs/ | 2026-08-09 | 文档结构、multiplexer 定位 |
| Agents 文档 | https://herdr.dev/docs/agents/ | 2026-08-09 | 支持 agent 列表、检测机制、manifest、状态上卷 |
| Socket API 文档 | https://herdr.dev/docs/socket-api/ | 2026-08-09 | 协议、方法清单、事件订阅、CLI 示例 |
| Agent automation 文档 | https://herdr.dev/docs/agent-automation/ | 2026-08-09 | agent 编排 agent 的原语与 workflow 示例 |
| Agent skill 文档 | https://herdr.dev/docs/agent-skill/ | 2026-08-09 | skill 文件用途与安装 |
| GitHub 仓库 | https://github.com/herdrdev/herdr | 2026-08-09 | README、目录结构、许可 |
| GitHub API | https://api.github.com/repos/herdrdev/herdr | 2026-08-09 | stars/forks/license/创建时间核实 |
| 本地 clone：README.md | /tmp/herdr-repo/README.md | 2026-08-09 | 功能清单、安装、license |
| 本地 clone：skills/herdr/SKILL.md | /tmp/herdr-repo/skills/herdr/SKILL.md | 2026-08-09 | 官方编排 playbook、ID 体系、安全规则 |
| 本地 clone：cli-reference.mdx | /tmp/herdr-repo/docs/next/website/src/content/docs/cli-reference.mdx | 2026-08-09 | agent start 21 种 kind 列表、worktree 命令、CLI 语义 |
| 本地 clone：agents/socket-api/agent-automation mdx | /tmp/herdr-repo/docs/next/website/src/content/docs/*.mdx | 2026-08-09 | 文档原文核对 |
| 本地 clone：persistence-remote.mdx | /tmp/herdr-repo/docs/next/website/src/content/docs/persistence-remote.mdx | 2026-08-09 | 远程 attach、SSH、平台限制 |
| 本地 clone：install.mdx | /tmp/herdr-repo/docs/next/website/src/content/docs/install.mdx | 2026-08-09 | 安装方式与平台要求 |
| 本地 clone：检测 manifest | /tmp/herdr-repo/src/detect/manifests/（pi.toml, claude.toml 等 19 个） | 2026-08-09 | 内置 agent 检测规则实证 |
| 本地 clone：Cargo.toml | /tmp/herdr-repo/Cargo.toml | 2026-08-09 | 版本 v0.8.0、Rust 项目实证 |
| 本地 clone：src/ 目录 | /tmp/herdr-repo/src/（api/、detect/、pane/、pty/、remote/ 等） | 2026-08-09 | 架构模块实证 |
