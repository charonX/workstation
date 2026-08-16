# 技术方案 — PI 插件管理与 MCP 支持（Extensions + MCP）

> 故事 ID：`2026-08-12-pi-mcp-plugin`
> 版本：`v1`
> 最后更新：2026-08-12
> 输入：`prd.md` v0.2、`research/pi-community-mcp-bridge.md`、`research/pi-embedded-sdk-package-mechanism.md`
> 对抗式深潜：6 轮单题（A/B1/C1/D1/三姿态/E1/全量 transport），全部人拍板

---

## 设计目标

让 workstation 的 PI agent 从「封闭盒子」转为「官方机制托管的可扩展宿体」：插件（extension）经 pi 官方包机制安装与按项目启用；MCP 桥内置注入 workstation 管理的配置快照；所有第三方工具调用全量过 gotgenes 权限面。

## 模块与边界

| 模块 | 职责 | 是否新增 |
|---|---|---|
| `extensionService` | 插件添加（npm/git/本地）/移除/清单/项目启用切换；薄封装官方 `DefaultPackageManager` + `SettingsManager` | 是 |
| `mcpService` | MCP server CRUD（DB）+ 项目启用映射；输出「项目生效配置快照」 | 是 |
| `worker.js` 会话装配 | 转官方文件 settings + 自动发现；内联注入授权桥 → gotgenes → MCP 桥（顺序固定）；`onMissing→"error"` | 否（改） |
| `permissionBridge` | 新增 broker 事件接线：`tool-approval-request` → gotgenes `checkPermission("mcp", …)` → claim 裁决 | 否（改） |
| `permissionConfigService` / `policyRules.js` | 配置面新增 `mcp` 族（server:tool glob），权限配置 UI 跟随扩分组 | 否（改） |
| 管理区「插件」页 | 插件清单/添加/移除/项目启用 + MCP server 管理表单 | 是（UI） |
| pi 运行时（0.84.1） | 前置升级：流式 delta、会话 v4、ModelRegistry 签名 | 否（依赖升级） |

### 模块关系图

```
管理区「插件」页
   │  HTTP API
   ▼
extensionService ──> DefaultPackageManager ──> agentHome/settings.json（全局清单真相）
   │                     └ install/remove/list
   └ 项目启用 ──> SettingsManager setter ──> <projectDir>/.pi/settings.json（+/- 覆盖模式）

mcpService ──> DB（mcp_servers + 项目启用映射）──> 生效配置快照
                                                    │
会话创建（worker）                                   ▼
   SettingsManager.create(cwd, agentDir)      createMcpAdapter({ config: 快照 })
   DefaultResourceLoader（自动发现开）               │
   ├─ 文件系统扩展（第三方插件，两级求值后仅 enabled）   │
   └─ extensionFactories（内联，顺序固定）◄──────────┘
        [授权桥] → [gotgenes] → [MCP 桥]
                              │
MCP 调用时：adapter broker ──tool-approval-request──> 授权桥
   → gotgenes checkPermission("mcp", "server:tool")
   → allow: claim("allow_once")
   → ask: 确认挂起队列 →（auto 模式先过模型 link）→ 人裁决 → allow_once/deny
   → deny: claim("deny") + reason 回 agent
```

## 数据流

**F-add-plugin（添加插件）**：
1. 触发：管理区插件页提交来源（npm/git/本地路径）。
2. 输入校验：来源格式 + 本地路径存在性（PRD §7）；非法 → E2 不落盘。
3. 核心处理：`DefaultPackageManager.installAndPersist(source)`——npm/git 下载落 `agentHome/npm|git/`，本地路径只登记；写全局 settings.json。
4. 副作用：磁盘下载 + settings.json 写入（proper-lockfile 加锁）。
5. 输出：清单行（名称/来源/版本/状态）；失败 → E1 透传包装。

**F-toggle-project（项目启用）**：
1. 触发：插件行项目启用开关。
2. 核心处理：复刻 `pi config` 持久化——往 `<projectDir>/.pi/settings.json` 对应资源数组写 `+pattern`/`-pattern`（先剔除同目标旧模式）。
3. 读取侧：UI 展示用 `resolve()` 的 `ResolvedPaths`（每项带 `enabled` 与 `metadata.scope`）。
4. 生效：新会话装配时官方求值生效（进行中会话不重载）。

**F-mcp-call（MCP 工具调用，权限链路）**：
1. agent 发起 MCP 调用（代理工具 `mcp` 或 direct tool）。
2. 桥 broker 发 `tool-approval-request`（载荷 serverName/originalToolName/args/origin），等待 claim。
3. 授权桥 `claim(async …)`：调 gotgenes `checkPermission("mcp", "<server>:<tool>")`。
4. allow → `allow_once`；deny → `deny`（reason 回 agent）；ask → 确认挂起队列 →（auto：模型 link 先判，不确定 defer）→ 内联确认卡/飞书卡片 → 人裁决 → `allow_once`/`deny`。
5. 无副作用到 settings；裁决留痕 permission review log（既有）。

**F-oauth（远程 server OAuth）**：
1. 桥发起 OAuth → 产出授权 URL。
2. workstation 经对话/通知把 URL 呈现给用户（浏览器打开），token 由桥存 OS 凭据库。
3. 交互形态细节在 DESIGN 阶段定。

## 接口契约

### 接口 1：extensionService 插件管理 API

| 项目 | 说明 |
|---|---|
| 调用方 | 管理区插件页 / CLI / 测试 |
| 被调用方 | extensionService（主进程） |
| 输入 | `add(source: string)`；`remove(source: string)`；`list(): PluginRow[]`（名称/来源/版本/scope/错误态）；`setProjectEnabled(projectId, source, resource, enabled)` |
| 输出 | 成功：清单行/操作结果；`list` 由官方 `resolve()` 求值（含 enabled 与 scope） |
| 业务错误 | 来源格式非法（E2）、重复添加（E6）、未安装先启用（E6） |
| 系统错误 | 网络/git/npm 失败（E1，透传官方错误 + 包装文案） |
| 副作用 | npm/git：磁盘下载 + 全局 settings.json 写；本地：仅 settings 写；启用切换：项目 `.pi/settings.json` 写 |
| 幂等性 | 是（官方 dedupe 身份规则：npm 包名/git URL 去 ref/本地 resolved 路径） |

### 接口 2：mcpService 配置与快照 API

| 项目 | 说明 |
|---|---|
| 调用方 | 管理区 MCP 表单 / worker 会话装配 / CLI / 测试 |
| 被调用方 | mcpService（主进程） |
| 输入 | CRUD：`{ name, type: "stdio"\|"http", command?, args?, env?, url?, headers?, auth? }`；`setProjectEnabled(projectId, serverId, enabled)`；`effectiveConfig(projectId\|spaceKey): McpConfigSnapshot` |
| 输出 | `McpConfigSnapshot` = 桥 `createMcpAdapter({config})` 直接可消费的形态（servers 映射，仅含本项目已启用且全局开关开的 server） |
| 业务错误 | 名称重复/非法、stdio 缺 command、http 缺合法 url（E2） |
| 系统错误 | DB 写失败 |
| 副作用 | DB 写；无文件副作用 |
| 幂等性 | 是 |

### 接口 3：broker → 授权桥权限接线

| 项目 | 说明 |
|---|---|
| 调用方 | pi-mcp-adapter（worker 进程内） |
| 被调用方 | 授权桥（permissionBridge 新增 link） |
| 输入 | broker 事件载荷 `{ serverName, originalToolName, args, origin, signal }` + `claim(fn)` |
| 输出 | claim 裁决：`"allow_once" \| "deny" \| "abstain"`（一期不用 `allow_for_session`） |
| 业务错误 | deny：带 teaching reason 回 agent |
| 系统错误 | claim 超时/无人 claim → 桥 headless fail-closed（`approval_required`），工具不执行 |
| 副作用 | ask 路径：确认挂起队列写库 + 确认卡渲染 + review log |
| 幂等性 | 同一调用的重复审批由桥侧缓存语义处理（「every uncached call」） |

### 接口 4：worker 会话装配（内部契约）

| 项目 | 说明 |
|---|---|
| 输入 | sessionCwd、agentDir、mcpService 快照、gotgenes 配置 |
| 装配顺序 | `SettingsManager.create(cwd, agentDir)`（文件真源）→ `DefaultResourceLoader`（自动发现开，`onMissing → "error"`）→ extensionFactories 固定序 `[授权桥, gotgenes, MCP桥]` |
| 错误 | 缺包 → 装配失败，错误消息含包名 + 「请到插件页重装」指引（E1 变体）；单插件加载错 → 该插件禁用、诊断记录、会话继续（E3/B8，依赖官方 loader 的 per-extension 错误隔离，BUILD 前 spike 验证） |

## 测试 seams

| 稳定块 | Seam | 测试类型 | 依赖处理 |
|---|---|---|---|
| B9 pi 升级 | 既有全量测试（modes/ux/权限 story 的测试即回归网） | 单元 + 集成 + E2E | 真实 |
| B1 插件安装 | extensionService API（临时 agentDir + 本地 fixture 包） | 集成 | npm/git 网络 mock/stub；本地路径真实 |
| B2 项目启用 | extensionService API + 会话工具面断言 | 集成 | 真实（临时项目目录） |
| B3 插件 UI | 管理区页面 | E2E（Playwright Electron） | 真实 |
| B4 MCP 配置 | mcpService API + 快照输出断言 | 单元/集成 | 真实 DB（测试库） |
| B5 桥随舰 | fixture stdio MCP server（node 脚本）全链路：快照注入 → 工具注册 → 调用回流 | 集成 | server 真实（fixture），模型 fauxProvider |
| B6 权限纳入 | broker claim 接线：断言 deny 时 fixture server 未收到调用；strict 弹卡 | 集成 + E2E | 真实 |
| B7 同工同权 | 通道会话（飞书路径）工具面 + 权限断言 | 集成 | 通道 mock |
| B8 故障隔离 | 坏插件 fixture（抛错 extension）+ 坏 server fixture（不存在命令） | 集成 | 真实 |
| OAuth 链路 | 授权 URL 呈现 | 手动验收（一期无本地 OAuth server fixture） | — |

**CLI 暴露**（ADR-001 惯例，CLI/HTTP 共享服务层）：`opc-workstation plugin add|remove|list|enable|disable`、`opc-workstation mcp add|list|enable|disable`——CLI 即测试 seam，也供 agent 自用。

## 关键决策

| 决策 | 选项 | 选择理由 | 风险 |
|---|---|---|---|
| 会话装配开口方式 | A 全量转官方 / B 管理官方+运行白名单 | **A（人拍板）**：复用度最高，行为与 pi 生态一致；两级求值/启停清单直接拿官方 `resolve()` | 启动期副作用入场（扫描/设置读取）；用 onMissing=error 与内联固定序收敛 |
| MCP 桥形态 | B1 内置内联 / B2 受管插件 | **B1（人拍板）**：内存快照隔离语义（不 merge 用户散落文件），DB 唯一真相；配置消费方确定 | 插件机制管不到桥本身（可接受：桥是应用能力不是用户插件） |
| 插件启用真相源 | C1 项目 `.pi/settings.json` / C2 DB | **C1（人拍板）**：与 ADR-022 同构，DB 零新增，官方求值直读 | 状态随项目目录走（删除项目即消失，与权限配置一致，可接受） |
| MCP 权限表达 | D1 gotgenes mcp 面 / D2 一刀切 ask | **D1（人拍板）**：gotgenes 原生预留 mcp 面（public.d.ts L62），server:tool glob，默认 ask | gotgenes 规则表要扩 mcp 族（policyRules.js 改） |
| 缺包行为 | 自动装（官方默认）/ 报错 | **报错（人拍板）**：受控分发诉求优先，启动期不联网 | 用户手删目录后要手动重装（UI 指引覆盖） |
| 项目信任 | 默认 true / 复刻信任门 | **默认 true（人拍板）**：单用户本机产品，项目皆用户登记 | 姿态记入安全清单；未来多用户/导入外部项目时需重审 |
| pi 版本 | E1 前置升级 0.84.1 / E2 钉 adapter 2.21.0 | **E1（人拍板）**：跟住上游，避免钉死旧版积累迁移债 | 流式 delta + 会话 v4 迁移回归面——靠既有测试网兜底 |
| MCP 一期范围 | stdio only / 全量 | **全量（人拍板）**：含 HTTP/bearer/OAuth | OAuth 交互形态需 DESIGN 阶段落地 |

## 风险与回流点

| 假设 | 如果错了会怎样 | 回流到 | 能否快速验证 |
|---|---|---|---|
| 官方 loader 对单插件加载错误有 per-extension 隔离（不拖垮会话） | B8 不成立，需自加 try/catch 装配层 | TECH-DESIGN（局部） | 能——BUILD 前 spike：坏插件 fixture |
| `resolve()`/`ResolvedPaths` 足以驱动插件页清单 UI（名称/版本/scope/enabled） | 清单页需自读 package.json 补元数据 | TECH-DESIGN（局部） | 能——spike 打印 resolve 输出 |
| broker claim 异步等待人确认无超时坑（research-1 开放问题 2） | 长等卡死或提前 fail-closed | TECH-DESIGN（局部） | 能——集成测试里挂起 claim 观察 |
| pi 0.84 会话 v4 与 worker 现有 session 生命周期管理（sessionLifecycle.js）兼容 | 迁移面扩大 | TECH-DESIGN（B9 切片内消化） | 能——B9 切片先跑全量测试 |
| OAuth 在 embedded 环境（无 TUI）可用 | 远程 server 降级为 bearer-only | PRD（砍 B4 的 OAuth 子集） | 中——需要真实 OAuth server 验证，一期手动验收 |

## 范围外与约束

- 包内 skills/prompts/themes 管理（归既有技能库）；插件市场/发现；进行中会话热重载；插件更新 UI（M5）。
- ADR 约束遵守：ADR-009（惰性初始化——service 不顶层读盘）、ADR-014/019（worker 子进程形态不动）、ADR-017/020/022（权限体系语义）、ADR-023（三档模式与 envelope 从严——mcp 面不进入 DELEGATION_EXCLUDED_SURFACES，但 external_directory/path 对 MCP 工具携带的 path 参数仍从严，gotgenes 已有 `input.arguments.path` 约定覆盖）。
- 安全：第三方插件 = 进程内任意代码；添加动作即显式授权 + UI 告知文案（M2）；安装后工具调用全量过权限面（B6）。
- 可观测性：插件加载诊断（官方 diagnostics）与 MCP server 连接失败落 notification/日志；权限裁决走既有 review log。

---

## 版本记录

| 版本 | 日期 | 变更 | 作者 |
|---|---|---|---|
| v0.1 | 2026-08-12 | 初稿（6 轮对抗式深潜后定稿） | AI + 人 |
