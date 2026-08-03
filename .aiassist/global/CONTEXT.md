# 领域词汇表 — OPC Workstation

> 本文件由 `/domain-model` 维护。
> 所有 skill 在读写代码/文档时，优先使用本文件的术语。
> 新增术语需经 `/domain-model` 确认。

---

## 核心实体

| 术语 | 英文 | 定义 | 代码映射 | 别名（禁止使用） |
|------|------|------|----------|----------------|
| 项目 | Project | Workspace 下的一个工作目录，可以是本地目录或 Git 仓库 | `projects` 表 | workspace |
| 流程 | Flow | 由节点和连边组成的可执行图 | `flows` 表 | pipeline |
| 任务 | Task | 流程在项目中的运行定义 | `executions` 表 / schedules | job |
| 执行 | Execution | 流程的一次具体运行 | `executions` 表 | run |
| Skill | Skill | Claude Code 标准格式的可复用能力包（含 SKILL.md 的目录） | 技能库中的来源目录内子目录（磁盘，无 DB 表） | plugin |
| Schedule | Schedule | 按 cron 表达式自动触发流程的定义 | `schedules` 表 | cron job |
| 内容源 | Content Source | 可被 Flow 按 tag 筛选引用的信息来源，一级实体；类型：webpage / rss / x / wechat | `content_sources` 表 | 信息源、订阅源 |
| 通知 | Notification | 应用内系统事件记录（产物产出/执行失败/通道状态） | `notifications` 表 | 消息（易与 IM 消息混淆） |
| 通道绑定 | Channel Binding | 通道类型到 Flow/Project 的单一路由绑定；IM 消息经它决定 createTask 的归属 | `channel_bindings` 表 | — |
| 子流程 | Subflow | 被另一个 flow 通过 callFlow 节点同步调用的 flow；可独立被飞书/定时/手动触发 | `flows` 表（同一实体，多入口语义） | 子 flow |
| 调用节点 | callFlow Node | 在父 flow 中同步调用子 flow 的节点，显式映射入参/出参 | `nodes` 表中 `type="callFlow"` | — |
| 入口节点 | flowInput Node | 声明子流程被调用时期望的入参变量 | `nodes` 表中 `type="flowInput"` | — |
| 出口节点 | flowOutput Node | 声明子流程返回给出调用方的出参变量 | `nodes` 表中 `type="flowOutput"` | — |
| 变量赋值节点 | setVariables Node | 通用变量归一化节点：声明 outputVariables 并用 expressions 求值，用于多入口变量名对齐或常量注入 | `nodes` 表中 `type="setVariables"` | — |
| 发布物 | Release | 一次应用分发的版本发布（GitHub Release + tag，含 dmg/zip 资产），驱动检查更新与手动重装 | GitHub Release（无 DB 表） | 版本发布 |
| 嵌套执行 | Nested Execution | 子流程被调用时产生的 execution，通过 parentExecutionId/parentNodeId/depth 与父执行关联 | `executions` 表 | — |
| 对话空间 | Conversation Space | 对话的上下文容器，按入口与聊天维度隔离（飞书单聊 / 每个群聊 / UI 面板各一）；每空间一个独立 agent 会话，上下文互不串扰；spaceKey 形如 `feishu:<chatId>`、`ui:copilot` | `agent_sessions` 表 + PI session | 会话（易与通用会话混淆）、聊天 |

## 业务概念

| 术语 | 定义 | 相关实体 | 使用场景 |
|------|------|----------|----------|
| Workspace | 应用配置的根目录，包含多个项目 | Project | Settings |
| 技能库 | Skill Library：workstation 私有的集中式 skill 存放目录（settings 可配，默认 `~/.opc-workstation/skills`）；磁盘即真相，技能列表=实时扫描 | Skill | Settings / Skills 管理 |
| 来源目录 | Source Directory：技能库内一个 slug 目录，承载一次添加（git clone / local 拷贝）的内容；一个来源目录可含多个 skill（ADR-003 修订后 repo 一级实体的磁盘形态） | Skill | Skills 管理分组/级联删除 |
| Agent 类型声明 | agentTypes：项目声明使用的 AI agent key 数组（∈ Agent Registry），决定 skill 软链分发到哪些 agent 原生目录；空数组=暂不分发 | Project | 项目创建/编辑 |
| Agent Registry | 75 项 agent 目录约定表（name/displayName/skillsDir/globalSkillsDir 模板），来自 vercel-labs/skills 的 JSON 快照，跟随上游 | Skill | Agent 选择器 / 建链 |
| Skill Symlink | 项目各 agent 原生目录下指向技能库内 skill 目录的符号链接（Windows 用 junction） | Project, Skill | Project Detail 关联 skill |
| 收敛 | Convergence：使项目 agent 目录中的软链与"已关联集合 × 当前声明 agentTypes"一致的动作（新增补建、移除删链、重同步幂等重建） | Project, Skill | agentTypes 变更 / 重新同步 |
| 外部条目 | External Entry：项目 agent 目录中非 workstation 创建的 skill 条目（实体目录或外部软链）；如实显示+标注，不动实体，冲突跳过 | Project, Skill | 项目技能扫描视图 |
| 素材库 | 项目目录内约定的内容沉淀区：速存 markdown + 索引文件，供下游文章/视频 Flow 消费 | Project | 链接速存 / 收集管线 |
| 通道 | 连接外部 IM 的投递通道（第一实现：飞书长连接）；**收=消息进 agent 对话（agent 优先，2026-08-03 修订 REQ-CHANNEL-002）**，发=执行结果/回复送达 | 对话空间, Execution | 对话入口 / 结果送达 |
| 通道绑定 | Channel Binding | 通道类型到 Flow/Project 的单一路由绑定；**修订后（2026-08-03）：不再直接触发，成为 agent 下发任务的默认目标候选** | `channel_bindings` 表 | — |
| 用户绑定 | User Binding | settings 中登记的飞书 open_id，内置 agent 的唯一操作者（未绑定用户一切消息拒绝，含查询）；经"Settings 引导发消息"一次性绑定，可解绑 | settings 配置 | 单用户绑定、授权用户（易与通道绑定混淆） |
| 确认挂起 | Pending Confirmation | 高危操作被命令保险层拦截后进入挂起队列的状态；飞书卡片确认/拒绝回调驱动后续执行或中止（确认与执行解耦） | `agent_confirmations` 表 | 待确认 |
| 产物 | Flow 执行产出的文件（日报、速存 markdown 等）；主锚点是项目文件，执行记录登记其路径 | Execution | 产物登记 / 通知 / 飞书文档同步 |
| 触发来源 | 执行的启动方式：手动 / 调试 / schedule / 通道 / **对话**（agent 对话识别下发意图，2026-08-03 登记） | Execution | executions.trigger 字段 |
| Tag | 内容源的品类标签；Flow 按 tag 筛选引用内容源，不做逐一关联 | 内容源 | 定时日报的来源圈定 |

## 状态与生命周期

| 术语 | 定义 | 所属实体 | 状态转换 |
|------|------|----------|----------|
| running | 执行中 | Execution | running → success / error |
| success | 执行成功 | Execution | 终态 |
| error | 执行失败 | Execution | 终态 |
| enabled | Schedule 启用中 | Schedule | enabled ↔ disabled |
| pending | 确认挂起中（高危操作被拦截，等待卡片确认） | 确认挂起 | pending → approved / rejected |

## 命名约定

- 数据库表：小写复数，如 `projects`、`executions`
- 函数/方法：camelCase
- 文件：camelCase，服务文件以 `Service` 结尾
- CLI 命令：`opc-workstation <entity> <action>`，通过本地 HTTP API 调用服务；未运行应用时 CLI 可启动 headless server。扩展（2026-07-29 登记）：允许三级子命令表达实体下的子资源动作，如 `opc-workstation project skill link <id> <slug> <skillName>`（review S6）
- HTTP API：`/api/<entity>`，RESTful 资源风格，默认 JSON，错误返回标准 HTTP 状态码 + JSON 错误体

## 变更记录

- 2026-08-02：新增实体「发布物 Release」（2026-08-01-macos-distribution）

| 日期 | 变更 | 触发 story |
|------|------|------------|
| 2026-07-08 | 初始化词汇表 | bootstrap-workflow |
| 2026-07-08 | 更新 CLI 与 HTTP API 术语定义 | codex-harness-desktop attempt-2 tech-design |
| 2026-07-16 | 新增 skill-repo、skill symlink、dependency cascade、orphan skill 术语 | codex-harness-desktop /reflect |
| 2026-07-19 | 新增内容源、通知实体；素材库、通道、产物、触发来源、Tag 概念 | 2026-07-19-media-production-line |
| 2026-07-28 | 新增子流程、callFlow/flowInput/flowOutput/setVariables 节点、嵌套执行术语 | 2026-07-23-nested-flow /reflect |
| 2026-07-29 | Skill 代码映射改为磁盘（三表删除）；Skill Repository → 技能库/来源目录；Skill Symlink 定义更新（agent 原生目录→技能库）；删除 Dependency Cascade（ADR-011 废止）、Orphan Skill（三表删除后概念消失）；新增 agentTypes、Agent Registry、收敛、外部条目；CLI 三级子命令约定扩展 | 2026-07-29-multi-agent-skills tech-design |
| 2026-08-03 | 新增「对话空间」实体、「用户绑定」「确认挂起」概念；修订「通道」「通道绑定」定义（agent 优先，REQ-CHANNEL-002）；触发来源新增「对话」；状态新增 pending | 2026-08-02-builtin-agent domain-model |
