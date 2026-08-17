# 需求洞察笔记 — 回合事件管线深化（turn event pipeline）

> 2026-08-17 · 来源：/improve-codebase-architecture 评审候选 #2（Strong / in-process）
> 报告存档：`.aiassist/global/architecture-reviews/architecture-review-2026-08-16.html`
> 参考先例：sibling story `2026-08-16-deepen-execution-runner`（评审 #1，已完成）

## 痛点（初衷）

worker.js 是 1854 行不可 import 的进程入口；一回合的事件状态机碎在三处（text_end
延迟转发、abort 合成收尾、淘汰清理 8 个状态 Map 手工配对），纯函数零直测，256KB
尺寸契约双实现已实证漂移。一句话：**回合状态机的知识没有属主，BUG 密度最高的区域
却无法透过 interface 测。**

## 实证摩擦点（子代理走查收集，全部带行号）

| # | 摩擦 | 位置 | 实证 |
|---|---|---|---|
| 1 | 清理清单两份手抄，已抄岔 | worker.js:723-744（handleSessionEvicted 删 7 项）/ 1703+（handleResetSession 删 5 项） | 重置版漏 toolContexts/sessionQueues；两清单是近亲复制 |
| 2 | 诊断计数 Map 泄漏 | worker.js:1598/1600（turnEventCounts/sdkEventCounts 仅 prompt 成功路径删） | 报错路径（1609-1615）与 llmError 早退（1577-1583）不删；淘汰/重置也不删 |
| 3 | 256KB 截断双实现，主进程那份更弱 | worker.js:514-543（limitSize，含工具事件数据载体分支）vs agentService.js:228-242（enforceSizeLimit 无该分支） | 主进程工具事件超限整条降级 `{type, truncated}` 丢 toolCallId/name/status/isError；MAX_IPC_BYTES 常量也双份（worker.js:63 / agentService.js:66） |
| 4 | 无 import 面、零导出 | 全仓库无 require/import worker.js；无 module.exports | spawn-only（agentService.js:460-465, 722）+ vite.worker.config.js:18 打包入口；仅 env seam |
| 5 | agentService 事件出口三处 | agentService.js:248（emitErrorEvent）/ 346（inMemory runTurn）/ 963（子进程消息回传） | 三处共用 enforceSizeLimit——单源后即三处调用点 |

## 关键事实核查记录

- 12 个会话级状态 Map 全清单确认：keySecrets(74) / toolContexts(79) / sessionModes(86) /
  judgeModels(100) / confirmAcks(105) / permissionDecisions(193) / sessionQueues(465) /
  lastReplies(601) / turnEventCounts(604) / sdkEventCounts(607) / turnStartedAt(620) /
  pendingTextEnds(621)。另有 2 个常量 Set（AGENT_MODES_SET:91 / FAUX_JUDGE_KINDS:855）无关。
- lastReplies 消费者仅 worker 内（1594 handlePrompt → prompt-result.reply），跨界后
  agentService.js:983-1000 消费；全 src/tests 无其它引用。
- inMemory 内核（agentService.js:289 createInMemoryAgentService）**未复刻回合状态机**：
  脚本化 provider 事件直通 enforceSizeLimit 后 emit（346），无 forwardEvent/延迟
  text_end/abort 合成/meta 机制——与 worker 的重复仅限 256KB 截断。
- 测试 seam 先例：sessionLifecycle.js 已抽离（src/agent/sessionLifecycle.js），
  sessionIdleEviction.test.js 直接 import + 注入 onEvict 回调测之；worker 侧黑盒测试
  用 spawn + FAUX（workerToolEventExt.test.js REQ-AGENT-055 / sessionEvents.test.js
  REQ-AGENT-028 走 HTTP+SSE；agentModelResolveLocal.test.js 直 spawn + JSONL 协议）。

## 关键边界

1. 管线模块拿「事件流转相关」状态：lastReplies / turnEventCounts / sdkEventCounts /
   turnStartedAt / pendingTextEnds + forwardEvent / flush / clear / limitSize /
   mapToContractEvent；装配态（keySecrets / toolContexts / sessionQueues /
   sessionModes / judgeModels / confirmAcks / permissionDecisions）留 worker。
2. 淘汰+重置清理统一为注册表：装配态 Map 也登记进注册表，淘汰/重置一条代码路径
   清全部——顺手修掉「两份清单抄岔 + 计数泄漏」。
3. 主进程 256KB 截断换成 worker 这份强的（工具事件保留契约字段）——修行为。
4. inMemory 内核只统一截断单真源，不接 forwardEvent（行为对齐不在此 story）。
5. worker.js 保持零导出、零 import、spawn-only；事件形状/转发顺序/abort 合成语义/
   淘汰副作用照旧（除 #3 批准的截断行为修复）。

## 隐含假设

1. 注册表统一清理后，reset 补删 toolContexts/sessionQueues 无隐藏语义依赖
   （子代理评估「lifecycle.remove 应已使其 moot」，未 100% 实证——列为风险）。
2. keySecrets/confirmAcks/permissionDecisions 不登记注册表（保留语义：keyRef 共享
   缓存 / 30s·10min 超时兜底）——用户默认同意，未显式确认。
3. 既有黑盒测试无断言锁定主进程 enforceSizeLimit 的弱降级行为（Q2 修复允许改
   受影响断言，走签核）。

## 矛盾/风险

1. 注册表统一清理 → reset 行为变化（补删 2 Map + 计数 Map）——唯一未 100% 实证的
   点；tech-design 时实证「reset 后残留 toolContexts/sessionQueues 是否可观察」。
2. worker 打包（vite.worker.config.js）与主进程双入口 import 同一模块——需确认
   无打包/环依赖问题（模块不 import worker/agentService 即无环）。
3. 主进程截断行为修复若被既有测试锁定旧行为 → 断言变更走签核（Q2 已批准方向）。

## 候选方向

### 方向 A：管线模块 + 注册表统一清理（确认）
- 适用场景：评审 #2 字面落实 + 顺手修实证洞；sibling story 同模式可复用
- 主要取舍：reset 行为小变（已批准）；模块内部形状（注册表 API）留 tech-design
- 推荐度：首选

### 方向 B：只搬不动（纯抽取，行为原样）
- 适用场景：零风险诉求
- 主要取舍：清理抄岔与计数泄漏留给 BUG 循环逐个修；单源化仅截断
- 推荐度：不推荐（用户已否决——Q1/Q2 均批准顺手修）

### 方向 C：管线模块 + inMemory 全行为对齐
- 适用场景：inMemory 与生产完全同构诉求
- 主要取舍：测试 seam 行为大改（text_end 加 meta/计数），改断言面大，无生产价值
- 推荐度：不推荐（用户 Q4 批准「统一」，澄清后确认仅单源截断）

## 确认方向

最终确认的方向：**方向 A**（管线模块 + 注册表统一清理 + 截断单真源 + 主进程截断
行为修复）。

确认意图（2026-08-17 人拍板，问答实录）：

- Outcome: 回合事件的状态机有一个可 import 的家（turnEventPipeline），直测；
  worker.js 退回 IPC + 装配壳；256KB 截断单真源，三处调用点共用。
- User: 开发者（worker 是 BUG 密度最高区）
- Why now: architecture-review #2 点名 + 清理清单已实证抄岔 + 计数 Map 已实证泄漏
- Success: turnEventPipeline 纯函数直测绿（注入 send + 假时钟）；两份手抄清理清单
  消失（注册表统一）；turnEventCounts/sdkEventCounts 淘汰/重置必清；agentService
  enforceSizeLimit 删除、工具事件在主进程侧不再整条降级；既有黑盒测试全绿不破。
- Constraint: 事件形状/转发顺序/abort 合成语义/淘汰副作用照旧（除 Q2 批准的主进程
  截断行为修复）；worker.js 保持零导出、零 import（spawn-only）。
- Out of scope: inMemory 内核事件流不接 forwardEvent；sessionLifecycle.js 不动；
  keySecrets/confirmAcks/permissionDecisions 保留语义不动；auto-judge/权限层/
  FAUX seams 不碰。

确认理由：评审 #2 方向明确 + sibling story（评审 #1）同一模式刚验证过 + 三个实证洞
（抄岔/泄漏/弱截断）都是低成本顺手修，人已逐项批准。

## 最窄的切入点

turnEventPipeline 模块 + 注册表：先把「可 import 的纯模块」立起来（无副作用 import，
注入 send/时钟），再逐个把 forwardEvent / 延迟 text_end / abort 合成 / limitSize 搬入，
最后注册表替换两处手抄清单并补计数清理——每步黑盒回归保绿。

## 待确认问题

- [ ] tech-design：注册表 API 形状（registerSessionMap/clearSessionState 命名与
      遍历语义）；reset 补删 2 Map 是否可观察（风险 1 实证）
- [ ] tech-design：双入口（worker bundle + 主进程）import 同一模块的打包确认
- [ ] tech-design：管线模块对外接口集（onSessionEvent / takeLastReply /
      takeTurnDiagnostics / limitSize / clearSessionState 候选）
- [ ] 既有断言是否锁定主进程弱降级行为（signoff 前 grep 实证）
