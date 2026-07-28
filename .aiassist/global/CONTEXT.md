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
| Skill | Skill | Claude Code 标准格式的可复用能力包 | `skills` 表 | plugin |
| Schedule | Schedule | 按 cron 表达式自动触发流程的定义 | `schedules` 表 | cron job |
| 内容源 | Content Source | 可被 Flow 按 tag 筛选引用的信息来源，一级实体；类型：webpage / rss / x / wechat | `content_sources` 表 | 信息源、订阅源 |
| 通知 | Notification | 应用内系统事件记录（产物产出/执行失败/通道状态） | `notifications` 表 | 消息（易与 IM 消息混淆） |
| 通道绑定 | Channel Binding | 通道类型到 Flow/Project 的单一路由绑定；IM 消息经它决定 createTask 的归属 | `channel_bindings` 表 | — |
| 子流程 | Subflow | 被另一个 flow 通过 callFlow 节点同步调用的 flow；可独立被飞书/定时/手动触发 | `flows` 表（同一实体，多入口语义） | 子 flow |
| 调用节点 | callFlow Node | 在父 flow 中同步调用子 flow 的节点，显式映射入参/出参 | `nodes` 表中 `type="callFlow"` | — |
| 入口节点 | flowInput Node | 声明子流程被调用时期望的入参变量 | `nodes` 表中 `type="flowInput"` | — |
| 出口节点 | flowOutput Node | 声明子流程返回给出调用方的出参变量 | `nodes` 表中 `type="flowOutput"` | — |
| 变量赋值节点 | setVariables Node | 通用变量归一化节点：声明 outputVariables 并用 expressions 求值，用于多入口变量名对齐或常量注入 | `nodes` 表中 `type="setVariables"` | — |
| 嵌套执行 | Nested Execution | 子流程被调用时产生的 execution，通过 parentExecutionId/parentNodeId/depth 与父执行关联 | `executions` 表 | — |

## 业务概念

| 术语 | 定义 | 相关实体 | 使用场景 |
|------|------|----------|----------|
| Workspace | 应用配置的根目录，包含多个项目 | Project | Settings |
| Skill Repository | 集中式 skill 仓库，一个 repo 可包含多个 skill | Skill | Settings / Skills 管理 |
| Skill Symlink | 项目目录下指向 skill 安装目录的符号链接 | Project, Skill | Project Detail 关联 skill |
| Dependency Cascade | 关联 skill 时自动级联关联其 `dependencies` 声明的 skill | Skill | Project-skill 关联 |
| Orphan Skill | repo 模型迁移后 `repoId` 为 NULL 的遗留 skill 记录 | Skill | 数据清理 |
| 素材库 | 项目目录内约定的内容沉淀区：速存 markdown + 索引文件，供下游文章/视频 Flow 消费 | Project | 链接速存 / 收集管线 |
| 通道 | 连接外部 IM 的触发与投递通道（第一实现：飞书长连接）；收=消息触发 Flow，发=执行结果送达 | Flow, Execution | 外部触发 / 日报送达 |
| 产物 | Flow 执行产出的文件（日报、速存 markdown 等）；主锚点是项目文件，执行记录登记其路径 | Execution | 产物登记 / 通知 / 飞书文档同步 |
| 触发来源 | 执行的启动方式：手动 / 调试 / schedule / 通道 | Execution | executions.trigger 字段 |
| Tag | 内容源的品类标签；Flow 按 tag 筛选引用内容源，不做逐一关联 | 内容源 | 定时日报的来源圈定 |

## 状态与生命周期

| 术语 | 定义 | 所属实体 | 状态转换 |
|------|------|----------|----------|
| running | 执行中 | Execution | running → success / error |
| success | 执行成功 | Execution | 终态 |
| error | 执行失败 | Execution | 终态 |
| enabled | Schedule 启用中 | Schedule | enabled ↔ disabled |

## 命名约定

- 数据库表：小写复数，如 `projects`、`executions`
- 函数/方法：camelCase
- 文件：camelCase，服务文件以 `Service` 结尾
- CLI 命令：`opc-workstation <entity> <action>`，通过本地 HTTP API 调用服务；未运行应用时 CLI 可启动 headless server
- HTTP API：`/api/<entity>`，RESTful 资源风格，默认 JSON，错误返回标准 HTTP 状态码 + JSON 错误体

## 变更记录

| 日期 | 变更 | 触发 story |
|------|------|------------|
| 2026-07-08 | 初始化词汇表 | bootstrap-workflow |
| 2026-07-08 | 更新 CLI 与 HTTP API 术语定义 | codex-harness-desktop attempt-2 tech-design |
| 2026-07-16 | 新增 skill-repo、skill symlink、dependency cascade、orphan skill 术语 | codex-harness-desktop /reflect |
| 2026-07-19 | 新增内容源、通知实体；素材库、通道、产物、触发来源、Tag 概念 | 2026-07-19-media-production-line |
| 2026-07-28 | 新增子流程、callFlow/flowInput/flowOutput/setVariables 节点、嵌套执行术语 | 2026-07-23-nested-flow /reflect |
