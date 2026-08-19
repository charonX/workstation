# Review 报告 — 飞书 /reset 历史会话归档与回看 / prd+tech+req+test+code(+security)

> 故事 ID：`2026-08-19-feishu-reset-history-archive`
> 审查层：`prd, tech, req, test, code`（+ 条件派发 security；performance 未派发：§10.7 无性能敏感路径）
> 模式：`panel`（并行 specialist）
> 日期：2026-08-19

---

## 审查摘要

- **总体结果**：**FAIL**（1 CRITICAL + 3 条阻塞级 IMPORTANT；全部可在本 story 内就地修复，无需回流）
- **阻塞项数量**：4
- **警告项数量**：9（IMPORTANT 非阻塞）+ 17 条 SUGGESTION

**跨层收敛点**（多个 specialist 独立命中同一处，可信度高）：
1. **ADR-0037 欠账**（tech + code 双命中）：PRD 承诺的 ADR-0037 / ADR-016 标注 / README 索引均未落地，ADR-016 飞书条款与已合并代码相互矛盾。
2. **§8-5 并发语义无承接**（prd + req + test 三命中）：code 层已实证「归档事务同步无 await、无交错窗口」，正确解法是**显式豁免注记**而非补并发测试。
3. **旧语义测试翻转**（req + test + code 三命中）：事实是旧「feishu 世代制不建行」例因恰好走空世代分支而**自然存活、无需修订**；但 test-plan 修订行指向错误文件、旧测试名/注释宣称的语义已不成立。

---

## 分层发现（panel 模式）

| 层 | 子代理 | 严重 | 重要 | 建议 |
|---|---|---|---|---|
| prd | prd-reviewer | 0 | 1 | 4 |
| tech | tech-reviewer | 0 | 4 | 2 |
| req | req-reviewer | 0 | 2 | 4 |
| test | test-engineer | 1 | 2 | 4 |
| code | code-reviewer | 0 | 1 | 4 |
| security | security-auditor | 0 | 0 | 3 |

### 关键发现（按层）

- [ ] **CRITICAL: REQ-AGENT-124 AC3「写失败降级」零测试覆盖**（test-engineer）
  - 问题：AC3（SQLite 归档事务抛错 → stderr `E-SESSION-PERSIST` + 降级原地换代 + 无半成品归档行）无任何自动化测试，`grep E-SESSION-PERSIST tests/` 零命中；违反核心规则 6。注意 tech 层补充：归档分支 `touchSessionFile` 在 try 之外（sessionStore.js:253），**只读目录注入走不到降级分支**，正确注入点是 DB 层失败（破坏句柄/删表）——或者把 touch 移入 try（code 发现 5 的对称修复）。
  - 建议：补一例 DB 写失败注入测试（test-gap，走 /test-author 或 /bug）；可选联动 code 发现 5 把 touch 收进 try。
- [ ] **IMPORTANT（阻塞）: 新活跃行 lastActiveAt 未锚定，排序锚点推导不出**（prd-reviewer）
  - 问题：锚点 3 断言新行在前、归档在后，但锚点 2/§10.3 未规定新行 lastActiveAt 取值，expected 无法机械推导。
  - 建议：PRD 就地补锚定「新行 lastActiveAt=此刻（=createdAt）」，并核对已锁定排序断言。
- [ ] **IMPORTANT（阻塞）: ADR-0037 / ADR-016 标注 / README 索引未落地**（tech + code）
  - 建议：门 2 `/reflect` 前落档（含一句话注明与 ADR-026/030/033 兼容确认、守护扩至全 feishu 前缀的行为变化记录——code 发现 3）。
- [ ] **IMPORTANT（阻塞，需人确认）: 403 响应体字段锚点漂移 `{code}` vs 实际 `{error}`**（test-engineer）
  - 问题：PRD 锚点 7 写 `{ code: "E-SESSION-READONLY" }`，实现与测试断言 `body.error`（sendError 封套 `{error, message}`，与既有 feishuReadonly 测试一致）。signoff 交叉验证表写「值一致 ✅」不成立。**规格锚点归人**：建议人确认把锚点修订为 `{ error: "E-SESSION-READONLY" }`。
  - 建议：人拍板后修订 PRD 锚点（[docs]），signoff.md 补记该修订。

---

## 阻塞项（建议修复或回流）

- [ ] **层：test** — REQ-AGENT-124 AC3 写失败降级补测试（DB 层失败注入）。建议动作：修复后重审（聚焦 test 层）。
- [ ] **层：prd** — 锚点 2/§10.3 补「新行 lastActiveAt=createdAt=此刻」。建议动作：就地补（[docs]），核对排序断言。
- [ ] **层：tech/code** — 落 ADR-0037 + ADR-016 状态标注 + README 索引行。建议动作：/reflect 前完成（硬性 checklist）。
- [ ] **层：prd（人确认）** — 403 锚点字段名 `{code}` → `{error}` 修订。建议动作：人拍板后 [docs] 修订 + signoff 补记。

## 警告项（建议但不阻塞）

- [ ] **tech**：重启水合会水合归档行（mtime 1h 窗口内），白占 LRU 名额——无正确性问题，建议 §13 显式记录「接受 + reflect 观察点」，或 ready 水合处过滤 `:gen\d+$`（一行改动）。
- [ ] **tech**：POST stop 无 feishu 403 守护（幂等 no-op 设计）——§8-1/§10.6「全部写端点」措辞与代码出入，建议补注「stop 不列入只读守护」。
- [ ] **tech**：§11.1 写失败注入点描述修正为「DB 层失败（删表/破坏句柄）」（与 CRITICAL 项联动）。
- [ ] **req**：§8-5 并发无验收承接——建议 REQ-124 显式注记豁免（code 已实证单事务同步无交错窗口）。
- [ ] **req**：PRD §11.2 旧测试翻转声明与事实不符（旧例因空世代分支自然存活）——修订 test-plan.md:21 文件指向 + 更新 ui-copilot sessionReset.test.js:235-279 的测试名/注释（「仅空世代不建行」）。
- [ ] **req**：REQ-125 补回位置断言 `[0]`=活跃、`[1]`=归档（与 prd 阻塞项联动）。
- [ ] **test**：REQ-AGENT-126 AC1 未断言 messageId/createdAt 一致性（只断言了 role/text）。
- [ ] **code**：mode/provider 端点新增 POST 别名使 ui:* 空间写面扩大（404→写）——确认有意或在方法分派前上移守护。
- [ ] **code**：agentSessions.js 文件头端点契约注释被整段删除（约 50 行），建议恢复非过时段落。

## SUGGESTION 余项（详见各 specialist 报告，不展开）

- prd：锚点 7 补 provider/mode；无行分支补锚点或显式基线声明；§8-5 在 §6.2 补对应行；畸形 ref gen1 碰撞归属 §8-2。
- tech：CONTEXT.md 术语同步留 /reflect（/domain-model）；契约 1 注明畸形 ref 为不可达防御分支。
- req：REQ-124-2 补「stub store 返回 undefined 时回执文案不变」；REQ-126 出现 sessionDomain 而 PRD §10.2 未列（signoff 追认）；CONTEXT.md 同步。
- test：空世代补「仅元数据行」语料例；requirements.md 表名 `space_meta` → `agent_space_meta`（[docs]）；§8-5 取舍在 signoff/reflect 显式记录。
- code：touch 移入 try 对称覆盖 §8-2（与 CRITICAL 项联动）。
- security（3 条防御纵深，均当前不可达）：permissionAdjudicator/cardRenderer 的 chatId 提取剥 `:gen\d+$` 后缀；reset 防御「对归档键再归档」短路；spaceKeyFor 可对 chatId 做字符白名单（飞书 chatId 实为 `oc_*`，现实不可达）。

## 通过的重点维度（PASS 摘要）

- **code**：归档事务原子性（better-sqlite3 transaction 自动回滚）、世代命名 main/worker 逐字节一致、onReset 形态兼容、空世代投影判定正确（header-only 不误判）、**commit 标签纪律守住**（[test] 零实现、[build]/[refactor] 零业务测试）、范围外清单零触碰、renderer 零改动、新旧测试实测全绿（14/14 + 13/13）。
- **test**：REQ-TRACE 四件套完整、hash 一致、EXPECTED-TRACE 除 403 字段名外全部字面诚实、只测外部行为、无快照预言、 seam 下沉符合 §11.1。
- **req**：三稳定块全覆盖、无孤儿 REQ、锚点字面一致、hash 校验通过。
- **security**：写面守护前缀覆盖完整、键解析零混淆、fail-closed 降级、SQL 全参数化、无越权读扩大。
- **prd**：痛点锚定、稳定/移动块划分、锚点世代号/键形/文案内部一致性（除发现项外）、用户故事覆盖。

---

## 结论

- [ ] 可进入下一阶段
- [x] **需修复阻塞项后重审**（4 项全部就地可修，无回流必要）
- [ ] 建议回流到 `PRD` / `TECH-DESIGN` / `REQ` / `TEST` / `BUILD`

**建议处理顺序**：
1. 人确认 403 锚点字段名（`{code}` → `{error}`）→ [docs] 修订 PRD 锚点 7 + 补 lastActiveAt 锚定（两处一并）。
2. test-gap：补 REQ-AGENT-124 AC3 写失败降级测试（DB 层注入；可选联动 touch 移入 try）。
3. 修订 test-plan.md:21 指向 + 旧测试注释；REQ-124 补 §8-5 豁免注记。
4. 落 ADR-0037 + ADR-016 标注 + README 索引（/reflect 前硬闭环）。
5. 重调 `/review --cover=req,test` 聚焦重审自动链产物。

---

## 聚焦重审（2026-08-19 `--cover=req,test`，修复后复审）

> 背景：首轮 4 阻塞项修复后（PRD v0.2 `389cd51`、AC3 补测试 `fb85a6b`）的聚焦复审。

### 复审确认已收敛

- 403 锚点 `{error}`（PRD v0.2，人确认）；REQ-AGENT-124 AC3 写失败降级测试已补且绿；旧例空世代语义正名；ADR-037 落档。

### 新发现

| # | 级别 | 位置 | 发现 | 处置状态 |
|---|---|---|---|---|
| R1 | **CRITICAL** | `agentService.js:867-892` + `sessionStore.js:149,134-136` | **重启水合消费归档行**：水合循环 `store.list()` 无归档过滤，对 `feishu:<chatId>:gen<N>` 归档行调 `getOrCreate` → ① 归档 JSONL 存在时 `UPDATE lastActiveAt=now`（违反 REQ-AGENT-123 AC1「归档行 lastActiveAt 保持原值」，且每次重启把归档行顶到列表最前，破坏 REQ-AGENT-125 AC1 排序）；② 归档 JSONL 缺失且 lastActiveAt 在窗口内时走 missing-file 分支 `bumpGeneration` 改写归档行 sessionRef 指向空新文件——静默销毁历史指针（正是 REQ-AGENT-125 AC3/126 AC2 承诺优雅降级的场景）；③ 归档行被装配为活 worker 会话（session-config IPC + API key 注入）。ADR-037 后果 3「水合归档行 = 无害资源浪费」的评估**漏掉了行变异**，评估不成立。已由主会话对照 `isWithinHydrationWindow`（mtime 判定，归档文件 mtime 新 → 必在窗口）实证 | **已修**（人分类 code-defect → BUG-001）：水合循环按 `isFeishuArchiveKey` 跳过归档键；回归测试 Prove-It 先红后绿（`f1bb2cb` + `6be2cdc`），ADR-037 后果 3 已更正 |
| R2 | IMPORTANT | `requirements.md:69` | REQ-AGENT-126 AC3 文本写 403 响应体 `{ code: "E-SESSION-READONLY" }`，与 PRD v0.2 锚点 7（人确认 `{error}`）、sendError 封套、已签核测试矛盾；REQ 文件 hash 锁定，契约文档与测试不一致 | **人决策（2026-08-19）**：文档债务留 /reflect（与 `space_meta` 表名漂移同例，已记 signoff.md） |
| R3 | IMPORTANT | `feishuResetArchive.test.js` AC1 | 未断言新活跃行 provider/model=NULL 与 createdAt=此刻（REQ-AGENT-123 AC1 契约明列；PRD v0.2 锚点 2） | **已补**（`8a43bb0`，14/14 绿） |
| R4 | IMPORTANT | `feishuArchiveSessions.test.js:177` | REQ-AGENT-126 AC1 要求回读消息保持 messageId/role/createdAt/text 一致，测试只断言 role/text | **已补**（`8a43bb0`，messageId/createdAt 一致性断言） |
| R5 | SUGGESTION | `sessionStore.js:244` | 空世代判定用 `projectMessagesFromJsonl` 全量读+逐行 JSON parse 整个历史 JSONL，仅为判断「有无有效消息」——长会话 /reset 时主进程 O(文件) 同步解析，可改为首行短路 | **人决策（2026-08-19）**：已优化——提取 `projectLine` 单一谓词 + `hasProjectedMessage` 首行短路（`420048f`，56/56 绿） |

---

## 审查人决策记录

<!-- 人填写：是否接受本 review 结论，以及理由。 -->

**决策**：接受 / 有条件接受 / 不接受

**理由**：

**下一步动作**：
