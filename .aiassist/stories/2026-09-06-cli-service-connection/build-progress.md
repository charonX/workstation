# BUILD 进度 — 2026-09-06-cli-service-connection

> REQ 版本：v1（hash `7a08fa0c5ef0d0de30c2e6ac387f5cfc7b3534a2baebed30b2dc11edbe6563a9`）
> 门 1 已通过（signoff.md，AI 全量自检零升级点）。测试已锁定，实现者对业务测试只读。

## 切片划分（按 requirements.md 与技术架构分层）

| Slice | 名称 | REQ-ID | 对应测试文件 | 范围 | 依赖 | 状态 |
|---|---|---|---|---|---|---|
| 1 | 内置清单与环境探测 | REQ-CLI-SERVICE-001, 002, 003 | `api/cliRegistry.test.js`、`api/cliProbe.test.js` | `src/services/cliRegistry.js` + `src/services/cliService.js` (probe, checkLatestVersion, 60s TTL cache, concurrency <= 4) | — | 完成 |
| 2 | 配置持久化与凭据加密 | REQ-CLI-SERVICE-004, 005 | `api/cliServiceConfig.test.js` | `src/db.js` DDL + `src/services/cliService.js` (两层启用、timeoutSec、env secretStore 加密与掩码、effectiveConfig) | Slice 1 | 完成 |
| 3 | HTTP API 与产品 CLI | REQ-CLI-SERVICE-004, 005, 010 | `api/cliHttpApi.test.js`、`cli/cliServiceCommand.test.js` | `src/http/routes/cliServices.js` + `src/http/server.js` 挂载 + `src/cli/commands/cliService.js` + `src/cli/opc-workstation.js` 挂载 | Slice 2 | 完成 |
| 4 | 内置 Skill 与软链收敛 | REQ-CLI-SERVICE-007 | `api/cliSkillSync.test.js` | `builtin/skills/` 3 份 SKILL.md + `src/services/skillService.js` (`getBuiltinSkillPath`, `syncProjectCliSkills`) | — | 完成 |
| 5 | 权限策略与 worker 执行接线 | REQ-CLI-SERVICE-008, 009 | `api/cliExecutionWiring.test.js` | `src/services/policyRules.js` BASH_RULES + `src/agent/policyRules.js` + `src/services/agentService.js` (buildConfigMessage 快照注入、resolveCliEnvForCommand) + worker 执行合并 | Slice 2 | 完成 |
| 6 | 前端管理页渲染与交互 | REQ-CLI-SERVICE-006 | `e2e/cliServicesPage.test.cjs` | `src/renderer/pages/CliServices.jsx` + 路由与侧边栏接入 + data-testid 契约 | Slice 3 | 完成 |

## 关键既有资产（实现参考先例）

- `src/services/mcpService.js`：MCP Server 配置 CRUD、`effectiveConfig` 计算、两层启用与 `mcp_project_enablement` 模式。
- `src/services/secretStore.js`：`encryptSecret` / `decryptSecret` 凭据加密与解密。
- `src/http/routes/mcp.js`：HTTP 路由处理模式，`responders.js`（`ok`, `mapError`, `badRequest`, `notFound`）。
- `src/cli/commands/mcp.js`：产品 CLI 命令族实现模式（JSON 输出，错误处理）。
- `src/services/skillService.js`：技能软链管理与项目关联收敛机制。
- `src/services/policyRules.js`：BASH_RULES 出厂权限规则唯一真源。

## 测试命令

- 业务测试（单元/API/CLI）：`NODE_ENV=test node --import ./scripts/session-lifecycle-seam.mjs --test <file>`
- 全量单元测试：`npm run test:unit`
- E2E 测试：`playwright test`

## 进度日志

### Slice 1：内置清单与环境探测服务（2026-09-06）

#### PRD → 代码 可追溯性表

| REQ-ID | 需求描述 | PRD 章节依据 | 实现代码 | 对应测试 | 验证状态 |
|---|---|---|---|---|---|
| REQ-CLI-SERVICE-001 | 内置 CLI 清单注册表与数据结构 | §6.3 块 1, §10.2 | `src/services/cliRegistry.js` (`CLI_REGISTRY`, `getRegistry`, `findRegistryItem`) | `tests/.../api/cliRegistry.test.js` | 全绿（6/6 pass） |
| REQ-CLI-SERVICE-002 | 本机环境实时探测、超时与短缓存 | §6.3 块 2, §7, §8 E2, §10.3 流 1, §10.5 决策 3 | `src/services/cliService.js` (`probe`, `ConcurrencyLimiter`, `defaultExecFile`) | `tests/.../api/cliProbe.test.js` (rows 1-5) | 全绿（5/5 pass） |
| REQ-CLI-SERVICE-003 | 分发渠道最新版本查询与更新检测 | §6.3 块 2 row 4, §8 E3, §10.3 流 1 | `src/services/cliService.js` (`checkLatestVersion`, `compareSemver`, `parseSemver`, `defaultFetchLatest`) | `tests/.../api/cliProbe.test.js` (rows 6-7) | 全绿（2/2 pass） |

#### 验证日志

- **测试命令执行**：
  - `cliRegistry.test.js`：6 passed，0 failed，耗时 40.7ms。覆盖清单固定顺序（`claude`, `codex`, `crawl4ai`）、完整字段结构、条目精确匹配（`crawl4ai` 的 command 为 `crwl`、channel 为 `pypi`、builtinSkillSlug 为 `cli-crawl4ai`）、未知 id 返回 null。
  - `cliProbe.test.js`：7 passed，0 failed，耗时 80.7ms。覆盖已安装 CLI 解析、未安装 CLI（ENOENT 返回 `installed: false, version: null` 且不抛错）、超时/失败返回 `E-CLI-PROBE-FAILED:<reason>`、60s TTL 短缓存与 refresh 绕过、同 id 并发合并与全局并发 ≤ 4 限流、渠道最新版本比较与更新标记、网络失败优雅降级（`unknown`, `updateAvailable: false`）。
- **代码静态检查**：
  - `npm run lint`：`src/services/cliRegistry.js` 与 `src/services/cliService.js` 0 error，0 warning。
- **状态**：
  Slice 1: complete (c787e30..ea70df9, tests green, PRD alignment passed)
  Slice 1: refactor pass done (ea70df9..d5411cf, tests green, no rollback)

### Slice 2：配置持久化与凭据加密（2026-09-06）

#### PRD → 代码 可追溯性表

| REQ-ID | 需求描述 | PRD 章节依据 | 实现代码 | 对应测试 | 验证状态 |
|---|---|---|---|---|---|
| REQ-CLI-SERVICE-004 | CLI 服务配置持久化与两层启用 | §6.3 块 3 row 2, §7.1 规则 2/3, §7 规则 4, §8 E1, §10.2, §10.4 接口 2/3/4 | `src/db.js` (CLI_SERVICES_DDL, initSchema, migrateSchema, resetDb) + `src/services/cliService.js` (`setGlobalEnabled`, `setProjectEnabled`, `updateConfig`, `effectiveConfig`) | `tests/.../api/cliServiceConfig.test.js` (tests 1, 2, 3, 4) | 全绿（4/4 pass） |
| REQ-CLI-SERVICE-005 | 环境变量配置加密存储与安全回显 | §6.3 块 3 row 1, §7 规则 1/2/3, §8 E4, §10.4 接口 1/2, §10.5 决策 4 | `src/services/cliService.js` (`updateConfig` 校验+加密, `getConfig` envKeys 脱敏, `_getRawDbRow`) + `src/services/secretStore.js` | `tests/.../api/cliServiceConfig.test.js` (tests 5, 6, 7) | 全绿（3/3 pass） |

#### 验证日志

- **测试命令执行**：
  - `cliServiceConfig.test.js`：7 passed，0 failed，耗时 49.2ms。覆盖未安装 CLI 禁用全局开启（`E-CLI-NOT-INSTALLED`）、全局未启用禁止在项目启用（`E-CLI-GLOBALLY-DISABLED`）、调用超时范围校验 10-600s（`E-CLI-INVALID-TIMEOUT`）、两层启用与 effectiveConfig 计算（仅全局开 ∧ 项目开 ∧ 已安装 返回解密 env）、环境变量输入校验（正则与非空检查 `E-CLI-INVALID-ENV-KEY`）、环境变量加密存储与 API 脱敏仅返回 envKeys、全量替换覆盖语义。
  - 回归测试全绿：
    - `cliRegistry.test.js`：6 passed，0 failed，耗时 1.5ms。
    - `cliProbe.test.js`：7 passed，0 failed，耗时 51.3ms。
    - `dbPerPathCache.test.js`：11 passed，0 failed，耗时 71.6ms。
- **代码静态检查**：
  - `npm run lint`：`src/db.js` 与 `src/services/cliService.js` 0 error，0 warning。
- **状态**：
  Slice 2: complete (d5411cf..403ab79, tests green, PRD alignment passed)
  Slice 2: refactor pass done (403ab79..d68119f, tests green, no rollback)

### Slice 3：HTTP API 路由与产品 CLI 命令族（2026-09-06）

#### PRD → 代码 可追溯性表

| REQ-ID | 需求描述 | PRD 章节依据 | 实现代码 | 对应测试 | 验证状态 |
|---|---|---|---|---|---|
| REQ-CLI-SERVICE-004 | CLI 服务配置持久化与两层启用（HTTP 路由面） | §6.3 块 3, §7.1 规则 2/3, §8 E1, §10.2, §10.4 接口 1/2/3 | `src/http/routes/cliServices.js` (`handleCliServices`) + `src/http/server.js` (挂载 `case "cli-services":`) | `tests/.../api/cliHttpApi.test.js` (tests 1, 2, 3, 5) | 全绿（4/4 pass） |
| REQ-CLI-SERVICE-005 | 环境变量配置加密存储与安全回显（HTTP 路由面） | §6.3 块 3, §7 规则 1/2, §8 E4, §10.4 接口 1/2 | `src/http/routes/cliServices.js` (输入校验 400 `E-CLI-INVALID-ENV-KEY`、脱敏回显) | `tests/.../api/cliHttpApi.test.js` (test 4) | 全绿（1/1 pass） |
| REQ-CLI-SERVICE-010 | 产品 CLI cli-service 命令族 | §10.4 接口 1/2/3, §11.1 Seam 1/2/3 | `src/cli/commands/cliService.js` (`list`, `probe`, `enable`, `disable`, `env`) + `src/cli/opc-workstation.js` (注册 `"cli-service"`) | `tests/.../cli/cliServiceCommand.test.js` (tests 1, 2, 3, 4) | 全绿（4/4 pass） |

#### 验证日志

- **测试命令执行**：
  - `cliHttpApi.test.js`：5 passed，0 failed，耗时 2024.7ms。覆盖 `GET /api/cli-services`（列表与 golden values、无明文 env 只有 envKeys 数组）、`GET /api/cli-services?refresh=1`（强制重探）、`PUT /api/cli-services/:id`（配置更新、未知 id 返回 404 `E-CLI-UNKNOWN-ID`）、`PUT /api/cli-services/:id` 校验错误返回 400 `E-CLI-INVALID-ENV-KEY`、`PUT /api/cli-services/:id/projects/:projectId` 全局未启用返回 409 `E-CLI-GLOBALLY-DISABLED`。
  - `cliServiceCommand.test.js`：4 passed，0 failed，耗时 6441.9ms。覆盖 `opc-workstation cli-service list --json`（输出 3 个内置服务条目）、`opc-workstation cli-service probe <id>`（返回指定 CLI 的实时探测结果）、`opc-workstation cli-service env set 与 list`（安全展示 key，绝不打印明文 value）、`opc-workstation cli-service enable <id>`（未安装 CLI 报错 `E-CLI-NOT-INSTALLED` 且退出码非 0）。
  - 回归测试全绿：
    - `cliRegistry.test.js`：6 passed，0 failed，耗时 4.0ms。
    - `cliProbe.test.js`：7 passed，0 failed，耗时 55.4ms。
    - `cliServiceConfig.test.js`：7 passed，0 failed，耗时 67.8ms。
    - 5 个套件共计 29 passed，0 failed。
- **架构约束守卫**：
  - `src/http/server.js` 行数维持在 248 行，满足 `≤250 行` 架构约束。
- **代码静态检查**：
  - `npx oxlint src/http/routes/cliServices.js src/cli/commands/cliService.js`：0 warning，0 error。
- **状态**：
  Slice 3: complete (tests green, PRD alignment passed)

### Slice 4：内置 Skill 自动收敛与项目链接（2026-09-06）

#### PRD → 代码 可追溯性表

| REQ-ID | 需求描述 | PRD 章节依据 | 实现代码 | 对应测试 | 验证状态 |
|---|---|---|---|---|---|
| REQ-CLI-SERVICE-007 | 内置 Skill 自动收敛与项目链接（真 SKILL.md 缝） | §6.3 块 5, §10.5 决策 2, ADR-043 | `builtin/skills/cli-claude/SKILL.md` + `builtin/skills/cli-codex/SKILL.md` + `builtin/skills/cli-crawl4ai/SKILL.md` + `src/services/skillService.js` (`getBuiltinSkillPath`, `syncProjectCliSkills`, `listLinkedSkillPaths`) | `tests/.../api/cliSkillSync.test.js` (tests 1, 2, 3) | 全绿（3/3 pass） |

#### 验证日志

- **测试命令执行**：
  - `cliSkillSync.test.js`：3 passed，0 failed，耗时 32.9ms。覆盖应用内置技能目录包含 3 个只读 SKILL.md 文件（含 YAML frontmatter `name:`、CLI 定位与参数规范、一次性调用规范与超时限制）、项目启用 CLI 服务时自动创建软链并被 `listLinkedSkillPaths` 收编、项目禁用时软链自动移除、用户自建同名 Skill 享有更高优先级（内置版本不覆盖自建版本）。
  - 回归测试全绿：
    - `cliRegistry.test.js`：6 passed，0 failed。
    - `cliProbe.test.js`：7 passed，0 failed。
    - `cliServiceConfig.test.js`：7 passed，0 failed。
    - `cliHttpApi.test.js`：5 passed，0 failed。
    - `cliServiceCommand.test.js`：4 passed，0 failed。
    - `skillInjection.test.js`：6 passed，0 failed。
    - `skillSync.test.js`：11 passed，0 failed。
    - 共计 49 passed，0 failed。
- **代码静态检查**：
  - `npx oxlint src/services/skillService.js`：新改动 0 warning，0 error。
- **状态**：
  Slice 4: complete (tests green, PRD alignment passed)

### Slice 5：权限策略、执行接线与快照解密注入（2026-09-06）

#### PRD → 代码 可追溯性表

| REQ-ID | 需求描述 | PRD 章节依据 | 实现代码 | 对应测试 | 验证状态 |
|---|---|---|---|---|---|
| REQ-CLI-SERVICE-008 | 权限策略出厂规则与项目层覆盖 | §6.3 块 5, §8 E5, §10.2, §10.5 决策 1, ADR-043 | `src/agent/policyRules.js` (`BASH_RULES`, `buildProjectBashRules`) | `tests/.../api/cliExecutionWiring.test.js` (tests 1, 2) | 全绿（2/2 pass） |
| REQ-CLI-SERVICE-009 | 执行接线、环境变量注入与超时控制 | §6.3 块 5, §8 E6, §10.4 接口 4, §10.5 决策 4, ADR-043 | `src/services/agentService.js` (`buildConfigMessage`, `resolveCliEnvForCommand`) + `src/agent/worker.js` + `src/agent/toolAdapter.js` | `tests/.../api/cliExecutionWiring.test.js` (tests 3, 4) | 全绿（2/2 pass） |

#### 验证日志

- **测试命令执行**：
  - `cliExecutionWiring.test.js`：4 passed，0 failed，耗时 490.8ms。覆盖出厂规则表包含清单命令（`claude`, `codex`, `crwl`）且默认判定为 `ask`；项目层规则对未启用 CLI 生成 `deny` 覆盖、已启用 CLI 回落出厂层；`buildConfigMessage` 在 `session-config` 中单点解密注入 `cliServices` 快照；`resolveCliEnvForCommand` 匹配命令提取环境变量并在 worker bash 中合并注入，未启用/未匹配命令不注入。
  - 回归测试全绿：
    - `tests/capabilities/plugin-management/cli-service/2026-09-06-cli-service-connection/api/*.test.js`（6 个套件共 32 passed，0 failed）。
    - `systemPrompt.test.js`（7 passed，0 failed）。
    - `mcpBridge.test.js`（4 passed，0 failed）。
- **Golden Consistency 验证**：
  - `node scripts/gen-agent-policy.mjs --check`：一致，退出码 0。
- **代码静态检查**：
  - `npx oxlint src/agent/policyRules.js src/services/agentService.js src/agent/worker.js src/agent/toolAdapter.js`：0 warning，0 error。
- **状态**：
  Slice 5: complete (tests green, PRD alignment passed)

### Slice 6：前端管理页渲染与交互（2026-09-06）

#### PRD → 代码 可追溯性表

| REQ-ID | 需求描述 | PRD 章节依据 | 实现代码 | 对应测试 | 验证状态 |
|---|---|---|---|---|---|
| REQ-CLI-SERVICE-006 | CLI 服务管理页列表呈现、状态徽标、刷新与启用交互 | §6.1 流 A/B, §6.3 块 4, §7.1, §8 E1 | `src/renderer/api/cliServices.js` + `src/renderer/pages/CliServices.jsx` + `src/renderer/App.jsx` + `src/renderer/components/layout/Sidebar.jsx` | `tests/.../e2e/cliServicesPage.test.cjs` | 全绿（4/4 pass） |

#### 验证日志

- **测试命令执行**：
  - `npx playwright test tests/capabilities/plugin-management/cli-service/2026-09-06-cli-service-connection/e2e/cliServicesPage.test.cjs`：4 passed，0 failed，耗时 1.2s。
    - 用例 1：导航至 `/cli-services` 页面并展示 3 个内置清单服务行（`claude`, `codex`, `crawl4ai`）。
    - 用例 2：未安装条目显示安装指引（`installHint`），且全局启用开关处于禁用（disabled）状态。
    - 用例 3：检测到新版本可用时（`updateAvailable: true`）展示更新提示徽标（`update-badge`）。
    - 用例 4：点击顶部刷新按钮（`refresh-probe-button`）触发带 `?refresh=1` 的重新探测。
  - 回归测试全绿：
    - `tests/capabilities/plugin-management/cli-service/2026-09-06-cli-service-connection/api/*.test.js` 与 `cli/*.test.js`（32 passed，0 failed）。
    - `toolSurface.test.js`（5 passed，0 failed）。
- **代码静态检查**：
  - `npx oxlint src/renderer/api/cliServices.js src/renderer/pages/CliServices.jsx src/renderer/App.jsx src/renderer/components/layout/Sidebar.jsx src/renderer/hooks/useSettings.jsx src/renderer/main.jsx src/agent/toolAdapter.js`：0 warning，0 error。
- **状态**：
  Slice 6: complete (tests green, PRD alignment passed)
