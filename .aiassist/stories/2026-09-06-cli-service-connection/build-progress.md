# BUILD 进度 — 2026-09-06-cli-service-connection

> REQ 版本：v1（hash `7a08fa0c5ef0d0de30c2e6ac387f5cfc7b3534a2baebed30b2dc11edbe6563a9`）
> 门 1 已通过（signoff.md，AI 全量自检零升级点）。测试已锁定，实现者对业务测试只读。

## 切片划分（按 requirements.md 与技术架构分层）

| Slice | 名称 | REQ-ID | 对应测试文件 | 范围 | 依赖 | 状态 |
|---|---|---|---|---|---|---|
| 1 | 内置清单与环境探测 | REQ-CLI-SERVICE-001, 002, 003 | `api/cliRegistry.test.js`、`api/cliProbe.test.js` | `src/services/cliRegistry.js` + `src/services/cliService.js` (probe, checkLatestVersion, 60s TTL cache, concurrency <= 4) | — | 完成 |
| 2 | 配置持久化与凭据加密 | REQ-CLI-SERVICE-004, 005 | `api/cliServiceConfig.test.js` | `src/db.js` DDL + `src/services/cliService.js` (两层启用、timeoutSec、env secretStore 加密与掩码、effectiveConfig) | Slice 1 | 待开始 |
| 3 | HTTP API 与产品 CLI | REQ-CLI-SERVICE-004, 005, 010 | `api/cliHttpApi.test.js`、`cli/cliServiceCommand.test.js` | `src/http/routes/cliServices.js` + `src/http/server.js` 挂载 + `src/cli/commands/cliService.js` + `src/cli/opc-workstation.js` 挂载 | Slice 2 | 待开始 |
| 4 | 内置 Skill 与软链收敛 | REQ-CLI-SERVICE-007 | `api/cliSkillSync.test.js` | `builtin/skills/` 3 份 SKILL.md + `src/services/skillService.js` (`getBuiltinSkillPath`, `syncProjectCliSkills`) | — | 待开始 |
| 5 | 权限策略与 worker 执行接线 | REQ-CLI-SERVICE-008, 009 | `api/cliExecutionWiring.test.js` | `src/services/policyRules.js` BASH_RULES + `src/agent/policyRules.js` + `src/services/agentService.js` (buildConfigMessage 快照注入、resolveCliEnvForCommand) + worker 执行合并 | Slice 2 | 待开始 |
| 6 | 前端管理页渲染与交互 | REQ-CLI-SERVICE-006 | `e2e/cliServicesPage.test.cjs` | `src/renderer/pages/CliServices.jsx` + 路由与侧边栏接入 + data-testid 契约 | Slice 3 | 待开始 |

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
- **状态**：Slice 1 全部完成。
