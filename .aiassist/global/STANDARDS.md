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

## HTTP 响应与错误映射标准（2026-08-19，2026-08-16-deepen-shallow-residue-sweep /reflect）

- 所有 HTTP 路由模块（`src/http/routes/*.js`）**严禁各自内联定义** `ok`/`badRequest`/`mapError`/`notFound` 等响应助手。
- 统一从 `src/http/responders.js` 导入使用标准 helper（`ok`, `noContent`, `badRequest`, `notFound`, `mapError`, `decodeParam`, `normalizeBool`）。
- 业务错误映射统一走 `mapError(res, err, defaultStatus = 400)`；错误状态码优先取 `err.status`，业务错误体为 `{ error: err.code || ..., message }`，`invalidAgents`、`issues`、`existing` 等结构化上下文自动透传。
- 严禁路由间反向导入响应助手（例如 `routes/plugins.js -> routes/mcp.js`）。

## 高频遥测与侧车日志规范（2026-08-24，2026-08-22-tool-call-review /reflect）

- **历史会话投影与执行遥测必须物理隔离**：主会话 JSONL 只允许存储对话语义实体（`user`/`assistant` 最终文本），高频/大载荷遥测（工具入参出参、TTFT/decode 时钟、Token 细分）必须写入同名的 append-only 侧车文件（`*.traj.jsonl`）。
- **侧车写入单向非阻塞与优雅降级**：侧车落盘失败（权限/磁盘满）仅记录 stderr 日志，绝不阻断或导致主 Agent Worker 崩溃。
- **单行载荷上限约束**：轨迹单行记录总大小上限不得超过 256KB，对超大工具输出执行结构化截断（`truncated: true`），防止长文本击穿 IPC 与虚拟滚动。

## 虚拟滚动与长列表手风琴裁剪规范（2026-08-24，2026-08-22-tool-call-review /reflect）

- **DOM 挂载树必须在虚拟滚动之上叠加回合/分组折叠**：长列表不仅要在视口内做行级虚拟滚动（如 `react-window` / `useVirtualizer`），多回合/多分组合并场景必须支持将历史折叠为单行摘要栏（$O(1)$ 节点），折叠子项在数据层直接过滤，绝不进入虚拟滚动的高度计算与测量树中。
- **纯函数状态归约（Model Reducer）必须与 JSX 视图解耦**：时间线投影、区间过滤、回合规整与去重等复杂逻辑必须实现为纯 JS 模块（如 `trajectoryModel.js`），保证在 Node.js 无 DOM 环境中可进行 100% 覆盖的单元测试。

## 本地敏感端点守卫与 CORS 规范（2026-09-03，2026-08-31-file-preview /reflect）

- **本地敏感端点收归 Loopback 守卫**：涉及工程源码、凭据、文件系统操作的本地 HTTP 端点，必须由 `src/http/browserApiGuard.js` 进行本地回环守卫（`isLoopbackOnlyApi` / `denyLoopbackApiIfUnsafe`）。
- **严禁盲目下发全局 CORS `*`**：受保护端点严禁配置 `Access-Control-Allow-Origin: *`，防止恶意外部网页在普通浏览器标签中直接 fetch 窃取用户本地源码或配置。
- **动态反射与无 Origin 保守策略**：仅向经过校验的本地回环 Origin（如 Vite dev 服务器 `http://localhost:5173`）动态反射 ACAO 头；对无 Origin 请求（Node CLI / curl）不输出 ACAO 头。
- **本地跨端口拓扑放行**：Chromium 在处理从 `http://localhost:5173` 到 `http://127.0.0.1:<port>` 的请求时会自动附加 `sec-fetch-site: cross-site`。守卫必须将 `cross-site` 判定与已校验的本地回环 Origin（`LOOPBACK_ORIGIN_RE`）联动，确保桌面端开发与测试正常放行。


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

## fail-fast 必须先于副作用，守卫校验返回值形状（2026-08-18，2026-08-16-deepen-session-domain BUG-001 /reflect）

- **fail-fast 落点前置**：带「未接线 → 抛错」语义的守卫（context 袋注入、工厂取位等），
  调用点必须前置于该函数触碰的一切副作用（写响应头 / 建句柄 / 起子进程 / 发 IPC）。
  头已提交后抛 = 挂死连接；建句柄后抛 = 孤儿资源。fail-fast 的干净诊断只在副作用之前有意义。
- **守卫查返回值形状，不只查 getter 是函数**：`typeof getter === "function"` 不等于
  `getter()` 返回了对象——惰性工厂未赋值时 getter 返回 undefined，只查 typeof 会把
  undefined 放行到调用方抛裸 TypeError，正是 fail-fast 要避免的 cryptic 错误。
  守卫应校验取位结果（对象 / 方法存在），而非调用方本身。

## 清理权威必须 try/finally（2026-08-18，2026-08-16-deepen-session-domain BUG-002 /reflect）

- **逐个处理 + 统一清理的循环，清理必须放 finally**：`for (const x of xs) work(x); map.delete(k);`
  中任一个 work 抛错 → delete 永不执行 → 状态泄漏（挂起集残留、句柄泄漏）。
- **失败隔离到单元素**：单元素处理失败不该阻断其余元素（per-element try/catch），
  让"清理权威"（delete / close / unsubscribe）始终能跑完。
- 判断依据：「直接迭代不增删集合」这类注释假设了处理不抛错——恰恰是假设出问题的地方。

## 事件尺寸截断契约（2026-08-18，2026-08-16-deepen-turn-event-pipeline /reflect）

- 「出站 JSON 恒 ≤ N 字节」的截断契约，收紧判定必须用**序列化后长度**迭代
  （`JSON.stringify({...out, [carrier]: text}).length` 二分收紧），原始长度
  slice 只做首轮粗截——JSON 转义（引号/控制字符 → \uXXXX）可使原始长度
  ≤ 预算的文本序列化后超限（BUG-001 实证：20 万引号 ≈400KB）。
- 文本载体（content/delta）与工具数据载体（input/output）收紧逻辑同型，
  单源实现（ADR-029 截断单真源），修一处即全链生效。

## 长作业 job 无假失败：无硬超时 + 流式进度（2026-08-18，2026-08-18-skill-update-diagnostics BUG-001 /reflect）

- **作业轮询默认无超时**：install/update/执行等「后台会跑完」的 job，`waitForJob` 默认
  `timeoutMs=0` 轮询至真实终态；把「慢」误判成「失败」的前端硬超时是假失败源。保留超时
  时，超时必须区分「仍在跑（pending）」与「失败（error）」，不得用失败文案表达超时。
- **进度必须可见**：长作业（git clone/pull 等）用 `spawn` 流式捕获 stdout/stderr 到
  job.log（`on("data")` 逐块追加，运行中即返回）；git 加 `--progress` 强制进度上管道。
  execFile（缓冲到退出）只适合短命令。
- **真卡死兜底**：无超时的代价是卡死会一直转——靠用户可见进度 + 手动关闭兜底；后端 job
  由既有生命周期管理。

## 权限裁决与四大安全不变量（2026-08-18，2026-08-16-deepen-permission-adjudication /reflect）

- **Per-Instance 领域工厂，消灭模块级全局 Map**：决议 Promise 注册表与状态标记封闭在领域实例闭包内，模块级零全局状态，防止并发测试与多服务实例状态串扰。
- **内存 Promise 注册表即时唤醒，消除轮询**：决议等待通过内存 Promise 即时响应 approve/reject，消除 20ms 定时器轮询与 CPU/延迟开销；决议终态由 `try/finally` 保证 Timer 与 Map 及时清理。
- **唯一执行者结构化锁定（Zero Execute on Approve）**：授权桥挂起行的 `approve` 仅更新持久化状态并向 Worker 发送 `allow` 决策，主进程 100% 跳过命令 `execute`，物理杜绝双重执行。
- **严格降级 Fail-Closed**：未知工具面、异常策略配置或未接线 handler 默认一律判定为 `ask` / `deny`，杜绝任何零确认放行漏洞。
- **单一评估与单一询问**：pre-gate 仅拦截 gotgenes 不可见运算符（重定向/管道），常规命令交 gotgenes 正常评估，同一操作仅生成唯一 `confirmId`，杜绝重复弹卡。
- **strict 语义单点内聚**：strict 全量确认等策略模式在 `PermissionPolicy`（评估器直接产出 ask）与 `PermissionBridge` 内部消化；`server.js` 的 `onPermissionAsk` 等外围胶水仅作单点转发，禁止手写 if-else 重复判定。
- **断言必为有效行为判定**：禁止为形式合规编写无法匹配生产实现的假断言（如伪正则）；所有安全契约必须有真实输入/输出断言（包含挂起单生成与决议放行），配合精确静态代码检查。

## 连接生命周期 per-path 缓存（2026-08-18，2026-08-16-deepen-db-per-path-cache /reflect）

- **共享连接用 per-path Map 缓存**（路径 → 句柄），同路径返回同一句柄、多路径并存互不驱逐；
  禁止"单槽切路径即关旧库"（缓存句柄被意外关闭的正确性陷阱）。
- **closeDb 语义 = 关全部**（+ 可选定向关）：per-path 下"关当前一个"不自洽；"关全部"是
  单连接调用方的安全超集。
- **句柄可缓存**：模块可安全持有 getDb(path) 返回值；"每次操作重新取 + 防御注释"是单槽
  时代遗留，清理时逐个追问"per-path 后还需要吗"（自愈/句柄失效检测机制尤其可疑）。

## 通道发送能力注入与单一在线检查（2026-08-19，2026-08-16-deepen-channel-sender-seam /reflect）

- **执行变量注册表保持纯净**：执行上下文中的 `variables` 仅容纳业务数据与环境变量，禁止注入服务对象（如 `_channelManager`），所有系统/外部服务能力一律走 `services` bag 注入（对齐 ADR-008）。
- **在线状态检查单一属主（Online check lives in one place）**：通道在线状态检查（`getStatus() === "online"`）必须且只在底层通道分发属主（`channelManager.dispatchToAdapter`）中集中执行；禁止在调用方与分发方之间抹平为双边不查，离线/未配置统一抛出标准错误码 `E-CHANNEL-OFFLINE`。
- **测试接缝边界显式包装，零运行时 Duck-Typing**：测试注入接缝（如 `setTestChannelSender`）应接收标准接口签名；向后兼容旧形态输入时，必须在**注入函数边界**处一次性完成形态适配与包装，禁止在运行期热路径中逐次嗅探 `typeof` / `arguments.length`（脆弱且耦合内部方法名）。
- **消灭静默无操作的残留空接缝**：重构废除旧接缝时，应联动清理所有调用方（如 `server.js`）并彻底删除空导出，禁止保留"静默 no-op"公开方法。

## 只读域的结构化表达与维护循环审计（2026-08-22，2026-08-19-feishu-reset-history-archive BUG-001 /reflect）

- **新状态类别的行必须被所有全表扫描的维护循环识别**：引入新持久化状态（如归档行）时，逐个审计水合、驱逐、清理、迁移、统计等无差别扫全表的循环——明确该状态是「跳过」还是「特殊处理」，缺省遍历即隐含变异风险。
- **只读语义用键形谓词结构化表达**：`feishu:*` 只读域在数据层用键形判定（如 `isFeishuArchiveKey`）过滤，不靠调用方约定俗成；写面守护（403 E-SESSION-READONLY）与维护循环跳过共用同一谓词。
- **hash 锁定契约的笔误勘误走版本化修订**：requirements.md 发现文本漂移时挂账到 signoff/review 显式记录并指明偿还节点（下一 /reflect）；偿还时新增 `requirements-v2.hash` 并同步全部测试文件 REQ-VERSION 头，断言内容零变化。

## 判定型谓词首行短路（2026-08-22，2026-08-19-feishu-reset-history-archive R5 /reflect）

- 热路径上的「有没有 X」判定不得复用全量投影函数；从既有逐行迭代器提取单一行级谓词 + 首行短路，O(文件) 降为 O(命中)。
