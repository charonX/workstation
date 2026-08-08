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
