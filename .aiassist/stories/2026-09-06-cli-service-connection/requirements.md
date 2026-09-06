# CLI 服务连接管理与环境检测 — 需求

> 故事 ID：`2026-09-06-cli-service-connection`
> 版本：`v1`
> 哈希：见 `requirements-v1.hash`
> 最后更新：2026-09-06

---

## 全局约束

- **内置清单与严格本机 CLI**：支持的 CLI 范围由内置清单代码定义（首批 `claude` / `codex` / `crawl4ai`），不支持用户自定义清单条目；仅纳管本机可执行命令，非远程服务。
- **安全边界与命令执行**：探测与调用 spawn 一律使用 `execFile`（无 shell 参与，参数数组传参），消除 shell 注入攻击面；清单命令出厂权限规则默认 `ask`，项目未启用时覆盖为 `deny`，启用不代表静默放行。
- **凭据与敏感信息安全**：env 配置中的敏感值经 `secretStore` 加密存储，HTTP API 任何响应绝不回显 value 明文，仅返回已配置的 `envKeys` 名称列表；明文解密仅在 `agentService.buildConfigMessage` 构造 session-config 快照时单点发生。
- **两层启用模型**：全局启用 ∧ 项目启用 = 项目内可用；未在本机安装的 CLI 禁止启用（409 `E-CLI-NOT-INSTALLED`）；全局禁用的 CLI 禁止在项目内启用（409 `E-CLI-GLOBALLY-DISABLED`）。
- **真 SKILL.md 缝**：内置调用说明作为只读技能随应用分发，CLI 在项目启用时自动软链到项目技能目录，收敛链路幂等；用户自建同名 skill 享有更高覆盖优先级。
- **术语规范**：严格遵循 `CONTEXT.md` 中定义的「CLI 服务」、「内置清单」、「环境检测」、「两层启用」、「env 注入」、「分发渠道」、「内置 Skill」；消歧「产品 CLI」、「外部 agent CLI」与「CLI 服务」。

---

## REQ 列表

### REQ-CLI-SERVICE-001: 内置 CLI 清单注册表与数据结构

**分类：** P0
**优先级：** 必须
**Scope：** `intra-module`
**Capability：** `plugin-management`
**Entity：** `cli-service`
**测试类型：** 单元 / 集成

#### 验收标准

1. `cliRegistry` 导出首批 3 个内置清单条目，顺序固定为 `["claude", "codex", "crawl4ai"]`——EXPECTED-TRACE: PRD §6.3 块 1。
2. 每个条目包含完整结构：`id` (string), `displayName` (string), `command` (string), `versionArgs` (string[]), `versionRegex` (string), `channel` ("npm"|"pypi"), `package` (string), `installHint` (string), `builtinSkillSlug` (string)。
3. 条目精确配置：
   - `claude`：`command: "claude"`, `versionArgs: ["--version"]`, `channel: "npm"`, `package: "@anthropic-ai/claude-code"`, `builtinSkillSlug: "cli-claude"`。
   - `codex`：`command: "codex"`, `versionArgs: ["--version"]`, `channel: "npm"`, `package: "@openai/codex"`, `builtinSkillSlug: "cli-codex"`。
   - `crawl4ai`：`command: "crwl"`, `versionArgs: ["--version"]`, `channel: "pypi"`, `package: "crawl4ai"`, `builtinSkillSlug: "cli-crawl4ai"`。
4. `getRegistry()` / `findRegistryItem(id)` 纯函数：传入已知 id 返回对应条目；传入未知 id 返回 `null`。

#### 测试可追溯性

- 测试：`cliRegistry.test.js`
- Seam：`src/services/cliRegistry.js` 纯函数
- 断言：EXPECTED-TRACE PRD §6.3 块 1, §10.2

---

### REQ-CLI-SERVICE-002: 本机环境实时探测、超时与短缓存

**分类：** P0
**优先级：** 必须
**Scope：** `intra-module`
**Capability：** `plugin-management`
**Entity：** `cli-service`
**测试类型：** 单元 / 集成

#### 验收标准

1. `probe(id, { refresh })` 通过 `execFile(item.command, item.versionArgs)` 探测命令；若命令存在且输出包含版本字符串（如 `1.0.80 (Claude Code)`），按 `versionRegex`（默认 `(\d+\.\d+\.\d+)`）提取 semver，返回 `{ id, installed: true, version: "1.0.80" }`——EXPECTED-TRACE: PRD §6.3 块 2 row 1。
2. 若命令不存在（`ENOENT`），返回 `{ id, installed: false, version: null }`，不抛出异常——EXPECTED-TRACE: PRD §6.3 块 2 row 2。
3. 探测失败判定：若执行超过 5 秒超时、退出码非 0、或未输出有效版本（三者满足任一），返回 `{ id, installed: false, version: null, probeError: "E-CLI-PROBE-FAILED:<reason>" }`——EXPECTED-TRACE: PRD §6.2 异常行 2, §8 E2。
4. 缓存行为：探测结果具有 60 秒 TTL 内存短缓存（成功态、失败态均缓存）；60s 内再次调用 `probe(id)` 直接命中缓存不触发 spawn；传入 `refresh: true` 时绕过缓存强制重探——EXPECTED-TRACE: PRD §6.3 锚点 A5, §10.5 决策 3。
5. 并发与限流：同 `id` 的并发 probe 请求合并为一个 in-flight Promise；跨条目的全局并发 spawn 限制为 ≤ 4。

#### 测试可追溯性

- 测试：`cliProbe.test.js`
- Seam：`src/services/cliService.js` probe 方法
- 断言：EXPECTED-TRACE PRD §6.3 块 2, §8 E2, §10.5 决策 3

---

### REQ-CLI-SERVICE-003: 分发渠道最新版本查询与更新检测

**分类：** P1
**优先级：** 必须
**Scope：** `intra-module`
**Capability：** `plugin-management`
**Entity：** `cli-service`
**测试类型：** 单元 / 集成

#### 验收标准

1. 对 `channel: "npm"` 条目，请求 `https://registry.npmjs.org/<package>/latest` 解析 `version` 字段作为最新版本；对 `channel: "pypi"` 条目，请求 `https://pypi.org/pypi/<package>/json` 解析 `info.version` 字段——EXPECTED-TRACE: PRD §10.3 流 1。
2. 当 `installed: true` 且 `latestVersion` 存在时，通过 semver 比较：若 `latestVersion > version` 则 `updateAvailable: true`，否则 `false`——EXPECTED-TRACE: PRD §6.3 块 2 row 4。
3. 网络不可达、HTTP 错误或超时时，优雅降级：`latestVersion: "unknown"`, `updateAvailable: false`，不阻断探测与页面渲染，不抛出系统错误——EXPECTED-TRACE: PRD §6.2 异常行 3, §8 E3。
4. 最新版本查询结果具有 1 小时 TTL 独立缓存，避免频繁触达外部 registry。

#### 测试可追溯性

- 测试：`cliProbe.test.js`
- Seam：`src/services/cliService.js` 渠道版本检查
- 断言：EXPECTED-TRACE PRD §6.3 块 2 row 4, §8 E3, §10.3 流 1

---

### REQ-CLI-SERVICE-004: CLI 服务配置持久化与两层启用

**分类：** P0
**优先级：** 必须
**Scope：** `cross-module`
**Capability：** `plugin-management`
**Entity：** `cli-service`
**测试类型：** 集成

#### 验收标准

1. 数据库新增 `cli_services`（`id`, `enabled`, `env`, `timeout_sec`, `updated_at`）与 `cli_service_project_enablement`（`project_id`, `service_id`, `enabled`, `updated_at`）两张表。
2. 未在本机安装（`installed: false`）的条目，试图更新 `enabled: true` 时抛出 409 `E-CLI-NOT-INSTALLED`，拒绝启用——EXPECTED-TRACE: PRD §7.1 规则 2, §8 E1。
3. 当 CLI 全局禁用（`cli_services.enabled = 0`）时，试图在项目内启用（`setProjectEnabled(projectId, id, true)`）抛出 409 `E-CLI-GLOBALLY-DISABLED`——EXPECTED-TRACE: PRD §7.1 规则 3。
4. 调用超时设置验证：支持配置 `timeoutSec`，取值必须为整数且在 10–600 秒范围内；非法取值抛出 400 `E-CLI-INVALID-TIMEOUT`；未设置时默认 120 秒——EXPECTED-TRACE: PRD §7 规则 4。
5. `cliService.effectiveConfig(projectId)` 纯计算契约：仅返回同时满足「全局启用 ∧ 项目启用 ∧ 本机已安装（installed: true）」的条目列表——EXPECTED-TRACE: PRD §6.3 块 3 row 2, §10.4 接口 4。

#### 测试可追溯性

- 测试：`cliServiceConfig.test.js`, `cliHttpApi.test.js`
- Seam：`src/services/cliService.js` + SQLite DB
- 断言：EXPECTED-TRACE PRD §6.3 块 3, §7.1, §8 E1, §10.4 接口 2/3/4

---

### REQ-CLI-SERVICE-005: 环境变量配置加密存储与安全回显

**分类：** P0
**优先级：** 必须
**Scope：** `cross-module`
**Capability：** `plugin-management`
**Entity：** `cli-service`
**测试类型：** 集成

#### 验收标准

1. 配置 env 字典时，KEY 必须匹配正则表达式 `^[A-Z_][A-Z0-9_]*$`，单 KEY 长度 ≤ 128 字符；VALUE 必须非空且长度 ≤ 4096 字符；单 CLI 最多允许 50 个 env 条目；违反时拒绝保存并抛出 400 `E-CLI-INVALID-ENV-KEY`——EXPECTED-TRACE: PRD §7 规则 1/2/3, §8 E4。
2. 存入数据库时，env 字典中的每个敏感 VALUE 必须经 `secretStore.encrypt` 加密存储，数据库中不出现明文。
3. API 输出安全守卫：无论是 `GET /api/cli-services` 还是 `PUT /api/cli-services/:id`，响应中的 env 字段一律不输出明文，仅返回已配置 KEY 的名称数组 `envKeys: string[]`——EXPECTED-TRACE: PRD §6.3 块 3 row 1, §10.4 接口 1/2。
4. 全量替换语义：传入新 env 字典时完全覆盖该 CLI 的既有 env 配置，同名 KEY 更新值，未包含的旧 KEY 被删除。

#### 测试可追溯性

- 测试：`cliServiceConfig.test.js`, `cliHttpApi.test.js`
- Seam：`src/services/cliService.js` + `src/services/secretStore.js`
- 断言：EXPECTED-TRACE PRD §6.3 块 3 row 1, §7, §10.4 接口 1/2

---

### REQ-CLI-SERVICE-006: CLI 服务管理页列表呈现与操作

**分类：** P0
**优先级：** 必须
**Scope：** `cross-module`
**Capability：** `plugin-management`
**Entity：** `cli-service`
**测试类型：** 组件 / E2E
**UX 参照：** 仿 `src/renderer/pages/Mcp.jsx` 结构

#### 验收标准

1. 侧边栏包含「CLI 服务」导航项，点击进入 `/cli-services` 页面。
2. 页面按清单顺序渲染 3 个 CLI 卡片/列表行，展示条目名称、命令、检测状态（已安装/未安装/检测失败）及当前本地版本——EXPECTED-TRACE: PRD §6.1 流 A。
3. 当某条目未安装时，该行视觉置灰，展示安装指引文案（`installHint`），全局启用开关呈现为 disabled 状态无法开启——EXPECTED-TRACE: PRD §6.2 异常行 1, §6.3 块 4。
4. 当检测到新版本可用（`updateAvailable: true`）时，显示明显的高亮更新提示（如「可更新至 <latestVersion>」）。
5. 顶部提供「刷新」按钮，点击时调用带 `?refresh=1` 的 API 绕过缓存重新探测，刷新按钮展示 loading 态直到探测完成。
6. 提供项目启用弹窗/Popover：全局开启时可勾选当前已注册的项目列表；全局关闭时项目勾选操作 disabled。
7. 提供 env 配置弹窗：支持动态增删 KEY=VALUE 键值对，前端实时进行 KEY 大写命名与 VALUE 非空校验，保存成功后弹窗关闭并刷新列表。

#### 测试可追溯性

- 测试：`cliServicesPage.test.cjs`
- Seam：`src/renderer/pages/CliServices.jsx` (E2E)
- 断言：EXPECTED-TRACE PRD §6.1 流 A/B, §6.3 块 4, §7.1

---

### REQ-CLI-SERVICE-007: 内置 Skill 自动收敛与项目链接

**分类：** P0
**优先级：** 必须
**Scope：** `cross-module`
**Capability：** `plugin-management`
**Entity：** `cli-service`
**测试类型：** 单元 / 集成

#### 验收标准

1. 应用内置只读技能来源目录（`builtin/skills/`），包含 `cli-claude`、`cli-codex`、`cli-crawl4ai` 的完整 `SKILL.md`，内容包含该 CLI 的定位、命令行参数规范与一次性任务调用要求——EXPECTED-TRACE: PRD §6.3 块 5, §10.5 决策 2, ADR-043。
2. 当某 CLI 服务在某项目被启用（`enabled: true`）时，触发技能收敛动作：将对应内置技能目录通过软链（Symlink）链接到该项目的 skills 目录下，使 `listLinkedSkillPaths(projectId)` 包含该内置 skill 路径。
3. 当某 CLI 服务在某项目被禁用（`enabled: false`）时，自动解除该项目 skills 目录下对应内置技能的软链。
4. 收敛动作幂等：重复启用不产生重复软链，重复禁用不报错；若用户在项目自建了同名 slug 的技能，自建版本具有最高优先级，内置版本不覆盖用户版本。

#### 测试可追溯性

- 测试：`cliSkillSync.test.js`
- Seam：`src/services/skillService.js` 内置来源与 link/unlink 收敛
- 断言：EXPECTED-TRACE PRD §6.3 块 5, §10.5 决策 2, ADR-043

---

### REQ-CLI-SERVICE-008: session-config 快照解密注入与 worker 环境变量合并

**分类：** P0
**优先级：** 必须
**Scope：** `cross-module`
**Capability：** `plugin-management`
**Entity：** `cli-service`
**测试类型：** 单元 / 集成

#### 验收标准

1. 主进程 `agentService.buildConfigMessage(projectId)` 构造 `session-config` 时，调用 `cliService.effectiveConfig(projectId)`，并通过 `secretStore.decrypt` 将有效 CLI 的 env 明文快照注入到消息体中的 `cliServices` 数组——EXPECTED-TRACE: PRD §10.4 接口 4, §10.5 决策 4, ADR-043。
2. `cliServices` 快照格式：`[{ id: string, command: string, env: Record<string, string>, timeoutSec: number }]`；未启用的 CLI 不进入快照；这是全系统唯一的 env 解密发生点。
3. worker 接收并缓存当前会话的 `cliServices` 快照。
4. 当 worker 执行 bash 工具调用时，提取执行命令名；若命中 `cliServices` 快照中的条目（`claude` / `codex` / `crwl`），将该条目配置的 `env` 键值对合并到子进程执行环境变量 `options.env` 中；未启用的命令不注入任何该 CLI 的 env 变量。
5. 超时控制：子进程执行超时时间取该 CLI 配置的 `timeoutSec`（默认 120s）；超过则杀进程（SIGTERM → SIGKILL）并返回 `E-CLI-TIMEOUT`——EXPECTED-TRACE: PRD §8 E6。

#### 测试可追溯性

- 测试：`cliExecutionWiring.test.js`
- Seam：`src/services/agentService.js` + `src/agent/worker.js`
- 断言：EXPECTED-TRACE PRD §6.3 块 5, §8 E6, §10.4 接口 4, ADR-043

---

### REQ-CLI-SERVICE-009: 权限策略接线与出厂规则配平

**分类：** P0
**优先级：** 必须
**Scope：** `cross-module`
**Capability：** `plugin-management`
**Entity：** `cli-service`
**测试类型：** 单元 / 集成

#### 验收标准

1. `src/agent/policyRules.js` 与 `src/services/policyRules.js` 中的 `BASH_RULES` 必须显式包含清单命令规则：涵盖带参形态（`claude *`、`codex *`、`crwl *`）与裸命令形态（`claude`、`codex`、`crwl`），默认权限判定均为 `ask`——EXPECTED-TRACE: PRD §10.2, §10.5 决策 1, ADR-043。
2. 运行规则生成与配平检测（`gen-agent-policy`），确保出厂规则与部署策略 JSON 配平无漂移。
3. 项目层权限覆盖生成（ADR-022）：针对项目已启用的 CLI 服务，权限规则回落至默认层（用户可配置为 allow 或 ask）；针对项目未启用的 CLI 服务，生成项目层规则覆盖（包含 `cmd *` 与 `cmd`），权限判定为 `deny`。
4. 权限执行闭环：当 agent 试图执行未启用的清单命令时，权限链返回拦截判定并回传错误码 `E-CLI-NOT-ENABLED`，不创建任何系统子进程——EXPECTED-TRACE: PRD §6.2 异常行 5, §8 E5。

#### 测试可追溯性

- 测试：`cliExecutionWiring.test.js`
- Seam：`src/agent/policyRules.js` + 权限裁决管道
- 断言：EXPECTED-TRACE PRD §8 E5, §10.2, §10.5 决策 1, ADR-043

---

### REQ-CLI-SERVICE-010: 产品 CLI cli-service 命令族

**分类：** P1
**优先级：** 必须
**Scope：** `cross-module`
**Capability：** `command-interface`
**Entity：** `cli`
**测试类型：** CLI 集成

#### 验收标准

1. `opc-workstation cli-service list [--json]`：调用本地 HTTP API 查询 CLI 列表，格式化输出已安装/未安装状态、本地版本、最新版本、全局启用状态；`--json` 输出原始响应 JSON——EXPECTED-TRACE: PRD §10.4 接口 1, §11.1 Seam 1。
2. `opc-workstation cli-service probe <id>`：调用本地 API 对指定 CLI 发起实时探测，打印检测结果（包含 installed, version, channel, latestVersion）——EXPECTED-TRACE: PRD §10.4 接口 1, §11.1 Seam 2。
3. `opc-workstation cli-service enable <id> [--project <projectId>]`：若无 `--project` 则全局启用；有 `--project` 则在对应项目启用；若 CLI 未安装则报错退出——EXPECTED-TRACE: PRD §10.4 接口 2/3。
4. `opc-workstation cli-service disable <id> [--project <projectId>]`：全局或按项目禁用指定 CLI。
5. `opc-workstation cli-service env set <id> KEY=VALUE [KEY=VALUE...]`：配置环境变量，保存后仅确认设置的 KEY 列表，不打印 VALUE 明文；`env list <id>` 仅列出已配置的 KEY 名称——EXPECTED-TRACE: PRD §10.4 接口 2。

#### 测试可追溯性

- 测试：`cliServiceCommand.test.js`
- Seam：`src/cli/` 产品 CLI 命令族
- 断言：EXPECTED-TRACE PRD §10.4 接口 1/2/3, §11.1 Seam 1/2/3

---

## 变更记录

| 版本 | 哈希 | 日期 | 变更内容 | 触发重签的 REQ-ID |
|---|---|---|---|---|
| v1 | 见 requirements-v1.hash | 2026-09-06 | 初版（10 个 REQ，覆盖全部 5 个稳定块及产品 CLI 接缝，全部 trace 到 PRD v0.1 锚点） | 全部 |
| v1.1 | 见 requirements-v1.hash | 2026-09-06 | 第一轮 review 后契约修订：REQ-002 AC3 对齐 PRD §8 E2 三独立条件；REQ-008 AC2 快照补 timeoutSec 锚点；REQ-009 归属归位 plugin-management/cli-service；REQ-002 AC4 锚点标注修正为 §6.3 锚点 A5 | REQ-CLI-SERVICE-002 / 008 / 009 |
