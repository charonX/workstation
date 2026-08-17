# 测试计划 — 回合事件管线深化（turnEventPipeline）

> 2026-08-17 · /test-author · REQ-VERSION: v1-hash:7452c3c1c3d87fbfbce1d33a1060f811bbbf6456984d222633b25df084b46856

## Seam 总览

| REQ-ID | Seam | 测试类型 | 文件 |
|---|---|---|---|
| REQ-AGENT-106 | turnEventPipeline 工厂直测（注入 send/log/假时钟） | 单元 | `api/turnEventPipeline.test.js` |
| REQ-AGENT-107 | 同上（转发/延迟/meta/计数/beginTurn/未知 key） | 单元 | `api/turnEventPipeline.test.js` |
| REQ-AGENT-108 | 同上（abort 合成三 AC） | 单元 | `api/turnEventPipeline.test.js` |
| REQ-AGENT-109 | AC1-3 同上（注册表）；AC4 真实 spawn + store.reset（E-AGENT-RESET） | 单元 + 集成 | `turnEventPipeline.test.js` + `api/resetDropQueue.test.js` |
| REQ-AGENT-110 | limitSize 直测四分支 + inMemory 内核集成（出口行为） | 单元 + 集成 | `api/limitSizeSingleSource.test.js` |
| REQ-AGENT-111 | 真实 spawn（createAgentService + 句柄事件） | 集成 | `api/workerWiring.test.js` |

## expected 值来源（EXPECTED-TRACE 对照）

| 断言 | 来源 |
|---|---|
| MAX_IPC_BYTES = 262144；截断保契约字段；迭代收紧 ≤ 262144 | prd.md §6.3-6/7、§10.4-7 |
| meta 三字段（durationMs 精确差 / tokensIn:1000 / tokensOut:2000） | prd.md §6.3-1、§10.4-1 |
| 5s 兜底（推进 5000ms；meta 仅 durationMs） | prd.md §6.3-2（PENDING_TEXT_END_FALLBACK_MS） |
| abort 合成（text 段拼接 "已生成文本"；reply 保留） | prd.md §6.3-3、§10.4-1 abort 样例 |
| 计数 {delta:2, end:1, tool:1}；beginTurn 幂等清；取出即删 | prd.md §6.3-4、§10.4-2/4 |
| clearSessionState 清全部登记 Map；cleanup 钩子；定时器不悬挂 | prd.md §6.3-5、§10.4-5/6 |
| E-AGENT-RESET 回执（ok:false + code + reason 含「已重置」；无 session-error） | prd.md §8 reset 行（test-author 升级点人拍板 1） |
| 事件链形状/meta/reply 不串轮/stop 收尾 | prd.md §6.1-1/3（既有 REQ-AGENT-006/028/057/091 契约） |

## 升级点记录（test-author 发现，已就地解决）

| 升级点 | 发现 | 处置 |
|---|---|---|
| E-AGENT-RESET 回执契约 | 实证：enqueueSession 的 promise 链不因 Map delete 取消（回调照跑）；主进程 pendingPrompts 无超时兜底——「reset 清队列」只删 Map 会致主进程永久悬挂 | 就地补 prd.md §8/§10.4 + requirements.md REQ-109 AC4，人拍板选项 1（worker 主动回 ok:false + E-AGENT-RESET；不发 session-error）；哈希重算 7452c3c1 |

## 覆盖检查

- 6 REQ 全部有自动化测试（0 个 `人工(仅视觉)`——本 story 纯内部重构无 UI）。
- 既有黑盒回归清单（REQ-AGENT-111 AC5，QA 阶段执行）：workerToolEventExt /
  sessionEvents / sessionIdleEviction / agentModelResolveLocal / agentDialogue。

## 测试依赖处理

- 单元面：spy send/log + 假时钟注入（setTimeout/clearTimeout/now），零网络零进程。
- 集成面：真实 spawn（NODE_ENV=test 自动 FAUX）+ 临时 workdir/DB 隔离；
  reset 路径经真实 sessionStore.reset（生产路径同构）。
- 时序：FAUX TPS 控速（60/150）制造流式/排队窗口（sessionStop.test.js 先例）。

## REFLECT 人工验收备注

- 无（无纯审美判断；全部结构/行为已自动化）。
