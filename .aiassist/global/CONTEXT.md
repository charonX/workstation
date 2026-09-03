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
| 对话空间 | Conversation Space | 对话的上下文容器，**空间 = 会话**（2026-08-06 ADR-016 修订）：每条 chat 一个独立空间，上下文互不串扰；spaceKey 语法 `feishu:<chatId>`（世代制沿用）、`ui:copilot:<sessionId>`、`ui:project:<projectId>:<sessionId>` | `agent_sessions` 表 + PI session | 聊天（"会话"在 UI 语境 = 对话空间本身，是规范说法；禁止用它指代 execution 等其他概念） |
| 飞书归档条目 | Feishu Archive Entry | 飞书空间 /reset 后保留的历史会话行（ADR-037，2026-08-19）：spaceKey `feishu:<chatId>:gen<N>`，title/sessionRef/lastActiveAt/createdAt 冻结原值，只读可回看；写端点 403 E-SESSION-READONLY；displayName 为空时逆解析活跃键查 agent_space_meta fallback | 对话空间 | 会话列表「飞书」分组历史回看 |
| 会话轨迹 | Trajectory | 伴随 Agent 会话生成的全量执行账本（含 TTFT/decode 细粒度耗时、Token 用量、工具入参及出参、大载荷截断标记等），以 append-only 侧车文件落盘，可独立回看与时间线过滤（ADR-038） | `*.traj.jsonl` 侧车文件 + `GET /api/agent/sessions/:spaceKey/trajectory` | 轨迹账本、执行日志 |
| 侧车文件 | Sidecar File | 伴随主会话存在、记录全量高频/大载荷遥测与工具调用的 append-only 本地 JSONL 文件（`ui_project_<pid>_<sid>.traj.jsonl`），实现历史投影与轨迹账本物理隔离 | `src/agent/trajectoryRecorder.js` | 轨迹文件、侧车 |
| 浏览器面板 | Browser Panel | 会话区右侧可收起的内嵌浏览器视图（WebContentsView 主进程托管）：同一浏览器实例承载人的交互浏览与 agent 的浏览器工具面；**可见性解耦**——收起 ≠ 关闭，实例生命周期独立于面板可见性（agent 工具照常可用） | browserViewManager（main）+ BrowserPanel（renderer）+ `/api/browser/*` | 预览面板（裸词，2026-09-02 起归「文件预览面板」全名使用）、webview（实现选型词，禁用于领域语言） |
| 文件预览面板 | File Preview Panel | 会话区右侧可收起的项目内文件**只读**预览视图（React 渲染层，非 WebContentsView——协议白名单不推翻）：Markdown 渲染/源码切换（复用聊天 MarkdownRenderer 管线）、代码高亮、图片直渲；与浏览器面板共享右侧面板容器心智，但内容通道独立（主进程受控读取）；文件外部变更自动刷新（主进程监听） | `src/renderer/components/preview/FilePreviewPanel.jsx` + `filePreviewStore.js` + `format.js` + `/api/agent/files/*` | 预览面板（裸词禁用，与浏览器面板消歧）、文件预览器 |
| 文件树 | File Tree | 会话区左侧可收起边栏：绑定当前会话项目空间的解析根，懒加载目录树，噪音目录默认隐藏，支持全部展开/收起；点击文件 → 文件预览面板打开；非项目空间无解析根 → 不显示入口 | `src/renderer/components/preview/FileTree.jsx` + `fileTreeStore.js` | 资源管理器、文件浏览器 |
| 服务凭据 | Service Credentials | 外部服务（如 RSSHub）访问配置的持久化实体：存储服务 Base URL 与加密 AccessKey，支持受控测试连接与只读脱敏读取 | settings.json 的 credentials 字典 + `src/services/credentialsService.js` | 凭据管理、三方服务配置 |

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
| 默认权限层 | MCP 权限的用户级默认值（pattern=server:tool glob → allow/ask/deny），存 workstation DB `mcp_permission_defaults`，在「MCP」页编辑；运行时合并进部署 JSON（`*` 首位 + last-match-wins），新会话生效 | MCP Server | 权限配置 / MCP 页 |
| 项目权限覆盖 | 项目对默认权限层/出厂策略的字段级覆盖（ADR-022），在项目详情「权限配置」页签编辑，命中即高亮「项目已改」；语义 = 覆盖默认层，项目文件仍是最高层 | Project, MCP Server | 项目权限配置页签 |
| 通道绑定 | Channel Binding | 通道类型到 Flow/Project 的单一路由绑定；**修订后（2026-08-03）：不再直接触发，成为 agent 下发任务的默认目标候选** | `channel_bindings` 表 | — |
| 用户绑定 | User Binding | settings 中登记的飞书 open_id，内置 agent 的唯一操作者（未绑定用户一切消息拒绝，含查询）；经"Settings 引导发消息"一次性绑定，可解绑 | settings 配置 | 单用户绑定、授权用户（易与通道绑定混淆） |
| 确认挂起 | Pending Confirmation | 高危操作被命令保险层拦截后进入挂起队列的状态；飞书卡片确认/拒绝回调驱动后续执行或中止（确认与执行解耦） | `agent_confirmations` 表 | 待确认 |
| 产物 | Flow 执行产出的文件（日报、速存 markdown 等）；主锚点是项目文件，执行记录登记其路径 | Execution | 产物登记 / 通知 / 飞书文档同步 |
| 触发来源 | 执行的启动方式：手动 / 调试 / schedule / 通道 / **对话**（agent 对话识别下发意图，2026-08-03 登记） | Execution | executions.trigger 字段 |
| Tag | 内容源的品类标签；Flow 按 tag 筛选引用内容源，不做逐一关联 | 内容源 | 定时日报的来源圈定 |
| 会话区 | 应用默认落地区（ADR-018）：纯会话左导（新对话/通用/项目/飞书分组）+ 对话窗；经 ⚙ 进管理区 | 对话空间 | 会话中心 / 助手页 |
| 管理区 | 旧应用壳原样保留区（ADR-018）：仪表盘/工作区/流程/执行/内容源/技能/通知/设置，顶部「← 返回对话」 | — | 会话区 ⚙ 进入 |
| 通用空间 | 不属任何项目的对话空间分组（`ui:copilot:<sid>`）；工具面 = CLI-only | 对话空间 | 会话区通用分组 |
| 项目空间 | 归属某项目的对话空间（`ui:project:<pid>:<sid>`）；工具面 = CLI + 项目 skills + 项目目录 FS/脚本（权限策略管控） | 对话空间, Project | 会话区项目分组、行内＋新建 |
| 孤儿会话 | 项目已删除但保留可回看的项目空间会话；禁止发送新消息 | 对话空间 | 会话列表划线呈现 |
| 内联确认卡 | 对话窗内渲染的高危确认交互（确认/拒绝/稍后处理），复用确认挂起队列与既有确认回调端点 | 确认挂起 | UI 空间高危操作 |
| 授权桥 | gotgenes 权限评估 `ask` → 确认挂起队列的接缝（ADR-017）：一套队列、按空间前缀分流渲染（UI 内联确认卡 / 飞书卡片）；**唯一执行者**=worker 侧（permission 行主进程不 execute），**单一评估**=同一命令不二次 ask（2026-08-07 BUG-001/002 修订） | 确认挂起 | 权限层（FS/脚本高危） |
| 卡片定型 | 飞书 CardKit 流式卡片在流式结束/错误/任务终态时的收口动作：`PATCH /cardkit/v1/cards/:id/settings` 关 `streaming_mode` + `summary` 换正文摘要——不做则会话列表永远卡初始 summary（如「[生成中...]」）直到 10 分钟窗口自动关闭（BUG-004/005） | 通道 | 回复卡片 / 任务卡片 |
| 工具折叠块 | Tool Call Block：对话流内工具调用的折叠呈现（默认收起：工具名+输入摘要；展开：输入/输出/耗时；错误默认展开标红）；由 `tool_execution_start/end/error` 事件实时驱动，**仅实时呈现不落历史**（B8 / REQ-AGENT-052/054） | 对话空间 | 富呈现（2026-08-08-pi-agent-ux-enrichment） |
| 历史投影 | History Projection：把 PI JSONL 投影为历史消息列表的规则——**历史 = 对话文本**（只投影 user/assistant 且剔除空文本行），工具产物（toolResult/thinking 载体）不落历史（BUG-009 收紧；REQ-AGENT-054） | 对话空间 | 历史会话重开 |
| 权限模式 | Permission Mode：会话级权限档位——**strict**（全确认，含配置 allow 的）/ **standard**（按项目权限配置执行，现状）/ **auto**（standard 基础上配置 ask 的由模型判断）；运行时档位不改持久配置；全局 lastMode 记录上次选择（首次 auto） | 对话空间 | 模式切换（2026-08-11-pi-agent-modes，ADR-023） |
| auto-judge link | 权限模式 auto 档的模型判断链节（authorizerChain）：审 ask → allow/deny/defer；**deny-first**（只 deny 明确危险，external_directory/path 的 allow 被 envelope 系统级降级 defer）；判断不了 defer 弹卡；连续 deny 熔断降级 standard | 对话空间, 确认挂起 | auto 模式（ADR-023） |
| 默认模型 | 标记为默认的模型配置：新会话初始模型、auto 判断锚点（decide 不随会话漂移）、会话配置被删时的回落对象 | 模型配置 | 新会话 / auto 判断 / 删除兜底 |
| 动态模型列表 | 配置模型时从供应商 API 拉取的可用模型清单——全协议族化（REQ-104/ADR-027：端点/鉴权按协议族派生，能力标志供应商直存或 pi-ai 目录补全）；拉取失败/无 baseUrl 回退内置目录，不阻塞保存 | 模型配置 | Settings 模型选择 |
| 会话级切换 | 当前会话切换模型配置的行为：对话历史保留、仅影响后续消息（与 Settings 级修改触发重建会话区分） | 模型配置, 对话空间 | 工具栏模型选择器 |
| 视觉模型 | 支持 image input 的模型（kimi-k2.5 及以上）；纯文本模型（deepseek 全系）附加图片被阻止并提示——不静默忽略 | 模型配置 | 图片附件能力判定 |
| 协议族 | API family | provider 的 API 协议形态（pi-ai 目录 `model.api` 字段）：openai-completions/openai-responses、anthropic-messages、mistral-conversations、google-generative-ai、bedrock/vertex 等——决定探针端点与鉴权头（ADR-027） | 模型配置 | test-connection / 动态模型拉取 |
| 供应商探针 | providerProbe | 对供应商发最小校验/列表请求的统一派生函数（`{url, headers} \| null`）：test-connection 与动态模型拉取同一派生源；baseUrl 缺失 → null → E-TEST-UNSUPPORTED/目录兜底，不阻塞保存 | 模型配置, 协议族 | Settings 添加表单 |
| 附件 | 随消息注入上下文的文件（v1：图片——jpeg/png/gif/webp/bmp/heic/heif，SVG 拒收；PDF 本期放弃留后续）：内容进会话历史（pi-ai 原生序列化）、重放可见；经文件选择器添加即显式授权（项目外不弹确认、无特殊标记）；非视觉模型阻止附加（附加时判定 + 发送时复核）；每消息 ≤10 个 | 对话空间 | 图片注入（**≠ 产物**：执行产出物，两者不同） |
| 权限裁决器 | PermissionAdjudicator：管理高危操作挂起确认单生命周期、超时流转、决议状态下发的领域服务；唯一执行者（approve 产生 allow 决策，零主进程 execute）与单一评估安全不变量的物理承载 | 确认挂起, 对话空间 | 权限拦截 / 确认执行管道 |
| Fail-Closed 安全降级 | 权限策略评估遇到未知工具面、损坏配置或降级运行时的安全底线——默认一律判定为 ask 挂起人工确认，杜绝零确认绕过 | 权限模式, 确认挂起 | 策略评估 / 异常兜底 |
| 飞书归档条目 | Feishu Archive Entry | 飞书空间 /reset 后保留的历史会话行（ADR-037，2026-08-19）：spaceKey `feishu:<chatId>:gen<N>`，title/sessionRef/lastActiveAt/createdAt 冻结原值，只读可回看；写端点 403 E-SESSION-READONLY；displayName 为空时逆解析活跃键查 agent_space_meta fallback | 对话空间 | 会话列表「飞书」分组历史回看 |
| 活跃行 | Active Row | spaceKey 无 `:gen<N>` 后缀的当前会话行：飞书空间 = 唯一可写可交互行；/reset 时被改名为归档键并插入新活跃行（title/provider/model=NULL 回落默认） | 对话空间 | reset 归档事务 / 写面守护 |
| 世代编号 | Generation Number | 飞书空间 JSONL 文件的世代序数 N（`feishu_<chatId>.<N+1>.jsonl` / 归档键 `:gen<N>`）：归档时从旧 sessionRef 解析并 +1 延续，防碰撞；空世代不归档但换代照常递增 | 对话空间 | 归档键命名 / 孤儿世代文件判定 |
| 空世代 | Empty Generation | 活跃行消息投影为空的世代（JSONL 空文件或无有效 user/assistant 消息）：/reset 不产生归档行，原地换代——「没聊过的会话不留历史」 | 对话空间 | reset 分支语义 |
| 回合边界 | Turn Boundary | 轨迹记录中标识对话轮次起点的分隔行（`type="turn_boundary"`）；在前端账本中呈现为可交互折叠手风琴条（Turn Rule），支持多回合收起与展开 | 会话轨迹 | 轨迹账本渲染与回合手风琴 |
| 时间线总览 | Timeline Overview | 轨迹视图顶部的时钟与耗时投影图表，按比例呈现 Assistant 思考/生成、工具调用与空闲区间；支持智能长空闲折叠（Gap Compression）、滚轮缩放与选区拖拽联动 | 会话轨迹 | 轨迹总览与选区过滤 |
| 人机共驾 | Shared Control | 人与 agent 共享同一浏览器面板实例的控制规则：**不加锁、人操作永远优先**（用户点击即时生效），agent 每次操作前重读页面快照自行适应；面板提供「agent 控制中」指示与一键「停止控制」（断控制不关页面，此后**任何** browser 工具——含读取类——返回 E-BROWSER-DENIED）；**解除**：用户在地址栏/面板 chrome 发起一次导航（渲染进程 IPC，source=user）即解除，页内链接点击导航（will-navigate 路径）不解除 | 浏览器面板 | 浏览器面板共驾（2026-08-24-embedded-browser；2026-08-30 review 修订） |
| 读取类动作 | Read-class Action | 浏览器工具面中无写入语义的动作：navigate/read/scroll/screenshot/auth-check，riskLevel=query，自由执行 | 浏览器面板 | 浏览器工具风险分级 |
| 提交类动作 | Submit-class Action | 浏览器工具面中具有写入/不可逆语义的动作：click/type，规划为 riskLevel=confirm 经确认挂起队列批准；**2026-08-26 裁决：随范围收敛移出本期 story**（预览/读取先行），定义保留供后续 story 使用 | 浏览器面板, 确认挂起 | 浏览器工具风险分级（2026-08-24-embedded-browser，后续 story） |
| 协议白名单 | URL Scheme Allowlist | 浏览器面板地址栏与 agent 工具 url 参数共用的输入规则：仅允许 http/https，localhost/127.0.0.1 缺省补 http、其余补 https；白名单外（file/javascript 等）拒绝导航 | 浏览器面板 | 地址栏验证 / 工具参数验证 |
| 统一身份池 | Unified Identity Pool | `persist:browser` 分区持久化的目标站点登录态（Cookie/Session）：既供内置面板渲染，也经受控导出接口（`GET /api/browser/cookies`；Host=127.0.0.1/localhost 校验 + 跨源封锁 + 无 ACAO）供本地采集引擎与后台 Agent 复用 | 浏览器面板 | 登录态桥接 / Cookie 导出（ADR-039 决策 7/10） |
| 人机协同登录引导 | Human-in-the-Loop Auth | agent 经 `browser auth-check` 探测目标站点登录态，缺失时导航登录页并展开面板，由用户在面板内手动扫码/登录，后续请求与采集任务无缝接续 | 浏览器面板 | 登录引导流程 D（ADR-039 决策 8） |
| 本地采集引擎 | Local Collection Engine | workstation 内直连目标站点 API 做数据采集的服务（B站/X/微博等）；经统一身份池的 Cookie 受控导出接口复用登录态，自身不持有凭据 | 浏览器面板 | 采集场景的登录态消费方 |
| 解析根 | Preview Root | 文件预览与聊天图片解析共用的根目录真源：当前会话项目空间 → 项目 ID → registry 解析的项目工作目录；相对路径按它解析、绝对路径必须落在它之内（realpath 双检）；非项目空间（通用/飞书/孤儿）无解析根 | 对话空间, Project | 文件预览 / Markdown 图片解析（REQ-AGENT-051 起在用，2026-09-02 补登记） |
| 噪音目录 | Noise Directories | 文件树默认隐藏的硬编码目录清单（`.git`/`node_modules`/`dist` 等）；第一版不解析 .gitignore | 文件树 | 文件树过滤 |
| 机器级 Server 注册表 | Machine-level Server Registry | 跨会话与跨进程服务发现通道：固定锚定在机器级路径（`~/.opc-workstation/server.json`，与会话/项目配置目录解耦），桌面主 App 固定以 `owner="app"` 注册，供外部 CLI / Agent 无缝发现运行中的主服务；测试环境通过 `OPC_SERVER_REGISTRY_FILE` 环境变量覆盖提供隔离 | `src/serverRegistry.js` + `src/cli/server.js` | 外部 CLI 与桌面 App 服务发现（ADR-040，REQ-BROWSER-007） |
| 社交路由自动映射 | Social Route Mapping | 工作台内容源根据社交账号标识（如 X 用户名、B站 UID）自动生成对应 RSSHub 标准路由路径与鉴权标志的转换机制 | 内容源 | 社交动态接入 |

## 「agent」一词三义（2026-08-08 归位，B11）

> 同一词「agent」在代码与文档中承载三个互不重叠的义项；阅读/写作时必须消歧（D4 访谈裁决）。

| 义项 | 英文 | 定义 | 代码映射 | 使用场景 |
|------|------|------|----------|----------|
| PI 对话 agent | PI conversational agent | **交互会话**形态的 agent：有会话生命周期、有看门狗心跳、经权限层，服务对话空间（飞书/UI 通用/UI 项目）；「内置 agent」默认指它 | `src/agent/worker.js`（PI 运行时子进程）、`src/services/agentService.js`（看门狗/水合） | 对话空间 / 会话区 |
| flow 的 agent 节点 | Flow agent node | flow 图中的**一次性执行**节点：经 Claude Agent SDK 执行，无会话、无看门狗、bypassPermissions；与本 story 权限/生命周期议题零交叠（D3） | `src/flowEngine/claudeAgentAdapter.js` | flow 执行（provider=anthropic） |
| Agent Registry 外部 agent CLI | External agent CLI | Agent Registry 目录约定表（75 项，vercel-labs/skills 快照）中的**外部 agent**：skill 安装兼容层（软链分发目标），非运行时 agent | Agent Registry（`agentTypes` / 建链 / 收敛） | 项目创建/编辑、技能分发 |

## 会话生命周期术语（2026-08-08 归位，B11 + review-tech 警告5 扩围）

| 术语 | 英文 | 定义 | 关联实体 | 上下文 |
|------|------|------|----------|--------|
| 淘汰 | Eviction | 会话按三触发（idle TTL 1h / LRU 上限 50 / 同组单活冷却）被 dispose 出内存；JSONL 保留、可透明恢复；流式中/队列中豁免（进行中的回复不掐断） | 对话空间 | 会话生命周期（REQ-AGENT-035~037） |
| 懒恢复 | Lazy Restore | 被淘汰或未水合的历史会话下次交互时，主进程重发 session-config → worker `SessionManager.open` 从 JSONL 透明恢复续聊（复用 REQ-AGENT-005 标准 3 链路，零新造）；用户无重建感知 | 对话空间 | 会话生命周期 |
| 水合窗口 | Hydration Window | 启动/崩溃重启只水合 JSONL mtime ≤ TTL(1h) 窗口的行（对齐 REQ-AGENT-005「各活跃空间」原意）；历史行不水合、按懒恢复兜底；消除全行水合击穿内存上界 | 对话空间 | 重启恢复（REQ-AGENT-038） |
| 同组单活 | Single-Hot per Group | 同组（`ui:project:<pid>` 项目组 / `ui:copilot:*` 通用组，2026-08-08 人裁决同一规则）任一活动（session-config/prompt 到达）即冷却组内其他热会话（流式中延迟到流结束）；组内热会话恒 ≤1；跨组不互汰 | 对话空间 | 会话生命周期（REQ-AGENT-037） |
| session-evicted | session-evicted | worker → 主进程的 IPC 通知（淘汰已发生）：主进程丢 `sessions` 句柄、store 行保留、keySecrets 保留（懒恢复重注入需要）；重复通知幂等 | 对话空间 | IPC（worker → 主进程） |
| evicted | evicted | prompt 竞态兜底错误码：tombstoned key（本运行刚被淘汰）的 prompt 到达 → worker 回 `session-error {code:"evicted"}`，主进程重发 config + 重投该 prompt 恰一次；非 tombstone 未知 key 回 E-AGENT-NO-SESSION 不复活 | 对话空间 | 竞态兜底（接口 3） |

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

- 2026-08-16：新增实体「插件 Extension」「MCP Server」；新增概念「默认权限层」「项目权限覆盖」（2026-08-12-pi-mcp-plugin /reflect，ADR-024/025）
- 2026-08-12：新增「权限模式」「auto-judge link」（2026-08-11-pi-agent-modes /reflect，ADR-023）
- 2026-08-10：新增「工具折叠块」「历史投影」（2026-08-08-pi-agent-ux-enrichment /reflect）
- 2026-08-08：新增「agent 一词三义」归位 + 会话生命周期术语（淘汰/懒恢复/水合窗口/同组单活/session-evicted/evicted）（2026-08-07-pi-agent-consolidation）
- 2026-08-02：新增实体「发布物 Release」（2026-08-01-macos-distribution）

| 日期 | 变更 | 触发 story |
|------|------|------------|
| 2026-09-03 | 新增实体「服务凭据」；新增概念「社交路由自动映射」 | 2026-08-26-rsshub-integration /reflect |
| 2026-09-03 | 新增概念「机器级 Server 注册表」（ADR-040，REQ-BROWSER-007 服务发现通道） | 2026-08-24-embedded-browser /reflect |
| 2026-09-02 | 新增实体「文件预览面板」「文件树」；新增概念「解析根」（REQ-AGENT-051 补登记）「噪音目录」；「预览面板」裸词双向禁用（浏览器面板禁用别名修订注释） | 2026-08-31-file-preview /domain-model |
| 2026-08-30 | 「人机共驾」修订（断控制后任何 browser 工具 DENIED；解除仅限地址栏/chrome 手势 IPC 导航，页内点击不解除）；「读取类动作」枚举补 auth-check；新增「统一身份池」「人机协同登录引导」「本地采集引擎」 | 2026-08-24-embedded-browser review 修订 |
| 2026-08-25 | 新增实体「浏览器面板」（可见性解耦）；新增概念「人机共驾」「读取类/提交类动作」「协议白名单」 | 2026-08-24-embedded-browser /domain-model |
| 2026-08-22 | 新增「飞书归档条目」「活跃行」「世代编号」「空世代」术语（ADR-037 归档语义沉淀） | 2026-08-19-feishu-reset-history-archive /reflect |
| 2026-08-18 | 新增「权限裁决器」「Fail-Closed 安全降级」概念（架构深化候选 #3，收敛确认执行管道与四大安全不变量） | 2026-08-16-deepen-permission-adjudication /domain-model |
| 2026-08-12 | 新增「模型配置」实体（provider 条目列表）；「默认模型」「动态模型列表」「会话级切换」「视觉模型」「附件」概念（附件 ≠ 产物） | 2026-08-12-conversation-toolbar-ext /domain-model |
| 2026-08-12 | 新增「权限模式」（strict/standard/auto 三档，ADR-023）「auto-judge link」（模型判断链节，deny-first + envelope 强制） | 2026-08-11-pi-agent-modes |
| 2026-08-14 | 新增「协议族」「供应商探针」概念（ADR-027）；「动态模型列表」定义修订为全协议族化（REQ-104） | 2026-08-12-conversation-toolbar-ext /reflect（BUG-001/002） |
| 2026-08-10 | 新增「工具折叠块」「历史投影」（历史=对话文本，工具不落历史） | 2026-08-08-pi-agent-ux-enrichment |
| 2026-08-08 | 「agent 一词三义」归位（PI 对话 agent / flow agent 节点 / Agent Registry 外部 CLI）；新增会话生命周期术语（淘汰/懒恢复/水合窗口/同组单活/session-evicted/evicted） | 2026-08-07-pi-agent-consolidation |
| 2026-07-08 | 初始化词汇表 | bootstrap-workflow |
| 2026-07-08 | 更新 CLI 与 HTTP API 术语定义 | codex-harness-desktop attempt-2 tech-design |
| 2026-07-16 | 新增 skill-repo、skill symlink、dependency cascade、orphan skill 术语 | codex-harness-desktop /reflect |
| 2026-07-19 | 新增内容源、通知实体；素材库、通道、产物、触发来源、Tag 概念 | 2026-07-19-media-production-line |
| 2026-07-28 | 新增子流程、callFlow/flowInput/flowOutput/setVariables 节点、嵌套执行术语 | 2026-07-23-nested-flow /reflect |
| 2026-08-06 | 「对话空间」修订为"空间=会话"（ADR-016）；新增会话区/管理区/通用空间/项目空间/孤儿会话/内联确认卡/授权桥 | 2026-08-02-ui-copilot /domain-model |
| 2026-08-07 | 「授权桥」补充唯一执行者/单一评估语义（BUG-001/002）；新增「卡片定型」 | 2026-08-02-ui-copilot /reflect |
| 2026-07-29 | Skill 代码映射改为磁盘（三表删除）；Skill Repository → 技能库/来源目录；Skill Symlink 定义更新（agent 原生目录→技能库）；删除 Dependency Cascade（ADR-011 废止）、Orphan Skill（三表删除后概念消失）；新增 agentTypes、Agent Registry、收敛、外部条目；CLI 三级子命令约定扩展 | 2026-07-29-multi-agent-skills tech-design |
| 2026-08-03 | 新增「对话空间」实体、「用户绑定」「确认挂起」概念；修订「通道」「通道绑定」定义（agent 优先，REQ-CHANNEL-002）；触发来源新增「对话」；状态新增 pending | 2026-08-02-builtin-agent domain-model |
