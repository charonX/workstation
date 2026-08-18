# ADR-029：回合事件管线模块化 turnEventPipeline——工厂模块 + 会话状态注册表 + 截断单真源

- 状态：已接受
- 日期：2026-08-17
- 相关 REQ：—（/improve-codebase-architecture 独立触发，候选 #2；story 2026-08-16-deepen-turn-event-pipeline）

## 上下文

架构评审（2026-08-16）走查 agent 对话子系统发现：**「一回合的事件状态机」的知识无属主**。
worker.js（1854 行、spawn-only 不可 import 的进程入口）内一回合的状态碎在三处：

- **text_end 延迟转发**（pendingTextEnds + 5s 兜底定时器）与 **abort 合成收尾**
  （message_end stopReason=aborted → 合成 text_end）——REQ-AGENT-057/091 落在此处；
- **淘汰清理 8 个状态 Map 手工配对**：handleSessionEvicted（删 7 项）与
  handleResetSession（删 5 项）是两份近亲复制，已抄岔——重置版漏
  toolContexts/sessionQueues；
- **诊断计数 Map 泄漏**：turnEventCounts/sdkEventCounts 仅在 prompt 成功路径删，
  llmError 早退 / catch 失败路径不删、淘汰/重置也不删——下一轮 prompt-result 混轮
  报告（BUG-002 诊断数据污染）；
- **256KB 尺寸契约双实现已漂移**：worker 的 limitSize（工具数据载体分支，迭代收紧
  保 toolCallId/name/status/isError）vs agentService 的 enforceSizeLimit（无该分支，
  工具事件超限整条降级丢契约字段）；MAX_IPC_BYTES 常量也双份。

这些纯函数（转发/映射/截断/合成）零直测——全项目 BUG 密度最高的区域（BUG-002/
003/004/006/007/010/014 均出自这里）却无法透过 interface 测。sessionLifecycle.js
已实证「从进程入口抽可 import 模块 + 直测」的模式可行（sessionIdleEviction.test.js）。

## 决策

1. **新建 `src/agent/turnEventPipeline.js` 工厂模块** `createTurnEventPipeline(options)`：
   import 无副作用；注入 `{send, log, setTimeout, clearTimeout, now}`；收编
   forwardEvent（入口 onSessionEvent）/ mapToContractEvent / limitSize / 延迟 text_end
   （pendingTextEnds + 5s 兜底 unref）/ abort 合成 / 回合状态 Map（lastReplies /
   turnEventCounts / sdkEventCounts / turnStartedAt / pendingTextEnds）。同
   sessionLifecycle 工厂先例，每测试独立实例。
2. **会话状态注册表统一清理**：`registerSessionScopedMap(map)`（纯 Map 登记）+
   `registerSessionCleanup(fn)`（特殊清理，如 pendingTextEnds 定时器 clear）+
   `clearSessionState(sessionKey)`（遍历全部登记项 delete）。装配态 Map
   （toolContexts / sessionQueues / sessionModes / judgeModels）由 worker 登记、
   worker 持有；淘汰与重置统一走一条清理路径——修「两份手抄清单抄岔」。
   keySecrets / confirmAcks / permissionDecisions **不登记**（保留语义：keyRef 共享
   缓存 / 30s·10min 超时兜底）。
3. **reset 语义 = 清空重来（人拍板 A）**：clearSessionState 清全部登记项——含
   sessionQueues（丢弃重置前排队中的操作：其引用的上下文已被重置，继续执行才是
   隐患）与 toolContexts（无陈旧窗口）。实证：lifecycle.remove 不碰 worker 侧 Map，
   sessionQueues 残留真实存在。
4. **计数清时机（人拍板 B）**：`beginTurn(sessionKey)` 幂等清诊断计数（prompt 开始
   前）+ `takeTurnDiagnostics(sessionKey)` 取出即删（prompt-result 处）——修失败
   路径残留导致的混轮污染。失败轮计数本就不被消费（失败日志不打 stats），无可见
   损失。
5. **256KB 截断单真源（人拍板 Q2）**：limitSize（worker 强实现）为唯一真源，导出
   MAX_IPC_BYTES = 262144；agentService enforceSizeLimit 删除、3 个调用点
   （emitErrorEvent / inMemory runTurn / 子进程消息回传）改 import。行为修复：工具
   事件在主进程侧不再整条降级（保契约字段）。已实证无既有断言锁定弱降级。
6. **worker.js 保持 spawn-only 零导出零 import**：瘦身为 IPC + 装配 + lifecycle 接线
   + 权限/FAUX/序列队列；副作用（dispose/send/log）保留，evict/reset handler 改调
   clearSessionState（先 dispose 后清，顺序保持现状）；handlePrompt 改调
   beginTurn / takeLastReply（读取不删，现状语义）/ takeTurnDiagnostics。
7. **inMemory 内核仅单源截断（人拍板 Q4）**：不接 forwardEvent——实证其无回合状态机
   （脚本化 provider 事件直通限流出站），与 worker 的重复仅限 256KB 截断；接
   forwardEvent 会改变测试 seam 行为（text_end 加 meta/计数）且无生产价值。

## 后果

- 回合状态机知识集中一处：转发/延迟/合成/截断/清理清单单真源；管线纯函数直测
  （注入 send + fake clock）。
- 行为变化（人批准）：reset 丢排队操作 + 清 toolContexts；计数清理时机前移（不混轮）；
  主进程工具事件截断保契约字段。
- 契约保留：事件形状/转发顺序/abort 合成语义/淘汰副作用照旧；lastReplies「读取不删」
  语义保持；5s 兜底 unref 保持。
- 测试策略：replace, don't layer——管线直测就位后，既有 spawn 黑盒测试保持为契约
  回归，不新增 spawn 层白盒断言。
- 依赖方向先例：services → agent import 成立（permissionPolicy → toolAdapter 同构；
  双入口打包已实证：模块零外部依赖，vite external 清单不受影响）。

## 替代方案

- **只搬不动（纯抽取、行为原样）**：清理抄岔与计数泄漏留给 BUG 循环逐个修——被
  否决：三个实证洞都是低成本顺手修，人逐项批准（需求洞察 Q1/Q2）。
- **inMemory 全行为对齐**（inMemory 也接 forwardEvent）：被否决：测试 seam 行为大改
  （text_end 加 meta/计数），改断言面大，无生产价值。
- **模块级单例而非工厂**：被否决：工厂同 sessionLifecycle 先例，测试独立实例隔离
  状态。

## 补充（2026-08-17 /review 修订）

1. **撤销 E-AGENT-RESET 回执契约**（决策 3 后半段）：原「reset 丢弃排队 fn 回
   E-AGENT-RESET 失败回执」基于错误模型——实证 worker IPC 为全局串行队列
   （messageQueue.enqueue + handleMessage await，worker.js:1663-1697），reset-session
   排在在途 prompt 之后处理，会话队列深度恒 ≤1，「排队中被丢弃的 prompt」场景
   不存在，回执永不触发。裁决：撤销契约行，reset 语义保持现状（在途/先到按序
   完成；reset 后新 prompt 走既有 E-AGENT-NO-SESSION）。注册表统一清理与计数泄漏
   修复不受影响。
2. **补 touch 注入钩子**（决策 1 注入集）：注入集 {send, log, touch, setTimeout,
   clearTimeout, now}——touch 仅当事件实际映射出站时调用，恒 clearPending:false
   由注入方承担（forwardEvent 现状 worker.js:707；缺失 → 长回合 TTL 淘汰悬崖 /
   组冷却双热回归 REQ-AGENT-037 M1）。
3. **未知 key 语义澄清**（决策 7 邻接）：事件对未知 sessionKey 照常计数/转发/延迟
   收尾/出站（消息乱序容忍 = 事件不丢失），仅注入 touch 由注入方内部 no-op——
   非「整事件静默丢弃」。
4. **决策 6 澄清**：worker.js 保持「不增加导出」；新增 import 仅限 src/agent/ 内部
   模块（同 sessionLifecycle 先例，worker 必须 import 管线才能接线），不新增外部
   依赖——「零 import」字面不可满足（prd §12 同改）。
5. **文本载体截断转义安全（BUG-001，2026-08-18）**：truncateTextCarrier 补迭代收紧
   ——slice 到字节预算不保证 JSON 序列化后 ≤ MAX（引号/控制字符转义放大，20 万引号
   ≈400KB）；与工具载体 shrinkToolCarrier 同型（`JSON.stringify({...out,[carrier]:
   text}).length` 二分），出站 JSON 恒 ≤ 262144。Prove-It 回归（3d844d6 + 774a6e7）。
