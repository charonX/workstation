# Review 报告 — Session Domain 深化 / prd,tech,req,test

> 故事 ID：`2026-08-16-deepen-session-domain`
> 审查层：`prd,tech,req,test`（code 层跳过：实现未开始，无 diff）
> 模式：`panel`（4 个并行 specialist：prd-reviewer / tech-reviewer / req-reviewer / test-engineer）
> 日期：2026-08-17
> 时机：门 1 signoff 已通过、BUILD 未开始——**本次审查发现签核存在两处失实，需在 BUILD 前处理**

---

## 审查摘要

- **总体结果**：**FAIL**
- **阻塞项数量**：2（tech C1 行数算术不可行；test C1 gitState 正分支承载声明失实）
- **警告项数量**：8（prd 1 + tech 3 + req 3 + test 1 IMPORTANT）
- **建议项数量**：18（各层 SUGGESTION，详见分层发现）

---

## 分层发现（panel 模式）

| 层 | 子代理 | 严重 | 重要 | 建议 | 层结论 |
|---|---|---|---|---|---|
| prd | prd-reviewer | 0 | 1 | 4 | PASS |
| tech | tech-reviewer | 1 | 3 | 5 | FAIL |
| req | req-reviewer | 0 | 3 | 5 | WARN |
| test | test-engineer | 1 | 1 | 4 | WARN |

### 关键发现（按层）

- [ ] **CRITICAL: 路由瘦身目标算术不可行（tech C1）**
  - 位置：prd.md §10.2 / ADR-030 决策 4 / REQ-117 AC5 / dependencyDirection.test.js:77-81（≤350 硬断言）
  - 问题：现文件 928 行（wc 实测）。按 §10.2 move/stay 清单搬走 ~300-330 行（父代理复核：DEFAULT_PROVIDER+附件 ~27、key 解析 ~28、投影/分页 ~73、gitState+挂起+attachPending+peekSession ~40、createSseSubscription ~93、buildSessionConfig ~15），**留存 ~600 行**；10 个 handleXxx 端点 + 列表拼装 ~139 行 + provider/mode 端点组 ~128 行按方案全部留路由，无更多可搬项。即使砍掉 67 行头部注释仍 ~540-580，距 ≤350 差 200+ 行。
  - 后果：AC5 在 BUILD 必红且无法在范围内修绿——要么触发本可避免的 BUG 循环，要么被迫削端点（违反"行为字节级不变"硬约束）。
  - 建议：（a）重定阈值（如 ≤650，~600 纯转发相对 928 已是实质改善）；（b）把 AC5 换成结构性断言（"领域函数零留存"）；（c）扩大搬迁范围（列表拼装/provider-mode 端点组另立模块——涉及 getDb/store join 归属，需重新拍板）。三处同源（§10.2 + REQ-117 AC5 + 测试断言）必须一起改。
- [ ] **CRITICAL: REQ-114 AC4 正分支承载声明失实（test C1）**
  - 位置：test-plan.md:14,23 + signoff.md 升级点结果第 2 行 + sessionDomainKeys.test.js:93-98
  - 问题：test-plan/signoff 声称 gitStateForSpace 正分支（branch/detached）"由既有 sessionEvents 的 session-git 首帧断言承载"。**父代理复核确认：全仓 grep `session-git` 在既有测试零命中**——sessionEvents 全部用例只过滤断言 text_* 帧；sessionStats 直测 readGitBranch 不经 gitStateForSpace 的 DB 查找路径。且 gitStateForSpace 的 DB 访问是 catch-all（任何异常 → none），新测试只断言 none——**若搬迁把 DB 路径搬坏（永远落 catch），现有测试照样全绿**。正分支 + DB 读取路径整体零钉。
  - 签核责任认领：门 1 signoff 的「tech-design 已授权 seam 最简」结论基于失实前提（当时假设 session-git 断言存在），该授权无效，signoff.md 相应行需更正。
  - 建议：（a）补直测正分支（DB_PATH 临时库 seed projects 行 + 真实临时 git 仓或 stub seam，断言 `{state:"branch"/"detached"}`）；或（b）更正 test-plan/signoff 措辞为"正分支无自动化覆盖"，由人显式拍板接受。

---

## 阻塞项（建议修复或回流）

- [ ] **层：tech —— C1 行数算术不可行**
  - 建议动作：**回流到 TECH-DESIGN**（行数目标是技术方案决策，规格锚点归人；选项 a/b/c 需人拍板）→ 同步修订 PRD §10.2/§4 块6、requirements v2（哈希重算）、dependencyDirection.test.js AC5 断言，重跑 /signoff
- [ ] **层：test —— C1 gitState 正分支零覆盖**
  - 建议动作：**回流到 TEST**（补正分支直测）或由人拍板接受无覆盖并更正承载声明（test-plan + signoff.md）；若补测则经 /test-author → /signoff 重签

## 警告项（建议但不阻塞）

### prd 层（IMPORTANT ×1）

- [ ] **§1「server.js 反向 import 其 4 个内部函数」定性失准**（prd.md:16-17）：server.js:26 的 4 名中 2 个是 handler（handleAgentSessions/handleAgentLastMode，属正常 server→route 分层），真正倒置的领域函数是 2 个（buildSessionConfig/attachPendingSseSubs），§10.2 自己也这么定性。intention 未带数字，初衷未漂移。建议修正措辞。

### tech 层（IMPORTANT ×3）

- [ ] **I1 「34 函数 + 6 常量全量分类定稿」不实**：顶层函数实测 44 个；§10.2 未点名「列表拼装五函数」，且 isOrphanSpace 被 handlePostMessage 复用（编码「孤儿会话禁止发送」领域规则）、projectExists 被 handleCreateSession 复用，均非边界判定②声称的"单端点 presentation"；另有 7 个函数仅被「等」字覆盖。建议 §10.2 附完整 44 函数 move/stay 表，判定②理由改为"HTTP admission/presentation 留路由"。
- [ ] **I2 「纯函数域（零状态零连接）」标签失实**：sessionDomain 将 import fs/getDb/settingsService/gitBranch（只读 I/O）。建议改述「无内部可变状态/不持有连接的领域函数域（含只读 I/O）」。
- [ ] **I3 context 袋扩展契约缺「未接线」语义**：handleGetEvents/handlePostMessage 经 `context.getSseRegistry()` 取实例，缺失时 TypeError 崩；对比既有工厂项均有优雅降级。建议 §10.4 补一行缺省语义（如显式 throw-with-clear-message 并声明接线纪律为硬前提）。

### req 层（IMPORTANT ×3）

- [ ] **REQ-112 AC1 措辞倒置 + 空 providers golden 未落 AC**：「provider 非空回落」与代码语义相反（provider 为空才回落）；§6.3 空 providers 锚点（`{provider:"deepseek", model:"", apiKey:undefined, identity:""}`）未在任何 AC 中钉住。建议 AC1 改「provider 空 → 回落」并补一条 AC 钉完整四字段（测试已正确断言，REQ 层失传）。
- [ ] **REQ-114 契约幻影字段 `worktree?`**：现行 readGitBranch（gitBranch.js:67-79）从不返回 worktree；与字节级不变冲突。建议契约改为 `{state, branch?}`。
- [ ] **REQ-116 AC4 回归载体指错文件**：E-ATTACH-* 的 HTTP 面覆盖在 `imageAttachment.test.js:188-222`，不在 sessionMessage。建议改为 imageAttachment。

### test 层（IMPORTANT ×1）

- [ ] **承载矩阵另两处归属失实**（test-plan.md:25）：REQ-115 AC5 归属应为 sessionEvents/assistantConfirm（sessionMessage 无 SSE/挂起断言）；REQ-116 AC4 归属 imageAttachment。AC 本身仍被承载，文档准确性问题。

## 建议项（SUGGESTION 汇总，不阻塞，可随修复轮一并处理）

**prd**：§4 块6/§3.5/§9/§11.2「10 个既有测试文件」计数分解重复计数（实 6 seam 门+1 直调+1 静态+2 HTTP/E2E），test-plan 矩阵枚举 11 名与 PRD「10」不一致；§14「每稳定块 ≥2 条锚点」字面声明不实（块 4/6 锚点在 §10.4/§11.1）；§9「4 个导出名」语境易误读（路由实际导出 8 名）；版本记录仅 v0.1，建议补 v0.2/v0.3。

**tech**：§10.4 注册表三方法契约补「无业务错误」行保持同构；§10.4 createSubscription 改引 ADR-029 limitSize 单真源（agentService enforceSizeLimit 将删除）；ADR-030 关联列表补 ADR-029；静态 seam 低风险误判点三处（path 级正则误中注释/exec 只取首个 import/缺 registry 正向断言）建议由 test 层加固。

**req**：REQ-113 AC2 空文本 user 行剔除分支无锚点（现行对 user/assistant 均生效）；REQ-113 契约漏列 normalizeLimit 导出（路由 :428 直接调用）；REQ-112 AC3「代码审查」人眼判断写进 AC（建议可机验部分拆出，审查挪 REFLECT）；REQ-112 契约缺错误形态声明；REQ-117 AC4 回归清单含不消费 HTTP 面的 cardStream、漏 imageAttachment/sessionStop 等真实消费方（建议改「既有测试全量零改动全绿」）。

**test**：REQ-115 AC4 补 res "error" 事件分支（close/error 是两个独立注册点）；env 变量改保存/恢复式（sessionReset 先例）+ DB 用例后 closeDb；静态断言两处脆弱点（exec 首匹配+硬编码 specifier 可逃逸；split("\n") 末尾换行多计 1 行——929 vs wc 928）；REQ-112 AC3 可廉价加固（调用前后 settings.json mtime 不变断言）。

## 复核证据（父代理对两条 CRITICAL 的独立验证）

- `grep -rln "session-git" tests/capabilities/ | grep -v 本 story` → **零命中**（exit 1）——test C1 成立。
- `wc -l agentSessions.js` = 928；搬迁块起止行定位后合计 ~300-330 行 → 留存 ~600，≤350 不可达——tech C1 成立。
- 各 specialist 的锚点抽查（§6.3 字面值 ↔ 现行代码）在 prd/req/test 三层独立交叉验证，全部命中，无 AI 自证迹象。

---

## 结论

- [ ] 可进入下一阶段
- [x] **需修复阻塞项后重审**
- [x] **建议回流**：tech C1 → `TECH-DESIGN`（行数目标人拍板）；test C1 → `TEST`（补正分支直测）或人拍板接受无覆盖

两层骨架健康（prd PASS；方向、ADR、模块拆分、测试质量均无结构性问题），阻塞项集中在两个数字/事实性错误，修复量小但牵涉规格锚点，必须回到人拍板层。

---

## 审查人决策记录

<!-- 人填写：是否接受本 review 结论，以及理由。 -->

**决策**：接受 / 有条件接受 / 不接受

**理由**：

**下一步动作**：
