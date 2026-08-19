# Engineering Lessons

本文件记录跨 story 的工程经验与复用知识。

- 在项目演进过程中补充踩坑记录、最佳实践、性能调优等。
- 保持简洁，优先记录可复用的结论，而非一次性细节。

## 服务容器独立化与测试资源泄漏防御：惰性工厂、兼容代理与故障注入的资源恢复（2026-08-19，2026-08-16-deepen-service-container）

- **故障注入测试（Fault Injection）必须保证底层系统资源的彻底恢复**：
  - 现象：在测试容器 `dispose()` 容错不阻断时，通过 mock `purgeTask.destroy = () => { throw new Error(...) }` 模拟定时任务销毁异常。容器确实正确捕获了异常，但真实的 `node-cron` interval 从未被停止，导致事件循环永远处于活跃状态，`node --test` 单测进程挂死。
  - 结论：故障注入在验证了异常捕获后，**必须在 `try...finally` 中恢复原始方法并执行底层真实资源的销毁**（或对容器注入假定时器 seam），严防事件循环与异步句柄泄漏。
- **架构硬约束指标（如行数 ≤250）需配合死导入检查与依赖方向断言**：
  - 现象：`server.js` 瘦身虽然达到了 234 行，但曾残留了无调用的 `buildSessionConfig` 死导入，在精神上违背了"不导入具体领域工厂"的原则。
  - 结论：重构时必须通过静态测试与代码审查，确保精简后的文件零死导入；依赖方向断言应正向钉在承载领域能力的真实新模块（`serviceContainer.js`）上。
- **兼容层必须显式标注 `@deprecated` 并明确唯一正规入口**：
  - 现象：为了保证既有测试零改动而保留的 `server._opcXxx` 属性代理，如果不加约束很容易被未来新业务代码误用，重新腐化架构。
  - 结论：兼容代理函数必须添加 `@deprecated` JSDoc 与清晰的警告注释，并在全局架构文档中明确 `server.services` 为唯一正规 DI seam。

---

## 通道能力收拢与测试接缝设计：单一在线检查、边界适配与零假断言（2026-08-19，2026-08-16-deepen-channel-sender-seam）

- **「在线检查统一收拢」不等于「双边抹平不查」**：
  - 现象：原先测试路径的 shim 会检查通道在线状态，而生产路径漏查；重构统一收口时若只是删除了测试 shim，未在底层通道分发属主（`channelManager.dispatchToAdapter`）中加入状态守卫，会导致生产离线时直接调用 adapter 发送而无守卫，把不一致抹平成了"两处都不查"。
  - 结论：将在线状态守卫收拢到唯一分发属主（`channelManager.dispatchToAdapter`），未上线/未配置一律抛出规范化错误 `E-CHANNEL-OFFLINE`，消除离线静默穿透。
- **测试接缝在注入边界做一次性形态适配，禁止热路径运行时 Duck-Typing 嗅探**：
  - 现象：为了兼容旧的 1 参 adapter 测试注入，在 `resolveChannelSender().send` 运行期用 `typeof adapter.getStatus === "function" || typeof adapter.onMessage === "function"` 判断参数个数（arity）。这种运行时嗅探不仅脆弱（若 2 参 mock 恰好包含同名方法会被误判丢参），而且把 runner 强耦合到 adapter 内部方法名。
  - 结论：在 `setChannelAdapterForTests(adapter)` **注入边界处一次性包装** 为标准的 2 参 `channelSender` 对象；`resolveChannelSender()` 直接返回 2 参 sender，运行期零嗅探、零额外逻辑。
- **废弃接缝必须彻底连根拔起，禁止保留静默无操作的空接缝**：
  - 现象：废除旧属性注入后，在 runner 中保留了 `setChannelAdapter(_adapter) {}` no-op 空方法，`server.js` 仍然在调用它，形成了无意义的伪接缝。
  - 结论：消灭旧模式时，同步清理调用方（`server.js`）并彻底删除空导出，保持公共 API 干净。
- **子流程测试必须遵循真实契约，严禁伪造不存在的内联调用**：
  - 现象：测试子流程继承 `services.channelSender` 时，直接给 `invokeSubflow` 传入了内联 flow 对象，忽视了 runner 真实契约是从 `flowService.getFlow` 获取注册 flow 且需要 `callFlow` 节点的 `inputMappings` 映射。
  - 结论：测试嵌套执行等跨模块特性时，严格遵循真实 service 注册与节点映射契约，产出真实可信的自动化证据。

---

## 权限裁决与安全管道深化：消灭全局状态、即时唤醒与唯一执行者（2026-08-18，2026-08-16-deepen-permission-adjudication）

- **模块级全局 Map 是跨用例干扰与内存泄漏的温床**：
  - 现象：`notifySettleFlags` 曾作为模块顶级 `Map` 存在于 `confirmationService.js`，并发测试或多实例构造时存在全局状态污染风险。
  - 结论：将状态注册表下沉到 Per-Instance 工厂（`createPermissionAdjudicator`）的闭包实例内部，实例销毁/隔离自然干净。
- **消灭 20ms 定时器轮询，改用内存 Promise 注册表即时唤醒**：
  - 现象：`permissionBridge.js` 原先每隔 20ms `setInterval` 轮询 SQLite 查询决议状态。
  - 结论：在主进程维护 `pendingDecisions: Map<confirmId, { resolve, timer }>`，在 `approve`/`reject` 同步写库的同时直接 `resolve` 内存 Promise，零延迟、零轮询 CPU 开销，并在终态通过 `try/finally` 严格 `clearTimeout` 与清理 Map。
- **安全不变量必须在结构上强制，不能寄希望于外围注释**：
  - 现象：BUG-001/002 是因为「授权桥行在 approve 时主进程不得 execute」只以注释约定，很容易在后续改动中误调 `execute` 导致双重执行。
  - 结论：在 `PermissionAdjudicator.approve` 内部结构化判断 `isBridgeRow`（`riskLevel === "permission"` 或 `notifyOnSettle === false`），彻底跳过 `execute`；同时测试用例直接断言 `assert.equal(executedCommands.length, 0)` 锁死契约。
- **strict 等全局安全语义必须收归策略/裁决层，上层装配仅转发**：
  - 现象：`server.js` 曾在 `onPermissionAsk` 中通过 `getModeService().getMode(sessionKey) === "strict"` 手写 `user_bash` 全确认分支，导致 strict 判定散落且重复。
  - 结论：将 `mode: "strict"` 作为第一判定注入 `permissionPolicy`（评估器直接返回 `"ask"`），并在 `permissionBridge` 统一调度；`server.js` 仅做单行转发，彻底消灭外围 if-else 胶水。
- **杜绝无法命中生产实现的假断言，用真实行为断言与严格静态断言锁定**：
  - 现象：断言写成了生产代码中根本不存在的正则（如 `doesNotMatch /if (mode === "strict") { return "ask"; }/`），无法测出真实代码中的重复逻辑。
  - 结论：测试必须包含真实的业务行为断言（如 strict 模式下安全命令真实产生 pending 单并在 approve 后放行），配合精准的静态代码检查（如断言 `server.js` 零手写 strict 判断），确保红绿有效。

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

---

来源：2026-08-01-macos-distribution /reflect（2026-08-02）

## 外部工具/构建链的真实输出形态要"实测一次"，不能停在源码推演

- **现象**：release 命令的产物定位按 maker 源码推演（`out/<app>-<v>-<arch>.dmg` + `out/zip/...`），漏掉 forge 7 的 makeDir 前缀——真实产物在 `out/make/` 下（zip 深度 3）。首次真实发布 upload 失败（zip 回退契约名不存在）；修复为深度 2→4。
- **根因**：tech-design 风险表已标注"一次本地打包验证"的快速验证路径，但从未执行；产物布局靠读 maker 源码"推演"代替"实测"。
- **结论**：凡是外部工具/构建链的真实输出形态（forge 产物布局、原生模块 ABI、gh CLI 行为、SDK payload 形态），契约里标注的快速验证路径必须真的跑一次。发布类命令在合入前跑一次 `npm run make` + `find out -name "*.dmg|*.zip"` 的成本远低于真实发布失败。

## 带外部副作用的命令要把"失败后如何收尾"设计进错误路径

- **现象**：release 命令 create 成功、upload 失败 → Release 已公开但 0 资产（半发布状态）；按设计 create/upload 失败不回滚（已 push），错误码复用 E_RELEASE_BUILD_FAILED。
- **结论**：创建远程资源的命令（Release/部署/上传），失败路径要明确"半发布状态如何恢复"（本例：`gh release upload` 手工补传资产即可恢复）；REQ 的失败场景应包含"副作用已部分发生"的收尾契约。

## 签核测试也可能有 harness bug：写 CLI 子进程测试前推演执行语义

- **现象**：AC3 测试以相对路径 `node src/cli/opc-workstation.js` + 子进程 `cwd=临时 git 仓库` 启动 → node 按子进程 cwd 解析入口 → MODULE_NOT_FOUND，实现永远无法介入；实现侧不可满足，需测试侧一行修复（绝对路径）。
- **结论**：test-author 写子进程 CLI 测试时：① 入口路径用 `path.resolve` 绝对化；② 签核前推演"测试进程如何启动被测代码"（node 相对入口按子进程 cwd 解析、execFileSync 的 cwd 参数语义）；③ 签核断言与启动方式解耦。

## dry-run 的"校验清单"语义要在测试里显式定义，签核测试可能强制非常规语义

- **现象**：签核测试要求 dry-run 通过 `v<当前版本>`（等于），真实模式必须拒绝等于——唯一自洽语义是"dry-run 跳过版本递增校验"；同理 tag 防重仅在 make 失败时执行（AC4/AC6/AC7 三个测试共同约束的唯一自洽解）。
- **结论**：dry-run 哪些校验执行、哪些跳过，以及"某检查只在异常分支执行"这类语义，必须在 REQ/测试中逐条显式写出；实现者遇到多测试约束冲突时，先推导唯一自洽解再实现，并把推导记录进 build-progress。

## 原生模块 ABI 不只有 better-sqlite3：forge maker 链也有原生依赖

- **现象**：首次真实发布 make 失败——`macos-alias`（maker-dmg 依赖）编译自 Node 22 ABI 131，当前 Node 24 ABI 137；`rebuild:node` 只重建 better-sqlite3。
- **结论**：Node 大版本升级后，除 better-sqlite3 外，forge maker 链的原生依赖（macos-alias 等）也需 `npm rebuild` 按当前 Node ABI 重建；发布前跑一次真实 make 可提前暴露（同第一条教训）。

## 真实发布是"链路测试"：它验证了错误路径设计，也暴露了未实测假设

- **现象**：首次真实发布：make 失败 → 命令中止不创建 tag/Release + package.json 回滚（GAP-4 修复在真实环境验证通过）；第二次 make 成功但 upload 失败（产物定位假设错误）。
- **结论**：人工验收项（REQ-DIST-004 AC3）不只是"过一遍流程"，它是错误路径设计（回滚/中止语义）与未实测假设（构建链输出）的最后一次真实校验；REFLECT 前把可实测的假设尽量前置（第一条教训），让首发只验证"外部世界行为"（GitHub 权限、Gatekeeper）而非自身代码。

## 测试 seam 与真实环境的差异，是跨进程/外部集成 story 的最大 bug 源（2026-08-05，2026-08-02-builtin-agent）

- **现象**：本 story 真实环境联调连出 6 个 code-defect，全部测试全绿时潜伏：Electron 主进程不容忍 stdio EPIPE（Node v24 容忍）；开发模式 spawn 源码入口而打包走 bundle（CJS 内联即崩）；fauxProvider 绕过 key 校验（重启水合不注 key 全绿假象）；CardKit schema 只对真实飞书 API 可验（三轮才到真根因）；模型 ID 硬编码与 pi 目录不符；看门狗在 faux 快速流式下从不会误杀。
- **结论**：① 写测试时**显式列出"本 seam 绕过了什么环境差异"**（faux 绕过 key 校验、内存 IPC 绕过序列化、开发入口绕过 bundle）——绕过清单就是真实联调的检查清单；② 跨进程/外部 API 的 story，QA 阶段把「打包形态 + 真凭据 + 真外部 API」的最小真实链路冒烟作为标准动作，不要等用户首发；③ 诊断此类问题先在进程内补链路过检日志（路由决策/子进程生命周期/外部调用结果），日志先行可省一轮猜。

## 环境依赖的故障复现不可移植时，用机制级断言替代（BUG-001）

- **现象**：主进程 stdio EPIPE 崩溃在 Node v24 无法复现（运行时容忍断管），但 Electron 主进程崩——真实断管复现写法在开发机上测不出红。
- **结论**：故障机制明确但复现依赖运行时行为时，用**机制级断言**（手动 `stream.emit("error", EPIPE)` 触发同一代码路径）+ 子进程对照实验（装防护 vs 不装，exit code 对比），测试与运行时版本解耦；不要用"在我机器上能崩"的复现当回归测试。

## 构建产物的回归测试必须走生产构建管线同一入口（BUG-002）

- **现象**：用裸 `vite build` 验证 worker bundle 修复，产物是浏览器语义（builtins 被 externalize 成浏览器兼容占位）——与 forge 打包产物（注入 node conditions + builtins external）不是同一个东西，测了等于没测。
- **结论**：bundle 类回归测试的构建入口必须与生产完全一致（本例：forge plugin-vite 的 ViteConfigGenerator + isProd），并在临时目录**置于 repo 内**（node_modules walk-up 解析依赖）；断言产物行为（spawn 真实运行到 ready）而不仅是构建成功。

## 外部 API 的 schema 错误：分层 seam + 真实变体脚本二分，不要猜（BUG-006 三轮）

- **现象**：sendCard 400 修了三轮才到真根因——卡片实体创建接口与 im/v1/messages 发送接口是两个 schema 层，前两轮都在修创建层，真根因在发送层 content 格式。
- **结论**：① 外部 API 封装至少分**请求构建层**（结构/字段断言，fake/mock）与**传输层**（端点/包装/响应解析断言，mock fetch）两个 seam 各自测试；② 遇真实 API schema 报错，先写**变体脚本**对真实 API 做二分定位（哪个调用、哪个字段），修复对象明确后再改代码+补回归——猜着修会产生"修复了但没好"的多轮消耗。

## 有状态服务的恢复（水合）路径必须断言与新建路径等价的能力注入（BUG-005）

- **现象**：重启后按 agent_sessions 水合会话只建句柄，不注入 keySecrets——新建路径有 key、恢复路径没有，faux 模式又不校验 key，全绿潜伏到真实重启才暴露。
- **结论**：凡「新建 + 恢复」双路径的有状态服务（会话/连接/订阅），恢复路径的测试断言必须覆盖**恢复后的行为能力**（恢复后可对话/可收发/可写），而不只是"状态还在"；注入清单（凭证/配置/回调）两条路径要显式对齐。

## 看门狗心跳与工作负载共享调度 = 负载越重越易误杀（BUG-008 → ADR-015）

- 见 ADR-015：心跳控制面带外、任何入站消息计为存活。补充教训：**faux/快速依赖会让时序类 bug 在测试中不可见**——fauxProvider 秒级流式从不会触发 6s 心跳超时，真实 LLM 分钟级生成必现；时序相关测试需要可调的速率 seam（本例补 OPC_AGENT_FAUX_TPS 调慢 faux 流式）。

## mock 契约测试编码的是"你以为的外部契约"——方法级假设只有真实 API 能证伪（2026-08-07，2026-08-02-ui-copilot BUG-004/005）

- **现象**：飞书卡片定型修复写了 5 个回归测试（渲染器层 fake adapter + 传输层 mock fetch 断言请求方法/端点/body schema）——全绿。真实联调：飞书网关 404。根因是 settings 接口官方方法为 PATCH，测试断言的 PUT 本身就是按错误假设写的：**mock fetch 断言只能证明"实现符合测试的假设"，证明不了假设符合外部世界**。
- **结论**：① 外部 API 契约测试的每个假设要素（HTTP 方法/端点路径/包装层/响应解析路径）在测试注释里显式标注「联调验证点」，QA 报告逐条核销——全绿不替代联调；② 首次接入的外部端点，实现前用最小脚本对真实 API 做一次方法/端点验证（curl 级），把假设钉死再写测试；③ 与「外部 API 分层 seam」（2026-08-05 教训）互补：分层 seam 定位"哪层错"，本条防止"每层都对、假设错了"。

## "修复未生效"不要盲猜重试——先补静默路径的诊断可见性，让现场一次分叉（BUG-004→005）

- **现象**：BUG-004 修复（卡片定型）测试全绿但用户实测症状仍在。排查前先把三分叉列明（旧代码未重启 / finalize HTTP 失败被 fire-and-forget 静默吞 / 飞书行为与预期不符），发现 finalize 路径是诊断盲区（失败只进内存 warnings 数组，无 console 输出）——补三态诊断（派发/成功/失败）交用户重启实测，**一轮**拿到决定性证据（`定型失败 ... 404`），直接定位 PUT→PATCH。
- **结论**：① fire-and-forget 异步路径（不阻塞主流程的副作用调用）的失败必须有三态 console 通道（派发/成功/失败），静默 catch 只进内存数组 = 生产无痕（对齐 sendCard/finalizeCard 诊断模式）；② "修复未生效"类问题的标准动作：列分叉 → 找盲区 → 补诊断 → 现场实测一轮分叉——比"再猜一个根因重写修复"省至少一轮；③ 诊断日志带外部系统的错误码聚合（sendWithRetry 的 `status code= msg=` 模式），网关级错误（无 code 的 404）与业务级错误（有 code）要能区分。

## 双层安全机制必须明确"唯一执行者"与"唯一询问者"（BUG-001/002 + gotgenes `..` 角落，一脉三证）

- **现象**：三个 bug 同一族——BUG-001：授权桥 approve 后主进程与 worker 两侧都执行同一高危命令（双执行）；BUG-002：worker pre-gate 与 gotgenes gate 若不设单一评估原则会双评估双询问；gotgenes `..` 相对重定向角落：同一命令命中两条规则（cwd 外 + `*>` 模式）出两张确认卡（双询问，无安全洞但体验断裂）。
- **结论**：凡"两层机制守护同一危险"（命令保险层/gotgenes/pre-gate/确认队列），设计时必须显式回答两个问题：**谁是唯一执行者**（决议→执行的触发点只能有一个）、**谁是唯一询问者**（同一命令同一危险只出一张确认卡）；两层都会命中时，必须在接缝处写下去重/优先级规则（本例：permission 行跳过主进程 execute、wrapper floor 交 gotgenes 单 ask 承接、规则级去重待 pi-agent-consolidation 处理）。

## 签核断言必须可执行，不许"注释承载语义"占位

- **现象**：2026-08-07-pi-agent-consolidation 门 1 签核时，5 个测试文件把断言写成 `assert.ok(true)` + 注释说明预期语义（自认"集成面断言待实现后接线"）——BUILD 中父代理需逐个强化为真实断言，否则测试形同虚设（全绿但无验证力）。
- **根因**：签核时把"断言表达"与"断言语义"分离——语义写进注释就失去了机器验证。
- **结论**：门 1 签核的每条验收标准必须落到可执行断言；seam 未就绪时宁可写"seam 未就绪即失败"（如 `assert.ok(mod, ...)`），不许写恒真占位。实现后可接线（--import seam）的语义必须真实断言。

## 签核浏览器 E2E 前，先验证测试环境下行为链的可驱动性

- **现象**：T-7/T-9 签核为"agent 主动发起工具调用"的全链 E2E，但 FAUX 模式（零网络 E2E）是确定性回声、从不调工具——2 个 E2E 文件 6 用例全红在首个 goto，需重写 + 新增"可编程工具调用注入缝"（OPC_FAUX_TOOL_SEQUENCE）。
- **根因**：签核时没问"测试环境下 agent 真的会发起工具调用吗"——FAUX 与真实 provider 的行为差异是已知事实（assistantConfirm 头注释早写了 seed seam 的原因）。
- **结论**：签核浏览器 E2E 断言前，确认测试环境下行为链每一腿可驱动（FAUX 能力边界、seed seam、可编程注入缝）；不可驱动的腿要么补 seam 要么降级组合已实证链路，且要在签核时显式记录。

## agent 主动发起路径必须有真实链路 E2E（fake IPC / seed seam 覆盖不到模型循环）

- **现象**：T-7/T-9 注入缝驱动 agent 真实发起工具调用后，实证暴露两处藏了三个 story 的生产缺陷：① SDK 0.83.0 `noTools:"all"` → 空 Set 反而过滤全部工具（agent 拿不到任何工具，"Tool bash not found"）；② confirm-request-ack/permission-decision 经全局串行队列被在途 prompt 占住 → 确认卡"已确认并执行"但执行永不发生（死锁）。
- **根因**：工具调用路径此前只经 fake IPC / seed 直写 / 单元 seam 验证——它们绕过模型循环真实执行，缺陷不可见。
- **结论**：涉及"agent 主动发起 X"的行为（工具调用、确认、恢复），必须有真实链路验证（可编程 FAUX 注入缝驱动生产链执行，或真实 provider），单测与 seed 只能作补充。

## 对抗式验证（PRD 对齐子代理）抓"测试全绿但语义错"的缺陷

- **现象**：sessionLifecycle 实现后 19/19 测试绿，PRD 对齐子代理发现 M1：worker 对每个流式事件调 touch() 无条件清 pendingEvictions → 组冷却标记的延迟淘汰被会话自身流式事件抵消 → 组内双热并存，违反 F3"组内恒 ≤1"锚点（测试未建模流式期间的 touch）。
- **根因**：测试用例覆盖了"流式中标记、流结束淘汰"，但没覆盖"流式期间有事件 touch"的交叉场景——实现把两类 touch（用户新活动 vs 会话自身事件）混为一谈。
- **结论**：BUILD 每个切片后跑一轮对抗式 PRD 意图检查（操作流/错误状态/交叉场景），成本低于 QA 后 bug 循环；"绿了对照 PRD 意图"不是口号是流程。

## 伪契约驱动反直觉行为：实现注释引用的"E2E 契约"必须验证真被断言

- **现象**：2026-08-08-pi-agent-ux-enrichment BUG-001——Composer 注释声称"发送后不清空输入：E2E 契约依赖发送文本保留"，但 assistantChat AC4 实际只断言按钮态（流式中 disabled/完成后 enabled），从未断言文本保留。实现者把"测试的间接隐含前提"当成契约，导致"发送后文字还在"的反直觉行为。
- **根因**：实现注释引用契约但未验证契约原文；AC4"完成后 enabled"的实现依赖链（canSend 需文本非空）被误读为"必须保留文本"，实际是"完成后按钮态随输入框内容"的自然语义。
- **结论**：实现注释里写"E2E 契约依赖 X"时，先 grep 验证 X 是否真的被断言。伪契约是 req-gap 的温床——本 bug 分类为 req-gap（契约定义了反直觉行为），就地补全 PRD 语义 + 改断言。

## 需求现场扩展的增量闭环（bug 引出新功能）

- **现象**：BUG-001 修复讨论中用户提出状态显示需求（执行状态/token/上下文/git 分支——pi-web 式）——从单 bug 升级为新功能面。
- **处置**：不塞进 bug 修复，走增量闭环：回 PRD 加稳定块（B9-B11）→ /research 调研数据源（getSessionStats/getContextUsage/pi footer git 实证）→ tech-design 增量 → 结晶增量 REQ（056-058）→ 门 1 增量签核（授权）→ 增量切片（Slice 8/9）。
- **结论**：bug 中冒出的新需求是"范围扩展"不是"bug 的一部分"——用增量闭环叠加，不推倒既有（既有 666 水位 + 12 E2E 全程不退）。

## 数据源调研前置：呈现需求先证数据可用性

- **现象**：状态显示的 token/成本数据——PI 事件层无 usage 事件（实证），但 getSessionStats() 聚合存在（tokens/cost/contextUsage）；FAUX provider 的 usage 是消息内容估算（非 0，修正了"FAUX 全 0"的初判）；git 分支 pi 有 footer 实现可参考。
- **结论**：呈现类需求（尤其"显示 X 数据"）先 /research 验证数据源存在性与形态，再定 REQ——调研结论直接决定可行性分层（有源/需新实现/无源估算）。

---

来源：2026-08-08-pi-agent-ux-enrichment /reflect（2026-08-10）

## 可观测性先行：跨进程链路故障先补诊断日志再猜根因（BUG-002，5 轮诊断）

- **现象**：LLM 空转（消息发出无回复）——SDK 吞掉请求失败（deepseek 400），worker 静默。5 轮诊断 commit 从「淘汰日志带来源 → LLM 调用起止 → prompt-result 带 reply → 事件计数 → 读 SDK 末条消息」逐层补可观测性，才实锤「工具名含空格 → OpenAI function.name 规范 → provider 400 → LLM 空转」。
- **结论**：跨进程/第三方 SDK 链路的故障，第一动作是补链路诊断日志（每段转发留痕、失败显式化），让现场一次分叉定位，不要盲猜重试；诊断日志本身也是可观测性资产（淘汰/LLM 调用的来源与结果），留在代码里。

## 系统恢复路径 ≠ 用户活动：生命周期规则的语义边界要显式（BUG-003）

- **现象**：重启水合风暴误淘汰——session-config 不带 source 标记，worker 把系统恢复（水合）当作用户活动触发同组冷却，同组两会话重启后只剩一个。
- **结论**：任何「系统自动动作 vs 用户主动动作」双语义的入口（水合/恢复/重连/重试），必须带显式来源标记（source:hydration），冷却/淘汰/计数规则只对用户活动生效；测试断言恢复后的行为等价（两会话句柄都在），而不只是状态存在。

## 切会话/切上下文必须显式归零跨上下文状态（BUG-004）

- **现象**：流式中切会话 → 新会话 composer 永远 busy、状态栏不跟随——上个会话的 streaming/execState 残留到新会话。
- **结论**：UI 状态若按"当前选中项"派生（streaming/toolActive/git/context），切换选中项时必须显式重置全部派生状态，再依赖新连接的补推事件重新就绪；不要依赖"新数据自然覆盖"。

## 跨进程文件路径解析基准要显式定义并测试（BUG-005）

- **现象**：read/write 相对路径按进程 cwd 解析 → 静默错读同名文件（不同项目同名文件读错内容）+ 边界逃逸（`..` 出项目目录）。
- **结论**：工具面的相对路径基准必须是**会话项目目录**（业务语义），不是进程 cwd；解析后 realpath containment 校验；回归测试要包含"同名文件"与"路径逃逸"两个复现形态。

## 事件契约缺失字段会导致 UI 错配：错误关联策略要显式（BUG-006）

- **现象**：tool_execution_error 事件不带 toolCallId → 并行工具出错时错误归到错误块（错配）；error 无 id 需倒序匹配最近 running 块。
- **结论**：事件流契约若某些事件缺关联字段（error 无 id），渲染层必须定义显式关联策略（最近 running 匹配 + 未来补字段优先精确匹配双分支），并写进 REQ 标准（并行场景专项测试）；能补字段（携带 toolCallId）优先于猜测关联。

## 子进程不得隐式自起共享服务（BUG-007）

- **现象**：worker 上下文 ensureServer 隐式自起 HTTP server（headless 自起的遗留假设），子进程内 boot 第二个 server；测试 seam 依赖该隐式行为，修复后 seam 需同步注入 baseUrl。
- **结论**：多进程架构中"共享服务"（HTTP server/DB）只能有一个权威启动者（主进程），子进程通过注入的连接信息（baseUrl）使用；测试 seam 若隐式依赖"恰好有服务在跑"，要在 seam 契约里显式化（注入 baseUrl），否则修复被 seam 拖住。

## UI 气泡角色词表 ≠ 存储/JSONL 原生角色词表（BUG-009→010，双层教训）

- **现象**：BUG-009 修复历史投影（只放行 user/assistant 原生角色，工具产物不落历史）后，ui-copilot 的 E2E seed 用 UI 气泡词表 `agent` 写 JSONL → 行被过滤 → 2 例回归红（REQ-AGENT-034）。历史投影自 8/7 写入后未变，潜伏错位由修复暴露。
- **结论**：① 跨层数据（存储 JSONL / API / UI 气泡）各有自己的角色词表（PI 原生 user|assistant|toolResult vs UI data-message-role user|agent），测试 seed 必须用**存储层原生词表**，渲染层负责映射；② 收紧/过滤型修复（按角色过滤）必须全量回归所有写同层数据的既有测试，包括其他 story 的 seed seam；③ 修复时同步补 seam 注释的词表契约，避免再次错位。

## 历史=对话文本：投影过滤是产品契约不是实现细节（BUG-009）

- **现象**：历史消息投影原样透传 toolResult 行 → bash ls 输出/JSON 以纯文本气泡漏进历史；只含 thinking/toolCall 的 assistant 行投影为空气泡。
- **结论**：历史视图的语义是"对话文本"（用户说了什么、agent 回了什么），工具产物是实时呈现层的事；投影层按 role 过滤 + 空文本剔除是 REQ 契约（工具不落历史，B8），不是可选的实现细节——写进 REQ 验收标准并在投影层加注释。

## 渲染安全边界的成体系决策（ADR-021）

- 对话富呈现的注入面有三类：HTML 全转义（零 raw 白名单）、mermaid strict（DOMPurify 清洗实证）、图片主进程白名单 + blob URL（realpath containment + 扩展名白名单）。安全姿态保守：任何未来 raw HTML 白名单需求需重新评审。详见 ADR-021。

---

来源：2026-08-10-pi-permission-config-ui /reflect（2026-08-11）

## 主进程 bundle 引入新的 CJS 依赖必须检查 external（BUG-002，构建产物盲区第三次印证）

- **现象**：打包形态（.vite/build）启动即崩 `Calling "require" for "node:os"`——S1 在主进程服务层顶层 `import { createJiti } from "jiti"`，rolldown 把 jiti 的 CJS webpack chunk 内联进 ESM 主 bundle（保留 `__require("node:os")` 兜底），ESM 无 require 加载即崩。E2E 全绿（源码启动不加载打包产物）。
- **根因**：`vite.worker.config.js` 有 `/^jiti(\/|$)/` external（worker 用 jiti 从不崩），但 `vite.main.config.js` 没有——同一依赖两个 bundle 的 external 配置不一致；rolldown 对 CJS 依赖的「require 兜底」只在不 external 时生成。
- **结论**：① 主进程 bundle 引入任何**新的 CJS 依赖**（jiti/原生模块/内部 webpack 形态的包），必须同步检查 `vite.main.config.js` external——与 worker/renderer 配置逐项对齐；② 涉及构建产物的改动必须跑「真实构建 + 产物加载」smoke（本 story 沉淀为 `.agent-home/build-smoke/`：forge 等价构建 → grep 产物无 `__require(` → node 加载产物入口），源码启动测试永远覆盖不到打包形态；③ 这是「构建产物包含性盲区」第三次印证（agentRegistry ENOENT → bundle 语义 → require 兜底），每次都是新变体——固定动作是「任何影响 bundle 的变更跑一次真实构建冒烟」。

## 面板保存的数据流：known-gate 会吞掉「面板新增但服务端规则表不认识」的键（BUG-001）

- **现象**：面板添加 path 白名单条目 → 保存成功提示出现但落盘空配置——`buildProjectJson` 的 known-gate（`if (!known.has(key)) continue`）丢弃了 `permission.path.<pattern>`：known = GET rules 的 key 集，服务端 `buildRules` 只产 merged 中已存在的键，新增键不在集内。
- **结论**：前端「按规则表生成 payload」时，**列表/集合类编辑器的键天然不在规则表**（规则表只反映已存在值）——known-gate 必须放行编辑器交互产生的键族（path/external_directory/shellTools 前缀），或直接去掉 gate（payload 只含面板交互产生的键，无任意键注入面）。回归测试要覆盖「面板新增条目 → 保存 → 落盘」的端到端（E2E 064 就是为此补的）。

## 权限配置面板化的两个安全边界实证（裁决 A + 对齐）

- **顶层未知键 → 运行时整集 fail-closed**：gotgenes `unifiedConfigSchema` 是 strictObject——未知顶层键导致整文件判 `{config:{}}` → `invalid:true` → 全规则集 floor ask（含全局 allow）。**保存侧必须拒绝顶层未知键**（400 + 提示），防「保存即全禁」；permission 面内自定义 surface/pattern 是 z.record 合法（运行时安全），保留放行。
- **含点 surface 破坏面板 key 协议**：面板规则 key 以点作结构分隔（`permission.<surface>.<pattern>`），含点 surface（`"custom.surface"`）会被误解析、面板保存损坏配置——协议层拒绝含点 surface（保存 400），pattern 键含点（`bash."rm *"`）不受影响。
- **结论**：给「自由 JSON + 结构化面板」双形态的配置做 UI 时，schema 的宽松面（z.record）与面板协议的结构约束（点分隔）会冲突——协议约束必须在保存侧显式补拦，不能依赖 schema（schema 会放行协议不支持的值）。

## 权限体系的模式化（auto/edit mode）已有现成机制可借鉴（调研，输入下 story）

- gotgenes `authorizerChain` 就是「模型判断 link」的官方扩展点：link 审 `ask` → allow/deny/defer，bounded-delegation 内建（link 对 external_directory/path 的 allow 降级 defer——模型永不能超策略）；官方 `@gotgenes/pi-permission-model-judge` 是 deny-first 参考实现（只 deny 笔误、永不放行、fail-safe by construction）。
- yoloMode = gotgenes 原生的「ask→allow 全局重写」（最粗粒度 auto）。
- 结论：做 auto mode 不需要改 gotgenes——注册 authorizerChain link 即可；deny-first + 熔断（连续 3 拒暂停）+ 短路（不匹配不调模型）是可借鉴的安全设计。详见 research/pi-auto-mode-authorizer-chain.md。

---

来源：2026-08-11-pi-agent-modes /reflect（2026-08-12）

## 模型判断权限（auto mode）的正确姿势：authorizerChain link + deny-first，不是改引擎

- gotgenes authorizerChain 是「模型判断 link」的官方扩展点：link 审 ask → allow/deny/defer，**envelope 系统级强制**（delegation-envelope.ts：模型对 external_directory/path 的 allow 一律降级 defer——放行必人工，deny 有效）。「模型不自动放行项目外」不是自觉约定是系统强制。
- 实现 auto mode 零 gotgenes 改动：注册 link + 链序 `["auto-judge", "opc-bridge"]`；deny 短路确认卡（authorizer-chain.ts 实证），defer 落回既有 opc-bridge 卡。
- **动态链不可行 → 模式门控**：gotgenes authorizerChain 是配置数组整体替换且 configStore 私有闭包无运行时变更 API——改配置违反「模式不改 .pi」契约。正确做法：worker 侧模式门控（非 auto 档 auto-judge 立即 defer 零副作用——不调 decide/不写日志/不动计数），净效果 = 标准/严格档链现状、auto 档加 link。
- **安全设计三件套（可复用）**：deny-first（模型只 deny 明确危险、永不主动放行 excluded 面）+ 熔断（连续 deny N 次降级回 standard，Claude Code 3/20 阈值参考）+ 判断不了 defer 弹卡（fail-safe by construction）+ review log 可观测（静默全 defer 可查）。

## 测试注入缝：可编程 decide 替代真实模型调用

- auto-judge link 的 `decide` 注入缝（构造函数注入）让测试用可编程判定（allow/deny/defer/throw）驱动全路径——真实模型调用在测试中不可行（网络/凭据/不确定性）。
- 配套：envelope 强制语义用「jiti 加载 gotgenes 源码直接验证」（encloseInDelegationEnvelope 实证测试），不依赖我们的实现——验证系统级行为而非自觉。
- FAUX 注入口（OPC_FAUX_JUDGE_RESULT）对齐既有 OPC_FAUX_TOOL_SEQUENCE 模式。

## agentService.stop() 必须等待子进程退出（hydration flake 根治）

- **现象**：hydrationWindow.test.js ~50% flake——旧 worker 退出前触碰 JSONL → 测试 utimesSync 设的旧 mtime 被改写回 now；或 afterEach ENOTEMPTY（句柄未释放）。
- **根因**：agentService.stop() fire-and-forget——SIGTERM 后立即返回，不等待子进程退出。测试 stop 后马上 utimes/清理 → 与仍在退出的 worker 竞态。
- **修复**：stop() 捕获 child 引用 + 'exit' 事件 + 超时兜底（5s 未退 → SIGKILL + 1s 宽限）；无存活子进程同步 resolve。实测 hydrationWindow 从 ~50% 红 → 4 连绿，全量 740/740。
- **结论**：任何「监督方 stop 被监督子进程」的结构，stop 必须等待退出（超时兜底防挂起）；「stop 返回 = 进程已停」是测试稳定性的前提假设。

## 无会话操作的 UI 语义：不能静默丢弃，要落盘全局默认（BUG-001）

- **现象**：无会话时切严格模式 → 发送对话 → 模式跳回 auto。根因：handleModeChange 在 selectedKey=null 时 `if (!key) return` 静默丢弃（UI 乐观显示但服务端未收到 PUT）；发送首条消息 createSession → 切会话 effect 复位 + GET 取位（= 旧 lastMode）→ 回 auto。
- **结论**：会话级 UI 状态在「无会话」时的操作必须显式定义语义——降级为全局默认（无会话时切模式 = 改 lastMode）比静默丢弃 + 禁用都自洽；「UI 显示 ≠ 服务端状态」的窗口（乐观更新未落盘）会以任何后续数据流（取位/切换）暴露。

## 背景层级一致性：容器化底部输入区（BUG-002）

- **现象**：composer 有 surface 白块背景、toolbar 无背景透页面底（#ffffff vs #f7f8f7）→ 视觉色带，用户感知「工具栏有背景色」。
- **结论**：同一视觉区块（底部输入区）内元素必须共享同一背景容器——把 Composer + 附属工具栏包进统一容器（surface + 顶边框），视觉一体（Codex 式）。「无独立背景」的组件放在有背景的兄弟旁 = 色带。

## 重复信息标识清理（BUG-003）

- 同一信息（spaceName）在两处显示（header 徽标 + composer chip）——保留权威位置（header），删除冗余（chips 行 + 死数据 spaceName prop 链）。删 UI 元素必须同步清理 props/调用方/样式（checklists 既有教训再印证）。

## 域集合放出时，散落枚举表必然分叉（BUG-001，2026-08-14）

- **现象**：v0.6 放出 37 个 apiKey provider——保存校验（isApiKeyProvider）、catalog 端点、模型列表兜底三处都跟进，唯独 test-connection 的 `AGENT_PROVIDER_ENDPOINTS` 硬编码表漏改 → 34 个新 provider 全部误报「请选择供应商」。
- **结论**：放出/收缩一个域集合（provider、权限面、工具集）时，先 grep 该域的**全部枚举点**（硬编码表、白名单、switch、路由校验）列清单逐一核对——"以为只有一处"是常态错觉。长期解法：单一真源派生（providerProbe 同源 test-connection 与 fetchModels，ADR-027），消灭枚举表。

## 跨供应商端点假设必须逐个实证；假 key 探测法（BUG-002，2026-08-14）

- **现象**：「baseUrl+/models+Bearer 通吃」假设未实证即落 REQ 并实现，被 anthropic 族推翻（/models→404 端点不存在，/v1/models→401 端点存在）——一轮返工。
- **结论**：外部 API 形态假设在 /research 或 /tech-design 阶段就该实证，不许带未验证假设进 BUILD。**假 key 探测法**零成本区分端点存在性：401/403 = 端点存在（鉴权层拒绝假 key），404/405 = 端点不存在；响应 body 的 error type（resource_not_found vs invalid_authentication）进一步确认。协议族判定看 pi-ai 目录 `model.api` + provider 实现源码（`api: anthropicMessagesApi()` 等）。

## 测试无端挂起（零输出）先查 better-sqlite3 ABI（2026-08-14）

- **现象**：node --test 启动后无任何输出、不退出的挂起——根因是 ABI 翻转（Electron rebuild 后 node 测试打不开 DB，E-DB-UNWRITABLE 在 beforeEach 吞没成挂起形态，而非报错）。
- **结论**：本项目 better-sqlite3 双 ABI（test:unit 前置 rebuild:node、test:e2e 前置 rebuild:electron）是既有设计；**并行 story 交叉跑两套测试时 ABI 必被翻转**。症状从"报错"变"挂起"也要第一时间 `npm run rebuild:node` / `rebuild:electron` 对齐再诊断。

## 展示格式化纯函数别住 JSX（BUG-003，2026-08-14）

- **现象**：StatusBar 的 contextText/meterWidth 住在 .jsx 里——node 测试无法 import JSX，百分比全精度直拼的缺陷长期无单元 seam 拦截（E2E 只断言可见性，数值格式无覆盖）。
- **结论**：展示格式化函数（token/耗时/百分比/文案拼接）一律放纯 JS 模块（format.js 先例），JSX 只做绑定。数值格式（小数位/单位/千分位）是签核对象——UX 参照里的示例值（6%）要被显式签认为格式契约，否则实现自由发挥。

## 已批准的 UX HTML 参照也会错：忠实复刻把原型缺陷带进产品（BUG-008/009，2026-08-16）

- **现象**：两例同构——① .switch 无 display 声明（span inline 塌缩成 2px 竖条，E2E 实测）；② 弹层 absolute 贴单元格向下展开，单行/末行整体被祖先 `overflow:hidden` 裁剪。两处实现都「忠实复刻」了已定稿 HTML 原型的缺陷（静态原型从未触发该形态：多行布局不暴露末行出界）。
- **结论**：已批准 UX HTML 是结构/行为契约的权威，但**不是布局无缺的保证**——塌缩/裁剪/对比度类缺陷一经运行时发现，走 /bug（req-gap 就地补全 HTML + 重生成 preview），不在代码层私修。E2E 可见性断言要认清盲区：`toBeVisible` 不查祖先裁剪，真实命中用 `elementFromPoint` 锚定（BUG-009 seam）。

## 「UI 显示 ≠ 服务端状态」第四形态：无参聚合读 seam 拿全局态冒充行级态（BUG-012，2026-08-16）

- **现象**：MCP 弹层显示「1 个项目 ▸」+ switch on 全是假态——buildProjectMaps 调**无参** listMcpServers() 拿全局开关当项目启用态；用户点击实为反转写 enabled:false，真实启用行永不落库 → 下游 effectiveConfig 恒空（活库实证 0 行）。画面看起来「已启用」，桥里一个 server 都没有。
- **结论**：行级布尔态（per-project/per-row）的读 seam 必须带行标识参数；无参读全局态冒充行级态是「UI 显示 ≠ 服务端状态」最隐蔽的变体（前例：无会话操作静默丢弃）。验证闭环三步缺一不可：点开关 → 真实落库 → 刷新回读；初始态截图不算证据。

## 中断流式生成：在事件链最高层合成收尾事件（BUG-010，2026-08-16）

- **现象**：SDK abort() 掐断 text_end → UI streaming 永不复位、prompt-result 丢 reply。
- **结论**：流式事件链的收尾事件若可被外部中断掐断，在事件链**最高层**（worker 转发处）按 stopReason 合成补齐——修在每个消费者是 N 处修，修在源头是一处。另：停止/心跳/确认回执类操作走带外通道（ping/confirm-ack/stop-session 先例），进串行队列排在长 prompt 后 = 停止永失效。

## 「刷新持久」断言必须真实 reload：SPA hash 重导航不卸载组件（BUG-014，2026-08-16）

- **现象**：`goToAdminRoute` = `page.goto(base + hash)`，同 URL 时 fragment 变化是 no-op，组件不卸载——原「刷新后规则仍在」断言形同虚设（状态本就在内存）；叠加以「无 seed 持久化实体」，持久化断言完全空转。
- **结论**：持久化断言三要素齐全才算数：① seed 真实持久化实体（走 PUT/落库路径）；② `page.reload()` 真实刷新（不是 hash 重导航）；③ 刷新后重新走进入路径再断言。

## 默认层 × 覆盖层数据模型 pattern（BUG-014，2026-08-16）

- **现象**：权限体系只有「出厂静态全局（只读）+ 项目文件覆盖（可写）」两层，用户级「可写默认」无处安放 → 用户只能到项目页手填 server:tool glob（看不到已绑 server/工具）。
- **结论**：可复用三层模型——出厂静态层（包内 JSON 只读）→ 用户默认层（DB 表可写，新会话生效）→ 项目覆盖层（项目文件）。两个合并点各有纪律：视图层合并做空层**同引用 no-op**（保 deepEqual 契约）；部署层合并保通配符 `"*"` 首位 + last-match-wins 键序（delete-then-set），DB 失败回退静态拷贝不阻断会话。录入形态：手填 glob 降为高级入口，主录入 = 实体下拉 → 探测下拉（probe 拉真实工具清单，即连即断）。

## IA 锚点演进走 req-gap 就地补全链，不退 phase（BUG-013/014/015 三连，2026-08-16）

- **现象**：门 1 签核的页面锚点（插件页承载 MCP、#/workspace 权限区块）在 BUG 循环中连续三次被推翻——初衷与数据模型未变，只是信息架构调整。
- **结论**：IA/入口锚点演进 ≠ 回流（初衷未推翻）。固定动作链：REQ 注记（锚点废止声明）+ hash 重算 → UX 原型同步改 + preview 重生成 → E2E 重锚新路径（断言语义不变）+ 旧入口缺失回归 → 实现。三连复用同一链路，成本递减。

## 时序契约的保留依据必须在实现前用消费方证据证伪/证实（2026-08-17，execution-runner v2）

- **现象**：250ms queued 观察窗的保留依据是「API 契约可能被 UI 依赖」——v2 深潜发现 renderer 零 queued 消费（UI 泛化渲染 status），「可能依赖」证伪；且串行队列下睡眠占队头槽位，N×250ms 累加进墙钟（「总墙钟不变」不成立）。
- **结论**：涉及生产路径时序成本（睡眠/延迟/轮询）的契约，保留依据必须是**消费方证据**（grep renderer 消费点、事件订阅者清单），不是「可能有依赖」的推测。review 收益项字面落实前先证伪保留依据。
- **顺带模式**：时序敏感断言的可观察性——睡眠撤除后，用「闸门 executor 队头占用」制造确定性排队窗口，替代时间窗等待（零睡眠可观察性，见 STANDARDS）。

## 测试 seam 契约应与生产契约同源（2026-08-17，execution-runner slice 3）

- **现象**：注入的 fake executor 经 `context.prompt` 读 prompt，而生产 claudeAgentAdapter 读 `node.config.prompt`——实现方为迁就测试在 runner 装配 seam 加了 context 并入归一化，PRD 对齐审查后撤除。
- **结论**：测试注入 seam 的参数契约 = 生产 adapter 的调用契约（fake 与真实实现读同一字段）。为测试加归一化层 = 测试面与生产面分叉，是隐式耦合。

## executionQueue.destroy() 的 length 洞（预存缺陷，2026-08-17 记录）

- **现象**：对已清空的 project 数组执行 `q.length = 1` 会在数组中留洞，`pendingCount()` 永久计 1 → drain 有界等待空转满 5s（旧 taskService 路径同受害，executionLog.test.js 全文件 11.3s 即此因）。
- **处置**：runner.reset() 以 `pendingCount() > 0` 守卫跳过空队列 destroy（语义等价）；destroy 本体修复留待后续 bug。

## 模块图无环的强制手段（2026-08-17，execution-runner slice 2）

- **现象**：skip 反应（markScheduleInvalid）原设计在 runner.submit 内 → runner↔taskService 成环；cron 校验在 taskService → taskService→schedulerService 成环。
- **处置**：skip 反应归唯一带 scheduleId 的调用方（schedulerService 触发路径）；cron 校验移路由。**结论**：跨模块依赖成环时，把「专属反应」归到唯一调用方，而不是在共享模块里加 import。

## fail-fast 必须先于副作用，否则它比没有更糟（2026-08-18，session-domain BUG-001）

- **现象**：slice-3 新增 `sseRegistryOf(context)` fail-fast（§10.4 契约：未接线 → 抛错）。
  落点错了两处：`handleGetEvents` 先 writeHead/flushHeaders 再取 registry → SSE 头已提交
  后抛 = 连接挂死（无 body 无 end）；`handlePostMessage` 先 createSession 再取 → 建句柄后
  500 = 孤儿会话 + 挂起订阅永不挂接。守卫还只查 `typeof getter === "function"`，而 server.js
  袋的 getter 恒存在（工厂未赋值时返回 undefined）→ 放行 undefined 到调用方抛裸 TypeError，
  fail-fast 的干净诊断被架空。
- **根因**：fail-fast 设计时只写了"未接线要报错"，没规定**报错时机必须早于任何副作用**
  （写响应头 / 建句柄 / 起进程）。
- **结论**：带 fail-fast 的守卫，调用点必须前置于该函数触碰的一切副作用；守卫要校验
  **返回值形状**（typeof getter === "function" 不等于 getter() 返回了对象）。三处同根：
  头已提交后抛 / 建句柄后抛 / 守卫放行 undefined——review 一次抓全，修起来都是"前置一行"。

## 清理权威必须 try/finally，不能依赖循环自然完成（2026-08-18，session-domain BUG-002）

- **现象**：`attachPending` 的 `for (const sub of subs) sub.attach(session)` 无保护——
  任一 sub.attach 抛错（陈旧/畸形句柄）→ 循环中断、`pendingSseSubs.delete` 永不执行、
  其余 sub 永久滞留挂起集。该路径是 attach-or-pend 塌缩后新暴露（旧代码只 attach 新 sub，
  异常被隔离在单连接）。
- **结论**：任何"逐个处理 + 最后统一清理"的循环，清理必须放 finally（且失败隔离到单元素，
  不阻断其余）。"attach 不增删集合 → 直接迭代"的注释假设了不抛错，恰恰是假设出问题的地方。

## 行数预算会吃防御性注释：行为保持 story 加修复也要算注释成本（2026-08-18，session-domain）

- **现象**：REQ-117 AC5 行数 ≤650（目标 ~600），slice-3 落成 644（16 行余量）。/code-review
  的 bug 修复加了三处 fail-fast 前置注释，644→650，**零余量**。后续路由再增一行就破 AC5。
- **结论**：带行数上限约束的文件，任何增量（含修复注释）都吃预算；修复时先压自己的注释
  到最小必要，别把余量当常态。650 贴着上限 = 下一次改动必然触发重新权衡（瘦身 or 重定阈值）。

## 直接跑 node --test 会绕过 rebuild:node，原生绑定 ABI 错位（2026-08-18，环境坑）

- **现象**：better-sqlite3 绑定被更高 Node（ABI 148）编译过，直接 `node --import ... --test`
  报 E-DB-UNWRITABLE（新 Database 抛错被 wrapDbUnwritableError 误标）。`npm run test:unit`
  因先跑 `rebuild:node` 而正常。
- **结论**：本仓库单测的正规入口是 `npm run test:unit`（含 rebuild）。绕过它直接 node --test
  前先 `npm run rebuild:node`；遇到诡异的 E-DB-UNWRITABLE 先怀疑绑定 ABI，不是测试/DB 配置。

## 独立 review 视角能抓到"测试全绿 + ALIGNED"漏掉的实现细节缺陷（2026-08-18，session-domain）

- **现象**：三切片全绿（960/960）+ PRD 对齐子代理 ALIGNED + refactor 轮通过后，
  /code-review（换模型重跑）仍抓到 4 缺陷（2 根因：fail-fast 落点 3 项 + attachPending
  清理 1 项），全部在本次新写代码里，且都是"非生产路径但契约要兑现"的潜伏缺陷。
- **结论**：字节级搬运的"行为保持"验证 + PRD 意图对齐，覆盖不了"新缝的守卫代码自身质量"。
  行为保持 story 收尾前仍值得一次独立 code review；缺陷集中在守卫/错误路径/清理路径。

## 签核全 RED 盲区：test-author 笔误要等实现后才暴露（2026-08-18，turn-event-pipeline）

- **现象**：同一 story 两处 test-author 笔误（REQ-109 AC3 出站计数 3→2、resetDropQueue
  ready 监听挂在 `await svc.start()` 之后）在门 1 签核时**零执行全 RED**（seam 未就绪
  import 即失败），笔误直到 BUILD 实现后跑测试才暴露——每次都触发一次 test-gap
  分类 + 修正轮。
- **结论**：签核时测试从未运行过 = 断言笔误零拦截。缓解手段：① test-author 阶段对
  纯逻辑断言做静态自检——同文件交叉验证（AC3 的计数与同文件 AC2/AC4 的计数自相
  矛盾即可当场发现）；② 依赖既有 seam 的测试（如 ready 监听）对照同 seam 先例
  （workerWiring 在 start 前挂监听）逐行比对。

## 跨模块契约升级给人之前，先实证触发场景可达性（2026-08-18，turn-event-pipeline B1）

- **现象**：test-author 基于「sessionQueues delete 后 promise 链仍跑 → 主进程 pending
  永久悬挂」的错误模型，把 E-AGENT-RESET 回执契约升级给人拍板；/review 实证 worker
  IPC 是全局串行队列（prompt 与 reset-session 同队列按序 await）——「排队中被丢弃的
  prompt」场景根本不存在，契约作废重裁。
- **结论**：跨模块行为契约的升级点（expected 推导不出、需要新错误码/回执），升级前
  必须走查调用链的**队列/串行语义**（谁 await 谁、消息是否带外）实证「触发场景可
  达」。人拍板前的事实基础错了，拍板结果必然返工。review 的价值在于把这类错误模型
  拦在实现前——建议 complex story 在 signoff 与 BUILD 之间插入设计链 review。

## 截断契约必须按「序列化后长度」收紧，不能只按原始长度 slice（2026-08-18，BUG-001）

- **现象**：limitSize 文本载体 `slice(0, MAX-256)` 对转义密集文本不保证 ≤ 262144——
  20 万引号经 JSON.stringify 双倍转义后 ≈400KB 超限；工具载体分支早有迭代收紧
  （while 二分），文本分支缺失（同型洞，两份旧实现都在）。
- **结论**：任何「出站 JSON 恒 ≤ N」的截断契约，收紧判定必须用
  `JSON.stringify({...out, [carrier]: text}).length` 迭代（文本/工具载体同型），
  原始长度 slice 只做首轮粗截。截断逻辑单源化（ADR-029）让此类洞只修一处。

## 并行 story 禁止 git add -A（2026-08-18，turn-event-pipeline）

- **现象**：本 story 的 signoff v4 commit 在提交瞬间被并行 story 的 `git add -A` +
  [build] commit 扫走（暂存区共享），签核记录混入他 story 的 commit（内容完整、归属
  不干净）。
- **结论**：多 story 并行开发同一仓库时，一律按路径精确 `git add <file>`；`git add -A`
  会把他人已暂存/新建的文件卷进自己的 commit。commit-msg 钩子在此场景还会误报
  （[test] 标签撞上他 story 暂存的 src/ 文件）。

## 测试 seam 的 once 事件语义：await start() 已消费 ready（2026-08-18，turn-event-pipeline）

- **现象**：`agentService.start()` 内部 `emitter.once("ready")` 等待首个 ready；测试
  在 `await svc.start()` 之后才挂 `svc.on("ready")` → 事件永不二次到达 → waitUntil
  恒超时（v2 重写笔误，基线即红）。
- **结论**：对「启动即消费一次」的 emitter 事件，测试监听必须在触发动作之前挂；
  同类 seam 先例（workerWiring 在 start 前挂）可作为对照模板。

## 长 job 的前端硬超时是假失败源：要么无超时+进度，要么区分"仍在跑"与"失败"（2026-08-18，skill-update BUG-001）

- **现象**：git 安装技能，`waitForJob` 硬编码 30s 超时。大仓库 clone 真实耗时 >30s → 前端报
  "Timed out"（用户以为失败），后端 job 其实继续并在稍后完成。复现：service 层 3s 成功；
  根因在渲染端 30s 常量，不在后端。
- **根因**：对"后台会继续跑完"的 job 设硬超时，把"慢"误判成"失败"。超时只是前端观察窗，
  后端 `settleJobWhen` 不管前端是否放弃。
- **结论**：作业型接口（install/update/执行）的轮询**默认无超时**（`timeoutMs=0` 轮询至真实
  终态），靠**进度可见**（流式 log）让用户判断死活；真卡死由用户手动关闭兜底。若保留超时，
  超时必须区分「仍在跑（返回 pending 态）」与「失败（error 态）」，不得用失败文案表达超时。

## 作业进度 log 必须流式：execFile 缓冲到完成，spawn + --progress 才逐块（2026-08-18，skill-update BUG-001）

- **现象**：安装进度不可见。`execFileAsync`（promisify(execFile)）把 stdout/stderr 缓冲到
  子进程退出才返回——运行中拿不到任何输出。
- **结论**：要实时进度，用 `child_process.spawn` + `stdout/stderr.on("data")` 逐块追加到
  job.log（运行中 getJob 即可见）；git clone 需加 `--progress` 强制进度行上管道（否则
  非 TTY 时 git 抑制进度）。execFile 适合"只要结果"的短命令，spawn 适合"要过程"的长作业。

## E2E 的 git ff-only 失败 fixture：必须脏「上游提交会修改」的文件（2026-08-18，skill-update 测试作者陷阱）

- **现象**：E2E 让 ff-only 失败，fixture 写错——上游 v2 提交**新增** `review2` 技能，测试去
  脏克隆里的 `review2/SKILL.md`：克隆是 v1（无此文件）→ ENOENT；即便文件在，ff-only 对新
  增文件不失败（本地没改它）。正确做法：v2 **修改**克隆里已存在的 `review/SKILL.md`，再脏
  同一文件 → git 报 "Your local changes would be overwritten"，确定性失败。
- **结论**：git ff-only 拒绝的触发条件是「本地脏的文件恰好被上游提交修改」。fixture 里脏的
  文件必须与上游提交改的是同一个；skillLibrary.test.js 已有正确先例，复制先例而非另造。

## 已签 story 内的 req-gap 就地补全：加 REQ + 重哈希 + 补测试，不必重开门（2026-08-18，skill-update BUG-001）

- **现象**：QA 期用户报 bug，修复方向（无超时+进度）不在已签 REQ 范围。按 req-gap 默认收敛
  路径：requirements 追加 REQ-SKILL-023（AC1-AC3）→ 重算 hash（65dfabfb）→ PRD §4/§6.3/
  §10.4/D5 同步 → 回归测试红→绿 → QA 重跑。全程 phase BUG→QA，无归档重做、无新 story。
- **结论**：req-gap 就地补全在「意图缺口」场景比新建 story 轻得多；关键是**规格改动必须落
  commit**（本 story 曾因 AC4 修订未提交致哈希机制失联，见下）。

## 规格修订不落 commit 会断哈希机制（2026-08-18，skill-update PRD 对齐发现）

- **现象**：test-author 期改 AC4 语义 + 重算 requirements-v1.hash，但只 commit 了测试文件——
  HEAD 契约文本（旧 AC4）与测试盖的哈希、实现三方冲突，REQ-VERSION 对不上任何已提交版本。
- **结论**：改 requirements.md 后必须同 commit 落 `requirements-v1.hash`（[docs]）；否则测试
  的 REQ-VERSION 与 HEAD 契约失联，signoff/实现/测试三方各指一方。

## 单槽病会藏在"自愈机制"里：清理连接防御时逐个追问"per-path 后还需要吗"（2026-08-19，db-per-path BUG-001）

- **现象**：db.js 从单槽改 per-path 后，Slice 2 调用点清理把 notificationService 的
  模块级持句柄 + 自愈（`getDbRef` 检查 `!db || !db.open` + `isDbClosedError`）判为
  "closeDb 测试隔离必需"而 KEEP。QA 期 BUG-001 发现：自愈机制**本身就是单槽时代防御**
  （检测"句柄被别的路径切换关掉"并重开），per-path 后全库唯一残留单槽病的站点。
- **结论**：清理"连接生命周期防御"时，凡是**检测句柄失效/自愈重开/错误重试**的机制，
  都要逐个追问"per-path 后还需要吗"——这些机制存在的唯一理由是单槽互斥驱逐，per-path
  消除了驱逐，机制就变成死代码。Slice 2 的 KEEP 理由（"closeDb 仍关全部，自愈必需"）错在
  把"测试隔离的 closeDb"当成生产路径的真实驱逐；生产路径下句柄不再被意外关闭。

## 透明替换重构的成功标准：签名不变 + 调用点零破坏 + 全量绿（2026-08-18，db-per-path）

- **现象**：db.js 单槽 → per-path Map，`getDb(path)` 签名一字未动，55 处调用点零改动，
  6 个 seam RED 测试转绿，全量 999→1010 零回归。
- **结论**：改"一个模块的内部数据结构"（连接生命周期）这类重构，透明替换是低风险路径：
  内部 Map 替换单槽变量、语义只增不减（closeDb 关全部是超集、句柄可缓存是增强），
  外部契约（签名/错误码/调用方式）不变。收益直接进调用点（不再需要防御），但清理要克制
  （逐个甄别，别一把梭 55 处）。

## 签核测试可以锚定契约强化，但要显式文档化（2026-08-18，db-per-path resetDb）

- **现象**：REQ-015 AC5 用例建自定义表 `t` 断言 resetDb drop 它——而固定 DROP 列表（19 表）
  不含 `t`。实现用 sqlite_master 动态清遗留表满足（resetDb 语义 = 该路径 full reset），
  语义从"固定列表"强化为"全清"。授权来自**已签核的测试**而非 PRD 字面"不变"。
- **结论**：当签核测试断言了字面 PRD 之外的行为，实现可用测试锚定的语义强化满足，但必须
  在 signoff/build-progress **显式声明**（本 story 记录在 signoff「实现期语义声明」），否则
  后续会把固定表清单误当 resetDb 契约，或把强化误判为越权改动。

## 严禁生产路径静默 Mock：缺少依赖应 Fail-Fast，不可伪造假成功（2026-08-19，shallow-residue S1）

- **现象**：`src/flowEngine/agentAdapter.js` 固定返回 mock success；未配置 provider 的 agent 节点
  在 `agentExecutor.js` 中静默走 mock 假成功，导致缺少配置的 flow 在生产/非 mock 运行中假装成功，
  掩盖真实错误。
- **根因**：历史原型阶段为了离线通过测试而在生产分派路径留下了静默 fallback。
- **结论**：**生产路径严禁存在无显式开关的静默 Mock**。缺少依赖（如 provider 未填）必须立即
  Fail-Fast 报错（`E-AGENT-NO-PROVIDER`），测试桩/Mock 只能通过测试 Seam（如
  `executionRunner.setAgentExecutorForTests`）显式注入，保证生产与测试语义严格一致。

## HTTP Responder 统一与错误上下文透传：契约收敛不是简单粗暴抹平（2026-08-19，shallow-residue S2）

- **现象**：5 个路由各自复制内联 `ok/badRequest/mapError/notFound`，且默认状态码有 400 与 500
  的方言偏差。统一收敛到 `src/http/responders.js` 时，除基础 `{ error, message }` 外，必须同时
  保留 `invalidAgents`、`issues`、`existing` 等特定业务错误字段的透传。
- **结论**：统一基础脚手架（如 HTTP Responders）时，收敛的是**方言碎片与重复代码**，不是粗暴抹平
  下游依赖的业务协议。`mapError` 的收敛预期是统一默认状态码为 400（业务校验），但对已存在的
  结构化透传字段（如 409 冲突的 `existing.slug`、校验问题的 `issues`）必须完整保留向后兼容。

## Deletion Test 与模块职责归位：无用代码彻底删除，错位逻辑归入所属领域（2026-08-19，shallow-residue S3/S4）

- **现象**：服务端 `flowService.js` 中残留了 6 个无任何调用的前端 UI 画布计算与缩放函数（`toggleRun`,
  `zoomIn`, `zoomOut`, `resetZoom`, `getNodeCategories`, `getEditableFields`）；而 `getCronDescription`
  被误放在 `taskService.js` 中。
- **结论**：过 Deletion Test 的无用代码果断删除（无活跃引用直接清空）；错位的领域逻辑（Cron 描述属于
  `schedulerService`）迁入正确所属模块，原模块仅保留单行兼容转发平滑过渡。

## Scope Discipline：严格区分服务端 HTTP 响应收敛与客户端 CLI Helper 复用（2026-08-19，shallow-residue review）

- **现象**：扫描热点清单时包含 `src/cli/commands/{mcp,plugin}.js`，其中 `plugin.js` 从 `./mcp.js`
  导入 `usageError/handleResponse/setProjectEnabled`。
- **结论**：服务端 HTTP Responders 收敛（`src/http/responders.js`）解决的是 API 路由层的方言与反向依赖；
  CLI 客户端助手共享属于 CLI 层的命令组装逻辑。重构必须守住 REQ 契约范围边界，避免“顺手做无关改动”
  导致范围蔓延。

