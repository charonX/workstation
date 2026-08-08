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
