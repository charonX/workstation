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
