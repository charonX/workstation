# Build Progress — 2026-08-16-deepen-execution-runner

> 父代理台账：/implementer（2026-08-16 起）
> 门 1 已过（a355772 assertion-signoff）；phase=BUILD
> 测试命令：`npm run rebuild:node && NODE_ENV=test node --import ./scripts/session-lifecycle-seam.mjs --test <文件>`
> 环境注记：better-sqlite3 ABI 需 rebuild:node 后再跑单测；并行会话改文件触发 vite HMR 会污染 E2E，静期重跑。

## 切片清单（依赖序）

| # | 切片 | REQ-ID | 测试文件 | 依赖 |
|---|---|---|---|---|
| 1 | ExecutionRunner 模块核心：submit/runOnce/reset + 内部队列（私有化）+ generation + 写入原语全收 + 观察窗 + 检查点 + recoverInterruptedExecutions + test seams | REQ-FLOW-048, REQ-FLOW-052 | executionRunner.test.js, executionRunnerReset.test.js | — |
| 2 | 入口接线：executions.js/imRouter/schedulerService → runner.submit（直调）；taskService 转发别名；schedule skip 反应归 schedulerService；删 subscribeToScheduleTriggers + server.js:151 接线；server.js:441 → runner.reset() | REQ-FLOW-049, REQ-SCHEDULE-010 | executionRunnerSubmit.test.js, scheduleDirectCall.test.js | 1 |
| 3 | debug 描述符：flows.js → runner.runOnce(debug)；persist:false 传播（services bag 绑定）；合成 debug parent 废止 | REQ-FLOW-050 | debugZeroPersist.test.js | 1 |
| 4 | 嵌套收编：子执行走 runOnce（守卫覆盖）；子日志写子行；execution:completed 事件补父子字段；深度/出口/冒泡语义保持 | REQ-FLOW-051 | nestedExecutionConsolidated.test.js（+ nestedExecution/subflowFailure 断言迁移核对） | 1, 3 |
| 5 | 测试 seam 迁移（[test] 侧，父代理执行）：artifacts/linkCapture/dailyDigest/nestedExecution 的 setter import 改挂 runner；全量回归 | REQ-FLOW-053 | 既有测试文件 import 迁移（断言不变） | 1-4 |

## 关键契约速查（子代理必读，勿重新发明）

- **模块形状**：`src/services/executionRunner.js` 模块级导出 `{ submit, runOnce, reset, recoverInterruptedExecutions, setAgentExecutorForTests, setChannelAdapterForTests }`；不 import taskService（无环）；executionQueue.js 文件保留但只被 runner import（接口私有化）。
- **submit**：`({projectId, flowId, trigger, variables, scheduleId?}) → {id, executionId, queuePosition} | {skipped:true, reason, scheduleId}`；容量满同步拒 `E-QUEUE-FULL`（第 51 个）。
- **runOnce**：`(executionCtx, descriptor)`；descriptor `{trigger, persist, artifacts, notify, observeQueued}`，subflow 附加 `{parentExecutionId, parentNodeId, depth, entryNodeId}`；观察窗 = 出队后、状态迁移前，仅 observeQueued=true（250ms 常量）；generation 4 检查点等价（快照/睡后/引擎后/catch/finally 门控）；queued 结算 + running 弃置语义保持。
- **reset**：generation+1 + destroy + 有界等待（20ms 轮询 + 5s 上限）→ resolve。
- **persist 传播**：runOnce 把自身 persist 绑定进 makeInvokeSubflow，子描述符继承。
- **skip 反应**：submit 只返回 `{skipped}`；日志 E-SCHED-FLOW-INVALID + markScheduleInvalid 由 schedulerService 触发路径执行。
- **写入原语全收**：insertExecutionNodes/completeExecution/addExecutionLog/collectArtifacts/deliverTerminalNotification/writeExecutionNotification/abortExecutionIfQueued/resolveChannelAdapter/_channelManager shim 从 taskService 迁入 runner。
- **taskService 保留**：查询（getExecution/list 等）、schedule CRUD（含 markScheduleInvalid）、getCronDescription、resetTasks、转发别名（createTask/executeTask/clearExecutionQueue → runner）。

## Slice 状态

（子代理与父代理按序追加：Slice N: complete/refactor pass done + PRD→代码 可追溯性表）

### Slice 1: ExecutionRunner 模块核心（REQ-FLOW-048 + 052）

状态：**complete（实现侧）+ 4 用例受测试骨架 fixture 阻塞（见 concerns，等父代理裁决）**。
实现：`src/services/executionRunner.js`（新建，零改动既有文件）；回归 executionLog/executionQueue/artifacts 23/23 绿。
两个业务测试文件 10 用例：6 绿（AC1/AC2/AC4/AC5 + debug 描述符 + reset AC1/AC2/AC4b）；4 红均为 fixture 问题（见下）。

#### PRD→代码 可追溯性表（Slice 1）

| PRD 意图（§10 / REQ） | 实现文件/函数 | 测试文件 | 覆盖状态 |
|---|---|---|---|
| §10.4 submit 契约：`{id, executionId, queuePosition}`，id===executionId（REQ-FLOW-048 AC1） | executionRunner.js: submit | executionRunner.test.js AC1 | COVERED |
| §8 E-QUEUE-FULL 容量满同步拒、不落行（REQ-FLOW-048 AC2 / 052 AC4b） | executionRunner.js: submit（isFull + enqueue） | executionRunner.test.js AC2；executionRunnerReset.test.js AC4b | COVERED |
| §10.5 观察窗 250ms 常量、出队后迁移前（REQ-FLOW-048 AC4） | executionRunner.js: runOnce（observeQueued 门控） | executionRunner.test.js AC4 | COVERED |
| §6.2/§8 schedule 出队二次 published 校验 → error + E-SCHED-FLOW-INVALID（REQ-FLOW-048 AC5） | executionRunner.js: runOnce（trigger=schedule 重读 flowService.getFlow） | executionRunner.test.js AC5 | COVERED |
| §10.2 写入原语全收：节点记录/完成态/日志/产物/终态通知/queued 结算/通道解析（REQ-FLOW-048 AC6） | executionRunner.js: insertExecutionNodes/completeExecution/addExecutionLog/collectArtifacts/deliverTerminalNotification/writeExecutionNotification/abortExecutionIfQueued/resolveChannelAdapter | executionRunner.test.js AC3（终态+output 断言） | PARTIAL：AC3 断言被 fixture 阻塞（flow 无 agent 节点 → executor 不被调用，output=null）；实现侧探针已验证等价 |
| §10.4 debug 描述符 persist=false 零落库 + 零睡眠（REQ-FLOW-048 AC3/AC4） | executionRunner.js: runOnce（persisted 判定 + observeQueued 缺省 false） | executionRunner.test.js「runOnce（debug 描述符）」 | COVERED |
| §10.4 测试 seam 注入经 runner（REQ-FLOW-053 AC1） | executionRunner.js: setAgentExecutorForTests/setChannelAdapterForTests | executionRunner.test.js REQ-FLOW-053 AC1 | PARTIAL：同 AC3 fixture 阻塞 |
| §10.3/10.4 reset 单一失效机制：generation+1+destroy+有界等待（REQ-FLOW-052 AC1） | executionRunner.js: reset | executionRunnerReset.test.js AC1 | COVERED |
| §8 reset 竞态：queued 结算 error（QUEUE_DRAINED_REASON）+ 收尾先于 reset resolve（REQ-FLOW-052 AC2） | executionRunner.js: runOnce 检查点① + abortExecutionIfQueued | executionRunnerReset.test.js AC2 | COVERED |
| §8 running 弃置 + recoverInterruptedExecutions 兜底（REQ-FLOW-052 AC3） | executionRunner.js: runOnce 检查点② + recoverInterruptedExecutions（re-export） | executionRunnerReset.test.js AC3 | PARTIAL：fixture 阻塞（flow 无 agent 节点 → 挂起 executor 不挂起，行在 reset 前已 success）；探针（挂起 executor + agent 节点）验证弃置+recover 语义正确 |
| §10.2 队列行为透 runner：同项目串行（REQ-FLOW-052 AC4a） | executionRunner.js: 内部队列实例（executionQueue） | executionRunnerReset.test.js AC4a | PARTIAL：fixture 阻塞（同上；且 executor 解构 `{prompt}` 但引擎传 `{node, context,…}`——应为 `context.prompt`） |
| §10.4 recoverInterruptedExecutions 随写入原语迁入 runner | executionRunner.js: `export { recoverInterruptedExecutions } from "./executionQueue.js"` | executionRunnerReset.test.js AC3 | PARTIAL（同 AC3 fixture） |
| §10.3 persist 传播：makeInvokeSubflow 绑定自身 persist（slice 3/4 用） | executionRunner.js: makeInvokeSubflow/invokeSubflowImpl（persistChild 门控） | slice 3/4 测试文件 | GAP（本切片无直接断言；接口已就位，slice 3/4 覆盖） |

#### Slice 1 concerns（已定根因，等父代理裁决）

1. **4 个红用例 = 测试骨架 fixture 错误（非实现缺陷）**——实现侧经探针逐条验证等价：
   - `executionRunner.test.js` AC3 + REQ-FLOW-053 AC1、`executionRunnerReset.test.js` AC3/AC4a 的 fixture 建的 flow **无 agent 节点**（POST /api/flows 仅 name；PATCH 仅 status:published）→ 引擎空 flow 早返回，注入的 executor 从不被调用（AC3-matrix 断言 output=null；AC4a 断言 order=[]；AC3-reset 断言行在 reset 前已完成 success）。参照 executionLog.test.js 先例，fixture 需 PATCH nodeList 含 `{type:"agent", config:{prompt:"{{prompt}}"}}`。
   - 注入的 executor 解构 `({prompt})`，但引擎调用契约是 `executor({node, context, project, projectPath, iteration, services, currentDepth})`（flowEngine.js L170-180）——顶层无 `prompt`；应读 `context.prompt`（variables 经 Object.assign 种子化）或 `node.config.prompt`。
   - 探针证据：/tmp/probe-fixture.mjs（agent 节点 + context.prompt 后 AC3-matrix/AC4a/AC3-reset 三断言全过）。
2. **executionQueue.destroy() 既有缺陷（length 洞）**：对已清空的 project 数组 `q.length = 1` 留洞，`pendingCount()` 永久计 1 → reset/clearExecutionQueue 的有界等待空转满 5s（旧 taskService 路径同样受影响——executionLog.test.js 全文件 11.3s 即此因）。本切片在 runner.reset() 内以 `pendingCount() > 0` 守卫跳过空队列 destroy（语义等价：空队列 destroy 无副作用），未改 executionQueue.js（禁改清单）。建议后续 [build]/bug 循环修 destroy 本体。
3. **QUEUE_DRAINED_REASON 文案微调**：签核断言（S4「日志含 QUEUE_DRAINED_REASON」+ AC2 断言字面量）要求日志消息含 `QUEUE_DRAINED_REASON` 字面量；taskService 现状消息 `E-QUEUE-DRAINED: execution aborted by queue lifecycle change` 不含。本切片消息改为 `E-QUEUE-DRAINED: execution aborted by queue lifecycle change (QUEUE_DRAINED_REASON)`（保留原码 + 追加签核字面量；旧测试无断言锁定原消息——grep 已证）。若父代理裁决恢复逐字一致，需改回并同步签核测试断言。
4. 模块形状按契约：`{ submit, runOnce, reset, recoverInterruptedExecutions, setAgentExecutorForTests, setChannelAdapterForTests }`；`completeExecution`/`addExecutionLog` 也导出（runner 为 queue 唯一消费者时 queue 私有化到位；taskService 未转发——slice 2 接）。

