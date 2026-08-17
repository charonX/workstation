# 签核记录 — 2026-08-16-deepen-turn-event-pipeline

## Assertion（门 1，2026-08-17）

### 检查清单

- [x] PRD §14 无 GAP 悬空（§10 已由 /tech-design 定稿 PASS；§5 移动块四块全解决）
- [x] 每个 REQ-ID 都有对应测试（REQ-AGENT-106~111 → 4 个测试文件全覆盖）
- [x] 每个测试文件都有 `REQ-TRACE`、`REQ-VERSION`、`CAPABILITY-TRACE`、`ENTITY-TRACE`、
      `EXPECTED-TRACE`、`TEST-AUTHOR`、`ASSERTIONS-SIGNED`（4 文件头部 6 行机械核验）
- [x] 每个 REQ 的 capability/entity 与 `business-capabilities.md` 一致
      （agent-dialogue/conversation-space，turn-event-pipeline 行已登记）
- [x] 无 `// TODO: HUMAN ASSERTION` 占位（grep 0 命中）
- [x] 预期值来源清晰：每条 expected 值 trace 到 prd.md §6.3/§10.4 锚点（非代码输出）
- [x] 无快照当判定依据
- [x] 边界/错误 case 已覆盖（未知 key no-op、5s 兜底、usage 缺失 meta 缩字段、
      无载体截断兜底、aborted 有/无 pending 两分支、cleanup 定时器不悬挂、reset 排队丢弃）

### expected 值交叉验证（EXPECTED-TRACE ↔ prd.md 锚点）

| 断言组 | 锚点来源 | 值一致 |
|---|---|---|
| MAX_IPC_BYTES = 262144；截断保契约字段；迭代收紧 ≤ 262144 | §6.3-6/7 + §10.4 接口 7 | ✅ |
| meta 三字段（durationMs 精确差 123 / tokensIn:1000 / tokensOut:2000） | §6.3-1 + §10.4 接口 1 样例 | ✅ |
| 5s 兜底（推进 5000ms；meta 仅 durationMs） | §6.3-2（PENDING_TEXT_END_FALLBACK_MS=5000） | ✅ |
| abort 合成（text 段拼接 "已生成文本"；reply 保留；有 pending 不合成） | §6.3-3 + §10.4 接口 1 abort 样例 + §6.2 分支 | ✅ |
| 计数 {delta:2, end:1, tool:1}；beginTurn 幂等清；取出即删 | §6.3-4 + §10.4 接口 2/4 | ✅ |
| clearSessionState 清全部登记 Map；cleanup 钩子；定时器不悬挂 | §6.3-5 + §10.4 接口 5/6 | ✅ |
| E-AGENT-RESET 回执（ok:false + code + reason 含「已重置」；无 session-error） | §8 reset 行（test-author 升级点人拍板 1，本会话就地补） | ✅ |
| 事件链形状/meta/reply 不串轮/stop 收尾 | §6.1-1/3（既有 REQ-AGENT-006/028/057/091 契约） | ✅ |

### 升级点结果

| 升级点 | 内容 | 处置 |
|---|---|---|
| E-AGENT-RESET 回执契约（test-author 发现） | 实证：enqueueSession promise 链不因 Map delete 取消 + 主进程 pendingPrompts 无超时兜底——「reset 清队列」只删 Map 会永久悬挂 | 人拍板选项 1（worker 主动回 prompt-result ok:false + E-AGENT-RESET；不发 session-error），已就地补 prd.md §8/§10.4 + requirements.md REQ-109 AC4，哈希重算 7452c3c1 |
| 初衷漂移 | intention ↔ PRD §1 ↔ REQ 集合一致（无漂移信号） | 无 |
| 跨模块契约歧义 | §10.4 六接口契约均可从锚点确认（含注册表语义、limitSize 四分支） | 无 |
| 安全边界 | 无信任边界变化（keySecrets 不登记、明文不落盘语义不动） | 无 |

### 覆盖摘要

| REQ-ID | 测试文件 | capability/entity |
|---|---|---|
| REQ-AGENT-106 | api/turnEventPipeline.test.js | agent-dialogue/conversation-space |
| REQ-AGENT-107 | api/turnEventPipeline.test.js | agent-dialogue/conversation-space |
| REQ-AGENT-108 | api/turnEventPipeline.test.js | agent-dialogue/conversation-space |
| REQ-AGENT-109 | api/turnEventPipeline.test.js + api/resetDropQueue.test.js | agent-dialogue/conversation-space |
| REQ-AGENT-110 | api/limitSizeSingleSource.test.js | agent-dialogue/conversation-space |
| REQ-AGENT-111 | api/workerWiring.test.js | agent-dialogue/conversation-space |

回归清单（QA 阶段执行）：workerToolEventExt / sessionEvents / sessionIdleEviction /
agentModelResolveLocal / agentDialogue（REQ-AGENT-111 AC5）。

### 签核状态

签核时 4 文件全 RED（turnEventPipeline 模块 seam 未就绪——import 即失败；其余
依赖该模块导出），0 例误绿。signer = **AI**（无升级点遗留，E-AGENT-RESET 已人拍板）。
人工验收留在 REFLECT：无（全部验收标准可自动化）。

---

## Assertion v2 重签（2026-08-17，/review 全链修订）

**缘起**：/review（panel：prd/tech/req/test 四 specialist）4 项 IMPORTANT + 16 警告全处理。

### v2 修订内容（人拍板 2026-08-17）

1. **B1 撤销 E-AGENT-RESET 契约**（tech F2）：实证 worker IPC 为全局串行队列
   （messageQueue.enqueue + handleMessage await，worker.js:1663-1697）——reset-session
   排在在途 prompt 之后处理，会话队列深度恒 ≤1，「排队丢弃」场景不存在；v1 升级点
   基于错误模型（当时未实证全局队列 await 语义）。处置：§8/§10.4 接口 6 契约行删除，
   REQ-109 AC4 重写为「reset 语义保持」（流式中 reset 不掐断在途生成 + 会话重建健康），
   resetDropQueue.test.js 重写。注册表统一清理 + 计数泄漏修复不受影响。
2. **B2 补 touch 注入钩子**（tech F1）：管线注入集 {send, log, **touch**, setTimeout,
   clearTimeout, now}——仅当事件实际映射出站时调用，恒 clearPending:false 由注入方
   承担（缺失 → 长回合 TTL 淘汰悬崖 / 组冷却双热回归，REQ-AGENT-037 M1）；单元测试
   补 touch spy 时机断言。
3. **B3 未知 key 语义修正**（tech F3）：事件照常计数/转发/延迟收尾/出站，仅 touch
   no-op（消息乱序容忍 = 事件不丢失）；REQ-107 AC6 + 单元测试重写。
4. **B4 REQ-111 AC2 表述修正**（req）：text_start 非 worker 契约流事件（SSE 层按
   裁决 11 合成，既有 REQ-AGENT-028 测试锁定）；AC2 改为 text_delta×N → text_end。
5. **警告项 16 条全处理**：§6.3 补块 4 锚点行；§5 标题；§14 计数 8→9；intention 行数
   1835→1854；§12 零 import 修正；§10.4 接口 2/3/4/6 四要素补全 + 接口 6 按调用方
   分行；§10.6 风险表补两行；REQ-106 标注修正；REQ-110 调用点 248→249；
   limitSize AC1 改 deepEqual；AC6 EXPECTED-TRACE 补引；AC1 无副作用直接断言；
   workerWiring AC4 3s→5s；AC1 注释声明 config 形状由 AC5 覆盖；resetDropQueue
   p1 有界等待。

### v2 签核状态

- requirements.md v2 哈希 `ce30bc5a5b38a48fb78ab31fd56d388918e59094597535cdedd97028604f5d15`
  （requirements-v2.hash，v1 哈希文件删除）。
- 4 测试文件头部 REQ-VERSION 同步为 v2-hash；断言随修订更新（未知 key/touch/AC4），
  其余断言不变。
- AI 自检复查：REQ-AGENT-106~111 全覆盖保持；EXPECTED-TRACE 锚点随 prd v0.3 修订
  后重新交叉验证一致（含新增 touch 时机与块 4 锚点）；无 TODO 占位；无快照。
- 升级点：B1 撤销为 v1 升级点的推翻性修订（人拍板 2026-08-17）；其余 v2 修订为
  事实修正。signer = **AI**（v2 修订全部人拍板后自动签核）。
