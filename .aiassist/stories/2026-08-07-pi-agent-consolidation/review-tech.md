# Review 报告 — PI Agent 集成整理与优化（Consolidation） / tech

> 故事 ID：`2026-08-07-pi-agent-consolidation`
> 审查阶段：`tech`
> 日期：2026-08-08

---

## 审查摘要

- **总体结果**：**FAIL**（2 个阻塞项，修复 tech-design 后重审）
- **阻塞项数量**：2
- **警告项数量**：5

审查范围：`tech-design.md v1` × `prd.md v0.1` × `workflow-state.yaml` × 全部 ADR（重点 ADR-014/015/016/017）× `architecture.md` × `CONTEXT.md` × `STANDARDS.md` × 实际代码（worker.js / agentService.js / permissionPolicy.js / sessionStore.js / pi-permission-config.json / 现有测试）。

**关键实证校验**（tech-design 对现状的陈述与代码一致）：
- worker `sessions` Map 无 idle 淘汰/无上限，释放仅同 key 重建 / 出错 / `/reset` 三路径 — 属实（worker.js:56/508/756-760/792-800）。
- `logs[]` 无界、全库无消费者（http/cli 均无人读 `service.logs`）— 属实（agentService.js:424/494/980）。
- ping/pong 经 `logSend` 逐条入日志 — 属实（agentService.js:537-545/494）。
- `keySecrets` 按 **keyRef**（`key:${provider}:${generation}`）键控，**非按 sessionKey** — 属实（agentService.js:234、worker.js:497），这构成阻塞项 1 的事实基础。
- 双真源：`BASH_DESTRUCTIVE_PATTERNS` 与 `pi-permission-config.json` 逐条对应（靠注释手工维持）— 属实（permissionPolicy.js:48-63、json:31-64）。
- 现有恢复测试断言"两次启动恢复"，未钉死全行水合 — 属实（sessionRestore.test.js）。

---

## 审查项

| 维度 | 结果 | 说明 |
|---|---|---|
| 对齐 PRD | **PASS** | B1–B12 + M1 全部有模块/数据流/测试 seam 承接；M1 按"QA 阶段消化"处理正确；成功标准 1（24h 内存有界）有 QA 观测落点 |
| 模块边界 | **WARN** | sessionLifecycle/worker/agentService/policyRules 职责单一、边界清晰；但 sessionLifecycle 的辅助 Map 清理范围含 `keySecrets` 与共享 keyRef 矛盾（见阻塞项 1）；confirmAcks/permissionDecisions 两 Map 未纳入淘汰清理范围（可能残留悬挂 resolve，虽有超时兜底） |
| 接口契约 | **WARN** | 接口 1–5 均含输入/输出/错误/副作用/幂等；但接口 3 `evicted` 与既有 `E-AGENT-NO-SESSION` 判别缺失（见阻塞项 2）；接口 3 自动重投与 REQ-AGENT-005 标准 4「不做缓存自动重投」原则需显式调和（见警告项 3） |
| 测试 seams | **PASS** | B1–B12 每个稳定块均有 seam；时钟注入/Map 状态断言/CLI seam/golden diff seam 均合理；618+148 水位作为 B4 行为保持回归基线恰当；语料矩阵承接 B7 一令一卡 |
| 复杂度 | **PASS** | 复杂度收敛恰当：不做分进程建造、不做 agentService 拆分、复用 REQ-AGENT-005 恢复链路零新造；60s sweep 为 trivial 新增；无过度设计 |
| 风险 | **PASS** | 风险表 7 项均有回流点与快速验证路径；M1 秒级假设、mtime≈活跃集、隐藏测试钉死全行、gotgenes schema 漂移、同组单活误伤均被显式列出 |
| ADR 覆盖 | **WARN** | ADR-019/020 计划合理、满足 ADR 三条件；与 ADR-014/015/017 无冲突；但 ADR-020 形态（独立 ADR vs ADR-017 补充节）标"定稿拍板"未决（见警告项 2） |
| 术语一致性 | **WARN** | 与 CONTEXT.md 术语一致（对话空间/spaceKey 语法/授权桥/确认挂起）；但 B11 仅归位"agent 三义"，本 story 新 IPC/状态术语（`session-evicted`/`evicted`/同组单活/水合窗口）未纳入归位计划（见警告项 5） |
| 标准 | **PASS** | 未违反 STANDARDS.md；测试纪律（REQ-TRACE/只读/commit 标签）已声明；ADR 硬约束（ADR-014/015/017）在约束节列出 |

---

## 阻塞项（建议修复或回流）

- [ ] **模块边界：sessionLifecycle 淘汰清理范围与 keySecrets 共享 keyRef 矛盾（接口 1 + §模块 51/70 + §安全 153）**
  - 问题：tech-design 三处把 `keySecrets` 列为"随会话淘汰同步清理"（§模块边界 51 `toolContexts/sessionQueues/lastReplies/keySecrets`、接口 1 副作用 `辅助 Map ×4 + worker keySecrets`、§安全 153 `worker keySecrets 随淘汰清理`）。但 worker `keySecrets` 按 **keyRef**（`key:${provider}:${generation}`）键控（worker.js:57/497），同 provider + 同 generation 的多个会话**共享同一条 keySecrets 条目**（agentService.js:234 `keyRefFor(provider, gen)`、:421 注释"keyRef → 明文 key"）。按单会话淘汰清理会**误删仍存活会话的 key 条目**——破坏 worker `redact()` 日志脱敏（worker.js:320-326，遍历 keySecrets.values()）与后续懒恢复的 apiKey 注入依据。接口 2 主进程侧又写"keySecrets 保留（懒恢复重注入需要）"，两侧语义自相矛盾。PRD F1 只要求"三个辅助 Map（toolContexts/sessionQueues/lastReplies）"清理，**未含 keySecrets**——tech-design 擅自扩成 ×4 是错误来源。
  - 建议：keySecrets 为 keyRef 级共享缓存，**不随单会话淘汰清理**（与接口 2 主进程侧一致）；PRD §11 B1 seam 的三个辅助 Map 即为清理全集；worker 侧 keySecrets 清理由 keyRef 引用计数/懒恢复重注入决定，不在本 story 改变。同时把 `confirmAcks`/`permissionDecisions`（confirmId 键控）明确列为"淘汰会话时随超时兜底释放"，不强制同步清理。
  - 建议动作：**修复后重审**（改 tech-design 三处表述 + 接口 1 副作用列 + §安全 153，与 PRD 对齐）。

- [ ] **接口契约：接口 3 `session-error {code:"evicted"}` 与既有 `E-AGENT-NO-SESSION` 判别缺失，可能复活已删会话**
  - 问题：接口 3 写"worker 对未知 sessionKey 的 prompt → 回 `session-error {code:"evicted"}`；主进程收到 → 重发 session-config + 重投该 prompt 一次"。但 worker 现有对未知 key 的响应是 `E-AGENT-NO-SESSION`（worker.js:704-708，`会话不存在`）。`evicted`（已淘汰、store 行仍在、JSONL 可懒恢复）与"从未存在/已删除会话"是两个语义不同的状态——若一律回 `evicted`，主进程会为重发 session-config + 重投，对**已删除的 UI 会话/孤儿会话**误触发重建复活，与 ADR-016"孤儿会话禁止发送新消息"及 /reset 换代语义冲突。接口 3 未定义 worker 侧如何区分两者（需 store 行存在性 or 淘汰 tombstone 集合）。
  - 建议：worker 侧明确判别依据——仅当"该 sessionKey 存在 store 行/JSONL（可恢复）"时回 `evicted`；其余保持 `E-AGENT-NO-SESSION`。接口 3 契约补充判别谓词（如 `hasRecoverableRow(key)`），并给主进程重投加一次上限（已有）。
  - 建议动作：**修复后重审**（补判别依据，避免复活已删会话）。

---

## 警告项（建议但不阻塞）

- [ ] **模块边界：B3 同组单活与 ADR-016 多会话并列的 UX 张力——copilot 全组单热**
  - 问题：分组函数 `ui:copilot:*→copilot 组` 意味着**所有通用 copilot 会话（多个 chat）同一时刻只有一个热会话**。而 ADR-016 的核心决策正是"空间=会话、每条 chat 独立上下文（Codex 语义）、列表可见多条可继续"。用户在 copilot 空间开了两条 chat，A 正在读，B 收到消息→A 被冷却淘汰（虽 JSONL 保留可懒恢复）。这与多会话并列的既定交互存在张力。PRD B3 已由用户拍板（D5），故非阻塞；但建议在 REFLECT 将其列为明确观察项（风险表已列入"同组单活无误伤场景"，此处再强化：具体到"copilot 全组单热"这一收缩是否被 D5 显式覆盖）。
  - 建议：确认 D5 拍板是否明确覆盖"copilot 组内多 chat 单热"；若覆盖，tech-design 加一句"copilot 组 = 所有 `ui:copilot:*`，组内单热"的显式声明，避免实现期歧义。

- [ ] **ADR 覆盖：ADR-020 形态未决（独立 ADR vs ADR-017 补充节）**
  - 问题：决策表 ADR 计划行写"ADR-020 权限出厂策略单一真源化（修订 ADR-017「文件=契约」表述；备选：作 ADR-017 补充节，定稿拍板）"。ADR-017 已有 2026-08-07 补充节先例（BUG-001/002 修订），且 B6/B7 语义是对 ADR-017「策略文件=契约」的**修订**而非新增独立决策——独立 ADR-020 与补充节各有利弊（独立 ADR 索引更清晰；补充节保持 ADR-017 完整性）。
  - 建议：在 CRYSTALLIZE 前定稿形态；若选独立 ADR-020，注明与 ADR-017 的覆盖关系（ADR-017 修订 or ADR-020 取代其中"文件=契约"表述）。

- [ ] **接口契约：接口 3 自动重投与 REQ-AGENT-005 标准 4「不做缓存自动重投」原则的显式调和**
  - 问题：REQ-AGENT-005 标准 4 签核文本明确"重启期间到达的 prompt 不做缓存自动重投——重启窗口短、手动重发可接受"。接口 3 为 `evicted` 引入**自动重投一次**（理由：worker 未见过 prompt，重投安全）。技术上安全（幂等），但与本 story 声明"REQ-AGENT-005 不动"存在原则张力——`evicted` 与 `restarting` 同为"会话暂时不可服务"，处理却不同（自动 vs 手动）。
  - 建议：tech-design 补一句判别理由（`evicted` 时 worker 从未入队 = 零副作用，与 `restarting` 时可能部分执行不同），并确认无需改 REQ 文本（走就地补全/签核即可）。

- [ ] **测试 seams：B7 一令一卡"多规则命中展示优先级归实现"可更显式**
  - 问题：PRD B7 与数据流 6 用"仅当危险仅由不可见族运算符承载时 pre-gate 拦截"表达优先级，但"可见+不可见双命中"（如 `rm -rf * > /dev/null` 同时命中 rm 可见族与 `>` 不可见族）时的归属未逐条写明（当前语义推断为：可见族命中→交 gotgenes 单评估，pre-gate 跳过）。语料矩阵会兜底，但实现前把判别表列全更稳。
  - 建议：tech-design 加一列"命中组合→归属"的判别表（不可见 only→pre-gate；可见 only→gotgenes；双命中→gotgenes 优先，pre-gate 跳过），作为语料矩阵的规格输入。

- [ ] **术语一致性：新 IPC/状态术语未纳入 CONTEXT 归位计划**
  - 问题：B11 只归位"agent 三义"。本 story 引入 `session-evicted`、`evicted`（错误码）、同组单活、水合窗口等新术语/新 IPC 消息，均未列入 CONTEXT.md 更新计划。
  - 建议：B11 扩为"术语归位：agent 三义 + 会话生命周期（淘汰/懒恢复/水合窗口/同组单活/session-evicted）"，REFLEACT 时一并写入。

---

## 结论

- [ ] 可进入下一阶段
- [x] 需修复阻塞项后重审
- [ ] 建议回流到 `PRD` / `TECH-DESIGN` / `BUILD`

**建议动作**：先修两个阻塞项（均为 tech-design 内自洽性问题，不必回流 PRD），改完 tech-design v2 后重审一次即可进入 CRYSTALLIZE。警告项 1（copilot 全组单热）与警告项 2（ADR-020 形态）建议在重审或 CRYSTALLIZE 前由人显性决策。

---

## 审查人决策记录

<!-- 人填写：是否接受本 review 结论，以及理由。 -->

**决策**：待填

**理由**：待填

**下一步动作**：待填
