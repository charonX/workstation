# 测试计划 — 2026-09-06-cli-service-connection

> REQ 版本：v1（hash `7a08fa0c5ef0d0de30c2e6ac387f5cfc7b3534a2baebed30b2dc11edbe6563a9`）
> 能力：`plugin-management` / `command-interface` / `agent-security`
> 实体：`cli-service` / `cli` / `permission`
> 目录：`tests/capabilities/plugin-management/cli-service/2026-09-06-cli-service-connection/` 与 `tests/capabilities/command-interface/cli/2026-09-06-cli-service-connection/`

---

## 覆盖矩阵

| REQ-ID | seam | 测试文件 | 测试类型 | 断言锚点 |
|---|---|---|---|---|
| REQ-CLI-SERVICE-001 清单注册表与结构 | cliRegistry 纯函数 | `api/cliRegistry.test.js` | 单元 | PRD §6.3 块 1, §10.2 |
| REQ-CLI-SERVICE-002 环境探测与短缓存 | cliService.probe (execFile + 缓存 + 并发) | `api/cliProbe.test.js` | 单元 / 集成 | PRD §6.3 块 2, §8 E2, §10.5 决策 3 |
| REQ-CLI-SERVICE-003 渠道最新版本与更新检查 | cliService.checkLatestVersion (npm/pypi) | `api/cliProbe.test.js` | 单元 / 集成 | PRD §6.3 块 2 row 4, §8 E3, §10.3 流 1 |
| REQ-CLI-SERVICE-004 配置持久化与两层启用 | cliService DB + effectiveConfig | `api/cliServiceConfig.test.js`、`api/cliHttpApi.test.js` | 集成 | PRD §6.3 块 3, §7.1, §8 E1, §10.4 接口 2/3/4 |
| REQ-CLI-SERVICE-005 环境变量加密与掩码回显 | cliService env + secretStore | `api/cliServiceConfig.test.js`、`api/cliHttpApi.test.js` | 集成 | PRD §6.3 块 3 row 1, §7, §10.4 接口 1/2 |
| REQ-CLI-SERVICE-006 管理页列表与交互 | CliServices.jsx (Playwright E2E) | `e2e/cliServicesPage.test.cjs` | 组件 / E2E | PRD §6.1 流 A/B, §6.3 块 4, §7.1 |
| REQ-CLI-SERVICE-007 内置 Skill 自动收敛 | skillService 内置来源与 link/unlink | `api/cliSkillSync.test.js` | 单元 / 集成 | PRD §6.3 块 5, §10.5 决策 2, ADR-043 |
| REQ-CLI-SERVICE-008 快照解密注入与 worker 合并 | agentService buildConfigMessage + worker | `api/cliExecutionWiring.test.js` | 单元 / 集成 | PRD §6.3 块 5, §8 E6, §10.4 接口 4, ADR-043 |
| REQ-CLI-SERVICE-009 权限出厂规则与项目覆盖 | policyRules BASH_RULES + 权限裁决管道 | `api/cliExecutionWiring.test.js` | 单元 / 集成 | PRD §8 E5, §10.2, §10.5 决策 1, ADR-043 |
| REQ-CLI-SERVICE-010 产品 CLI cli-service 命令族 | 产品 CLI `opc-workstation cli-service` | `tests/capabilities/command-interface/cli/.../cli/cliServiceCommand.test.js` | CLI 集成 | PRD §10.4 接口 1/2/3, §11.1 Seam 1/2/3 |

---

## 管理页交互映射（对照 Mcp.jsx 模式 → 自动化测试）

| 页面结构 / 交互行为 | 测试文件落点 | 预期验证点 |
|---|---|---|
| 清单列表渲染（3 条目：claude / codex / crawl4ai） | `cliServicesPage.test.cjs` 用例 1 | 渲染卡片数量、命令名、版本标签可见 |
| 未安装视觉置灰 + 安装指引（installHint） + 开关禁用 | `cliServicesPage.test.cjs` 用例 2 | `data-installed="false"`、安装命令文案、开关 disabled |
| 最新版本更新提示徽标 | `cliServicesPage.test.cjs` 用例 3 | `update-badge` 可见，文案含最新版本号 |
| 顶部刷新按钮调用 `?refresh=1` | `cliServicesPage.test.cjs` 用例 4 | 拦截 API query 验证强制刷新参数 |
| 项目启用勾选与 env 凭据配置表单 | `cliHttpApi.test.js` + `cliServiceConfig.test.js` | 接口级覆盖项目启用与 env 掩码校验（对齐 MCP 模式先例） |

---

## 新增 seam 落点（实现契约路径）

| seam | 预期落盘路径 | 对应先例 |
|---|---|---|
| 内置清单注册表纯模块 | `src/services/cliRegistry.js` | 纯数据/纯函数 |
| CLI 服务核心业务与探测 | `src/services/cliService.js` | `src/services/mcpService.js` |
| HTTP 路由处理 | `src/http/routes/cliServices.js` | `src/http/routes/mcp.js` |
| 产品 CLI 命令处理器 | `src/cli/cliService.js` | `src/cli/mcp.js` |
| 内置 Skill 目录 | `builtin/skills/cli-claude/`, `cli-codex/`, `cli-crawl4ai/` | 技能库来源目录 |
| 前端独立管理页 | `src/renderer/pages/CliServices.jsx` | `src/renderer/pages/Mcp.jsx` |
| 出厂策略规则扩展 | `src/agent/policyRules.js` BASH_RULES | `src/agent/policyRules.js` |

---

## 留给 REFLECT 人工验收（纯审美，无结构断言）

- 卡片阴影间距、未安装置灰透明度（opacity: 0.6）、更新提示气泡颜色搭配 —— 理由：属于纯主观视觉观感，所有元素存在性、状态属性与交互流程已全量自动化测试覆盖。

---

## 回溯与自检清单

- [x] 10 个 REQ-ID 全部具有至少 1 个自动化测试（覆盖率 100%）。
- [x] 8 个测试文件头部要素齐全（`REQ-TRACE`、`REQ-VERSION`、`CAPABILITY-TRACE`、`ENTITY-TRACE`、`EXPECTED-TRACE`、`TEST-AUTHOR`、`ASSERTIONS-SIGNED`）。
- [x] 所有预期值机械推导并严格 trace 到 PRD §6.3 / §7 / §8 / §10.4 锚点。
- [x] 无任何 `// TODO: HUMAN ASSERTION` 占位符；无快照测试。
- [x] 边界/异常场景全覆盖：ENOENT 命令不存在、探测超时 5s、分发渠道网络失败降级、未安装禁止启用（409）、全局禁用禁止项目启用（409）、超时 10–600s 边界、env KEY 正则校验与加密掩码、权限 deny 拦截。
