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
| REQ-CLI-SERVICE-009 | plugin-management / cli-service（v1.1 修订归位，原 agent-security / permission） | `api/cliExecutionWiring.test.js` | ✅ |
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
| 出厂 BASH_RULES 清单命令默认 `ask`；项目未启用生成 `deny` 覆盖；执行拦截（verdict: deny，无进程产生） | `cliExecutionWiring.test.js` | PRD §8 E5, §10.2, §10.5 决策 1, ADR-043 |
| `buildConfigMessage` 唯一解密点注入 `cliServices` 快照；worker 按匹配命令合并 env | `cliExecutionWiring.test.js` | PRD §10.4 接口 4, §10.5 决策 4, ADR-043 |
| 产品 CLI `cli-service list/probe/enable/disable/env` 命令族支持与明文保护 | `cliServiceCommand.test.js` | PRD §10.4 接口 1/2/3, §11.1 Seam 1/2/3 |

### 升级点检查

- **初衷漂移**：story `intention`（管理本机 CLI 服务、检测可用性、供 agent 稳定调用）↔ PRD §1 问题陈述 ↔ 10 个 REQ 集合完全一致，无漂移。
- **跨模块契约歧义**：PRD §10.4 四大接口契约与 ADR-043 决策完备，输入输出、错误码与副作用均有明确样例，无歧义。
- **expected trace 失败**：全部断言均可 trace 到 PRD 锚点，无遗漏，无待拍板占位。
- **安全边界**：涉及本机命令执行与 env 凭据，ADR-043 与 PRD §10.7 已确立安全底线（`execFile` 无 shell、出厂默认 `ask`、未启用 `deny` 拦截、单点解密快照、API 严禁明文回显），威胁建模经确认，无新增不可控风险。
- **范围决策**：PRD §14 自检查表全 PASS，移动块（调用历史）与范围外（自动安装等）已显式排除，无悬空 GAP。

**结论：无升级项，AI 全量自检通过，断言签核锁定。BUILD 解锁。**

---

## Assertion 修订签核（v1.1，review 后契约修订）

- 日期：2026-09-06
- signer：**AI**（修订内容均源自 review.md 第一轮人裁决方向与第二轮重审发现；无新增升级点）
- REQ 版本：v1.1（hash `d33ce03b960d1815a224d214724b10561ef35cafcdca3f08152d5543560b12ff`）
- 修订背景：第一轮 /review 发现契约漂移与缺口（REQ-F1/F2/F3、TECH-1/2/3/4），第二轮重审发现 signoff 与现行契约版本脱节（RE2-4），本轮闭环。

### 修订内容

1. REQ-002 AC3 探测失败条件对齐 PRD §8 E2 三独立条件（超时 / 非零退出 / 无法解析版本，任一即失败）。
2. REQ-008 AC2 快照格式补 `timeoutSec: number`，PRD §10.4 接口 4 同步补锚点（TECH-2/REQ-F3）。
3. REQ-009 capability/entity 归位 `plugin-management / cli-service`，与 business-capabilities.md、测试目录一致（REQ-F2）。
4. PRD §10.3/§10.5/ADR-043 显式记录 split 生效语义：权限 deny 规则 mtime 热生效（ADR-022），env 快照与 skill link 冷生效（新会话）；§10.2 模块表与 ADR-043 潜在代价的残留「新会话生效」blank表述已清除（TECH-1/RE2-4）。
5. PRD §10.4 新增「命令匹配与安全注入契约」（裸命令精确匹配、路径分隔符禁止注入、出厂 globs 双形态）与接口 1b（`GET /api/cli-services/project-enablements` 聚合端点）（TECH-3/TECH-4/RE2-7）。
6. PRD §6.1 流表锚点 ID 错配修正（B1↔B2、C1→D1）；REQ-002 AC4 锚点标注修正为 §6.3 锚点 A5。

### 修订后自检

- [x] `requirements-v1.hash` 已重算（SHA-256 全文）并与 8 个测试文件 `REQ-VERSION` 头同步（随 [test] commit 09bcee7 之后的同步提交落地）。
- [x] 修订未新增 REQ、未改变任何已锁定断言的 expected 值（仅语义对齐与标注修正）。
- [x] 受影响 REQ（002/008/009）的现有测试断言与新契约文本一致（第二轮重审 test-engineer 实测 40/40 通过）。

**结论：修订签核完成，契约与签核记录恢复一致。**

---

## Assertion 修订签核（v1.2，review RE4-1 契约对齐）

- 日期：2026-09-07
- signer：**AI**（用户显性裁决 Option A：更新契约对齐 gotgenes 权限层单一真源，消除死错误码 E-CLI-NOT-ENABLED）
- REQ 版本：v1.2（hash `1f616dc91b7e8d80569503c5ce12f190ddf066f699394496ea8a815e61593119`）
- 修订背景：第四轮 /review 发现 REQ-009 AC4 锁定的错误码 `E-CLI-NOT-ENABLED` 随 RE2-5 选项 B 移除 pre-gate 后在系统中已不存在，契约与实现/测试分叉（RE4-1）。

### 修订内容

1. REQ-009 AC4 改写为「权限链返回 deny 拦截判定并回传拒绝原因，不创建任何系统子进程」，消除对应用层死错误码 `E-CLI-NOT-ENABLED` 的锚定。
2. PRD §8 E5 错误码列与 §11 测试决策 item 5 同步修订为权限链拒绝原因（verdict: deny）。
3. signoff.md expected 表核对行同步修正。

### 修订后自检

- [x] `requirements-v1.hash` 已重算（SHA-256 全文：`1f616dc91b7e8d80569503c5ce12f190ddf066f699394496ea8a815e61593119`）并与 8 个测试文件 `REQ-VERSION` 头同步。
- [x] 修订未新增 REQ，真实反映已通过实测的策略评估器行为（`cliExecutionWiring.test.js` 断言 `verdict === "deny"`）。
- [x] 全仓测试 42/42 PASS，E2E 7/7 PASS。

**结论：v1.2 修订签核完成，契约与架构单一真源完全一致。**
