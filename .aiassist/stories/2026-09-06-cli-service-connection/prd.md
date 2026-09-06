# CLI 服务连接管理与环境检测

> 状态：验收期（复核修订）
> 故事 ID：`2026-09-06-cli-service-connection`
> 最后更新：2026-09-06

---

## 1. 问题陈述

agent 运行时需要调用本机 CLI 服务来完成任务，但工作台目前只支持 MCP 连接——CLI 服务既不纳入管理，也不知道当前环境里装了哪些、可用性如何，agent 无法稳定使用。用户想让 agent 用 codex/claude 这类 CLI 时，只能自己手动确认装没装、登没登录，agent 侧没有任何发现与调用依据。

## 2. 解决方案

把本机 CLI 服务做成一等配置实体，全链对齐已有 MCP server 管理模式：内置清单注册表定义「支持哪些 CLI、怎么检测、去哪查新版本、怎么安装」；环境检测实时探测本机安装状态与版本并按分发渠道检查更新；两层启用（全局开关 + 按项目启用）与 env 凭据注入；独立管理页展示/操作；agent 侧通过内置 skill 获得调用说明，经工作台执行通道以一次性任务形态调用，权限走现有 broker/policy rules。

## 3. 用户故事

1. 作为工作台用户，我想要在管理页看到内置清单里每个 CLI 的安装状态、本地版本、最新版本与更新提示，以便知道当前环境能用哪些 CLI。
2. 作为工作台用户，我想要对未安装的 CLI 看到安装指引（官方文档/命令），以便按指引补齐环境。
3. 作为工作台用户，我想要全局启用/禁用某个 CLI 并按项目启用，以便控制 agent 在项目里能用哪些 CLI。
4. 作为工作台用户，我想要给 CLI 配置 env 注入（如 API key），敏感值加密存储、不明文回显，以便安全管理凭据。
5. 作为 PI agent，我想要在运行时获得「当前项目可用的 CLI 清单 + 调用说明（内置 skill）」，以便用一次性任务形态调用 CLI 完成工作。
6. 作为工作台用户，我想要 agent 调用 CLI 时经过权限管控（授权/拒绝/审计），以便防止越权执行。

## 4. 稳定块（已稳定，可结晶为 REQ）

| # | 稳定块 | 为什么不再推翻 |
|---|---|---|
| 1 | 内置 CLI 清单注册表（首批 claude / codex / crawl4ai）：每条目含 id、显示名、检测命令、版本解析、分发渠道（npm/PyPI）、安装指引、内置 skill 引用 | 访谈已确认「内置清单、严格本机 CLI」；清单机制本身支持后续加条目 |
| 2 | 环境检测服务：实时探测（命令存在性 + `--version` 版本解析）+ 短缓存 + 按分发渠道查询最新版本 | 访谈已确认「实时探测 + 短缓存」「按分发渠道查」 |
| 3 | CLI 服务配置管理：两层启用（全局开关 + 按项目启用）+ env 注入（secretStore 加密，不明文出 API） | 直接对齐 mcpService 已验收模式（REQ-AGENT-084~088） |
| 4 | 独立管理页（仿 Mcp.jsx）：清单列表（安装状态/版本/更新提示/未安装标灰+指引）、启用开关、env 配置、手动刷新 | 访谈已确认独立页 + 未安装给指引 |
| 5 | agent 调用面：每个 CLI 配内置说明 skill（简单 CLI 用通用模板），随启用状态注入 agent 上下文；调用经工作台执行通道，权限走 broker/policy rules | 访谈已确认「内置 skill + 可覆盖」「走现有权限体系」 |

## 5. 移动块（还在动，暂不入 REQ）

| # | 还在动的块 | 不确定什么 |
|---|---|---|
| 1 | CLI 调用历史/执行记录（类 skill-job 可观测性） | 收尾确认时用户未表态；不做不影响核心闭环——归入移动块，后续可随迭代稳定 |

> 2026-09-06 /tech-design：原移动块 2「内置 skill 注入机制」已收敛（真 SKILL.md 缝，见 §10.5 决策 2），升级为稳定块 5 的实现依据。

## 6. 用户操作流（Operation Flows）

### 6.1 主流程 / Happy Path

**流 A：查看环境检测（稳定块 1、2、4）**

| 步骤 | 用户动作 | 系统响应 | 验收锚点 |
|---|---|---|---|
| 1 | 打开侧边栏「CLI 服务」页 | 页面列出内置清单全部条目（claude / codex / crawl4ai），触发实时探测 | 清单顺序固定为注册表定义顺序 |
| 2 | 等待探测完成 | 每个条目显示：已安装（版本号 + 最新版本 + 有更新时提示）/ 未安装（标灰 + 安装指引）/ 检测失败（错误态） | §6.3 锚点 A1/A2 |
| 3 | 点击「刷新」 | 绕过缓存重新探测，更新状态与版本信息 | 缓存 TTL 内不刷新，刷新强制重探 |

**流 B：启用并配置 CLI（稳定块 3、4）**

| 步骤 | 用户动作 | 系统响应 | 验收锚点 |
|---|---|---|---|
| 1 | 在某 CLI 行打开全局开关 | 全局启用成功，该行变为可用态 | §6.3 锚点 B2 |
| 2 | 在项目启用 popover 中勾选当前项目 | 项目启用成功 | 两层启用：全局开 ∧ 项目启用 = 项目内可用 |
| 3 | 添加 env 项 `FOO=bar` 保存 | 保存成功；列表/详情不回显 value 明文 | §6.3 锚点 B1 |
| 4 | （agent 侧）在启用了该 CLI 的项目里发起相关任务 | agent 上下文含该 CLI 的内置 skill 调用说明，可通过执行通道调用 | §6.3 锚点 D1 |

**流 C：agent 调用 CLI（稳定块 5）**

| 步骤 | 用户动作 | 系统响应 | 验收锚点 |
|---|---|---|---|
| 1 | agent 依据内置 skill 发起一次 CLI 调用（一次性任务：命令 + 参数 + 超时） | 权限链裁决（broker/policy rules）；放行则 spawn 执行并回传 stdout/stderr/exit code | §6.3 锚点 D1 |
| 2 | 权限拒绝时 | agent 收到拒绝结果，不执行 | §8 错误态 E5 |

### 6.2 分支与异常

| 触发条件 | 分支结果 | 对应错误状态 |
|---|---|---|
| 本机未安装某 CLI | 该条目标灰，显示安装指引；启用开关不可用（禁止启用未安装项） | E1 |
| `--version` 探测超时（>5s）或非零退出 | 该条目显示「检测失败」+ 重试入口 | E2 |
| 新版本检查网络失败（registry 不可达） | 最新版本显示「未知」，不影响本地检测结果展示 | E3 |
| 保存 env 时 KEY 非法 / VALUE 为空 | 表单内联错误，不落库 | E4 |
| agent 调用未启用（全局关 ∨ 项目未启用）的 CLI | 权限链拒绝，不执行 | E5 |
| agent 调用不在内置清单内的命令 | 不经过本能力面，由既有 bash 权限规则处理 | N/A（本 story 不改变既有 bash 规则） |
| CLI 执行超时（默认 120s，可配） | 杀进程，回传超时错误 | E6 |

### 6.3 预期值锚点（Expected-Value Anchors）

| 锚点ID | 稳定块 | 输入 | 预期输出/结果 | 依据 |
|---|---|---|---|---|
| A1 | 1 | 内置清单 | 恰好 3 条目，id 顺序为 `["claude","codex","crawl4ai"]`；claude 条目：`command:"claude"`、`versionArgs:["--version"]`、`channel:"npm"`、`package:"@anthropic-ai/claude-code"`；codex 条目：`command:"codex"`、`channel:"npm"`、`package:"@openai/codex"`；crawl4ai 条目：`command:"crwl"`、`channel:"pypi"`、`package:"crawl4ai"` | 访谈确认首批清单；npm/PyPI 包名为官方分发名；crawl4ai CLI 入口为 `crwl`（[官方 CLI 文档](https://docs.crawl4ai.com/core/cli/)） |
| A2 | 2 | 本机存在 `claude`，`claude --version` 输出 `1.0.80 (Claude Code)` | 探测结果含 `{id:"claude", installed:true, version:"1.0.80"}`（版本用每条目配置的 regex 提取首个 semver） | 版本解析规则 = 每条目 `versionRegex`，默认 `(\d+\.\d+\.\d+)` |
| A3 | 2 | 本机不存在 `codex` 命令 | `{id:"codex", installed:false, version:null}`，UI 标灰 + 显示该条目 `installHint` | 访谈确认「展示未安装 + 安装指引」 |
| A4 | 2 | npm registry 返回 `@anthropic-ai/claude-code` latest `1.0.90`，本地 `1.0.80` | 条目含 `latestVersion:"1.0.90"`、`updateAvailable:true` | semver 比较，`latest > local` 即 true |
| A5 | 2 | 连续两次探测间隔 < TTL（60s） | 第二次命中缓存，不重新 spawn | 访谈确认「实时探测 + 短缓存」，TTL=60s |
| B1 | 3 | 保存 env `{"ANTHROPIC_API_KEY":"sk-ant-xxx"}` | DB 中 value 经 secretStore 加密存储；任何 API 响应中 value 不出现明文与密文（仅返回 `envKeys` 键名数组） | 对齐 mcpService bearer token 处理（secretStore）与 §10.4 接口契约 |
| B2 | 3 | 全局开关开、项目未启用 → `effectiveConfig(projectId)` | 该项目可用 CLI 清单不含此项 | 对齐 `mcp_project_enablement` 两层语义（全局开 ∧ 项目启用） |
| C1 | 4 | 页面加载且三项均未安装 | 3 行均标灰、均显示安装指引、启用开关均 disabled | 流 A + E1 |
| D1 | 5 | 项目内 agent 会话装配（codex 已全局开 + 项目启用） | 该项目的 linked skill 列表含内置 skill `cli-codex`（指向内置来源只读目录），会话 additionalSkillPaths 含其路径；skill 文本含命令名 `codex`、一次性调用示例、超时约束 | /tech-design 决策 2（真 SKILL.md 缝，复用 listLinkedSkillPaths 全链路） |

## 7. 表单与输入验证（Form / Input Validation）

| 输入字段 | 规则 | 有效例子 | 无效例子（→错误提示） | 错误状态 |
|---|---|---|---|---|
| env KEY | 正则 `^[A-Z_][A-Z0-9_]*$`，单条长度 ≤ 128 | `ANTHROPIC_API_KEY` | `api-key`（→「KEY 只能含大写字母、数字、下划线，且不能以数字开头」） | E4 |
| env VALUE | 非空，长度 ≤ 4096 | `sk-ant-xxx` | ``（空串 →「VALUE 不能为空」） | E4 |
| env 条目数 | 单 CLI ≤ 50 条 | 3 条 | 第 51 条（→「单个 CLI 最多 50 条 env」） | E4 |
| 调用超时（秒） | 整数，10–600 | `120` | `5`（→「超时需在 10–600 秒之间」） | E4 |

### 7.1 跨字段/业务规则

| 规则 | 触发时机 | 例子（触发 → 期望结果） | 错误状态 |
|---|---|---|---|
| env KEY 在同一 CLI 内唯一 | 保存时 | 已有 `A=1`，再存 `A=2` → 覆盖更新而非新增重复条 | E4 |
| 未安装的 CLI 禁止启用 | 打开全局开关时 | `codex` 未安装 → 开关 disabled，提示「未安装，无法启用」 | E1 |
| 项目启用前置 = 全局已启用 | 项目 popover 勾选时 | 全局关 → popover 内项目勾选 disabled | E1 |

## 8. 错误状态与失败响应（Error States / Failure Responses）

| 场景 | 触发条件 | 错误码/消息 | 用户可见状态 | 副作用/回滚 |
|---|---|---|---|---|
| E1 未安装启用 | 对 `installed:false` 条目启用 | `E-CLI-NOT-INSTALLED` | 开关 disabled + 安装指引 | 无副作用 |
| E2 探测失败 | `--version` 超时 5s / 非零退出 / 输出无法解析出版本 | `E-CLI-PROBE-FAILED:<原因>` | 条目「检测失败」+ 重试 | 缓存记录失败态，TTL 内不反复 spawn |
| E3 新版本检查失败 | npm/PyPI 请求超时/非 200 | 无错误码（降级） | `latestVersion:"unknown"`，本地状态照常 | 无副作用，不阻塞页面 |
| E4 输入校验失败 | §7 规则触发 | 字段级内联消息 | 表单标红，保存按钮不可用 | 不落库 |
| E5 权限拒绝 | agent 调用未启用/未授权 CLI | `E-CLI-NOT-ENABLED` / 权限链拒绝原因 | agent 收到拒绝结果 | 不执行，无进程产生 |
| E6 执行超时 | 调用超过配置超时（默认 120s） | `E-CLI-TIMEOUT` | agent 收到超时错误 + 已产生的部分输出 | 杀子进程（SIGTERM→SIGKILL） |

## 9. 复杂度分级

| 维度 | 取值/说明 |
|---|---|
| 复杂度 | **complex** |
| 判断理由 | 触模块多（DB 新表、新 service、HTTP 路由、新 UI 页、权限链、内置 skill 注入）；外部依赖多（npm registry、PyPI、本机 spawn）；有安全敏感面（命令执行权限颗粒度、env 凭据） |

- 结晶路径：`PRD → DESIGN → DOMAIN-MODEL → TECH-DESIGN → CRYSTALLIZE`。**结晶前必须先走 `/tech-design` 深潜补全 §10**，重点回答：①「只放行已启用 CLI」的权限规则颗粒度（安全边界）；②内置 skill 注入/覆盖机制；③探测与缓存的并发模型。

## 10. 技术方案（Implementation Decisions）

> complex story：本节由 `/tech-design` 深潜填充（2026-09-06，三个深潜重点均已收敛：①权限颗粒度=静态生成 ②内置 skill=真 SKILL.md 缝 ③探测缓存并发模型）。深潜依据：policyRules/gotgenes 规则面与 worker 装配链路代码实证。

### 10.1 设计目标

- 以最小新模式成本把「本机 CLI 服务」纳为一等配置实体：实体模型、两层启用、探测、权限全部对齐 mcp-server 已有验收模式，新增的只有「本机命令探测 + 分发渠道版本检查 + 内置 skill 调用面」。

### 10.2 模块与边界

| 模块 | 职责 | 是否新增 |
|---|---|---|
| cliRegistry（内置清单） | 清单条目静态定义（id/显示名/command/versionArgs/versionRegex/分发渠道+包名/安装指引/内置 skill slug）；纯数据 + 纯函数 | 是 |
| cliService | 探测（probe：存在性+版本+缓存+in-flight 合并+限流）、版本检查（按渠道查 latest）、配置读写（两层启用/env/超时）、effectiveConfig(projectId) | 是 |
| DB 层 | `cli_services`（id 主键、enabled、env 加密、timeoutSec）+ `cli_service_project_enablement` 两表，对齐 `mcp_servers`/`mcp_project_enablement` | 是（表） |
| HTTP 路由 /api/cli-services | 列表（含探测结果）/刷新探测/启用/env/超时/项目启用 | 是 |
| 管理页（renderer） | 独立页 CliServices + 侧边栏导航，照搬 Mcp.jsx 模式 | 是 |
| policyRules（ADR-020 真源） | BASH_RULES 增加清单命令出厂规则（默认 ask）；重新生成部署 JSON | 否（扩展） |
| 项目权限覆盖层（ADR-022） | 两层启用状态生成项目层 bash 规则覆盖：未启用 → deny；启用 → 回落默认层；权限规则 mtime 热生效（ADR-022），env/skill 装配冷生效（新会话，见 §10.5 决策 1） | 否（复用） |
| skillService | 新增「内置来源」目录类（应用自带只读 SKILL.md 目录注册进技能库）；CLI 项目启用 ⇄ 自动 link/unlink 对应内置 skill（复用收敛机制） | 否（扩展） |
| agentService.buildConfigMessage | session-config 唯一构造点：追加已启用 CLI 的 env 解密快照（cliServices 段） | 否（扩展） |
| worker bash 执行 | 命中已启用清单命令时合并该 CLI 的 env 快照进子进程环境 | 否（扩展） |
| secretStore | env value 加解密（快照注入是唯一解密点，对齐 ADR-025） | 否（复用） |

#### 模块关系图

```
[用户: 管理页/产品CLI]                [agent: bash 工具调用 claude/codex/crwl]
        │                                        │
        ▼                                        ▼
[/api/cli-services]                    [gotgenes bash 规则: 出厂 ask / 项目层 deny·allow]
        │                                        │ 放行
        ▼                                        ▼
[cliService] ──probe──> [本机 spawn --version]   [worker bash 执行: 合并 env 快照 → spawn]
   │    └──版本检查──> [npm registry / PyPI]          │
   │                                                   │
   ├──配置读写──> [DB: cli_services / _project_enablement]
   │                                                   │
   └──effectiveConfig(projectId) ──> [buildConfigMessage: env 解密快照]
                                           │
[skillService: 启用⇄link 内置 SKILL.md] <────┘（同一启用动作的两个装配副作用）
```

### 10.3 数据流

1. **环境检测**：打开管理页/产品 CLI `cli-service list` → GET /api/cli-services → cliService.probe() 逐条目：缓存命中（TTL 60s，含失败态）直接返回；未命中且同 id 无 in-flight → 限流（全局 ≤4 并发）spawn `execFile(command, versionArgs)`（无 shell，参数数组，无注入面）→ versionRegex 提取 semver → 写缓存。版本检查独立缓存（TTL 1h）：npm `GET https://registry.npmjs.org/<pkg>/latest` / PyPI `GET https://pypi.org/pypi/<pkg>/json`，失败降级 `latestVersion:"unknown"` 不阻塞。
2. **启用配置**：用户开全局开关（前置：installed=true，否则 E1）→ 写 DB → 项目勾选启用 → 写 enablement 表 → 触发两个装配副作用：①项目层权限覆盖生成（ADR-022 语义：权限策略基于 mtime 保存即生效，即时 deny 阻断未启用 CLI；而环境变量快照基于 session-config 冷注入，新会话生效避免会话中凭据漂移）；②内置 skill 自动 link 到项目（收敛机制幂等，严格保留用户自有软链与目录）。禁用反向：deny 覆盖 + unlink。
3. **agent 调用**：agent 经内置 skill 指导发起 bash 调用（如 `codex exec "..."`）→ gotgenes bash 规则裁决（出厂 ask / 项目层覆盖；ask 走授权桥确认挂起）→ 放行后 worker bash 执行检出命令属于已启用 CLI → 合并 session-config 快照中的 env → spawn 一次性任务 → stdout/stderr/exit code 回传（输出按 256KB 截断单真源 shrinkToolCarrier 对齐，ADR-029）；超时（默认 120s，10–600 可配）杀进程 E6。

### 10.4 接口契约

#### 接口 1：GET /api/cli-services（列表 + 探测结果）

| 项目 | 说明 |
|---|---|
| 调用方 | 管理页 / 产品 CLI |
| 被调用方 | cliService |
| 输入 | query `?refresh=1`（绕过缓存强制重探）；query `?project=<id>`（投影指定项目下的启用状态，对齐 plugins?project= 先例）；端点亦支持全项目启用态聚合读取 |
| 输出 | `{ services: [{ id, displayName, installed, version, latestVersion, updateAvailable, enabled, envKeys: string[], timeoutSec, installHint, probeError? }] }` |
| 业务错误 | 无（探测失败是数据不是错误：`installed:false` 或 `probeError` 字段） |
| 系统错误 | 500 `E-CLI-REGISTRY-CORRUPT`（内置清单缺失——启动期自检应拦截） |
| 副作用 | 触发探测 spawn / 渠道 HTTP（缓存未命中时） |
| 幂等性 | 是（缓存 + in-flight 合并） |

**样例（golden values）**：

| 场景 | 请求/输入 | 期望响应/输出 |
|---|---|---|
| 正常（本机实测 2026-09-06） | `GET /api/cli-services` | claude 条目：`{id:"claude", installed:true, version:"2.1.246", latestVersion:"2.1.263", updateAvailable:true}`；codex 条目：`{id:"codex", installed:false, version:null}` |
| 边界（缓存内二次请求） | 60s 内第二次 GET | 响应字节级一致，无新 spawn |
| 异常（渠道不可达） | PyPI 超时 | crawl4ai 条目 `latestVersion:"unknown"`，其余字段正常 |

#### 接口 1b：GET /api/cli-services/project-enablements（全项目启用态聚合）

| 项目 | 说明 |
|---|---|
| 调用方 | 管理页（项目启用 popover 回显，单次请求替代逐项目 N+1） |
| 被调用方 | cliService.listProjectEnablements |
| 输入 | 无 |
| 输出 | `{ enablements: { [serviceId]: string[] } }`——serviceId → 已启用该项目服务（enabled=1）的 projectId 数组；无启用关系的 serviceId 不出现 |
| 业务错误 | 无 |
| 系统错误 | 500（DB 读失败） |
| 副作用 | 无（直查 `cli_service_project_enablement` 表，不探测、不请求渠道、不解密） |
| 幂等性 | 是 |

#### 接口 2：PUT /api/cli-services/:id（配置：启用/env/超时）

| 项目 | 说明 |
|---|---|
| 调用方 | 管理页 / 产品 CLI |
| 被调用方 | cliService |
| 输入 | `{ enabled?: boolean, env?: Record<string,string>, timeoutSec?: number }`（env 为全量替换语义，对齐 mcpPermissionDefaults replace 模式） |
| 输出 | 更新后条目（env 只回 key 列表，不回 value） |
| 业务错误 | 400 `E-CLI-INVALID-ENV-KEY` / `E-CLI-INVALID-TIMEOUT`；404 `E-CLI-UNKNOWN-ID`（id 不在内置清单）；409 `E-CLI-NOT-INSTALLED`（E1） |
| 系统错误 | 500 DB 写失败 |
| 副作用 | 写 DB；启用状态变化触发权限覆盖生成 + skill link/unlink |
| 幂等性 | 是（全量替换 + 收敛幂等） |

#### 接口 3：PUT /api/cli-services/:id/projects/:projectId（项目启用）

| 项目 | 说明 |
|---|---|
| 输入 | `{ enabled: boolean }` |
| 业务错误 | 404 `E-CLI-UNKNOWN-ID` / `E-PROJECT-NOT-FOUND`；409 `E-CLI-GLOBALLY-DISABLED`（全局关时禁止项目启用，§7.1 规则 3） |
| 副作用 | 写 enablement 表 + 同接口 2 的两个装配副作用 |
| 幂等性 | 是 |

#### 接口 4：cliService.effectiveConfig(projectId)（装配契约，内部）

| 项目 | 说明 |
|---|---|
| 调用方 | agentService.buildConfigMessage（session-config 唯一构造点） |
| 输出 | `[{ id, command, env: {KEY: 解密明文}, timeoutSec: number }]`——仅含「全局开 ∧ 项目启用 ∧ installed」的条目；env 解密只发生在此快照注入（对齐 ADR-025「快照是唯一解密点」）；包含可配 timeoutSec 供 worker 执行超时控制 |
| 副作用 | 读 DB + secretStore 解密；不写 |

#### 命令匹配与安全注入契约（TECH-3 / SEC-3）

1. **环境变量注入匹配**：仅当命令的首个可执行 token（剥离前导 KEY=VALUE 环境变量与引号）为裸命令（即不含 `/` 或 `\` 路径分隔符，且严格匹配 `entry.command` 或 `entry.id`）时，才注入快照环境变量；任何以 `./` 或全路径形态调用的命令绝不注入受管环境变量，防止未授权二进制劫持凭据。
2. **权限规则匹配**：出厂规则表 `BASH_RULES` 与项目层覆盖规则必须同时覆盖带参形态（`cmd *`）与裸命令形态（`cmd`），确保无参调用同样受到权限管控，消除 deny 绕过漏洞。

### 10.5 关键决策

| 决策 | 选项 | 选择理由 | 风险 |
|---|---|---|---|
| 1. 权限接线 = 静态生成 | 静态生成（出厂规则表加清单命令默认 ask + 两层启用生成项目层覆盖）vs 动态 pre-gate | 用户确认；零新机制，完全对齐 MCP 默认层/项目覆盖先例（ADR-020/022/025）。显式记录分裂生效语义：权限基于 ADR-022 mtime 热生效（即时阻断未启用 CLI 防止逃逸），而环境变量快照基于 session-config 冷注入（新会话加载最新凭据，避免热会话凭据漂移） | 组合命令逃逸面受 glob 整条匹配约束——缓解：默认 ask 而非 allow，高危命令段仍有出厂破坏性 pattern 兜底 |
| 2. 内置 skill = 真 SKILL.md 缝 | 真 SKILL.md（内置来源目录 + 启用自动 link，复用 listLinkedSkillPaths 全链路）vs systemPrompt 文本段 | 用户确认；零新装配代码；天然满足「内置 skill + 可覆盖」（用户自建同 slug skill 优先/手动 unlink 自管） | 「内置来源」是技能库目录类型的小扩展；启用态与 link 态需收敛保持一致（复用既有幂等收敛） |
| 3. 探测缓存并发模型 | per-entry 缓存 TTL 60s（含失败态）+ 版本检查 1h + in-flight 合并 + 全局并发 ≤4 | 用户确认；UI 打开页与 CLI list 并发触发不产生重复 spawn | 缓存窗口内状态滞后（可 `?refresh=1` 强制重探） |
| 4. env 注入 = session-config 快照 | 快照注入（buildConfigMessage 携带解密 env，worker bash 执行按命令匹配合并）vs 调用时实时查库 | 对齐 ADR-025 快照模式；worker 无 DB 访问；解密点唯一 | worker 内存持有明文密钥（与 MCP bearer 快照同风险级，已接受先例） |
| 5. 调用面不做专门桥 | 内置 skill 指导 agent 经既有 bash 执行通道调用 | 用户确认（访谈 Q12）；简单 CLI 通用模板即可 | skill 指导失败率高时需补专门桥——见 §10.6 |

### 10.6 风险与回流点

| 假设 | 如果错了会怎样 | 回流到 | 能否快速验证 |
|---|---|---|---|
| 权限 glob 能覆盖清单命令且组合命令风险可接受 | agent 借 `&&`/`;` 组合逃逸白名单语义 | TECH-DESIGN（加固：兜底翻 ask / 预检分段） | 能（BUILD 期用组合命令用例实测） |
| `crwl`/`codex` 的 `--version` 输出含 semver（`claude` 已实测 `2.1.246 (Claude Code)`） | 版本解析失败，检测退化 | TECH-DESIGN（调 versionRegex，低成本） | 能（本机实测；codex/crwl 本机未装，用 stub 输出契约锁定） |
| skill 指导足以让 agent 正确一次性调用 | 调用失败率高，需补专门调用桥 | TECH-DESIGN（方案层，初衷不变） | 不能（需 BUILD 后实测） |
| 版本检查接口形态稳定（npm `/latest`、PyPI `/json` 已实测可用） | 更新提示失效 | TECH-DESIGN（换渠道端点，低成本） | 能（已实测） |

### 10.7 安全/性能/可观测性

- **安全**（对照 checklists/security.md）：①探测与调用 spawn 一律 `execFile`（无 shell，参数数组）消除命令注入面；②env 明文只存在于 session-config 快照与 worker 子进程环境，不落盘、不出 API（接口 2 只回 key 列表）；③清单命令出厂默认 ask，启用不意味着静默放行；④管理页/产品 CLI 的 API 面纳入本地敏感端点守卫口径（ADR-042 决策 5 的 Loopback 守卫模式，server 已有统一挂载点）。
- **性能**（对照 checklists/performance.md）：探测/版本检查双 TTL 缓存 + in-flight 合并 + 并发 ≤4；管理页加载不被渠道请求阻塞（latestVersion 异步降级）。
- **可观测性**（对照 checklists/observability.md）：probe 失败/超时记服务日志（含条目 id 与原因）；agent 调用天然经会话轨迹（turnEventPipeline/ADR-038）留痕——调用历史专门面仍是移动块 1，不在本期承诺。

## 11. 测试决策（Testing Decisions）

### 11.1 覆盖接缝（coverage seams，CLI 优先）

| 稳定块 | Seam | 测试类型 | 依赖处理 |
|---|---|---|---|
| 1 清单注册表 | cliRegistry 纯函数（条目结构/顺序/字段完整性）；产品 CLI `opc-workstation cli-service list` | 单元 + CLI 集成 | 无依赖 |
| 2 环境检测 | cliService.probe：stub spawn（模拟 which/--version 输出）+ stub 分发渠道 HTTP（npm/PyPI 响应）；缓存 TTL / in-flight 合并行为；产品 CLI `opc-workstation cli-service probe <id>` | 单元 + 集成 | spawn 与 registry 请求全部 stub（对齐 mcpProbeTools 不测真实外部依赖的先例） |
| 3 配置管理 | HTTP API /api/cli-services（启用/env/超时/项目启用/effectiveConfig/env 掩码）；产品 CLI `cli-service enable/disable/env` 命令族 | 集成（API 级，真实 SQLite） | 真实 DB，对齐 mcpHttpUpdate 先例 |
| 3 权限接线 | policyRules 出厂规则含清单命令（配平测试锁漂移）；项目层覆盖生成（启用→默认层回落 / 未启用→deny） | 单元 + 集成 | gen-agent-policy 生成产物配平 |
| 4 管理页 | 产品 CLI 优先；页面结构/行为 E2E（Playwright：列表渲染、标灰+指引、开关 disabled、env 表单校验、刷新） | E2E | 后端 stub 探测结果 |
| 5 agent 调用面 | 内置 skill link/unlink 随启用收敛（listLinkedSkillPaths）；session-config cliServices 段快照（env 解密仅此点）；worker bash env 合并；权限拒绝路径（E5） | 单元 + 集成 | broker stub；spawn stub |

### 11.2 测试策略与先例

- 只测外部行为：探测结果、API 响应、页面结构/行为；不测 spawn 实现细节。
- 先例：`tests/capabilities/plugin-management/mcp-server/2026-08-12-pi-mcp-plugin/`（mcpService 单测 + mcpHttp* API 集成 + mcpPage E2E）逐层对齐。
- 能力域归属：plugin-management 下新增 entity `cli-service`（待 /domain-model 确认）。

## 12. 范围外

- CLI-as-agent-runtime（把 CLI 当运行时跑多轮会话——ADR-013 推迟项的另一部分）。
- 交互式会话 / REPL 式调用。
- 非本机 CLI 的服务连接（飞书/远程 HTTP 服务已有接入或另开 story）。
- 自动安装 / 自动升级 CLI（只检测 + 指引）。
- 用户自定义 CLI 条目（清单内置，不开放自定义）。
- CLI 调用历史/执行记录（移动块 1，本 story 不承诺）。

## 13. 补充说明

- 本 story 补齐 ADR-013 后果第 4 条「扫描本机已装 agent」与 ADR-005「调用本机 claude CLI」中被显式推迟的能力之一部分（检测 + 管理 + 一次性调用）。
- crawl4ai 的 CLI 入口为 `crwl`（pip 安装 `crawl4ai` 后获得；v0.5.0 起提供 CLI；版本检测备选 `pip show crawl4ai`），见 [官方 CLI 文档](https://docs.crawl4ai.com/core/cli/)。
- 连接模型决策（静态权限生成 / 真 SKILL.md 缝 / env 快照注入）已沉淀为 ADR-043。
- 访谈笔记：`interview-notes.md`。

## 14. PRD 完整性自检查

| 检查项 | 状态 | 备注 |
|---|---|---|
| 操作流 | PASS | 流 A/B/C 覆盖全部 5 个稳定块，§6.2 分支 7 条 |
| 输入验证 | PASS | §7 四条字段规则 + §7.1 三条业务规则，均带有效/无效例子 |
| 错误状态 | PASS | E1–E6，含跨模块（registry 网络、spawn、权限链）失败 |
| 预期值锚点 | PASS | §6.3 每条稳定块 ≥1 条字面值锚点（清单条目字段、探测 JSON、缓存 TTL、env 掩码、semver 比较） |
| 复杂度分级 | complex | §9 理由：多模块 + 外部依赖 + 安全敏感面 |
| 技术方案（§10） | PASS | 2026-09-06 /tech-design 深潜完成：§10.1–10.7 全量填充；关键决策 5 项（含 3 个深潜重点）已用户确认 |
| 覆盖接缝 | PASS | §11.1 每个稳定块 ≥1 个 seam，CLI/API 优先，E2E 仅页面行为 |

---

## 版本记录

| 版本 | 日期 | 变更 | 作者 |
|---|---|---|---|
| v0.1 | 2026-09-06 | 初稿（基于 interview-notes.md，方向 A） | AI + 人 |
