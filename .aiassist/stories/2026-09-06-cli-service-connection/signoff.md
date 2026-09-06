# 签核记录 — 2026-09-06-cli-service-connection

## Assertion（门 1：断言签核）

- 日期：2026-09-06
- signer：**AI**（auto 签核，无升级点；规格锚点由人定——PRD §6.3/§7/§10.4 均经需求洞察访谈与 tech-design 人确认）
- REQ 版本：v1（hash `7a08fa0c5ef0d0de30c2e6ac387f5cfc7b3534a2baebed30b2dc11edbe6563a9`）

### REQ-ID 列表与测试覆盖

| REQ-ID | capability / entity | 测试文件 | 状态 |
|---|---|---|---|
| REQ-CLI-SERVICE-001 | plugin-management / cli-service | `api/cliRegistry.test.js` | ✅ |
| REQ-CLI-SERVICE-002 | plugin-management / cli-service | `api/cliProbe.test.js` | ✅ |
| REQ-CLI-SERVICE-003 | plugin-management / cli-service | `api/cliProbe.test.js` | ✅ |
| REQ-CLI-SERVICE-004 | plugin-management / cli-service | `api/cliServiceConfig.test.js`、`api/cliHttpApi.test.js` | ✅ |
| REQ-CLI-SERVICE-005 | plugin-management / cli-service | `api/cliServiceConfig.test.js`、`api/cliHttpApi.test.js` | ✅ |
| REQ-CLI-SERVICE-006 | plugin-management / cli-service | `e2e/cliServicesPage.test.cjs` | ✅ |
| REQ-CLI-SERVICE-007 | plugin-management / cli-service | `api/cliSkillSync.test.js` | ✅ |
| REQ-CLI-SERVICE-008 | plugin-management / cli-service | `api/cliExecutionWiring.test.js` | ✅ |
| REQ-CLI-SERVICE-009 | agent-security / permission | `api/cliExecutionWiring.test.js` | ✅ |
| REQ-CLI-SERVICE-010 | command-interface / cli | `tests/capabilities/command-interface/cli/.../cli/cliServiceCommand.test.js` | ✅ |

capability/entity 与 `business-capabilities.md` 条目一致（`plugin-management` 下新增实体 `cli-service`，`command-interface` 下扩充 `cli`，测试目录严格映射）。

### AI 全量自检结果

- [x] 每个 REQ-ID 至少一个自动化测试（10/10，覆盖率 100%）。
- [x] 8 个测试文件头部要素齐全（`REQ-TRACE`、`REQ-VERSION`、`CAPABILITY-TRACE`、`ENTITY-TRACE`、`EXPECTED-TRACE`、`TEST-AUTHOR`、`ASSERTIONS-SIGNED`），`REQ-VERSION` 与 `requirements-v1.hash` 逐字一致。
- [x] 无 `// TODO: HUMAN ASSERTION` 占位；无快照测试当判定依据。
- [x] 边界/错误 case 覆盖：命令不存在 ENOENT、5s 超时负缓存、分发渠道网络失败降级至 unknown、未安装禁止全局启用（409）、全局禁用禁止项目启用（409）、超时 10–600s 边界、env KEY 正则与明文加密掩码、权限 deny 拦截。
- [x] 测试可执行性：8 个测试文件全部通过 `node --check` 语法核验；API/单元测试已编写加载断言并在未就绪时暴露清晰的 RED 契约。

### expected 值交叉验证（全量核对）

| 断言 expected | 测试落点 | PRD 锚点（已核对存在且值一致） |
|---|---|---|
| 清单恰好 3 项，id 顺序 `["claude","codex","crawl4ai"]`；字段完整 | `cliRegistry.test.js` | PRD §6.3 块 1 |
| claude npm `@anthropic-ai/claude-code`；codex npm `@openai/codex`；crawl4ai pypi `crawl4ai` 命令 `crwl` | `cliRegistry.test.js` | PRD §6.3 块 1, §13 |
| `claude --version` 输出 `1.0.80 (Claude Code)` → `{installed:true, version:"1.0.80"}` | `cliProbe.test.js` | PRD §6.3 块 2 row 1 |
| 命令不存在 → `{installed:false, version:null}` | `cliProbe.test.js` | PRD §6.3 块 2 row 2 |
| 60s 内二次探测命中缓存不重复 spawn；`refresh:true` 绕过缓存重探 | `cliProbe.test.js` | PRD §6.3 块 2 row 3, §10.5 决策 3 |
| latest 1.0.90 > local 1.0.80 → `updateAvailable:true`；网络失败降级 `latestVersion:"unknown"` | `cliProbe.test.js` | PRD §6.3 块 2 row 4, §8 E3 |
| 未安装启用 → 409 `E-CLI-NOT-INSTALLED`；全局关项目开 → 409 `E-CLI-GLOBALLY-DISABLED` | `cliServiceConfig.test.js`、`cliHttpApi.test.js` | PRD §7.1 规则 2/3, §8 E1 |
| 超时设置 10–600 秒合法，非法报 400 `E-CLI-INVALID-TIMEOUT` | `cliServiceConfig.test.js` | PRD §7 规则 4 |
| `effectiveConfig(projectId)` 仅返回全局开 ∧ 项目开 ∧ 已安装的条目 | `cliServiceConfig.test.js` | PRD §6.3 块 3 row 2, §10.4 接口 4 |
| env KEY 正则校验 `^[A-Z_][A-Z0-9_]*$`，非法报 400 `E-CLI-INVALID-ENV-KEY`；DB 加密，API 仅回显 `envKeys` | `cliServiceConfig.test.js`、`cliHttpApi.test.js` | PRD §6.3 块 3 row 1, §7 规则 1/2, §10.4 接口 1/2 |
| 管理页未安装标灰 + 安装指引 + 开关 disabled；更新提示徽标 | `cliServicesPage.test.cjs` | PRD §6.3 块 4, §8 E1 |
| 内置技能 `cli-claude/codex/crawl4ai`，启用自动软链收敛进 `listLinkedSkillPaths`，自建优先 | `cliSkillSync.test.js` | PRD §6.3 块 5, §10.5 决策 2, ADR-043 |
| 出厂 BASH_RULES 清单命令默认 `ask`；项目未启用生成 `deny` 覆盖；执行拦截 `E-CLI-NOT-ENABLED` | `cliExecutionWiring.test.js` | PRD §8 E5, §10.2, §10.5 决策 1, ADR-043 |
| `buildConfigMessage` 唯一解密点注入 `cliServices` 快照；worker 按匹配命令合并 env | `cliExecutionWiring.test.js` | PRD §10.4 接口 4, §10.5 决策 4, ADR-043 |
| 产品 CLI `cli-service list/probe/enable/disable/env` 命令族支持与明文保护 | `cliServiceCommand.test.js` | PRD §10.4 接口 1/2/3, §11.1 Seam 1/2/3 |

### 升级点检查

- **初衷漂移**：story `intention`（管理本机 CLI 服务、检测可用性、供 agent 稳定调用）↔ PRD §1 问题陈述 ↔ 10 个 REQ 集合完全一致，无漂移。
- **跨模块契约歧义**：PRD §10.4 四大接口契约与 ADR-043 决策完备，输入输出、错误码与副作用均有明确样例，无歧义。
- **expected trace 失败**：全部断言均可 trace 到 PRD 锚点，无遗漏，无待拍板占位。
- **安全边界**：涉及本机命令执行与 env 凭据，ADR-043 与 PRD §10.7 已确立安全底线（`execFile` 无 shell、出厂默认 `ask`、未启用 `deny` 拦截、单点解密快照、API 严禁明文回显），威胁建模经确认，无新增不可控风险。
- **范围决策**：PRD §14 自检查表全 PASS，移动块（调用历史）与范围外（自动安装等）已显式排除，无悬空 GAP。

**结论：无升级项，AI 全量自检通过，断言签核锁定。BUILD 解锁。**
