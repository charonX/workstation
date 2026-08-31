# Review 报告 — 内置浏览器面板与 agent 受控浏览器 / prd,tech,req,test,code,security

> 故事 ID：`2026-08-24-embedded-browser`
> 审查层：`prd,tech,req,test,code` + `security`（条件派发：PRD §10.7 涉及信任边界）
> 模式：`panel`（并行 specialist）
> 日期：2026-08-30

---

## 审查摘要

- **总体结果**：**FAIL**
- **阻塞项数量**：3（security CRITICAL ×1、req CRITICAL ×1、req IMPORTANT(AC 级阻塞) ×1）
- **警告项数量**：14 IMPORTANT + 20 SUGGESTION（去重后核心独立问题约 24 项）

跨层共识（同一问题多层命中，已去重）：

1. **截图落盘契约三层漂移**（req CRITICAL / test IMPORTANT / code IMPORTANT 同源）：PRD v0.3（2026-08-29 人裁决）已改为 `<configDir>/browser-shots/browser-<n>.png` 且 n 跨会话全局递增；`requirements.md` REQ-BROWSER-002 契约行 + AC7 仍是旧值 `<sessionDir>/shots/`（hash 锁定的契约层静默过期）；实现只做到进程内序号（重启覆盖旧文件）；测试按 PRD 新值断言（诚实但契约层断裂）。
2. **停止控制来源自声明弱化**（code IMPORTANT / security IMPORTANT 同源）：`navigate` 路由信任请求体 `source` 字段，本机任意进程可以 `source:"user"` 解除 agentControlRevoked，削弱「一键停止控制」刹车语义。

---

## 分层发现（panel 模式）

| 层 | 子代理 | 严重 | 重要 | 建议 | 结论 |
|---|---|---|---|---|---|
| prd | prd-reviewer | 0 | 0 | 6 | WARN |
| tech | tech-reviewer | 0 | 3 | 5 | WARN |
| req | req-reviewer | 1 | 2 | 1 | FAIL |
| test | test-engineer | 0 | 4 | 5 | WARN |
| code | code-reviewer | 0 | 4 | 6 | WARN |
| security | security-auditor | 1 | 1 | 2 | FAIL |

### 关键发现（按层）

- [ ] **CRITICAL: Cookie 明文导出端点对任意网页可读**（security-auditor）
  - 问题：`src/http/server.js:135` `Access-Control-Allow-Origin: *` + 无 Host 校验 → `GET /api/browser/cookies` 回执（含完整明文 cookieString）可被任意来源网页 fetch 读走，包括 agent 在内置面板中导航到的恶意站点；DNS rebinding 可绕过（server.js:144 不校验 Host）。ADR-039 决策 7「本地通道」前提实际失效，PRD §10.7「明文只走本地回执」边界不成立。CORS `*` 是先存代码，但明文凭据首次放上该面是本 story 引入。
  - 建议：对 cookies 路由校验 Host 头（必须 127.0.0.1/localhost，否则 403）+ 该路由不输出 `ACAO:*`、校验 Origin/Sec-Fetch-Site；或启动时生成随机 token 写 server.json，导出/删除要求 Bearer 头。收紧按路由差异化，不动全局 CORS（渲染进程 dev 期依赖）。
- [ ] **CRITICAL: REQ-BROWSER-002 截图契约与 PRD 人裁决锚点直接矛盾**（req-reviewer）
  - 问题：requirements.md 行 46/56 写 `<sessionDir>/shots/browser-<n>.png`（会话级递增），PRD §10.3/§10.4（2026-08-29 人裁决修订）为 `<configDir>/browser-shots/`，n 跨会话全局递增。REQ expected 是被人裁决推翻的旧版，规格锚点漂移。
  - 建议：更新 REQ-BROWSER-002 契约行与 AC7 → 重新计算 requirements-v2.hash → 同步 test-plan.md 与测试头 REQ-VERSION；按 STANDARDS errata 程序挂账偿还。
- [ ] **CRITICAL（AC 级阻塞）: REQ-BROWSER-004 AC2/AC3 组件测试链接在 test-plan 缺失**（req-reviewer 提出；test-engineer 补充实证）
  - 问题：AC2（openExternal 行为）/AC3（mailto 不拦截）声明为组件测试，test-plan §Seam 映射只有 E2E 一行；E2E 只断言菜单结构不点按钮（「E2E 不点」），openExternal 被调用且参数正确这一行为契约零断言——菜单存在 ≠ 接线正确。
  - 建议：/test-author 补组件测试（mock preload 断言 `opc.openExternal` 调用），或 REQ 层裁决降级为纯结构断言并修订 AC2 文案。

### 分层 IMPORTANT 摘要

**tech**（3）：
- 稳定块 3 revoked 解除机制歧义：§10 只对 HTTP navigate 定义 source 标记，页内点击导航是否解除 revoked 契约未定义（实现：仅 navigate source=user 解除——实现合规但 PRD 叙事有缝）。
- 稳定块 4 缺接口契约：MarkdownRenderer → 面板打开的调用机制未登记（§10.2 只有一行），openExternal 副作用无登记，对 revoked 状态的交互影响未推演。
- §10.6 风险表缺凭据导出行：本机任意进程可 dump 统一身份池，无回流点记录。

**test**（4，除上文阻塞项外）：
- REQ-002 AC4 半支未测：>50 可交互元素截断（`elements.length===50 && truncated:true`）无用例（4000 字符分支已测）。→ /test-author 补 `/many` stub 页。
- E2E 文件头 REQ-TRACE 声明覆盖 REQ-006 但全文无 auth-check/流程D 用例——虚假追溯；AC6 引导流程（auth-check=false → navigate --expand → 加载登录页）未测。→ 补流程D 用例或 REQ 层裁决合并。
- （截图路径漂移已并入跨层共识 1）

**code**（4，除跨层共识外）：
- screenshot 序号进程内内存计数（browserViewManager.js:332,675-677），重启后 browser-1.png 覆盖上一会话——跨会话递增语义未实现。
- `src/http/routes/browser.js:103-111` 内联本地 `ok`/`notFound` 助手，违反 STANDARDS/ADR-036（必须统一从 responders.js 导入，零行为变化可修）。

**prd**（无 IMPORTANT，6 条 SUGGESTION）：移动块 1 已事实稳定未回收；§14 错误计数 stale（E1-E6 实为 E1-E8）；块 4「系统浏览器入口」半支缺锚点；CONTEXT.md「人机共驾」定义滞后于砍 click/type 后的现行契约；文首状态/版本记录未刷新；块 5 初衷扩展未在 §1 同步记录。

### SUGGESTION 汇总（20 条，择要）

- code：`runNavigation` promise 路径未豁免 `ERR_ABORTED`（伪失败回执）；`E-BROWSER-CAPTURE-EMPTY` 放在 err.message 而非 err.code（落 500 而非契约形态 200+ok:false）；崩溃重建路径未 close 旧 webContents（疑似泄漏）；expandPending 清除时机窄竞态；scroll 注入失败静默吞返回 `{ok:true,0,0}`；`cookie-updated` 事件在接口 5 表中但无发射点（留 /reflect 二选一）；scheme 判定三处平行实现漂移风险（已挂账）。
- security：headless fallback fetch 直连任意 URL 与安全清单 SSRF 条款有张力（建议显式豁免或后续 story 加私有 IP 拦截）；setWindowOpenHandler 弹窗重定向绕过 navigate 状态机（崩溃态下静默失败）。
- test：`ASSERTIONS-SIGNED: false` 头注 stale；§6.3 行号标注三种编号约定混用；日志脱敏用例有空转通过风险（建议补 `lines.length > 0`）；example.com 用例依赖外网 flake 风险；两处 AC 弱断言（truncated:false 未断言 / hash 不变未断言）。
- req：REQ-002 AC6 scroll 断言 golden 值与兜底断言并存，契约权威不清晰。
- tech/prd：接口 3 缺副作用列、screenshot `GET|POST` 未定（非幂等应 POST）；§8-E2 未登记 E-BROWSER-NAV-FAILED 码；CONTEXT.md 未登记 auth-check/统一身份池等新术语；name 过滤参数无锚点来源（锚点外承诺）；ADR-039 未补记截图存储位置决策。

### 各层通过项（核查确认）

- **prd**：痛点锚定无漂移；锚点完整性足够机械推导；§14 无悬空 GAP；边界覆盖充分。
- **tech**：§10 主体质量高；ADR 无冲突；无过度设计；测试 seams 合理（ADR-002 先例）。
- **req**：稳定块→REQ 6/6 覆盖无孤儿；锚点抽查（协议补全/错误码/截断阈值/删除计数/脱敏格式）逐条字面一致；hash 与文件实际匹配；capability/entity 与能力地图一致。
- **test**：**EXPECTED-TRACE 诚实性抽查 10/10 全部命中 PRD 锚点且值一致**；无 skip/todo/哨兵残留；无快照当预言；REQ-VERSION 与 hash 三文件一致；seam 划分合理。
- **code**：**commit 范围纪律 PASS**（[build]/[refactor] 零触 tests/）；架构与 §10.2 对齐；安全基线（sandbox/无 preload/分区隔离）逐条落实；无范围外实现；设计系统 token 合规。
- **security**：PRD §10.7 五条承诺中 4 条完整兑现且有测试佐证（双闸/视图基线/分区隔离/日志脱敏）。

---

## 阻塞项（建议修复或回流）

- [ ] **层：security —— Cookie 导出端点 CORS/Host 缺口**
  - 问题：明文 cookieString 对任意网页可读（ACAO:* + 无 Host 校验 + DNS rebinding 面）。
  - 建议：Host 校验 + 路由级 CORS 收紧（或 token 方案）；随修 `source` 自声明问题（HTTP navigate 一律按 agent，user 来源只走 IPC）。
  - 建议动作：**走 `/bug`（code-defect）修复后重审**；同时建议把「导出端点访问控制」决策补记 ADR-039（/reflect 沉淀）。
- [ ] **层：req —— 截图路径契约漂移**
  - 问题：requirements.md 与 PRD 人裁决值矛盾；hash 锁定契约层静默过期；实现跨会话递增语义缺失。
  - 建议：req-gap 就地补全：更新 REQ-BROWSER-002 → v2.hash → 同步测试头 REQ-VERSION；实现侧补序号持久化（扫描 browser-shots/ 取 max+1）。
  - 建议动作：**修复后重审**（REQ 层 errata + code 小修，无需回流到 PRD——PRD 已是人裁决后的正确值）。
- [ ] **层：req/test —— REQ-004 AC2/AC3 行为断言缺失**
  - 问题：组件测试 seam 未建，openExternal 行为契约零断言。
  - 建议：`/test-author` 补组件测试（mock preload），或 REQ 层裁决降级并修订 AC 文案。
  - 建议动作：**补测试后重审**（test-gap 路径）。

---

## 警告项（建议但不阻塞）

- 50 元素截断半支未测（/test-author 补 `/many` stub）。
- 流程D/REQ-006 E2E 缺失 + 文件头虚假追溯（补用例或裁决合并）。
- §10 稳定块 3/4 契约缝隙（revoked 页内导航语义、链接集成接口契约）——/reflect 时 PRD 修订。
- §10.6 补凭据导出风险行 + 回流点。
- code 层 6 条 SUGGESTION（ERR_ABORTED / CAPTURE-EMPTY code 字段 / webContents 泄漏 / expandPending 竞态 / scroll 静默失败 / cookie-updated 未发射）——可留 /reflect 统一处置或择要 /bug。
- 文档一致性 6 条（prd SUGGESTION）+ CONTEXT.md 术语滞后——/reflect 时 /domain-model 一并修订。

---

## 结论

- [ ] 可进入下一阶段
- [x] **需修复阻塞项后重审**（3 项阻塞：security CRITICAL、req CRITICAL、REQ-004 测试缺口）
- [ ] 建议回流到 `PRD` / `TECH-DESIGN` / `REQ` / `TEST` / `BUILD`

**说明**：无需整层回流——PRD 本身质量高且是人裁决后的正确锚点；阻塞项均为就地修复范畴（1 个 /bug code-defect + 1 个 req errata + 1 个 /test-author 补测）。测试层诚实性（EXPECTED-TRACE 10/10）与 commit 纪律是本 story 的亮点。修复阻塞项 + 处置 14 条 IMPORTANT（或显式挂账到 /reflect）后可进 REFLECT。

---

## 修复记录（2026-08-30/31，人裁决：全部修复，无需逐项确认）

三个阻塞项与全部 IMPORTANT/SUGGESTION 已修复，分层三通道执行（[bugfix]/[build]/[refactor] = src/，[docs] = .aiassist/，[test] = tests/）。

### 阻塞项闭环

| 阻塞项 | 修复 | 验证 |
|---|---|---|
| security CRITICAL：Cookie 导出端点对任意网页可读 | `83b5361`+`b99ccf2`：`src/http/browserApiGuard.js` 门卫（Host 回环校验 + 跨源 Origin/Sec-Fetch-Site 403 + /api/browser/* 不出 ACAO），`responders.js` 增 `forbidden()` | REQ-005 AC8 新增 4 用例（伪造 Host/Origin/Sec-Fetch-Site→403、CLI 形态→200 无 ACAO）全绿 |
| req CRITICAL：截图路径契约漂移 | `5fd2866`：REQ-BROWSER-002 errata 至 `<configDir>/browser-shots/` + 跨会话续号，`requirements-v2.hash`（`1b26fe9d…`）；`3c024e5`：实现扫描续号 | REQ-002 AC9 用例（预置 browser-7.png → 续 8/9 不覆盖）绿；三测试文件头 REQ-VERSION 已同步 v2 |
| req/test 阻塞：REQ-004 AC2/AC3 行为断言缺失 | `0aff57b`：MdLink 分发逻辑提取纯模块 `mdLinkDispatch.js`（seam）；`c35b65a`：component/mdLinkDispatch.test.js 3 例（openExternal 参数断言 + mailto passthrough） | 组件 3/3 绿；package.json glob 已纳 component/ |

### IMPORTANT 闭环（择要）

- navigate source 通道化（`5e56c58`：HTTP 一律 agent，user 仅 IPC）+ REQ-003 AC7 用例（HTTP 伪造 source:user 仍 DENIED）绿。
- 截图序号持久化、responders 统一（ADR-036）、§10 契约缝隙（revoked 页内不解除/块4 接口契约/§10.6 凭据风险行）——`5fd2866`/`94f1f85` 文档补齐。
- 50 元素截断半支：`e0759c6` 补 `/many` stub + E2E 断言；**该用例首次跑红并暴露真实 code-defect**（注入脚本恰收 50 → truncated 永假），`1801552` [bugfix] 修复后 19/19 绿——review 补测的实证价值兑现。
- 流程D E2E 补齐（auth-check=false → expand → 登录页），REQ-006 虚假头部追溯名实相符。

### SUGGESTION 闭环

- code 7 项全修（`64f365f` `25042b9` `476aa8e` `8413053`：ERR_ABORTED 豁免、CAPTURE-EMPTY err.code、崩溃重建 close、expandPending 收窄为 open→closed 跳变清除、scroll 失败落日志、cookie-updated 分区监听发射、弹窗走状态机）；scheme 判定三处收敛 `src/shared/urlScheme.js`（`aa914bb`，12 例逐例等价验证）。
- prd/tech 文档 6+5 项全部落入 `5fd2866`（PRD v0.4）+ CONTEXT.md 术语修订 + ADR-039 决策 9-11。
- test 5 项：头部元数据（REQ-VERSION v2、ASSERTIONS-SIGNED true、行号约定统一）、日志脱敏防空转（lines>0）、truncated:false、hash 不变断言、example.com 外网容错（锚点 URL 值断言保留）。`<redacted>` 正向断言未加——AC7 锚点措辞为「允许出现」非必选，实现采取更严策略（零名零值），测试注释已记录此裁决。
- security SSRF 备忘：ADR-039 决策 11 显式接受（fallback fetch 直连任意站点 = 用户可见浏览器本质），私有 IP 拦截留后续 story。

### 最终验证（2026-08-31）

- 单元：**1127/1127 全绿**（1118 既有 + 9 新增；pipefail 核实 exit=0）
- E2E 本 story：**19/19 全绿**（含 /many 截断、流程D、崩溃注入、访问控制链路）
- lint：0 errors
- commit 纪律：本轮 15 个 commit 标签分层干净，无 src/+tests/ 混提
- 已知无关失败（预存，非本 story）：assistantFeishu REQ-AGENT-033 AC6、settingsTabs REQ-AGENT-023 AC1 两例设置页断言（基线 cd4da4f 上复现），建议另立 /bug 处理
- 环境备忘：better-sqlite3 ABI 双态（node/Electron）——`test:unit` 自带 rebuild:node，E2E 前须 `rebuild:electron`，错配表现为 agent session 创建失败（spaceKey undefined）

---

## 审查人决策记录

<!-- 人填写：是否接受本 review 结论，以及理由。 -->

**决策**：接受 / 有条件接受 / 不接受

**理由**：

**下一步动作**：
