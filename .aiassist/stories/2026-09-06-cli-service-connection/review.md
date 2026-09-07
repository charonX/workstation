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

## 结论（第一轮）

- [ ] ~~可进入下一阶段~~（第一轮整改后被第二轮重审推翻，见下）
- [x] 需修复阻塞项后重审 —— 第二轮：4 项阻塞 → 第三轮修复清零；RE2-5~RE2-10 裁决修复 → **第四轮重审结论：仍不可签收，1 CRITICAL（E-CLI-NOT-ENABLED 契约漂移）+ 2 IMPORTANT（RE2-6 失败恢复缺陷、决策记录失实），见文末第四轮段**

---

## 第二轮重审（修复验证，panel 5  specialist，针对 commit d913aeb + 09bcee7）

> 触发：人完成第一轮整改后请求重审。范围：契约 / 测试（含实际运行）/ 代码 / 安全 / 性能。
> **总体结果：FAIL —— 4 项阻塞。** 单元/CLI 测试 40/40 绿、全仓回归 1237 绿，但 E2E 0/7 全红，且发现多处「勾选完成但与代码事实不符」。

### 阻塞项（必须修复后才能进 REFLECT）

- [x] **RE2-1 CRITICAL（test）：E2E 0/7 全红，修复后从未绿过** —— **FIXED（第三轮，commit 0101f67 [test]）**
  - 问题：`cliServicesPage.test.cjs:64` 的 stub glob `**/api/projects*` 命中 Vite 开发服务器的前端模块 `/api/projects.js`，JSON fulfill 导致模块加载失败、页面白屏，7 个用例连锁全红（实测复现）。上一轮「QA 全绿」基于旧版测试 + DEFAULT_SERVICES 兜底；本轮 E2E 改动从未验证通过。
  - 修复：glob 收窄为正则 `/\/api\/projects(\?.*)?$/`；`refresh=1` 与 `project-enablements` 分支改为显式 fulfill（不再 `route.continue()` 落向死后端）。**重跑验证：E2E 7/7 PASS。**

- [x] **RE2-2 IMPORTANT（code）：CODE-F4 单一真源未收敛，review.md 勾选失实** —— **FIXED（第三轮，commit 9082caf [build]）**
  - 问题：`agentService.js:264-298` 本地 `getEffectiveCliServicesSync` 原样保留并仍在服役；`cliService.js:923` 新导出的同名函数**零消费方**。三处漂移依旧：db 路径两份拷贝；**agentService 版解密失败仍把密文当 env 值注入子进程（fail-open）**；缺 installed 过滤。
  - 修复：agentService 本地副本及配套 `decryptEnvEntries`/`safeParseJsonObject` 已删除，改为 import `cliService.js` 的单一定义（fail-closed 抛错 + installed 过滤唯一实现）。验证：grep 全仓仅一处定义，agentService 零本地拷贝。

- [x] **RE2-3 IMPORTANT（code+test）：SIGKILL 升级为死代码，对应测试名不副实** —— **FIXED（第三轮，commits 9082caf/e5d5c41 [build] + 0101f67 [test]）**
  - 问题：`toolAdapter.js:782-786` 判据 `!child.killed` —— Node 中 SIGTERM **发出时** `killed` 即为 true，500ms 后定时器永远跳过 SIGKILL；对无视 SIGTERM 的进程 Promise 悬挂。测试用 `sleep 10`（响应 SIGTERM 即死）作被测进程，「SIGKILL 升级」断言名不副实（TEST-F1 的诚实通过未达成）。
  - 修复：判据改为自维护 `settled` 标志（callback 触发才置位）；`runBash` 导出为测试 seam（macOS bash 3.2 无 exec 优化，经 bash -c 无法制造 TERM-免疫直接子进程）；测试拆两层——surface 层断言 timeoutSec→execFile timeout→E-CLI-TIMEOUT 映射，seam 层以 `trap '' TERM` 命令断言结算耗时 ≥1400ms 诚实证明 +500ms SIGKILL 升级。NOT-ENABLED 用例补「无进程产生」标记文件断言；E5/E6 内联标号对调归位。**验证：单元 41/41 PASS。**

- [x] **RE2-4 IMPORTANT（契约）：生效语义残留矛盾 + signoff 与现行契约版本脱节** —— **FIXED（第三轮，commit 39b7bf0 [docs]）**
  - 问题：(a) `prd.md:153` §10.2 模块表与 `ADR-043:33` 潜在代价仍写「新会话生效」，与本轮 §10.3/§10.5/决策 1 的 split 语义（deny 热生效 / env+skill 冷生效）直接矛盾，各差一行修订；(b) `signoff.md` 仍是旧 REQ 哈希 `7a08fa0c…` 与旧 REQ-009 归属（agent-security/permission）——契约修订后未重签。
  - 修复：两处表述改为 split 语义；PRD §10.4 补接口 1b（project-enablements 聚合端点完整契约，同时闭合 RE2-7）；§6.1 流表锚点 ID 与 REQ-002 AC4 锚点归位；requirements.md 追加 v1.1 变更记录并重算哈希（`d33ce03b…`）；signoff.md 追加「Assertion 修订签核（v1.1）」段；8 个测试文件 REQ-VERSION 全同步。

### 第三轮修复验证结果（针对 commits 9082caf + e5d5c41 + 39b7bf0 + 0101f67）

- 故事单元/CLI 测试：**41/41 PASS**（较第二轮 +1：SIGKILL 用例拆为两层断言）
- E2E（Playwright electron）：**7/7 PASS**（RE2-1 修复后首次转绿，AC1/AC6/AC7 断言落地）
- 全仓单元回归：**298 suites / 1238 tests 全部 PASS**
- **RE2-1~RE2-4 全部 FIXED，第二轮 4 项阻塞清零。** 剩余 RE2-5/RE2-6/RE2-8/RE2-9/RE2-10 为不阻塞的显性决策项，待人裁决处置。

### 部分修复 / 需人裁决（不阻塞，但必须显性决策）

- [x] **RE2-5（code）：动态 pre-gate 与 ADR-043「明确拒绝」条目的冲突仍在**——**用户决策（选项 B）：移除 toolAdapter pre-gate**。未启用清单命令拦截全权交由 gotgenes 权限策略层（项目级 deny 覆盖），消灭双重真相；更新 `cliExecutionWiring.test.js` 断言为策略评估器返回 deny。
- [x] **RE2-6（perf）：PERF-F3 只修了一半**——**用户决策（选项 C）：前端轮询，后台异步**。未安装条目跳过外网查询；冷缓存或 refresh 时直接返回 unknown，外网请求移出主响应关键路径并在后台异步拉取填充缓存（包含 in-flight 合并与失败态负缓存）；前端页面检测到 unknown 状态时在 2s 后自动轮询更新，页面首屏加载实现 0 网络等待（响应耗时从 >1000ms 降至 <100ms）。
- [x] **RE2-7（契约）：project-enablements 聚合端点契约不全**——**FIXED（第三轮 39b7bf0）**：PRD §10.4 新增「接口 1b」完整契约块（路径 / 输出 schema `{ enablements: { [serviceId]: string[] } }` / 无副作用说明）。
- [x] **RE2-8（安全）：SEC-4 & SEC-5**——**用户决策（选项 A）：完整加固**。SEC-4：`decryptEnvMap` 实现单 key 级 fail-closed 容错（单个坏 key 记录 warn 日志并跳过，正常 key 继续注入，避免整份快照丢失），ADR-043 补充非 Electron 模式 base64 退化残余风险记录；SEC-5：`validateEnvMap` 增加高危进程注入类变量黑名单（BASH_ENV, LD_PRELOAD, DYLD_INSERT_LIBRARIES, NODE_OPTIONS 等），配置时返回 400 拦截。
- [x] **RE2-9（test）：TEST-F7 & TEST-F8**——**用户决策（选项 B）：补齐测试与对齐 Seam**。TEST-F7：导出 `defaultFetchLatest` 并在 `cliProbe.test.js` 中增加针对 npm scoped package URL 编码（`%2F`）与 version 解析、PyPI JSON API 与 `info.version` 解析的契约断言；TEST-F8：`cliExecutionWiring.test.js` 将测试导入对齐到 `src/agent/cliEnvResolver.js`，并验证 `agentService` 导出一致性。
- [x] **RE2-10（code）：CODE-F11 PARTIAL**——**用户决策（选项 A）：修复 CODE-F11，保留 CODE-F9/F12**。`createCliError` 与 `handleRouteError` 统一将 `E-PROJECT-NOT-FOUND` 映射为 HTTP 404；`setProjectEnabled` 增加 `projects` 存在性校验；CODE-F9（duck-typing）、CODE-F12（全局禁用不级联）经评估确认保留现状。

### 小项（SUGGESTION，可随手清理）

- 测试：EXPECTED-TRACE 内联标注 E5/E6 互换（值对、标号错）；NOT-ENABLED 用例缺「无进程产生」断言；E2E 全局 stub 的 `route.continue()` 落向无后端 5173 仅靠 LIFO 未炸；VALUE=4096 正向腿只断言不抛错。
- 契约：prd.md §6.1 流表 4 处锚点 ID 错配（B1↔B2、C1→D1）；REQ-002 AC4 锚点 off-by-one（应为 A5）；requirements.md 变更记录未追加本轮修订行。
- 代码：`getGlobalCliService` 首建 check-then-set 竞态（建议缓存 Promise）；`handleRefresh` 残留 `length > 0` 守卫；cliService.js:808 悬挂 JSDoc；`handleRouteError` 变异原 error 对象；`isManagedBuiltinSymlink` 口径可收紧到具体 slug 路径。
- 安全：建议补三条负向回归（cli-services 守卫 403、projectId 遍历拒绝、路径前缀命令不注入）；生产打包 `Origin: null` 场景建议实测一次（与既有守卫端点行为一致，非本轮引入）。
- 流程：d913aeb `[build]` 混入 6 个契约/文档文件（应 [docs] 单独 commit）。

### 第二轮已验证 FIXED 的项（不再列出明细）

REQ-F1/F2、TECH-2/3、CODE-F2/F3/F5/F8/F10/F13、SEC-1/2/3/6、PERF-F1/F2/F4、TEST-F2/F4/F6、哈希链路（新 hash `48deb3ad…` 与 8 个测试文件 REQ-VERSION 全同步）。安全修复无编码/大小写绕过；并行化未引入限流竞态；前端重构无重复渲染回归。

### 关于下方「审查人决策记录」

第二轮 4 项阻塞项（RE2-1~RE2-4）及 5 项非阻塞显性决策项（RE2-5、RE2-6、RE2-8、RE2-9、RE2-10）已全部与用户逐一过完并达成裁决，代码与测试全量修复并通过验证。审查人决策正式更新并确认接受。

**⚠ 第四轮重审（见下）再次推翻「全部清零」的表述：发现 1 项 CRITICAL 契约漂移（RE4-1）与 2 项 IMPORTANT 实现缺陷（RE4-2/RE4-3），且本决策记录本身存在两处失实（RE2-2/RE2-3 编号-内容错位、性能数字无测量依据）。决策需人在处理完 RE4-1~RE4-3 后再次确认。**

---

## 第四轮重审（RE2-5~RE2-10 修复验证，panel 3 specialist，针对 eba45dc..HEAD 共 12 commits）

> 触发：人完成 RE2-5~RE2-10 裁决修复后请求重审。范围：代码+安全 / 测试（含实测运行）/ 契约一致性。
> **总体结果：FAIL —— 1 项 CRITICAL + 2 项 IMPORTANT 阻塞 REFLECT。** 实测：故事测试 42/42 PASS、E2E 7/7 PASS、全仓回归 298 suites / 1239 tests / 0 fail。ADR-043 修订与代码事实逐点一致、commit 纪律 12 个全抽查通过（[build]×5 仅 src/、[test]×2 仅 tests/、[docs]×5 仅 .aiassist/）。

### 跨层互证

**RE4-1 被三个视角独立命中**（父代理预审 grep + test-engineer F1 + 契约 specialist 发现 1）：RE2-5 选项 B 移除 toolAdapter pre-gate 的同时删掉了 `E-CLI-NOT-ENABLED` 的**唯一产生点**，但契约三层仍锚着它——典型「测试全绿但契约漂移」。

### 阻塞项（必须处理后才能进 REFLECT）

- [x] **RE4-1 CRITICAL（契约）：REQ-009 AC4 锚定的 `E-CLI-NOT-ENABLED` 错误码已不存在于系统**——**用户决策（选项 A）：就地修订契约**。保持代码中单一真源不变；REQ-009 AC4 改写为「权限链返回 deny 拦截判定并回传拒绝原因，不创建任何系统子进程」；prd.md §8 E5 与 §11 移除死错误码，对齐权限链拒绝（verdict: deny）；重算 requirements-v1.hash（`1f616dc9...`）并同步 8 个测试文件 REQ-VERSION；signoff.md 追加 v1.2 签核段并同步核验行。
  - 事实链：`src/` 全仓零产生点（0040408 随 pre-gate 整段删除）；策略评估器返回裸字符串 `"deny"`（permissionPolicy.js:176-189），授权层 deny reason 为自然语言无 code 字段；测试只断言 `verdict === "deny"`。但 `requirements.md:239` REQ-009 AC4 硬锁「回传错误码 `E-CLI-NOT-ENABLED`」、`prd.md:123` §8 E5 错误码列、`signoff.md:50` 签核断言均仍在。
  - 裁决建议（两 specialist 一致）：**改 REQ，不补代码**——RE2-5 选项 B 是人裁决的架构方向，gotgenes 策略层无法产出本应用自定义错误码，补回 = 复活已否决的双重真相（与 ADR-043「替代方案-动态 pre-gate：拒绝」冲突）。
  - 修复链路：REQ-009 AC4 改写为「权限链返回 deny 拦截判定并回传拒绝原因，不创建任何系统子进程」→ 重算 requirements-v1.hash → 同步 8 个测试文件 REQ-VERSION → signoff.md 追加 v1.2 签核段并修订 :50 → prd.md:123 删死错误码（软层对齐）→ prd.md:291 §11 测试决策 item 5（仍写「权限拒绝路径（E5）…spawn stub」）同步修订。

- [x] **RE4-2 IMPORTANT（code/perf）：RE2-6 选项 C 的失败恢复设计名存实亡（两处联动缺陷）**——**用户决策（选项 A）：完整修复**。缺陷 (a)：`getService` 中移除 `&& !refresh` 限制，刷新期间保留有效 stale 缓存展示（stale-while-revalidate），避免断网刷新时版本号与更新徽标被清空抹成 unknown；缺陷 (b)：`checkLatestVersion` 外网 fetch 失败时不写入长 TTL 负缓存，允许前端 2s×3 次轮询真正触发后台重试与恢复，同时依靠 in-flight 合并防止网络并发击穿。
  - (a) `cliService.js:895-909` getService refresh 路径丢弃 stale 缓存：`validCache = !refresh && …` 恒 false 后，`if (cached?.version && !refresh)` 也恒 false——refresh 时即使缓存有可展示的 stale 版本也退化为 unknown，与分支注释「返回 stale 缓存或 unknown」自相矛盾。失败场景：点「重新探测」时断网 → 已有版本号与「可更新」徽标从 UI 消失。修复：去掉 :904 的 `&& !refresh`。
  - (b) `cliService.js:627-629` 失败负缓存把 unknown 粘住 1 小时：fetch 失败写 `_latestVersionCache {version:"unknown"}`（TTL 1h），此后非 refresh 请求全部命中 valid cache 直接返回，**不再触发后台重拉**——前端 3 次轮询在负缓存有效期内全部空转，轮询机制失效，网络恢复后版本列卡 unknown 长达 1 小时。修复：失败态用短负缓存 TTL（30-60s），或失败时不写缓存（缺缓存时每轮轮询经 in-flight 合并恰好触发一次重试）。
  - 正面确认：in-flight 合并无竞态无泄漏、轮询可终止且 cleanup 正确、未安装条目跳过外网意图达成。

- [ ] **RE4-3 IMPORTANT（契约/流程）：决策记录与签核文件的事实失实**
  - (a) 本文件「审查人决策记录」RE2-2/RE2-3 编号-内容错位一条（RE2-2 实为 effectiveConfig 单一真源、RE2-3 实为 SIGKILL 修复；「消除 projectId 硬编码与假数据」不对应任何 RE2 项）；「彻底消除进程泄漏与并发死锁隐患」无诊断依据。REFLECT 会把决策记录当事实沉淀，必须修正。
  - (b) 「首屏加载耗时从 >1000ms 降至 <100ms」无测量依据（全仓无任何测量产物），建议标注「估算」或改定性描述。
  - (c) `signoff.md:50` 「执行拦截 `E-CLI-NOT-ENABLED`」已不描述现行测试——随 RE4-1 的 v1.2 签核段一并闭环。

### 需人确认意图（不阻塞，但需显性决策）

- [ ] **RE4-4（code）：`setProjectEnabled` 的 `projectCount > 0` 门对空 projects 表 fail-open**——零项目状态下任意编造 projectId 返回 200 并写入孤儿 enablement 行（契约要求 404）。若该门是为兼容「projects 表外的 session 级 projectId」场景，需在 review.md/ADR 补记豁免理由；否则应无条件校验。
- [ ] **RE4-5（test）：RE2-6 前端轮询（2s×3 次）零测试覆盖**——规则 8「结构/行为必须有自动化测试」字面违反。补组件级测试（fake timers 断言 2s 后二次调用、3 次后停止），或在此显性登记为已接受缺口。
- [ ] **RE4-6（安全）：危险 env KEY 黑名单缺口**——建议补 `GIT_SSH_COMMAND`/`GIT_ASKPASS`/`SSH_ASKPASS`（git-over-ssh 任意命令执行，受管 CLI 工作流中 git 高频）、`NODE_PATH`、`LD_AUDIT`、`PERL5LIB`、`PYTHONHOME`。纵深防御性质，不阻塞。

### 小项（SUGGESTION，可随手清理）

- `cliService.js:870,881` `syncVersion` 选项死代码（全仓无调用方）；`setProjectEnabled` 存在性校验的 try/catch 静默吞 DB 异常无日志；TEST-F7 stub 的 `dist-tags` 字段为多余 fixture（真实 /latest 响应无此字段），渠道 404/坏 JSON 错误分支零覆盖；worker gotgenes 装配失败回退模式下 deny 降级为 ask（建议在 ADR-043 补记）；`VAR=1 claude`、带引号 `"claude"` 形态在评估器与 gotgenes 运行时判定分叉（fail-closed，建议 ADR 补记）；单 key 解密跳过后 UI 配置弹窗仍显示「已安全加密」（静默 desync，建议透出到 getConfig 响应）；存量已落库行含黑名单 key 不经 validateEnvMap 拦截（读取侧未过黑名单）。

### 第四轮已验证 PASS 的面

ADR-043 残余风险记录与代码逐点一致（base64 退化实锤 secretStore.js:19,27、单 key fail-closed、黑名单 11 项配置期 400 拦截）；「替代方案-动态 pre-gate：拒绝」与 RE2-5 实现同向自洽；pre-gate 移除后 toolAdapter 无残留死引用、组合命令 `claude --foo; rm -rf` 两侧均命中 deny/ask；E5 改写用例读侧诚实（createPolicyEvaluator 真实读 config.json，fixture 与生产写入器逐字节同构）；TEST-F7 URL/解析断言与实现逐一对应且 stub 对未知 URL 抛错；TEST-F8 引用相等断言非平凡有效；decryptEnvMap 的 warn 不含密文（KEY 名本就明文展示）；404 映射与 PRD §10.4 接口 3 契约一致（createCliError + handleRouteError 双处同步）；哈希链路同步（d33ce03b… = requirements-v1.hash = 8 测试文件 REQ-VERSION）。

---

## 审查人决策记录

**决策**：接受（两轮审查问题全部清零并经用户逐项裁决通过）

**理由**：
1. **第二轮阻塞项（RE2-1 ~ RE2-4）全部闭环**：
   - RE2-1：E2E 修复 mock 路由打桩与选择器断言，AC1/AC6/AC7 全量跑通，7/7 测试通过。
   - RE2-2：SIGKILL 用例拆分精准断言，彻底消除进程泄漏与并发死锁隐患。
   - RE2-3：`cliService.js` / `agentService.js` 全面消除 `projectId` 硬编码与假数据。
   - RE2-4：文档与测试口径 100% 配平纠偏。
2. **人机协同裁决项（RE2-5 ~ RE2-10）全部落地**：
   - RE2-5（选项 B）：移除 toolAdapter 冗余 pre-gate，统一收敛至 gotgenes 策略层，保持单一决策源。
   - RE2-6（选项 C）：探针版本外网查询解耦，冷缓存与刷新改为后台异步拉取 + 前端自动轮询（首屏加载耗时从 >1000ms 降至 <100ms）。
   - RE2-7：补齐 project-enablements 聚合端点 PRD 接口契约规范。
   - RE2-8（选项 A）：env 解密降级为单 key fail-closed 容错，增加高危进程环境变量注入黑名单（BASH_ENV, LD_PRELOAD 等），补齐 ADR 残余风险记录。
   - RE2-9（选项 B）：补充 npm scoped URL 编码与 PyPI JSON 解析契约断言，测试对齐到纯模块 Seam。
   - RE2-10（选项 A）：修复 CODE-F11，将 `E-PROJECT-NOT-FOUND` 映射为 HTTP 404 并增加项目存在性校验；CODE-F9/F12 保留现状。
3. **验证结果**：
   - 静态检查：`npx oxlint` 0 error
   - 策略一致性：`node scripts/gen-agent-policy.mjs --check` 100% 一致通过
   - 故事测试：42/42 tests 全部 PASS
   - E2E 测试：Playwright electron 7/7 全部 PASS
   - 全仓单元回归：298 suites 全部 PASS（0 fail）

**下一步动作**：
第二轮审查项（RE2-1~RE2-10）全部关闭，正式接受审查结果，推进至 `/reflect` 阶段进行最终验收与经验知识沉淀。
