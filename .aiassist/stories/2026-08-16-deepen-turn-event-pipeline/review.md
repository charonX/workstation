# Review 报告 — 回合事件管线深化 / prd,tech,req,test

> 故事 ID：`2026-08-16-deepen-turn-event-pipeline`
> 审查层：`prd, tech, req, test`（code 跳过——BUILD 未开始，无 diff；QA 全绿后末端统一审查自动带上）
> 模式：`panel`（并行 specialist）
> 日期：2026-08-17

---

## 审查摘要

- **总体结果**：WARN（无 CRITICAL；4 项 IMPORTANT 需处理，其中 1 项需人重新裁决、3 项契约文本修正）
- **阻塞项数量**：4（tech F1/F2/F3 + req text_start）
- **警告项数量**：10（prd 5 + tech 3 + req 2 + test 2 + test 5 建议级）

---

## 分层发现（panel 模式）

| 层 | 子代理 | 严重 | 重要 | 建议 |
|---|---|---|---|---|
| prd | prd-reviewer | 0 | 1 | 4 |
| tech | tech-reviewer | 0 | 3 | 3 |
| req | req-reviewer | 0 | 1 | 2 |
| test | test-engineer | 0 | 2 | 5 |
| code | code-reviewer | — | — | —（BUILD 未开始，跳过） |

---

## 阻塞项（建议修复或回流）

### B1（tech F2）E-AGENT-RESET 契约基于错误模型，需人重新裁决

- **问题**：实证 worker IPC 为**全局串行队列**（`messageQueue.enqueue(() => handleMessage(msg))`，worker.js:1663-1697；prompt 与 reset-session 都走此队，仅 ping/confirm-ack/permission-decision/stop-session 带外）→ reset-session **永远排在在途 prompt 之后**，会话队列深度恒 ≤1，「排队中、未开始的 prompt 在 reset 时被丢弃」场景**不存在**；reset 后新 prompt 走 lifecycle.get undefined → 既有 E-AGENT-NO-SESSION（reset 经 lifecycle.remove 清 tombstone，不落 evicted 重投）。E-AGENT-RESET 回执永不触发；`sessionQueues.delete` 也不取消 promise 链（无机制）。
- **根因**：test-author 阶段基于「sessionQueues delete 后 promise 链仍跑 → 主进程 pending 悬挂」的错误模型升级给人拍板（当时未实证全局队列的串行 await 语义）。
- **建议**（选项 a/b 由人拍板）：
  - **(a) 撤销 E-AGENT-RESET 契约（推荐）**：reset 语义 = 现状（在途/先到 prompt 按序完成；后到 prompt 走 E-AGENT-NO-SESSION），零行为变化；删 §8 reset 行回执语义、§10.4 接口 6 回执副作用、REQ-109 AC4 E-AGENT-RESET 断言、resetDropQueue.test.js 改写为「reset 后会话重建健康性」断言。注册表统一清理 + 计数泄漏修复**不受影响**（仍成立）。
  - **(b) 保留取消语义、落主进程**：agentService handleReset 时对 pendingPrompts 中该 space 未回执条目 resolve `{ok:false, error:{code:"E-AGENT-RESET"}}`（用户可见即时取消）；取舍 = worker 仍执行完（浪费）+ agentService 行为变更扩出本 story 初衷范围。
- **建议动作**：人裁决 a/b → 契约修订（prd/REQ/测试）→ 重签
- **阻塞**：yes

### B2（tech F1）lifecycle.touch 钩子在管线设计中无归属

- **问题**：forwardEvent 内 `lifecycle.touch(sessionKey, { clearPending: false })`（worker.js:707，仅当事件实际映射出站时调用）——管线注入集 {send, log, setTimeout, clearTimeout, now} 无 touch 钩子、§10.3 无 touch 步骤。缺失后果：① 长回合结束后 lastActiveAt 停在回合起点 → TTL 淘汰悬崖（回合刚结束即淘汰）；② worker 包装器若改调默认 touch()（clearPending:true）→ 组冷却双热回归（REQ-AGENT-037 M1 修复）。
- **建议**：管线注入集补 `touch(sessionKey)`，契约条件语义 = 「仅当事件实际映射出站时调用、恒 clearPending:false（由注入方承担）」，§10.3/§10.4 接口 1 副作用同步；单元测试补 touch spy 断言（出站事件调、延迟分支/message_end 不调）。
- **建议动作**：就地补 prd §10.2/§10.3/§10.4 + 测试补断言（[docs]/[test] 修订）
- **阻塞**：yes

### B3（tech F3）未知 key「静默 no-op」与现状矛盾

- **问题**：forwardEvent 对未知 key **照常计数/转发/延迟收尾/出站 send**（worker.js:651-710 无 key 守卫）；只有 lifecycle.touch 对未知 key 内部 no-op（sessionLifecycle.js:123-131）。「静默 no-op」表述会让 REQ-107 AC6（send 零调用）写错断言、或诱使实现者加守卫丢事件（破坏消息乱序容忍契约）。
- **建议**：契约改为「未知 sessionKey → 事件照常计数/转发/延迟收尾，仅生命周期活动刷新为 no-op（保持现状）」；REQ-107 AC6 + 单元测试同步（send 出站 + touch 注入 spy 被调用）。
- **建议动作**：就地补 prd §6.2/§10.4 + REQ-107 AC6 + 测试（[docs]/[test] 修订）
- **阻塞**：yes

### B4（req）REQ-111 AC2「text_start」不在 worker 契约流

- **问题**：AC2 断言「text_start → text_delta×N → text_end」，但 worker 契约流（mapToContractEvent）只产 text_delta/text_end/tool_execution_*，**无 text_start**（SSE 层按裁决 11 合成，agentSessions.js:820-827；feishu 卡片层同型）。REQ 表述与 seam（worker 级）自相矛盾，会诱使实现者给 worker 出站加 text_start（未批准行为变更）。注：workerWiring.test.js 实际已按契约流写（只断言 delta/end），是 requirements.md 表述失实。
- **建议**：AC2 改为「text_delta×N → text_end（带 meta.durationMs）顺序与形状不变；text_start 非 worker 契约流事件，由 SSE 层合成（既有 REQ-AGENT-028 SSE 测试锁定，AC5 回归清单）」。
- **建议动作**：就地补 requirements.md + 哈希重算 + 测试头部 REQ-VERSION 同步（[docs]/[test] 修订）
- **阻塞**：yes

---

## 警告项（建议但不阻塞）

- [ ] **prd：§6.3 缺稳定块 4 锚点行**——§6.3 七行只覆盖块 1/2/3；§14/§6.1 自检「每稳定块 ≥1 锚点」「四块各有 happy path」声明失实（REQ-111 的 expected 在 PRD 层无处 trace）。建议：§6.3 补块 4 锚点行（如「spawn + FAUX → 事件形状与 REQ-AGENT-055 一致」）或将自检声明改如实。
- [ ] **prd：§5 标题「还在动」与正文「全部已解决」矛盾**（v0.2 未同步标题）。
- [ ] **prd：§14 自检「§8 八行」实际 9 行**（reset 行补录后未同步计数与枚举）。
- [ ] **prd：workflow-state intention 行数 1835 vs 实际 1854**（快照过时，干扰回流比对）。
- [ ] **prd：块 2 锚点缺字面 key 例子**；E-AGENT-RESET 未作为 golden 字面值进 §6.3（随 B1 裁决处理）。
- [ ] **tech：§12「worker.js 不增加任何导出/import 面」自相矛盾**——worker 必须 import 管线才能接线。改「不增加导出；新增 import 仅限 src/agent/ 内部模块」。
- [ ] **tech：§10.4 接口 2/3/4/6 四要素表缩略**（缺错误行；接口 6 应把 evict/reset 两调用方分行——evict 不丢队列、无回执）。
- [ ] **tech：§10.6 风险表缺两行**（touch 保真 → 回流 TECH-DESIGN；E-AGENT-RESET 机制缺口 → 回流 ASSERTION-SIGNOFF）。
- [ ] **req：REQ-106 cross-module 标注误含 agentService**（消费 limitSize 属 REQ-110 范围）；REQ-110 调用点 248→249（off-by-one）。
- [ ] **test：limitSizeSingleSource AC1 同一引用过度约束**——`assert.equal(out, ev)` 应改 `assert.deepEqual(out, ev)` + 无 truncated（契约未承诺引用不变）。
- [ ] **test：resetDropQueue 全局「无 session-error」断言隐含覆盖运行中 prompt 中断契约**——契约只对排队中的 prompt2 承诺；运行中 prompt1 被 reset dispose 的收尾语义未落文档（pi-ai dispose 语义 BUILD 时实证；若 RED 属契约缺口而非测试误红）。建议补契约行「reset 中断运行中 prompt：同 abort 收尾语义」或收窄断言。
- [ ] **test：`await p1` 无界等待**（node:test 无默认超时）——建议 Promise.race 包裹或 waitUntil 轮询 settled。
- [ ] **test：REQ-106 AC1 无副作用子句未直接断言**（间接覆盖存在，建议 makeHarness 后补 `pendingCount()===0` + `sends.length===0`）。
- [ ] **test：workerWiring AC4 的 3s 时钟硬边界非契约锚点**（60x 裕量，风险低；建议放宽 5s 或改事件序断言）。
- [ ] **test：workerWiring AC1 的 session-config 形状无直接断言**（建议注释声明由 AC5 回归清单覆盖）。
- [ ] **test：limitSizeSingleSource AC6 EXPECTED-TRACE 引用不完整**（补引 §8 + §10.5）。

---

## PASS 维度（摘要）

- **prd**：痛点锚定 PASS（与 intention 逐字一致）；稳定/移动块划分 PASS；GAP 归类 PASS；用户故事 PASS；ADR 冲突 PASS（含与 ADR-029/016/024/020/009 及同批 ADR-030 无冲突）；全部事实断言经代码实证准确。
- **tech**：模块/数据流覆盖 PASS；职责单一 PASS；复杂度 PASS（注册表两接口必要性成立）；ADR 三条件 PASS；术语一致 PASS；三个特别核查点（beginTurn 无竞态 / clearSessionState 定时器时序自洽 / E-AGENT-RESET 形态兼容）PASS。
- **req**：稳定块→REQ 映射 PASS（四块全覆盖、无孤儿）；验收标准↔锚点抽查全量一致（除 B4）；capability/entity PASS；REQ-ID 与哈希 PASS（7452c3c1 三处一致）；可测试性 PASS。
- **test**：覆盖缺口 PASS（6 REQ 全覆盖、边界/错误 case 全在）；**EXPECTED-TRACE 诚实性 PASS**（13 处逐条核验：锚点真实存在、值一致、无抄代码——实现模块尚不存在）；时序稳定性 PASS（结构性确定：IPC FIFO + 全局串行队列；TPS 失效也稳健）；无快照 PASS；REQ↔测试追溯 PASS。

---

# 补充：code 层审查（2026-08-18，BUILD 后 /review --cover=code）

> 注：`/review --cover=code` 被内置 GitHub PR review 命令拦截（本仓库无 PR），按 loop-workflow code 层执行：对 6 个实现 commit（5f4518e/7415cb9/27d5c9d/6992614/d92f23e/1da6157，3 文件）派 code-reviewer（Fowler 基线 + 契约对齐 + 范围检查 + 4 项设计问题裁决）。

## 结果：PASS（无 CRITICAL / 无 IMPORTANT；3 SUGGESTION）

- 范围核实：6 commit 零业务测试改动、无范围外实现（sessionDomain.js 属并行 story，已排除）
- 行为等值：旧 forwardEvent/limitSize/mapToContractEvent 与新管线逐段 1:1 搬移（含 touch 时机、延迟分支、abort 合成、注册表清理顺序）
- Fowler 基线：Duplicated Code 未命中（本 story 净消除——两份清理清单/双实现 limitSize/重复诊断块全部收敛）；Shotgun Surgery 此前命中、本 story 修复；其余未命中或弱命中不修
- 4 项设计问题裁决：turnStartedAt 覆盖语义【保持+S1 注释】（偏小机制实际不可达，可达偏差系既有语义仅影响诊断 meta）；双载体截断【保持+S2 注释】（生产不可达：契约形状单载体）；now() 多次调用【保持】（微优化无观察差异）；clearPendingTextEnds 别名【保留】（登记点意图命名价值 > Middle Man 成本）

## 遗留 SUGGESTION（人裁决，不阻塞合入）

- **S3（唯一真实缺陷候选）**：`truncateTextCarrier` 文本载体截断非转义安全——`slice(0, MAX-256)` 对转义密集文本（如 261888 个 `"`）JSON.stringify 后 ≈523KB 超限；工具载体分支有迭代收紧、文本分支没有。**既有缺陷**（旧 worker limitSize 与旧主进程 enforceSizeLimit 双副本同型，非本 story 引入），主进程兜底同命中。生产可达：LLM 输出引号密集长文本。修复 = 文本载体套用同款迭代收紧（2-3 行）。处置选项：/bug 修（code-defect，补失败回归测试）或接受并记录（REFLECT 沉淀）。
- S1/S2：补注释（各 1 行，随任一后续改动带上或 /bug 时一起）
