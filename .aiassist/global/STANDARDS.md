# Project Standards

本文件记录项目约定与标准。

## 设计系统

项目设计系统见根目录 `DESIGN.md` 与 `tokens.css`。

- 所有 UX 原型 HTML 必须引用 `tokens.css`。
- 不允许使用设计 token 之外的颜色或字体。
- 如需新增 token，先更新 `DESIGN.md` 和 `tokens.css`。
- 支持明暗两套主题：HTML 根元素设置 `data-theme="dark"` 或 `data-theme="light"`；未设置时跟随系统偏好。

## 编码规范

- TypeScript / React / Node.js 遵循各自社区默认风格
- 核心逻辑优先写单元测试
- Electron main process / IPC 层写集成测试

## 服务层资源获取（2026-08-01，2026-07-29-multi-agent-skills /reflect）

- 全局单例资源（DB、配置、外部客户端）只由单一模块管理（见 `src/db.js` 的连接单例）。
- 使用方**不要**缓存可能失效的句柄：每次使用前检查活性（better-sqlite3 用 `.open`），失效即经管理者重新获取；错误识别要覆盖真实报错文案，避免自愈逻辑永不触发。
- 模块顶层不得打开连接/读 env/读文件（见 engineering-lessons「ESM 模块顶层不要读 env」）；用惰性初始化。

## 批量接口设计（2026-08-01，BUG-003）

- 已有单条端点需要批量能力时，**扩展现有端点**（数组入参 + 单对象形态向后兼容）而不是新增 /bulk 端点，避免 API 面扩散。
- 批量响应必须逐项结果 + count 汇总（`{results:[{...status,code}], count:{...}}`），单项失败不中断其余；坏输入（空数组/非数组）400，项目级前置校验（如 E7）整体 4xx。

## 展示格式化纯函数模块（2026-08-14，2026-08-12-conversation-toolbar-ext /reflect）

- 展示格式化函数（token/耗时/百分比/文案拼接）一律放纯 JS 模块（如
  `src/renderer/components/assistant/format.js`），**不得住 .jsx**——JSX 只做绑定。
  原因：node 测试无法 import JSX，住 JSX 的格式化逻辑天然无单元 seam。
- UX 参照中的数值示例（如 `6%`、`12.4k / 200k tokens`）在断言签核时须显式确认为
  格式契约（小数位/单位/千分位），否则实现自由发挥。

## 目录结构约定

```
.aiassist/
├── stories/                 # 具体 story
└── global/
    ├── engineering-lessons.md
    ├── architecture.md
    └── STANDARDS.md         # 本文件
```

## 命名约定

- Story ID: kebab-case，如 `codex-harness-desktop`
- REQ ID: `REQ-<AREA>-<NNN>`，如 `REQ-DESIGN-001`
- CSS 变量前缀: `--ch-`

## Flow 节点类型开发约定

- 新增节点类型必须在 `src/renderer/components/flow/nodeRegistry.js` 注册，包括：`type`、`category`、`icon`、`defaultConfig`、`deriveOutputVariables`、`configPanel`、`labelKey`、`palette`。
- 所有节点类型统一使用 `config.outputVariables: [{ name, type?, defaultValue? }]` 声明下游可见变量名。
- 节点特定行为字段（如 `setVariables.expressions`、`callFlow.inputMappings`）与 `outputVariables` 分离：前者描述"怎么算"，后者描述"暴露什么"。
- 不要新增集中式 `switch` 分支来推导变量或渲染配置面板；统一通过 `nodeRegistry[type].deriveOutputVariables(config)` 和注册表中的 `configPanel` 组件处理。
- 节点 executor 返回结果优先使用 `outputVariables` plain object，由引擎统一写入 context 和 nodeRecord。

## Electron 开发约定

- 服务层代码（`src/services/`、`src/http/`、`src/cli/`）运行在 Electron main 进程，修改后必须重启应用或重新运行 `npm run dev`，renderer HMR 不会重载主进程。
- 产生文件系统副作用的功能（如 symlink、目录创建、文件写入）必须在 REQ 中明确验收标准，并在 API/CLI 测试中断言实际路径与状态。
- 删除产生文件系统副作用的实体时，必须同步清理相关文件，避免 dangling symlink / 孤儿目录。

## 测试约定

- 测试即契约（test-as-contract）
- 每个 REQ 至少对应一个可自动化验收测试
- Gate 2（feel-signoff）以高保真 HTML 为参照
- 文件系统副作用需用真实 I/O 断言，不能用纯 DB 状态推断

## 文档约定

- PRD 放在 `.aiassist/stories/<id>/prd.md`
- REQ 放在 `.aiassist/stories/<id>/requirements.md`
- 设计系统更新需同步 `DESIGN.md`、`tokens.css`、`.aiassist/global/STANDARDS.md`、`.aiassist/global/tokens.css`

## 跨进程监督与防御性进程骨架（2026-08-05，2026-08-02-builtin-agent /reflect）

- **看门狗心跳带外**：任何「看门狗 + 被监督进程」结构，ping/pong 不进被监督方工作队列（带外即时回应）；监督方收到被监督方任何消息（含业务事件）即刷新存活时间；杀死条件 = 完全静默超时 + exit。见 ADR-015。
- **日志尽力投递，不得致命**：面向桌面/常驻进程，stdio 写失败（EPIPE 等）不得导致进程崩溃——进程两个入口（Electron main / headless server）首行 import 防御模块（`src/stdioGuard.js`，幂等 'error' 监听吞掉 stdio 错误；处理器内绝不二次记录）。与 ADR-009 惰性初始化并存：仅限无 env/磁盘依赖的纯防御模块可顶层安装。
- **恢复路径能力等价**：有状态服务（会话/连接/订阅）的恢复（水合）路径必须与新建路径注入等价的能力清单（凭证/配置/回调）——恢复后应具备与新建相同的行为能力，测试断言恢复后行为而非仅状态存在。

## 多进程共享服务单一权威启动者（2026-08-10，2026-08-08-pi-agent-ux-enrichment BUG-007）

- 跨进程架构中「共享服务」（HTTP server / DB / 单例连接）只能有一个权威启动者（主进程）；子进程通过注入的连接信息（如 `agentServerBaseUrl`）使用，**不得隐式自起**。
- 测试 seam 若隐式依赖"恰好有服务在跑"，必须在 seam 契约中显式化（注入 baseUrl/连接信息），否则修复共享服务边界时会被 seam 拖住。

## 跨层角色词表约定（2026-08-10，2026-08-08-pi-agent-ux-enrichment BUG-009→010）

- 各层有自己的角色/状态词表：存储层（PI JSONL：`user|assistant|toolResult`）≠ API 投影（`user|assistant`，历史=对话文本）≠ UI 气泡（`data-message-role='user|agent'`）。
- 测试 seed 写入存储层数据时**必须用存储层原生词表**（JSONL 用 `assistant` 而非 UI 的 `agent`）；UI 气泡角色由渲染层从原生 role 映射，断言语义不变。
- 按角色过滤/收紧型修复（如历史投影只放行 user/assistant）必须全量回归所有写同层数据的既有测试（含其他 story 的 seed seam），并在 seam 注释写明词表契约。

## 构建产物 external 契约（2026-08-11，2026-08-10-pi-permission-config-ui BUG-002）

- 主进程/worker bundle 引入**任何新的 CJS 依赖**（jiti、原生模块、内部 webpack 形态的包），必须同步检查对应 vite 配置的 `rollupOptions.external`——同一依赖各 bundle（main/worker/renderer）的 external 配置要逐项对齐（BUG-002：worker 有 jiti external 而 main 没有 → 打包形态启动崩）。
- 涉及构建产物的任何变更（新依赖、配置改动、资源拷贝），跑一次「真实构建 + 产物加载」smoke（本 story 沉淀 `.agent-home/build-smoke/`：forge 等价构建 → grep 产物无 `__require(` → node 加载产物入口）——源码启动测试永远覆盖不到打包形态。

## 模型判断权限的接入姿势（2026-08-12，2026-08-11-pi-agent-modes，ADR-023）

- 需要「模型判断自动批准」类能力时，走既有引擎的官方扩展点（gotgenes authorizerChain link），**不改引擎**；安全边界由引擎系统级强制（envelope：external_directory/path 的模型 allow 降级 defer）承载，不靠自觉。
- 运行时按状态切换扩展点行为（如链 link 参与与否）用**门控**实现（非目标状态立即 defer 零副作用），不动态改配置（改配置违反契约 + 跨状态共享）。
- 模型判断 link 三件套：deny-first（只 deny 明确危险）+ 判断不了 defer 弹卡（fail-safe）+ 熔断（连续拒绝降级）+ review log 可观测。

## 测试注入缝（2026-08-12，2026-08-11-pi-agent-modes）

- 真实模型调用在测试中不可行——用**可编程判定注入缝**（构造函数注入 decide 函数）驱动全路径；验证引擎系统级行为（如 envelope 强制）用「jiti 加载第三方源码直接断言」，不依赖我们的实现。

## 执行生命周期与测试可观察性（2026-08-17，2026-08-16-deepen-execution-runner /reflect）

- **一次执行的生命周期知识单点化**：submit（入队触发唯一入口）/ runOnce（直跑执行器，描述符参数化）/ reset（单一失效机制）三接口收进一个模块（ExecutionRunner，ADR-028）；生产路径禁止在 executeTask/createTask 等外围函数里重新拼装运行选项。
- **失效机制单一**：执行上下文重置只能经 reset（generation+1 + 队列 destroy + 有界等待）；禁止在模块外直接 destroy 队列或自行维护 generation。
- **时序契约用消费方证据**：生产路径的睡眠/延迟/轮询成本（如观察窗）必须能被消费方证据支撑；renderer/订阅者零消费 → 撤除（v2 先例）。
- **零睡眠可观察性**：需要确定性时序的测试用「闸门 executor 队头占用」制造排队窗口，不用时间窗等待；竞态测试用「submit/reset 间不出让微任务」的同步时序触发。
- **测试 seam 契约 = 生产契约**：fake executor / fake adapter 的入参读取与生产实现同源（如 prompt 一律读 node.config.prompt）；禁止为测试 seam 加生产路径没有的归一化。
- **子执行写入归父守卫**：嵌套执行（subflow）的持久化写点纳入父 runOnce 的 generation 快照；reset 中途子写全跳过，子行由启动恢复兜底。子日志写子 execution 行，不冒泡父行。
