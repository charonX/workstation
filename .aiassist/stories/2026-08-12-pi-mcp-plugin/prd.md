# PI 插件管理与 MCP 支持（Extensions + MCP）

> 状态：探索期
> 故事 ID：`2026-08-12-pi-mcp-plugin`
> 最后更新：2026-08-12
> 输入：`interview-notes.md`（5 轮单题访谈，方向 A，人显式 yes）；`research/pi-community-mcp-bridge.md`；`research/pi-embedded-sdk-package-mechanism.md`

---

## 1. 问题陈述

PI agent 能力受限：无法调用任何外部工具生态——想用 MCP server（数据库、内部服务、任意第三方工具）时没有接入路径；想扩展 agent 能力时，pi extension 只能手工往 `agentHome/extensions/` 目录塞文件、手工编辑配置，应用内没有「安装 → 配置 → 使用」的扩展链路。能力天花板 = 内置工具 + skill 提示词，且每加一个扩展都要碰代码和隐藏目录。

## 2. 解决方案

在管理区落地 **PI 插件（extension）管理**：复用 pi 官方包机制（npm/git/本地三种来源、全局/项目两级作用域）实现集中安装与按项目分发启用；随舰落地 **MCP 桥**（社区事实标准 `pi-mcp-adapter`），MCP server 作为 workstation 一等配置实体（UI 维护、落库、全局定义 + 项目启用），桥在会话启动时读取生效配置并把 MCP 工具动态注册进 PI agent；所有 extension/MCP 工具**全量纳入 gotgenes 权限面**与 strict/standard/auto 三档模式，飞书通道与 UI 会话同工同权。

## 3. 用户故事

1. 作为**本机用户**，我想要在应用内添加 PI 插件（npm 包 / git 仓库 / 本地目录），以便不碰隐藏目录和命令行就能扩展 agent 能力。
2. 作为**本机用户**，我想要按项目启用/停用插件，以便不同项目的 agent 有不同的能力面。
3. 作为**本机用户**，我想要在 UI 里配置 MCP server（名称/启动命令/参数/env，或远程 URL），以便让 agent 调用外部工具而不手写 JSON。
4. 作为**本机用户**，我想要配置完 MCP server 后在对话里直接让 agent 使用其工具，以便完成「配置 → 使用」闭环。
5. 作为**本机用户**，我想要插件/MCP 工具的调用遵循项目权限配置与模式档位（strict 下弹确认卡），以便第三方能力不绕过安全边界。
6. 作为**维护者**，我想要某插件加载失败或某 MCP server 连不上时不拖垮整个会话，以便单点故障可隔离、可诊断。
7. 作为**维护者**，我想要看到插件的来源/版本/启用状态清单，以便知道「这个 agent 现在由哪些第三方代码构成」。

## 4. 稳定块（已稳定，可结晶为 REQ）

| # | 稳定块 | 为什么不再推翻 |
|---|---|---|
| B1 | **插件安装（三种来源）**：管理区添加 extension——npm（`npm:pkg[@ver]`）/ git（URL[@ref]）/ 本地路径；安装走 pi 官方包机制（`DefaultPackageManager`），落点为 workstation 控制的 agentHome（`agentDir` 覆盖）；**会话装配全量转官方发现链路**（文件 settings + 自动发现），gotgenes/授权桥保持官方 `extensionFactories` 内联注入（顺序宿主控制） | 访谈 Q2+Q3 人拍板；TECH-DESIGN Q1 人拍板 A（全量转官方）；research-2 实证官方机制程序化可达 |
| B2 | **按项目分发/启用**：插件全局安装、项目级启用/停用；启用状态写**项目 `.pi/settings.json`** 资源覆盖模式（复刻 `pi config` 持久化，公开 setter），读取走官方 `resolve()` 两级求值；**DB 零新增插件表** | 访谈 Q3 人拍板；TECH-DESIGN Q3 人拍板 C1——与 ADR-022「项目覆盖 = .pi 文件」同构 |
| B3 | **插件管理 UI**：管理区新「插件」页——列表（名称/来源/版本/启用状态/错误态）、添加、移除、按项目启用切换 | 管理区已有「技能」页同构形态（ADR-018 分区）；B1/B2 的呈现层 |
| B4 | **MCP server 一等配置实体**：DB 落库 + 管理区 UI 增删改查 + 启用开关；字段 = 名称/类型（stdio：command/args/env；远程：url/headers/auth）；**全局定义 + 项目级启用**；**一期全量 transport**（stdio + StreamableHTTP/SSE + bearer/OAuth，OAuth 流程复用桥的能力，授权 URL 经对话/通知呈现） | 访谈 Q4 人拍板「一等配置实体」；TECH-DESIGN Q6 人拍板全量范围；运行时桥直接读库已论证可行（pi 无需原生支持） |
| B5 | **MCP 桥随舰 = pi-mcp-adapter（内置内联工厂）**：打包为应用依赖，worker 以 `createMcpAdapter({ config })` 内联装配，config = mcpService 从 DB 算出的「本项目生效配置快照」（隔离语义：不与任何文件 merge） | research-1 实证其为社区事实标准（官方画廊收录）且配置注入有源码级证据（index.ts L883）；TECH-DESIGN Q2 人拍板 B1 |
| B6 | **权限全量纳入**：MCP 工具调用经桥 broker 事件（`pi-mcp-adapter:tool-approval-request`）对接授权桥 → gotgenes **`mcp` 面**（`checkPermission("mcp", "server:tool")`，gotgenes 原生支持，public.d.ts L62）+ 确认挂起队列 + 三档模式；一期映射只用 allow_once/deny/abstain；其他第三方 extension 注册的工具经 gotgenes 工具级裁决（工具名面）纳入同一权限面 | 访谈 Q4 人拍板「纳入权限体系」；TECH-DESIGN Q4 人拍板 D1（新 mcp 面、server:tool glob、默认 ask）；gotgenes 原生预留 mcp 面 |
| B7 | **飞书/UI 同工同权**：两条入口的会话同等可用插件/MCP 工具，同过权限面 | 访谈中默认假设人未纠偏；工具面在 worker 级，天然同构 |
| B8 | **故障隔离**：单插件加载失败 / 单 MCP server 连接失败 → 标记错误态、其工具不可用、会话与其余插件不受影响 | 用户故事 6；多来源第三方代码必须可隔离 |
| B9 | **pi 0.83 → 0.84.1 前置升级**：本 story 第 0 切片——worker 流式迁 `message_update` 纯 delta 语义、适配会话 v4 harness 与 ModelRegistry 签名变更；完成后用最新 pi-mcp-adapter | TECH-DESIGN Q6 人拍板 E1；adapter ≥2.22 peer 要求 pi-ai ^0.84.1；既有 modes/ux 测试作回归安全网 |

## 5. 移动块（还在动，暂不入 REQ）

| # | 还在动的块 | 不确定什么 |
|---|---|---|
| M4 | 通用 extension 工具的权限粒度 | extension 工具按工具名面走 gotgenes 工具级裁决已可用；是否要 per-tool 细分配置面未确认 |
| M5 | 插件更新动作是否进 UI | 官方 `update/checkForAvailableUpdates` 程序化可达；UI 暴露「更新」按钮的价值未确认 |

> 已消解（TECH-DESIGN 2026-08-12）：M1（pi 升级 → B9 前置切片，E1）；M3（一期范围 → 全量 transport 含 OAuth，B4）；「MCP 配置同步写 pi config 文件」不做（内存快照隔离语义，B5）。
> 已消解（DESIGN 2026-08-13）：M2——安全告知定稿为「添加插件」弹窗内常驻警示条（`plugin-safety-note`，见 ux/plugins-page.html），不做每次确认；OAuth 授权 URL 呈现定稿为对话内授权卡（主）+ 通知中心条目（旁路），见 ux/oauth-present.html。

## 6. 用户操作流（Operation Flows）

### 6.1 主流程 / Happy Path

#### F0 pi 0.84.1 前置升级（B9）

| 步骤 | 用户动作 | 系统响应 | 验收锚点 |
|---|---|---|---|
| 1 | （维护者）升级 pi 依赖到 0.84.1，迁移 worker 流式/会话装配 | 既有全部测试通过（modes/ux/权限 story 测试网 = 回归断言） | 全量回归绿；流式渲染/确认卡/模式切换 E2E 通过 |
| 2 | 升级失败（某迁移点不兼容） | 定位到具体 breaking 点在切片内修复，不带病进后续切片 | 升级切片独立 commit，可回退 |

#### F1 添加插件（B1/B3）

| 步骤 | 用户动作 | 系统响应 | 验收锚点 |
|---|---|---|---|
| 1 | 管理区进入「插件」页，点「添加插件」 | 弹出来源选择（npm / git / 本地路径）+ 输入框 | E2E：三种来源入口可见 |
| 2 | 输入来源（如 `npm:pi-mcp-adapter`）并确认 | 调用官方包机制安装到 agentHome；列表出现该插件（名称/来源/版本），状态「全局可用」 | API：settings 中登记 + 磁盘落位；E2E：列表行可见 |
| 3 | 添加本地路径来源 | 不拷贝，按路径加载（官方 local path 语义） | API：settings 记录 resolved 绝对路径 |

#### F2 按项目启用插件（B2/B3）

| 步骤 | 用户动作 | 系统响应 | 验收锚点 |
|---|---|---|---|
| 1 | 插件行上选择「按项目启用」，勾选项目 A | 项目级启用状态持久化（pi 两级 settings 语义） | API：项目级启用记录存在；全局默认状态不变 |
| 2 | 打开项目 A 的会话发消息 | 会话工具面包含该插件注册的工具 | 集成：会话工具列表含插件工具 |
| 3 | 打开项目 B（未启用）的会话 | 工具面不含该插件工具 | 集成：工具列表不含 |

#### F3 配置并使用 MCP server（B4/B5）

| 步骤 | 用户动作 | 系统响应 | 验收锚点 |
|---|---|---|---|
| 1 | 管理区「插件」页（或 MCP 区）点「添加 MCP server」 | 表单：名称/类型(stdio)/command/args/env | E2E：表单可见 |
| 2 | 填入合法配置并保存 | 落库；列表出现该 server，默认全局定义、未启用项目 | API：DB 行断言字段 |
| 3 | 在项目 A 启用该 server | 项目级启用持久化 | API：启用记录存在 |
| 4 | 项目 A 会话中让 agent 使用该 server 的工具 | 桥读取生效配置 → 连接 server → 工具注册 → agent 调用成功，结果回流对话 | 集成：fake stdio server 全链路调用断言 |

#### F4 权限管控（B6）

| 步骤 | 用户动作 | 系统响应 | 验收锚点 |
|---|---|---|---|
| 1 | strict 模式下，agent 发起 MCP 工具调用 | 调用被拦截 → 弹确认卡（含 server 名/工具名/参数摘要） | E2E：确认卡出现且信息完整 |
| 2 | 用户确认 | 调用放行，结果回流 | 集成：server 收到调用 |
| 3 | 用户拒绝 | deny + reason 回给 agent，工具不执行 | 集成：server 未收到调用 |

### 6.2 分支与异常

| 触发条件 | 分支结果 | 对应错误状态 |
|---|---|---|
| npm 包不存在 / git 克隆失败 / 网络失败 | 安装失败，列表不出现该插件 | E1 |
| 本地路径不存在 | 表单校验拦截，不发安装 | E2 |
| 插件代码加载报错（语法/依赖缺失） | 标记错误态，会话正常建、其余插件正常 | E3（B8） |
| MCP server 启动/连接失败 | 该 server 工具不注册，错误态可见，会话不阻塞 | E4（B8） |
| 权限评估 deny（配置或人工拒绝） | 工具不执行，reason 回 agent | E5 |
| 同一项目重复启用同一插件/server | 幂等，不产生重复记录 | E6 |

## 7. 表单与输入验证（Form / Input Validation）

| 输入字段 | 规则 | 错误提示 | 错误状态 |
|---|---|---|---|
| 插件来源（npm） | `npm:` 前缀 + 合法包名（可选 @semver） | 「npm 包名格式不正确」 | E2 |
| 插件来源（git） | `git:` 前缀 shorthand 或 https/ssh/git 协议 URL，可选 @ref | 「git 地址格式不正确」 | E2 |
| 插件来源（本地） | 路径存在且为目录或 .ts/.js 文件 | 「路径不存在」 | E2 |
| MCP 名称 | 非空、库内唯一、slug 安全字符 | 「名称已存在/不合法」 | E2 |
| MCP command（stdio） | 非空；args 为字符串数组；env 为 KEY=VALUE 列表，KEY 合法环境变量名 | 「启动命令必填」「env 格式为 KEY=VALUE」 | E2 |
| MCP URL（远程，若进一期） | http/https 合法 URL；headers 为 KEY=VALUE | 「URL 不合法」 | E2 |

### 7.1 跨字段/业务规则

| 规则 | 触发时机 | 错误状态 |
|---|---|---|
| 同一来源（npm 包名 / git URL 去 ref / 本地 resolved 路径）不可重复添加（官方 dedupe 语义） | 添加插件时 | E6 |
| 项目启用前提是插件已全局安装成功（非错误态） | 项目启用切换时 | E6 |
| MCP server 项目启用前提是全局定义存在且启用开关开 | 项目启用切换时 | E6 |

## 8. 错误状态与失败响应（Error States / Failure Responses）

| 场景 | 触发条件 | 错误码/消息 | 用户可见状态 | 副作用/回滚 |
|---|---|---|---|---|
| E1 安装失败 | npm 404 / git clone 失败 / 网络错误 | 官方包机制错误透传 + 包装文案 | 添加弹窗内报错；列表不出现 | 不留半成品（官方 install 失败不落 settings） |
| E2 输入非法 | 表单校验/路径不存在 | 字段级错误提示 | 表单标红，不提交 | 无副作用 |
| E3 插件加载失败 | extension 代码抛错/依赖缺失 | 加载错误摘要 | 列表行标错误态 + 悬浮详情 | 该插件工具不注册；会话与其余插件正常（B8） |
| E4 MCP 连接失败 | 子进程启动失败/握手超时 | server 名 + 失败原因 | MCP 列表行标错误态；对话中工具不出现 | 会话正常；其余 server 正常（B8） |
| E5 权限拒绝 | gotgenes deny / 人工拒绝 / auto 判危险 | deny reason | strict 弹卡被拒绝后对话内可见拒绝说明 | 工具不执行；reason 回 agent |
| E6 幂等冲突 | 重复添加/重复启用 | 幂等成功或明确提示 | 状态不变更 | 无重复记录 |
| E7 pi 版本不兼容 | pi-mcp-adapter ≥2.22 peer 要求 pi-ai ^0.84.1 | 构建/加载期失败 | 取决于升级切片 | 已由 B9 消解：前置升级 pi 0.84.1（E1，人拍板） |

## 9. 复杂度分级

| 维度 | 取值/说明 |
|---|---|
| 复杂度 | **complex** |
| 判断理由 | 模块数 5+（新 extensionService、新 mcpService、worker 会话装配、permissionBridge 扩展、管理区 UI 两区块）；外部依赖 4（npm registry、git、MCP server 子进程、pi-mcp-adapter）；分支多（三种来源 × 两级作用域 × 三档权限）；跨模块契约硬（worker↔桥↔gotgenes 授权桥） |

## 10. 实现决策（高层，不写代码）

### 10.1 模块边界与解耦（TECH-DESIGN 2026-08-12 定稿）

- **worker 会话装配全量转官方（A）**：从 `SettingsManager.inMemory()` + 全 `no*` 封闭基座，转为 `SettingsManager.create(cwd, agentDir)` 读真文件 + 官方自动发现链路。第三方插件经全局 `agentHome/settings.json` 声明、官方 `resolve()` 两级求值（项目 `.pi/settings.json` 覆盖全局）。
- **gotgenes + 授权桥保持官方 `extensionFactories` 内联注入**：内联是官方宿主注入面（docs/sdk.md L583-601），数组顺序宿主控制（授权桥先于 gotgenes 不变）；内联排在自动发现之后，第三方 handler 先看到调用但权限门照跑，不可绕过。
- **缺包不自动装**：worker 传 `onMissing → "error"`，缺包即报错并提示去插件页重装（不用 `PI_OFFLINE`，保留显式错误路径）。TECH-DESIGN Q5② 人拍板。
- **项目默认信任（显式姿态）**：接受 SDK `projectTrusted` 默认 true，不复刻 CLI 信任门；姿态记入安全清单。TECH-DESIGN Q5③ 人拍板。
- **extensionService（新）**：插件添加/移除/清单/项目启用。复用官方 `DefaultPackageManager`（installAndPersist/removeAndPersist/listConfiguredPackages）+ `SettingsManager` 公开 setter 复刻 `pi config` 的 `+`/`-` 持久化。**pi settings.json = 插件清单真相，不抄进 DB**。
- **mcpService（新）**：MCP server CRUD + 项目启用，DB 落库（新表 `mcp_servers` + 项目启用映射）；输出「某项目生效 MCP 配置快照」供桥消费。
- **MCP 桥（内置内联工厂）**：`pi-mcp-adapter`（E1 后用最新版）打包为应用依赖；worker 以 `createMcpAdapter({ config })` 装配，config = mcpService 快照（隔离语义，不 merge 任何用户散落文件）。
- **permissionBridge（改）**：新增 broker 事件接线——`tool-approval-request` claim → gotgenes `checkPermission("mcp", "server:tool")` → allow/ask/deny → allow_once/确认队列/deny；auto 模式复用 ADR-023 模型 link。
- **管理区 UI（改）**：新「插件」页（插件清单 + 项目启用 + MCP server 管理），形态对齐既有「技能」页。
- **pi 0.84.1 前置升级（B9）**：第 0 切片，独立可验。

### 10.2 其他方向性决策

- MCP 桥选型：`pi-mcp-adapter`（research-1：社区事实标准、官方画廊收录、配置注入与权限挂接均有源码级设计面；审批 broker 自 2.20.0 起可用）。
- 配置注入方式：内存快照（`createMcpAdapter({config})`），不写 pi 的 config 文件；同步写文件仅为可选生态兼容，一期不做。
- 保存即生效语义：MCP 配置变更对**新会话**生效；进行中的会话不重载（对齐权限配置 story 的 mtime 语义，简化一期）。
- OAuth：复用桥的 OS 凭据库存储与授权流程；授权 URL 经对话/通知呈现给用户点开（workstation 无 TUI，/mcp-auth 类命令的交互形态在 DESIGN 阶段定）。

## 11. 测试决策

- **插件机制**：extensionService 以 API/CLI 为 seam，用临时 agentDir + 本地 fixture 包（本地路径来源）做集成测试，避免 npm/git 网络依赖；npm/git 来源的解析逻辑单测（纯函数），真实网络安装走手动验收。
- **MCP 配置**：mcpService CRUD + 项目启用 = API 测试。
- **桥全链路**：fixture stdio MCP server（脚本）+ 内存配置注入 → 断言工具注册与调用回流（集成）。
- **权限集成**：broker 事件 → 授权桥接线用集成测试（断言 deny 时 server 未收到调用）；strict 弹卡走 E2E（Playwright）。
- **UI**：管理区插件页/MCP 表单 = E2E。

### 11.1 覆盖接缝（coverage seams）

| 稳定块 | seam | 测试类型 |
|---|---|---|
| B1 插件安装 | extensionService API（临时 agentDir） | 集成 |
| B2 项目启用 | extensionService API + 会话工具面 | 集成 |
| B3 插件 UI | 管理区页面 | E2E |
| B4 MCP 配置 | mcpService API | 单元/集成 |
| B5 桥随舰 | fixture stdio server 全链路 | 集成 |
| B6 权限纳入 | broker→授权桥接线；strict 弹卡 | 集成 + E2E |
| B7 同工同权 | 通道会话工具面断言 | 集成 |
| B8 故障隔离 | 坏插件/坏 server fixture | 集成 |

## 12. 范围外

- pi 包内 skills/prompts/themes 的管理（skills 归既有通用技能库）。
- 插件市场/发现/浏览（只支持显式来源添加；pi.dev 画廊不做应用内浏览）。
- MCP 桥自研（仅当 pi-mcp-adapter 集成被证伪才回流考虑）。
- 飞书通道的差异化工具策略（与 UI 同工同权）。
- 进行中会话的插件/MCP 热重载。
- 配置克隆/跨项目复用、变更审计历史。

## 13. 补充说明

- 根因伏笔（访谈收尾人拍板）：本 story 若错，最可能错在**技术可行性层**——两个调研已大幅消解该风险（桥有现成、官方机制可复用），残余风险集中在 M1（pi 版本升级影响面）。
- 「保存即生效」限新会话语义是一期简化，若用户实测需要热重载，走 /bug 或后续 story。

## 14. PRD 完整性自检查

| 检查项 | 状态 | 备注 |
|---|---|---|
| 操作流 | PASS | F1-F4 覆盖 B1-B6；B7/B8 在 6.2 与测试接缝覆盖 |
| 输入验证 | PASS | §7 覆盖插件来源与 MCP 表单 |
| 错误状态 | PASS | E1-E7；跨模块调用（npm/git/MCP 子进程/桥）均有定义 |
| 复杂度分级 | complex | §9 |

---

## 版本记录

| 版本 | 日期 | 变更 | 作者 |
|---|---|---|---|
| v0.1 | 2026-08-12 | 初稿（访谈 5 轮 + 双调研实证） | AI + 人 |
| v0.2 | 2026-08-12 | TECH-DESIGN 反向同步：A（全量转官方）/B1（桥内置内联）/C1（.pi 文件启用）/D1（gotgenes 原生 mcp 面）/E1（pi 0.84.1 前置升级=B9）；MCP 一期全量 transport；缺包报错不自动装；项目默认信任姿态显式化；M1/M3 消解 | AI + 人 |
