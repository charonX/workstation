# 测试模式检查清单

loop-workflow 中测试是契约。本清单用于 `/test-author`、`/tdd` 和 `/review --stage=code` 的 test-engineer 维度。

## 测试分层

- [ ] 小型测试（~80%）：纯逻辑、无 I/O、毫秒级
- [ ] 中型测试（~15%）：跨边界（API、DB、文件系统）、localhost
- [ ] 大型测试（~5%）：关键用户流程、E2E、性能基准

## 每个 REQ 的测试要求

- [ ] 每个 REQ-ID 至少有一个自动化测试
- [ ] 测试文件头部有 `REQ-TRACE`、`REQ-VERSION`、`CAPABILITY-TRACE`、`ENTITY-TRACE`
- [ ] 测试按 `tests/capabilities/<capability>/<entity>/<story-id>/` 组织
- [ ] 关键预期值来自人/真实 JSON/已签标准，而非代码输出
- [ ] 边界/错误 case 已覆盖
- [ ] 无 `// TODO: HUMAN ASSERTION` 占位

## 测试结构

- [ ] 使用 Arrange-Act-Assert
- [ ] 测试名是句子，描述行为：`user can create project with valid name`
- [ ] 一个概念一个测试，不堆叠断言
- [ ] DAMP over DRY：测试可读性优先于避免重复

## 测试替身

按优先级选择：

1. 真实实现（最高置信度）
2. Fake（内存版依赖）
3. Stub（返回固定数据）
4. Mock（验证调用，谨慎使用）

只在边界处 mock：外部 API、数据库、文件系统、邮件发送等。

## 前端测试

- [ ] 组件测试覆盖关键元素存在性
- [ ] 交互状态变化（loading/empty/error/success/disabled）有测试
- [ ] 导航/路由跳转有测试
- [ ] 数据绑定正确渲染有测试
- [ ] 删除/重命名 UI 元素时，同步检查并更新引用它的 E2E 测试与 locators
- [ ] 纯视觉审美判断才留给 REFLECT 人工验收

## Playwright E2E

- [ ] `playwright.config.ts` 已配置 `baseURL`、`retries`、`workers`、`trace`、`screenshot`
- [ ] 测试使用 locator（`getByRole`、`getByTestId`、`getByLabel`）而非裸 CSS selector
- [ ] 文案定位必须限定在目标容器内，避免跨组件匹配（如 `palette.getByText("Execution")`）
- [ ] 每个 E2E 测试只验证一个用户流程/概念
- [ ] 测试数据已隔离（独立用户/fixture/数据库重置）
- [ ] API 调用已用 `page.route` 或真实后端隔离
- [ ] CI 中已安装 Playwright 浏览器二进制
- [ ] 失败时自动生成 trace 和 screenshot 并作为产物上传
- [ ] E2E 数量符合测试金字塔（E2E 占比 ~5%，只覆盖关键路径）

## 桌面应用 / Electron 测试

- [ ] 修改 main 进程代码后，集成测试/E2E 前确认应用已重启，renderer HMR 不代表主进程已更新
- [ ] 文件系统副作用（symlink、目录、文件写入）在 API 测试中断言实际路径与状态
- [ ] 删除实体时同步断言相关文件/链接已被清理
- [ ] main 进程与 renderer 的边界用 Playwright Electron E2E 或 renderer public API 覆盖

## 反模式

| 反模式 | 问题 | 修复 |
|---|---|---|
| 测试实现细节 | 重构后行为未变但测试失败 | 测输入输出 |
| 滥用 snapshot | 没人 review diff | 断言具体值 |
| 共享可变状态 | 测试互相污染 | 每个测试独立 setup/teardown |
| 全 mock | 测试通过但生产崩溃 | 优先真实实现/Fake |
| mock 掉解析/适配层 | SDK/协议变更时漏过真实路径 bug（BUG-006 教训：EventDispatcher.parse() 展开路径从未被端到端测到） | 至少一个测试用 SDK 交付的原始 payload 形态喂入，而不是手动构造"已 parse"数据 |
| 用内部实现细节注入失败 | 修复实现后测试立即失明（AC4 教训：closeDb() 依赖"缓存连接不刷新"，自愈修复后不再失败） | 用真实失败条件注入：磁盘只读（chmod 444）、权限不足、网络断开；实现修复不应连带测试失效 |
| 只从源码路径测试 | 构建产物文件布局缺陷（快照/资源未复制进产物）源码启动测试发现不了（BUG-002 教训） | 涉及产物布局的能力加构件级契约测试：跑真实 build --outDir 临时目录，断言产物含目标文件且与源一致 |
| 批量接口只有全成功用例 | 单项失败/冲突/身份错误时整体行为无契约（BUG-003 教训） | 批量接口回归必测：单项失败不中断其余、逐项结果（results+count）形状、坏输入 400、空声明 409 |
| 新增节点类型只改实现不改注册表 | 变量选择器/面板/校验漏识别（BUG-001 教训：upstreamVariables switch 漏 setVariables） | 新增节点类型统一在 nodeRegistry.js 注册，输出变量推导用 deriveOutputVariables |
| 前置 story 回归测试未随当前行为更新 | 当前 story 改变已有节点/UI 后旧断言失败（BUG-005 教训） | 变更已有节点/UI 时同步搜索并更新所有引用该类型/文案的回归测试 |
| 集中式 switch 推导变量 | 每新增类型要改多处，易遗漏 | 用注册表 + deriveOutputVariables 通用化，新增类型只改一处 |

---

来源：改编自 `reference/agent-skills/references/testing-patterns.md` 与 `references/definition-of-done.md`。

## 反模式（2026-08-02 补充：2026-08-01-macos-distribution）

| 反模式 | 问题 | 修复 |
|---|---|---|
| CLI 子进程测试用相对入口路径 | node 按子进程 cwd 解析入口（execFileSync cwd 参数），临时目录下 MODULE_NOT_FOUND，实现永远无法介入（AC3 教训） | 子进程入口一律 `path.resolve()` 绝对化；签核前推演被测代码的启动方式 |
| 外部工具输出形态靠源码推演 | forge 7 makeDir=out/make/ 前缀漏推，产物定位错误，真实发布 upload 失败 | 构建链/外部工具的产物布局做一次真实实测（跑真实 make + find 产物），把实测结果写进实现注释 |
| dry-run 校验语义不显式定义 | "dry-run 应该全查一遍"的直觉 vs 签核测试约束（跳过递增校验、tag 防重仅 make 失败时）冲突 | REQ/测试逐条列出 dry-run 执行与跳过的校验；实现者推导多约束唯一自洽解并记录 |
| 远程资源创建失败无收尾路径 | create 成功 upload 失败 → 半发布状态（Release 0 资产） | 外部副作用命令设计"半发布状态恢复"路径（如 gh release upload 手工补传）并写入 REQ 失败场景 |

## 反模式（2026-08-05 补充：2026-08-02-builtin-agent）

| 反模式 | 问题 | 修复 |
|---|---|---|
| 用环境依赖的故障复现当回归测试 | stdio EPIPE 在 Node v24 容忍（复现不红）、Electron 主进程崩——同一复现写法换运行时失效 | 机制级断言：手动 `stream.emit("error", EPIPE)` 走同一代码路径 + 子进程对照实验（装防护 vs 不装比 exit code），与运行时版本解耦 |
| bundle 回归用裸构建工具验证 | 裸 `vite build` 产物是浏览器语义，与 forge 打包产物（node conditions + builtins external）不是一个东西，测了等于没测 | 构建入口与生产完全一致（forge ViteConfigGenerator）；断言产物真实行为（spawn 到 ready）而非仅构建成功；临时 outDir 置于 repo 内供 node_modules walk-up |
| 外部 API 只单层 mock 断言 | sendCard 400 修三轮才到真根因：创建接口与发送接口是两层 schema，单层测试定位不到 | 请求构建层（结构/字段，fake）与传输层（端点/包装/响应解析，mock fetch）分 seam；真实 schema 报错先用变体脚本对真实 API 二分定位再修 |
| 测试 seam 绕过清单不显式 | fauxProvider 绕过 key 校验 → 水合不注 key 全绿假象（BUG-005）；开发入口 spawn 源码 → bundle 崩溃全绿假象（BUG-002） | 写 seam 时显式注释「本 seam 绕过了什么环境差异」；绕过清单即真实联调检查清单；跨进程 story 在 QA 做最小真实链路冒烟 |
| 时序类行为用固定快速依赖测试 | faux 秒级流式永不触发 6s 心跳超时，看门狗误杀潜伏（BUG-008） | 时序相关测试留可调速率 seam（如 OPC_AGENT_FAUX_TPS）；用「横跨超时窗口」的慢速用例断言 |
| E2E/单元混跑不管原生模块 ABI | test:unit 把 better-sqlite3 重建为 Node ABI → 紧跟 E2E 报 E-DB-UNWRITABLE（项目创建类挂） | 混跑顺序：`npm run rebuild:electron` → E2E → unit（即 `npm run test:e2e` 惯例）；ABI 冲突失败属环境顺序问题，不误判为产品缺陷 |

## 反模式（2026-08-07 补充：2026-08-02-ui-copilot）

| 反模式 | 问题 | 修复 |
|---|---|---|
| mock 契约断言充当外部 API 契约验证 | 测试按错误假设写（settings 接口断言 PUT，官方实为 PATCH）——5 个回归全绿，真实联调 404：mock 只能证"实现符合假设"，证不了"假设符合外部世界" | 外部 API 契约的每个假设要素（方法/端点/包装/响应解析）在测试注释标注「联调验证点」，QA 逐条核销；首次接入的端点先用 curl 级脚本对真实 API 钉死方法/端点再写测试 |

## 2026-08-08 追加（pi-agent-consolidation REFLECT）

- [ ] 签核断言必须可执行：每条验收标准落真实断言；seam 未就绪用「seam 未就绪即失败」（assert.ok(mod, ...)），禁止 `assert.ok(true)` + 注释占位（实现后失去验证力）
- [ ] 签核浏览器 E2E 前验证行为链可驱动性：FAUX 能力边界（确定性回声不调工具）、seed seam、可编程注入缝——不可驱动腿补 seam 或降级并显式记录
- [ ] agent 主动发起路径（工具调用/确认/恢复）必须有真实链路 E2E：fake IPC / seed 覆盖不到模型循环真实执行（2026-08-08 实证：noTools 工具面失效 + 确认链死锁藏三个 story）
- [ ] 测试 seam 注入模式：node --import 预载脚本注入裸全局引用（测试文件只读不改 import 的合法通道）；E2E 用环境变量驱动 FAUX 工具调用序列（OPC_FAUX_TOOL_SEQUENCE）
- [ ] 黄金文件断言用 try/finally 还原：--check 类测试篡改-验证-还原必须 finally 保证，防污染真源文件（policyCodegen 教训：断言失败导致 golden 停留漂移态）

## 2026-08-10 追加（2026-08-08-pi-agent-ux-enrichment）

| 反模式 | 问题 | 修复 |
|---|---|---|
| seed 用 UI 气泡词表写存储层 | seed seam 把 `role:"agent"`（UI 词表）原样写 JSONL，投影收紧为原生词表（user/assistant）后行被过滤 → 2 E2E 回归红（BUG-010） | seed 必须用存储层原生词表（`assistant`）；UI 气泡角色由渲染层映射；seam 注释写明词表契约 |
| 收紧/过滤型修复不回归其他 story 的 seed | BUG-009 修历史投影（按 role 过滤）只跑了本 story 回归，ui-copilot 的 assistantFeishu 2 例红（潜伏错位由修复暴露） | 按角色/字段过滤的修复，grep 全仓所有写同层数据的 seed/测试并全量 E2E 回归 |
| 测试 seam 隐式依赖"恰好有服务在跑" | worker 上下文 ensureServer 隐式自起 server（headless 遗留），seam 依赖该隐式行为，修复共享服务边界时被拖住（BUG-007） | seam 契约显式化：注入 baseUrl/连接信息，不依赖隐式自起 |
| 跨进程路径基准未显式定义 | read/write 相对路径按进程 cwd 解析，静默错读同名文件 + `..` 逃逸（BUG-005） | 相对路径基准写进 REQ（会话项目目录）；回归含同名文件 + 逃逸两形态 |
| 事件契约缺关联字段靠 UI 猜测 | tool_execution_error 无 toolCallId → 并行工具错误错配块（BUG-006） | 能补字段优先补（事件携带 toolCallId）；不能补则显式关联策略（最近 running 匹配）写进 REQ 标准 |
| 跨进程链路故障盲猜重试 | LLM 空转 5 轮诊断才定位（工具名空格 → provider 400），前 4 轮靠猜 | 先补链路诊断日志（每段转发留痕、失败显式化）让现场一次分叉，再修 |
| 系统恢复路径被当作用户活动 | 水合 session-config 无 source 标记 → 同组冷却误淘汰（BUG-003） | 系统自动动作带显式来源标记（source:hydration），生命周期规则只对用户活动生效 |

## 2026-08-11 追加（2026-08-10-pi-permission-config-ui）

| 反模式 | 问题 | 修复 |
|---|---|---|
| 主进程 bundle 引入新 CJS 依赖不查 external | jiti 被内联进 ESM 主 bundle（`__require("node:os")`）→ 打包形态启动崩，E2E 全绿（源码启动不加载产物）（BUG-002） | 新 CJS 依赖必须同步检查 vite.main/worker external（与 worker 逐项对齐）；涉及 bundle 的变更跑「真实构建 + 产物加载」smoke（`.agent-home/build-smoke/`） |
| 面板保存按规则表 known-gate 过滤新增键 | path 列表新增条目被 known-gate 丢弃 → 保存落盘空配置（BUG-001） | 列表/集合编辑器产生的键族（path/external_directory/shellTools 前缀）放行 known-gate；E2E 覆盖「面板新增 → 保存 → 落盘」端到端 |
| 自由 JSON + 结构化面板双形态配置不补协议约束 | schema 宽松面（z.record）放行面板协议不支持的值（顶层未知键 → 运行时整集 fail-closed；含点 surface → 面板误解析损坏配置） | 协议约束在保存侧显式补拦（顶层未知键 400 / 含点 surface 400），不依赖 schema（schema 会放行协议不支持的值） |

## 2026-08-12 追加（2026-08-11-pi-agent-modes）

| 反模式 | 问题 | 修复 |
|---|---|---|
| 真实模型调用直接进测试 | 网络/凭据/不确定性，测试不可复现 | 可编程判定注入缝（decide 函数注入）驱动全路径；引擎系统级行为用「jiti 加载第三方源码直接断言」（envelope 实证） |
| 运行时按状态切换扩展点靠改配置 | 配置数组整体替换 + 私有闭包无变更 API；改配置违反「模式不改 .pi」且跨状态共享 | 门控（非目标状态 link 立即 defer 零副作用），不动态改配置 |
| 监督方 stop 不等待子进程退出 | stop 返回后 worker 仍运行 → 测试 utimes/清理竞态（hydration ~50% flake） | stop() 捕获 child + 'exit' 事件 + 超时兜底（SIGKILL + 宽限）；「stop 返回 = 进程已停」 |
| 无会话操作被静默丢弃 | UI 乐观显示但服务端未收到（handleModeChange if(!key) return）→ 后续数据流取位暴露不一致 | 无会话操作显式定义语义（降级为全局默认并落盘）；「UI 显示 ≠ 服务端状态」窗口必以取位暴露 |
| 同一视觉区块内背景层级不一致 | composer surface 白块 vs toolbar 透页面底 → 视觉色带（用户感知「有背景色」） | 容器化：同一区块元素共享统一背景容器（底部输入区 Composer+Toolbar 一个 surface 容器） |

## 2026-08-14 追加（2026-08-12-conversation-toolbar-ext /reflect）

| 反模式 | 问题 | 修复 |
|---|---|---|
| 域集合放出时不盘点散落枚举点 | 37 provider 放出漏改 test-connection 硬编码表 → 34 项误报（BUG-001） | 放出/收缩域集合前 grep 全部枚举点（硬编码表/白名单/switch/路由校验）列清单核对；长期：单一真源派生（ADR-027） |
| 跨供应商端点假设未实证进 BUILD | 「baseUrl+/models 通吃」被 anthropic 族推翻（BUG-002） | 假 key 探测法：401/403=端点存在、404/405=不存在；响应 error type 复核；协议族看 pi-ai `model.api` |
| 测试零输出挂起当测试问题查 | ABI 翻转的挂起形态（E-DB-UNWRITABLE 被 beforeEach 吞没） | 挂起先 `npm run rebuild:node`/`rebuild:electron` 对齐 ABI 再诊断；并行 story 交叉跑两套测试必翻转 |
| 展示格式化函数住 JSX | node 无法 import → 数值格式无单元 seam（BUG-003） | 格式化纯函数一律 format.js 类纯 JS 模块；UX 参照示例值（6%）签核时显式确认为格式契约 |

## 2026-08-16 追加（2026-08-12-pi-mcp-plugin /reflect）

| 反模式 | 问题 | 修复 |
|---|---|---|
| hash 重导航当「刷新持久」证明 | `page.goto(base+hash)` 同 URL 是 fragment no-op，组件不卸载——「刷新后仍在」断言空转（BUG-014 收紧原 2b） | 持久化断言三要素：seed 真实持久化实体（走 PUT 路径）→ `page.reload()` 真实刷新 → 重新进入再断言 |
| `toBeVisible` 当真实可见性 | 不查祖先 `overflow:hidden` 裁剪——弹层末行出界潜伏至用户实测（BUG-009） | 真实命中用 `elementFromPoint` 锚定（点坐标处命中的必须是目标元素） |
| 行级态用无参聚合读 seam | 全局开关冒充行级启用态：UI 假 on、点击反写 false、启用行永不落库（BUG-012） | 读 seam 带行标识参数；E2E「点开关 → 真实落库 → 刷新回读」三步闭环 |
| mock req 对象形状不随路由演进 | 路由开始读 `req.url` 后，缺 url 字段的旧 mock 全挂（efa6d4d） | mock 对齐真实 req/res 形状；路由新增读取面时盘点既有 mock |
