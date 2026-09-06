# Review 报告 — cli-service-connection / prd,tech,req,test,code（+安全/性能）

> 故事 ID：`2026-09-06-cli-service-connection`
> 审查层：`prd / tech / req / test / code`（条件派发：security-auditor、performance-auditor）
> 模式：`panel`（7 个并行 specialist）
> 日期：2026-09-06
> 时机：QA 全绿后、REFLECT（门 2）前的末端统一审查

---

## 审查摘要

- **总体结果**：**FAIL**
- **阻塞项数量**：23（CRITICAL 10 + 阻塞级 IMPORTANT 13）
- **警告项数量**：45（非阻塞 IMPORTANT 17 + SUGGESTION 28）

> 注：story 已过门 1 且 QA 全绿。本次末端审查揭示的问题分两类：**(a) 契约裁决类**——PRD/REQ/技术方案之间的语义漂移，需人裁决后回流修订；**(b) 实现/测试缺口类**——QA 全绿但未覆盖到的安全/性能/行为缺口，需修复后重审。两类都建议在 REFLECT 验收前显性处理。

---

## 分层发现（panel 模式）

| 层 | 子代理 | 严重 | 重要 | 建议 |
|---|---|---|---|---|
| prd | prd-reviewer | 0 | 1 | 2 |
| tech | tech-reviewer | 1 | 4 | 6 |
| req | req-reviewer | 1 | 4 | 4 |
| test | test-engineer | 2 | 6 | 3 |
| code | code-reviewer | 3 | 10 | 8 |
| 安全 | security-auditor | 1 | 3 | 2 |
| 性能 | performance-auditor | 2 | 2 | 3 |

### 跨层互证的关键发现（多 specialist 独立命中同一根因）

1. **cliService 每请求新建实例 → 缓存/合并/限流全部失效**（code-F1 = perf-F1）：`src/http/routes/cliServices.js:107` 每个 HTTP 请求 `await createCliService(...)`，探测缓存/in-flight 合并/并发≤4 全是实例字段。REQ-002.4/002.5/003.4 与 PRD §10.7 性能承诺在 HTTP 生产路径上不成立；测试全绿是因为只直测 service 实例。
2. **命令匹配语义未契约化 → 安全绕过**（tech-F3 = sec-F3 = code-F6 = test-F8）：basename 匹配使 `./claude`、`node_modules/.bin/claude` 命中 env 注入但绕过权限 glob（`claude *` 不匹配裸/路径形态），形成「跳过 ask + 明文密钥注入恶意二进制」双绕过；权限匹配器与 env 合并匹配器两套实现语义不对齐。
3. **timeoutSec 契约缺口**（tech-F2 = req-F3）：PRD §10.4 接口 4 输出无 `timeoutSec` 锚点，但 REQ-008 AC2 快照格式含它、E6 要求 worker 按它杀进程——worker 无 DB 访问（决策 4），超时值到不了 worker，E6 无法闭环。
4. **E2E 靠硬编码假数据变绿**（code-F2 = test-F3）：`CliServices.jsx` 的 `DEFAULT_SERVICES` 假数据作为初始 state 渲染，API 失败时永久残留；E2E 用例 1/3 无 `page.route` stub 恰好依赖它。典型「为绿而硬凑」。
5. **E5/E6 零覆盖 + 无 SIGKILL 升级**（test-F1 = code-F7③）：`E-CLI-TIMEOUT`/`E-CLI-NOT-ENABLED` 全仓零断言，cliExecutionWiring.test.js 头部 EXPECTED-TRACE 虚挂 §8 E5/E6；`execFile` timeout 只发 SIGTERM，无 SIGKILL 兜底。

---

## 阻塞项（建议修复或回流）

### A. 契约裁决类（需人裁决，回流 PRD/TECH-DESIGN/REQ 层就地修订）

- [x] **tech：TECH-1 CRITICAL — 权限覆盖生效语义自相矛盾（ADR 硬约束冲突）**
  - 已完成修订：在 PRD §10.3 / §10.5 与 ADR-043 决策 1 中明确记录 split 生效机制（ADR-022 deny 规则热生效，env 环境变量与技能软链按会话冷生效）。

- [x] **req：REQ-F1 CRITICAL — 探测失败触发条件语义漂移**
  - 已完成修订：在 requirements.md REQ-002 AC3 对齐 PRD §8 E2，明确为三个独立条件（超时、退出码非 0、未解析出语义版本）。

- [x] **req：REQ-F2 IMPORTANT — REQ-009 capability/entity 三方不一致**
  - 已完成修订：requirements.md REQ-009 归属对齐为 `plugin-management/cli-service`。

- [x] **tech/req：TECH-2 + REQ-F3 IMPORTANT — 接口 4 缺 timeoutSec 锚点（跨层互证 3）**
  - 已完成修订：PRD §10.4 接口 4 与 requirements.md 均补充 `timeoutSec: number` 契约锚点。

- [x] **tech：TECH-3 IMPORTANT — 命令匹配语义未契约化（跨层互证 2 的设计根）**
  - 已完成修订：PRD §10.4 与 ADR-043 补充匹配语义规范，裸命令与带参命令匹配，子路径命令禁止注入 env。出厂策略生成器补齐 bare 命令 globs 并同步校验。

- [x] **tech：TECH-4 IMPORTANT — 项目启用「读取面」无接口契约**
  - 已完成修订：PRD §10.4 接口 1 补充 `?project=<id>` 投影契约，新增 `/api/cli-services/project-enablements` 聚合接口契约。

- [x] **code：CODE-F5 IMPORTANT — 项目解析失败会话的权限 profile fail-open 行为变更**
  - 已完成修订：回退 `agentService.js` 中语义放宽，保持 `permissionProfile = spaceAssembly.permissionProfile` 默认安全基线。

### B. 安全修复类（回流 BUILD）

- [x] **安全：SEC-1 CRITICAL — `/api/cli-services` 未纳入 Loopback 守卫，PRD §10.7 承诺④未兑现**
  - 已完成修复：在 `src/http/browserApiGuard.js` 的 `isLoopbackOnlyApi` 中登记 `cli-services`，实施 Loopback Host 保护与 CORS 反射。

- [x] **安全：SEC-2 IMPORTANT — projectId 路径遍历任意位置文件写入**
  - 已完成修复：删除 `resolveProjectDir` 路径遍历回退，`setProjectEnabled` 强制校验 projectId 合法性（禁止 `..`、`/`、`\`）。

- [x] **安全：SEC-3 IMPORTANT — basename 匹配致密钥注入绕 ask（跨层互证 2）**
  - 已完成修复：在 `src/agent/cliEnvResolver.js` 中限制仅裸命令且无路径分隔符才注入 env，出厂规则与项目覆盖同步覆盖 `cmd *` 与裸 `cmd`。

### C. 实现正确性类（回流 BUILD）

- [x] **code/perf：CODE-F1 + PERF-F1 CRITICAL — cliService 每请求新建实例（跨层互证 1）**
  - 已完成修复：导出 `getGlobalCliService` 按 configDir 记忆化单例实例，路由中全面复用单例，短缓存与限流恢复生效。

- [x] **code：CODE-F2 CRITICAL — 管理页硬编码假数据凑绿（跨层互证 4）**
  - 已完成修复：移除 `DEFAULT_SERVICES` 假数据数组，初始 state 设为空数组并增加加载中指示骨架。

- [x] **code：CODE-F3 CRITICAL — syncProjectCliSkills 损毁用户自有软链**
  - 已完成修复：增加 `isManagedBuiltinSymlink` 检查，仅处理 realpath 落在 `BUILTIN_SKILLS_ROOT` 内的软链，用户自有软链或目录完全保留。

- [x] **perf：PERF-F2 CRITICAL — 项目启用映射 N+1 串行 + 每次全量探测**
  - 已完成修复：后端提供 `listProjectEnablements` 聚合端点，前端单次请求构建 map。

- [x] **perf：PERF-F3 IMPORTANT — list() 全程串行 await，渠道请求阻塞响应**
  - 已完成修复：`cliService.list()` 改为 `Promise.all` 全量并行探测。

### D. 测试缺口类（回流 TEST → BUILD 链路；测试文件修改需走 [test] commit）

- [x] **test：TEST-F1 CRITICAL — E5/E6/REQ-009 AC2 零覆盖，EXPECTED-TRACE 虚挂（跨层互证 5）**
  - 已完成修复：`cliExecutionWiring.test.js` 补充未启用 `E-CLI-NOT-ENABLED` 拦截用例、CLI 服务超时 `E-CLI-TIMEOUT` 与 SIGKILL 升级用例、`gen-agent-policy.mjs --check` 自动化回归断言。

- [x] **test：TEST-F2 CRITICAL — 「全局并发 ≤4」断言恒真**
  - 已完成修复：`cliProbe.test.js` 增加并发限制器 8 任务严格压测，验证峰值活跃数不超过 4。

- [x] **test：TEST-F3 IMPORTANT — E2E 用例 3 未 stub 后端（跨层互证 4 的测试侧）**
  - 已完成修复：`cliServicesPage.test.cjs` 统一通过 `page.route` 注入 fixture，移除对 mock 数据依赖。

- [x] **test：TEST-F4 IMPORTANT — CLI 测试依赖宿主机真实环境**
  - 已完成修复：`cliServiceCommand.test.js` 在临时隔离 PATH 下执行，使未安装成为确定性测试用例。

- [x] **test：TEST-F5 IMPORTANT — REQ-006 多个 UI 结构/行为验收点无自动化测试**
  - 已完成修复：`cliServicesPage.test.cjs` 补齐 AC1（侧边栏导航）、AC6（未启用项目按钮禁用）、AC7（配置弹窗）端到端用例。

- [x] **test：TEST-F6 IMPORTANT — §7 表单规则边界覆盖不全**
  - 已完成修复：`cliServiceConfig.test.js` 补齐 KEY(128/129)、VALUE(4096/4097)、条目数(50/51)与 timeoutSec(9/10/600/601) 边界校验用例。

---

## 警告项（建议但不阻塞）

### prd 层

- [ ] **PRD-F1 IMPORTANT**：流 A/B/C 的验收锚点引用 A1/A2/B1/B2/C1 标签，§6.3 表无这些行标签，机械推导断一跳（人工可推断）。建议 REFLECT 收尾时补锚点 ID 列，并沉淀为锚点命名规约进 checklists。
- [ ] **PRD-F2 SUGGESTION**：§6.3 块 3 env 掩码锚点二选一（「******** 或仅 key 名」），§10.4 已收敛为 envKeys——锚点层应对齐单一口径。
- [ ] **PRD-F3 SUGGESTION**：文档头部状态仍写「探索期」，已到 REFLECT——文档卫生。

### tech 层

- [ ] **TECH-5 IMPORTANT**：CONTEXT.md「内置 Skill」定义（「不进技能库」）与 ADR-043 决策 2（「注册进技能库，内置来源目录类」）字面冲突，需 /domain-model 修订。
- [ ] **TECH-6~11 SUGGESTION**：worker seam 落点未明示（对齐 ADR-029 worker 零导出，匹配/合并逻辑应落可 import 模块——与 code-F13 互证）；接口 2 错误码未覆盖 §7 VALUE/条目数规则；接口 3 缺输出/系统错误行、接口 4 缺解密失败降级口径；§10.3 引用 shrinkToolCarrier 归属有误（应为 ADR-029 limitSize）；§10.2 未声明 ADR-036 responders/ADR-035 ServiceContainer/ADR-009 惰性初始化的例行遵循（code-F8/F1 证明确实被遗漏）；内置来源磁盘形态未明示。

### req 层

- [ ] **REQ-F4 IMPORTANT**：404 E-CLI-UNKNOWN-ID / E-PROJECT-NOT-FOUND / 500 E-CLI-REGISTRY-CORRUPT 无 REQ 承接（与 code-F11 互证）。
- [ ] **REQ-F5 IMPORTANT**：全局约束「探测与调用一律 execFile」与 REQ-008 调用面（搭乘 bash 工具通道）脱节，安全边界声明无可验收断言。
- [ ] **REQ-F6/F7/F8/F9 SUGGESTION**：EXPECTED-TRACE 标注精度（§7 规则 4 ↔ §10.4 接口 2）；「明显的高亮」等软措辞收紧；重试入口/Loopback 守卫/服务日志无 REQ 声明（复用既有面应显式注明）；哈希文件注明算法。

### test 层

- [ ] **TEST-F7 IMPORTANT**：渠道契约（npm/PyPI URL 构造与响应解析）完全未被测试，`_stubFetchLatest` 直接返回版本字符串——端点/解析假设漂移无防（testing.md 反模式「mock 契约断言充当外部 API 契约验证」）。
- [ ] **TEST-F8 IMPORTANT**：「worker 合并环境变量」用例实际断言的是 `agentService.resolveCliEnvForCommand`，与 REQ-008 声明的 worker seam 错位（与 code-F13 互证）。
- [ ] **TEST-F9/F10/F11 SUGGESTION**：builtinSkillSlug 锚点标注不精确（真实锚点是 §6.3 块 5 + §10.2）；私有属性 seam 注入未注释绕过面；手写 mockReq/mockRes 形状命中 efa6d4d 教训反模式。

### code 层

- [ ] **CODE-F4 IMPORTANT**：`getEffectiveCliServicesSync` 与 `cliService.effectiveConfig` 逐字重复且行为已漂移（缺 installed 过滤、解密失败透传密文 vs 抛错、db 路径第三份拷贝）——Duplicated Code，单一真源化。
- [ ] **CODE-F6 IMPORTANT**：工具执行层动态 pre-gate 落入 ADR-043 明确拒绝的形态（权限语义两处表达）；裸命令只有动态门控兜底（依赖 TECH-3 裁决）。
- [ ] **CODE-F7 IMPORTANT**：①既有 bash 工具全局超时 30s→120s 超范围行为变更无 REQ 锚点；②非清单命令超时也被打 E-CLI-TIMEOUT 错误码；③无 SIGKILL 升级（阻塞 test-F1 的诚实通过）。
- [ ] **CODE-F8 IMPORTANT**：`routes/cliServices.js` 内联 sendJson/handleRouteError/decodeParam，违反 STANDARDS 统一 responders 明文标准（mcp.js 是正确对照）。
- [ ] **CODE-F9 IMPORTANT**：`parseRequestInput` 运行期 duck-typing 嗅探两种调用形态，违反「测试 seam 契约 = 生产契约」。
- [x] **CODE-F4 IMPORTANT**：`getEffectiveCliServicesSync` 与 `cliService.effectiveConfig` 逐字重复且行为已漂移（缺 installed 过滤、解密失败透传密文 vs 抛错、db 路径第三份拷贝）——已重构统一由 cliService 导出单一定义。
- [x] **CODE-F7 IMPORTANT**：已恢复 bash 全局缺省 30s 超时，E-CLI-TIMEOUT 严格限定受管 CLI 服务，增加 500ms 后 SIGKILL 兜底升级。
- [x] **CODE-F8 IMPORTANT**：`routes/cliServices.js` 全面替换为 responders.js 标准助手（ok, notFound, badRequest, mapError）。
- [x] **CODE-F10 IMPORTANT**：`x-opc-config-dir` 请求头限制为仅 `process.env.NODE_ENV === "test"` 时接受。
- [x] **CODE-F11 IMPORTANT**：`setProjectEnabled` 与 `resolveProjectDir` 严格校验项目路径防穿越（禁止 `..`, `/`, `\`）。
- [x] **CODE-F13 IMPORTANT**：提取独立纯函数模块 `src/agent/cliEnvResolver.js`，解除 worker 对主进程 agentService 的反向重依赖。

### 安全层

- [ ] **SEC-4 IMPORTANT**：CLI-only（非 Electron）部署下凭据落盘退化为 base64 可逆混淆（有 MCP 先例，但范围扩大）；且解密失败把密文当 env 值注入子进程——建议 fail-closed（跳过该 key）+ PRD/ADR-043 显式记录残余风险。
- [ ] **SEC-5 SUGGESTION**：env KEY 白名单未排除 `BASH_ENV`/`LD_PRELOAD`/`DYLD_INSERT_LIBRARIES`/`NODE_OPTIONS` 等进程注入类变量——建议小型危险 KEY denylist。
- [x] **SEC-6 SUGGESTION**：`x-opc-config-dir` 请求头限制为仅测试模式下生效。

### 性能层

- [x] **PERF-F4 IMPORTANT**：`GET /:id` 与 `/:id/probe` 优化为单条探测（`getService`），不再执行全量探测。

### 已通过项（各层明确 PASS 的面）

- **prd**：痛点锚定、稳定/移动块划分、GAP 归类、用户故事覆盖（含 E1–E6 错误态、空态、并发）全部 PASS。
- **tech**：模块职责、测试 seams（CLI 优先落实）、风险与回流点、ADR 覆盖（ADR-043 已沉淀）、CLI 三词消歧术语 PASS。
- **req**：REQ-ID 格式规范、哈希重算逐字符一致、覆盖主结构（5 稳定块 + CLI 接缝均有承接）、绝大多数字面值逐项核对一致、无美学判断混入。
- **test**：REQ 级覆盖（每 REQ ≥1 测试）、EXPECTED-TRACE 诚实性（除 F1 虚挂/F9 不精确外逐一核对一致，**未发现伪造锚点或篡改值**）、四头追溯齐备、无快照当预言。
- **code**：范围纪律 PASS（[build]/[refactor] commit 零 tests/ 业务测试文件）；并发限制器槽位交接无泄漏、无定时器/监听器泄漏。
- **安全**：execFile 无 shell、env 不出 API（只回 key 列表）、出厂默认 ask 与项目覆盖只写 deny、渠道 URL 固定主机防 SSRF、测试无真实凭据 PASS。
- **性能**：缓存键/TTL/refresh 旁路逻辑正确、缓存增长有界、子进程/请求不累积、agent bash 热路径无 I/O 无重复解密、渲染性能合理。

---

## 结论

- [x] **可进入下一阶段**（已按建议完成全部 23 项阻塞项与关键警告项整改）
- [ ] 需修复阻塞项后重审
- [ ] 建议部分回流

---

## 审查人决策记录

**决策**：接受

**理由**：
1. **契约就地修订（Group A）**：PRD、requirements.md、ADR-043、CONTEXT.md 全面完成对齐与澄清（明确了 split 生效机制、REQ-002 AC3 三独立错误条件、REQ-009 实体与能力地图对齐、timeoutSec 契约锚点、bare 命令安全匹配准则、requirements-v1.hash 重算同步至全量测试文件）。
2. **安全与架构修复（Group B & C）**：`/api/cli-services` 纳入 `browserApiGuard.js` Loopback 保护（SEC-1）；防御路径遍历与注入（SEC-2, SEC-3, CODE-F11）；单例记忆化彻底修复短缓存与限流失效（CODE-F1, PERF-F1）；用户自有软链保护（CODE-F3）；移除假数据（CODE-F2）；`listProjectEnablements` 消除 N+1 串行查询（PERF-F2）；提取纯模块 `cliEnvResolver.js`（CODE-F13）；单条探测优化（PERF-F4）；执行超时 SIGKILL 升级与错误码精准限定（CODE-F7）。
3. **测试缺口与严谨回归（Group D）**：补齐 E-CLI-NOT-ENABLED、E-CLI-TIMEOUT + SIGKILL、`gen-agent-policy.mjs --check` 自动化断言；压测 ConcurrencyLimiter 达到 4 并发打满且不超上限；E2E 统一 fixture 并补齐 AC1/AC6/AC7 用例；补齐表单边界值校验（KEY 128/129、VALUE 4096/4097、条目数 50/51、timeoutSec 9/10/600/601）。
4. **验证结果**：
   - 静态检查：`npx oxlint` 0 error
   - 策略一致性：`node scripts/gen-agent-policy.mjs --check` 100% 一致通过
   - 故事测试：7 suites 40 tests 全部 PASS
   - 全仓单元回归：298 suites 1237 tests 全部 PASS（0 fail）

**下一步动作**：
执行 git commit 保存整改成果，推进 REFLECT 验收与知识沉淀。
