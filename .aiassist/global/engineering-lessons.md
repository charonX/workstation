# Engineering Lessons

本文件记录跨 story 的工程经验与复用知识。

- 在项目演进过程中补充踩坑记录、最佳实践、性能调优等。
- 保持简洁，优先记录可复用的结论，而非一次性细节。

---

## 新增节点类型不要走集中式 switch，走注册表

- **现象**：`upstreamVariables.js` 用 switch 按节点类型推导下游变量，新增 `setVariables` 节点时漏补分支，导致下游变量选择器选不到它的输出（BUG-001）。
- **根因**：每新增一种节点就要改一处集中式代码，属于"遗忘型错误"高发结构。
- **结论**：节点类型元数据、默认配置、输出变量推导、面板渲染统一走 `nodeRegistry.js` 注册；新增节点类型只改一处，变量选择器/配置面板/节点面板自动识别。

## 声明与行为要分离：outputVariables 是契约，expressions/inputMappings 是实现

- **现象**：Attempt 1 里 `agent.outputVariable`、`callFlow.outputMappings`、`setVariables.assignments` 各自为政，保存校验、变量选择器、运行时写入都要特殊处理。
- **根因**：输出变量"叫什么名字"和"怎么算出来"被混在同一层字段里。
- **结论**：统一用 `config.outputVariables` 声明下游可见变量名；节点类型保留私有字段描述求值逻辑（如 `setVariables.expressions`、`callFlow.inputMappings`）。这样变量选择器和保存校验可以通用化。

## tech-design 阶段要识别"新增类型时容易遗漏的集中式分支"

- **现象**：Attempt 1 到 BUILD 后才发现 `upstreamVariables.js` 的 switch 会漏新节点，被迫回流到 TECH-DESIGN 做统一输出模型（ADR-010）。
- **结论**：方案评审时主动问"新增一种 X 要改几处代码？"如果答案是"到处改"，应在设计阶段就改成注册表/插件化/通用推导，不要等到 BUILD 阶段用 bug 发现。

## 当前 story 改变已有行为时，要主动检查前置 story 的回归测试

- **现象**：BUG-005 是 2026-07-16-flow-refinement 的回归测试仍期望 `setVariables` 不可见，但本 story 已把它实现为合法节点。
- **根因**：实现推进中只关注本 story 测试，没同步更新前置 story 中依赖旧行为的断言。
- **结论**：当新增/变更已有节点类型、UI 文案、面板结构时，除了本 story 测试，还要搜索所有引用该类型/文案的 E2E 回归测试并更新；最好在实现改动同期就改，不要留给 QA 暴露。

## 多入口/多输出归一化需求要在 PRD/REQ 阶段多问一层

- **现象**：BUG-003/004 都是 req-gap 就地补全——`setVariables` 需要多来源聚合表达式、`flowOutput` 需要显式映射上游变量。
- **根因**：初始 REQ 只考虑了"变量赋值"和"flowOutput 返回值"的最简场景，没追问"多个入口变量名不同怎么办""子流程出参想显式挑上游变量怎么办"。
- **结论**：遇到"入口多样"或"输出契约"类需求，必须穷举入口组合和输出映射场景；归一化节点（setVariables）应在需求阶段就作为一等公民提出。

## Electron E2E 启动超时先检查 native binding

- **现象**：E2E 启动报 30s 超时，BrowserWindow 未创建。
- **根因**：`better-sqlite3` 未针对 Electron ABI 重建，`startServer` 中 `getDb` 抛 `E-DB-UNWRITABLE`，主进程启动失败。
- **结论**：Electron 测试启动异常时，先跑 `npm run rebuild:electron`；main 进程启动日志比 renderer 超时更关键。

## 有副作用的节点通过 services 注入，保持引擎可测

- **现象**：`callFlow` 节点需要读 DB、建 execution、递归执行子 flow，这些不是纯函数能做的事。
- **结论**：采用 ADR-008 的 `options.services` 注入模式：`flowEngine.run()` 把 `services` 和 `currentDepth` 传给 executor，具体副作用由调用方（taskService 或测试 mock）提供。引擎保持纯函数，新节点类型可复用该模式。

---

## Electron 主进程代码变更必须重启

- **现象**：renderer 热更新后 UI 已显示 skill 关联成功，但项目目录下没有生成 `.opc/skills` 软连接。
- **根因**：`skillService.js` 运行在 Electron main 进程，Vite 的 renderer HMR 不会重载 main 进程。
- **结论**：修改 main 进程 / Node 服务层后，必须重启应用或重新运行 `npm run dev`；E2E 与手动验收前确认主进程已加载最新代码。

## Skill Repo 作为一级实体：迁移要清理遗留数据

- **现象**：Project Detail 可用技能列表出现多个仓库名（如 `mattpocock/skills`、`mattpocock-skills`）。
- **根因**：从“单个 skill”模型迁移到“skill repo → 嵌套 skills”时，只给 `skills` 表加了 `repoId`，未清理旧数据，导致 orphan skill（`repoId IS NULL`）仍被返回。
- **结论**：数据模型变更时必须写 migration 清理遗留记录，并新增过滤器（如 `listLinkableSkills`）避免无效数据进入业务逻辑。

## Frontmatter 解析不要假设单行 key:value

- **现象**：Skill Detail 中 `tags` 丢失，`version`/`author`/`category` 等元数据在存在时显示为“—”。
- **根因**：`parseSkillMarkdown` 只按首行解析，无法处理 YAML 列表和多行 frontmatter。
- **结论**：解析 SKILL.md / Markdown frontmatter 时，使用能处理多行字段、YAML dashed list、`[a,b]` 数组的解析器；空值在 UI 层应隐藏而不是用占位符兜底。

## 文件系统副作用必须纳入契约和测试

- **现象**：用户以为 project↔skill 关联只是数据库记录，期望有实际文件系统效果。
- **结论**：当功能产生文件系统副作用（如 symlink、目录创建）时，应在 REQ 中明确验收标准，并在 API 测试中断言路径/符号链接存在性；删除时必须同步清理，避免 dangling symlink。

## 依赖级联要显式处理，避免循环

- **结论**：skill `dependencies` 解析后，关联时应递归级联并记录 `visited` 防止循环依赖；取消关联时不应级联取消，避免误删用户显式选择的 skill。

## 关闭按钮等歧义控件应使用稳定定位

- **现象**：E2E 中“关闭弹层”因 header ✕ 和 footer Close 文本冲突导致 locator 不稳定。
- **结论**：优先使用语义角色或唯一 `data-testid`；避免按文案定位可能重复的控件。

## npm 安装测试应使用本地 fixture

- **结论**：测试真实 `npm install` 时，使用本地 package 目录 fixture 代替远程 registry，避免网络依赖和 CI 不稳定。

## REQ 变更后必须同步 hash 与所有测试头部

- **结论**：`requirements.md` 一旦修改，`requirements-v1.hash` 会变，所有 `REQ-VERSION` 头部必须批量更新；否则 pre-commit/校验会认为测试契约过期。

## 删除 UI 元素必须同步清理测试与 locators

- **现象**：BUG-005 清理节点面板中未实现节点（loop/while 等）后，QA 发现旧 E2E `flowRun.test.cjs` 仍断言面板显示 `"loop"` 分类而失败。
- **根因**：只改了 `NodePalette.jsx`，未同步检查所有引用该分类/按钮的 E2E 测试和 locators。
- **结论**：删除/重命名 UI 元素时，必须同时搜索并更新：组件本身、i18n 文案、locators、引用文案的 E2E 测试、截图/截图测试。跑 `/qa-runner` 前确认无遗留断言。

## 调试弹窗应显式区分"等待输入"与"运行中"

- **现象**：`handleDebugOpen` 里直接调用 `runDebug("{}")`，导致用户一点开调试弹层就自动运行，来不及输入变量。
- **根因**：打开弹窗和触发执行被耦合在同一个回调里。
- **结论**：调试/预览类弹窗的打开动作只应重置状态，执行动作由独立按钮触发；状态机要明确 `idle` / `running` / `result` / `error` 阶段，避免用户感知上的"失控"。

## E2E 文案断言必须限定范围或使用稳定定位

- **现象**：把 `loop` 断言改为 `Execution` 后，Playwright 报错 `"Execution" resolved to 2 elements`：一个是顶部导航 `Executions`，一个是节点面板 `Execution` 分类。
- **根因**：`getByText` 在整个页面匹配，未限定到目标容器。
- **结论**：E2E 中优先用 `data-testid`；使用 `getByText`/`getByRole` 时，通过父容器 locator（如 `locator(NODE_PALETTE).getByText(...)`）限定范围，避免跨组件文案冲突。

## 后端返回的日志/结构化数据前端要及时展示

- **现象**：调试接口已返回 `logs` 数组，但弹窗只展示 `output`，用户看不到执行过程。
- **根因**：前端只渲染了部分返回字段。
- **结论**：当后端已返回用于调试/排查的日志、trace、迭代信息时，前端应提供合理的展示面，避免数据"沉睡"；同步更新 i18n 与样式。

## ESM 模块顶层不要读 env/磁盘——惰性初始化才对 bundler 鲁棒

- **现象**：飞书凭据和技能数据每次重启就"消失"，bootstrap-env.js 作为第一个 import 仍无效。
- **根因**：ESM static import 被 hoist，vite/rollup 打包后其他 chunk 的静态 import 被提升到 bundle 顶部深度优先执行，bootstrap-env 的内联代码反而在后面执行。`settingsService` 顶层 `let settings = readSettings()` 跑在 env 设置之前，读到默认目录。
- **结论**：模块顶层只定义常量和函数，**不要**在顶层读 `process.env`、读文件、开 DB 连接；改用惰性初始化（`let cache = null; ensureLoaded() { if (!cache) cache = ... }`），在第一次导出函数被调用时才读。这样与 import 顺序、bundler 重排、dev/prod 打包都无关。

## SDK 集成测试必须覆盖"原始 payload 形态"，不能 mock 掉解析层

- **现象**：`mapInboundMessage` 读 `eventData.event.message` 返回 null，飞书消息全部静默丢弃，测试全绿。
- **根因**：所有测试经 `simulateReceiveForTests` 注入已经 parse 过的数据，绕过了真实 SDK EventDispatcher 把 v2 schema `.event` 展开到顶层的步骤。
- **结论**：测第三方 SDK 集成时，至少要有一个测试从 SDK 交付的**原始事件结构**喂入（而不是直接调业务 handler）；优先用真实 SDK client + fake transport，其次保留一层薄的 parse/adapter 并针对它写"原始 payload → 业务对象"的测试。

## 硬编码的自动行为要在 PRD/REQ 里明确"谁控制"

- **现象**：taskService 终态自动回复"已存：…"/"执行失败：…"，用户发现无法控制回复内容、也无法选择不回复。
- **根因**：设计时把"链接速存回执"和"执行终态回复"都做成系统层硬编码；后续场景扩展（自定义文案、卡片、不回复、多个发送动作）无法表达。
- **结论**：凡涉及**对外副作用**（发消息、写文件、调用外部 API）的动作，优先做成**显式 flow 节点**而不是系统层隐式行为；入队回执等有强时限/SLA 要求的可保留为系统行为，其余交给 flow 作者控制。

## 删除死代码/未用功能比留着更安全

- **现象**：内置技能 opc-collection-skills、链接速存模板等"开箱即用"资产没人用，反而增加状态面（builtin installSource、自动播种、模板实例化路径）和测试负担。
- **结论**：演示用/样板代码若没有真实用户路径，果断删除；比留着"将来可能用"的代码更安全——代码越少，状态越少，bug 面越小。需要时从 git 历史取回。

## 数据路径分裂恢复：启发式要按"行数"而不是"表存在"

- **现象**：BUG-007 一次性数据迁移检查"canonical DB 是否有 channel_bindings 表"，但 initSchema 启动时已自动建空表，检查永远为 true，迁移永远不跑。
- **根因**：检查表存在 vs 检查有数据是两回事——幂等 DDL 会让存在性检查失真。
- **结论**：跨路径/跨版本数据恢复，用"行数 > 0"或"标志性记录存在"判断，不要用表/列存在性。

---

来源：codex-harness-desktop /reflect（2026-07-16）、2026-07-16-flow-refinement /reflect（2026-07-19）、2026-07-19-media-production-line /reflect（2026-07-24）、2026-07-23-nested-flow /reflect（2026-07-28）

## 契约层要显式覆盖"边界形态"，不止主流程

- **现象**：BUG-001——技能库 `skills/<category>/<name>/` 嵌套布局扫不到（REQ 只签了两种布局）；BUG-003——项目技能关联只有扁平逐条交互（REQ 未定义分组/筛选/批量）。
- **根因**：/crystallize 时验收标准围绕主流程写，真实世界数据形态（嵌套目录、大批量集合、长列表）没有进 AC。
- **结论**：验收标准用 3 个问题自检：① 数据结构是否有嵌套/层级形态？② 数量级大了交互是否仍成立（批量/搜索/分组）？③ 数据源来自第三方时其真实布局是否覆盖？——任一为是，就把它写进 AC，别等 bug 循环来补。

## 构建产物包含性是"源码启动测试"的盲区，要用构件级契约测试

- **现象**：BUG-002——vite main 构建从不复制 agentRegistry.json 进产物，electron-forge start 读快照 ENOENT；API/E2E 全从 src/ 源码启动（import.meta.url 指向 src/services/），盲区从未被覆盖。
- **根因**：测试 seam 全在源码路径上，构建产物路径（打包后文件布局）没有契约。
- **结论**：涉及"构建后文件布局"的能力（快照复制、资源拷贝、产物目录结构），回归测试要跑一次**真实构建**（vite build --outDir 临时目录），断言产物含目标文件且与源一致。源码启动测试无法发现这类缺陷。

## 测试失败注入要选"真实失败路径"，不要依赖内部实现细节

- **现象**：notifications AC4 用 `closeDb()` 模拟写入失败，依赖"notificationService 缓存连接不刷新"这一实现细节；修复缓存自愈后测试立即失明。
- **根因**：注入方式耦合了被测实现的行为，而不是制造真实的失败条件。
- **结论**：模拟失败优先选真实条件——磁盘只读（chmod 444）、权限不足、网络断开、SDK 抛错；只有真实条件不可行时才用 mock/stub。这样实现修复不会连带测试失明。

## service 层资源句柄要"惰性 + 自愈"，不要缓存可能失效的引用

- **现象**：notificationService 模块级缓存 db 连接，closeDb()（server 重启/测试间切换 DB 路径）后仍用旧句柄 → "connection is not open" → 500/写通知失败；6 条全量测试因此变红。
- **根因**：db.js 是单例连接管理者（closeDb 会关闭全局连接），service 层却持有自己的缓存引用，两者失同步。
- **结论**：全局单例资源（DB、配置、客户端）由单一模块管理；使用方每次调用**检查句柄活性**（better-sqlite3 的 `.open`），失效即重新获取，且错误识别要覆盖真实报错文案（"is not open" ≠ "is closed"），否则自愈逻辑永远不会触发。

---

来源：2026-07-29-multi-agent-skills /reflect（2026-08-01）
