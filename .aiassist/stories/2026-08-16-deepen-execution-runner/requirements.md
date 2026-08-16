# Requirements — ExecutionRunner 深化（一次执行的唯一入口）

> 故事 ID：`2026-08-16-deepen-execution-runner`
> 版本：v1
> 最后更新：2026-08-16
> 来源：`prd.md` v0.1（§4 六稳定块，§10 技术方案已由 /tech-design 深潜定稿）
> 移动块：无（§5 已清空，四块全解决）
> UX 参照：N/A（纯内部架构重构，无用户界面；DESIGN/DOMAIN-MODEL 阶段跳过）
> 技术事实：观察窗契约「createTask 后立即 GET 稳定见 queued」经 executeTask:596
> 实证；queued 断言测试为轮询式不依赖睡眠本身；executionLog.test.js 实证；
> markScheduleInvalid 与 schedule CRUD 同住 taskService（唯一带 scheduleId 的调用方
> = schedulerService，测试经真实 scheduler 路径断言 skip）。
> ADR：ADR-028（grilling 10 项决议）+ tech-design 5 项新增决策（§10.5，REFLECT 时
> 补充进 ADR-028）。
> 测试目录：`tests/capabilities/flow-orchestration/execution/2026-08-16-deepen-execution-runner/`
> （REQ-FLOW-048~053）；`tests/capabilities/scheduling-execution/schedule/2026-08-16-deepen-execution-runner/`
> （REQ-SCHEDULE-010）。

---

## REQ-FLOW-048 ExecutionRunner 模块——submit/runOnce/reset 三接口

- 优先级 P0 / 必须 / cross-module / executionRunner（新增）+ executionQueue（接口私有化）+ taskService（转发瘦身）/ flow-orchestration / execution / 单元 + 集成
- 接口契约：
  - `submit({projectId, flowId, trigger, variables, scheduleId?}) → {id, executionId, queuePosition}` 或 `{skipped:true, reason, scheduleId}`（trigger=schedule 且 flow 非 published）
  - `runOnce(executionCtx, descriptor)`，descriptor = `{trigger, persist, artifacts, notify, observeQueued}`，subflow 附加 `{parentExecutionId, parentNodeId, depth, entryNodeId}`
  - `reset() → Promise`（generation+1 + 队列 destroy + 有界等待）
  - 错误：E-QUEUE-FULL（503 语义保持）/ project、flow 校验（400）/ E-FLOW-MAX-DEPTH / E-SUBFLOW-NO-OUTPUT / 引擎错误（保持）

验收标准：
1. submit 成功路径：落 queued 行 + 返回 `{id, executionId, queuePosition}` 三字段，形状与现状一致（单元：fake db + 假时钟）。
2. 项目队列容量满 → submit 同步拒绝 E-QUEUE-FULL，不落行（单元）。
3. runOnce 描述符矩阵：入队/debug/subflow 三形态走同一代码路径，行为按描述符分化——persist/artifacts/notify/observeQueued 各自生效（单元：注入 fake executor 断言节点记录/产物/通知按 flags 收放）。
4. observeQueued=true：出队后、状态迁移前存在观察窗（假时钟断言 queued 保持 ≥250ms）；observeQueued=false（debug/subflow）：零睡眠（单元：假时钟）。
5. trigger=schedule 的 runOnce 出队时二次 published 校验：执行时已非 published → 行标 error + 日志 E-SCHED-FLOW-INVALID（集成）。
6. 写入原语全收：节点记录/完成态/日志/产物/终态通知由 runner 完成（集成：执行全链路落库断言；taskService 不再承载写入语义）。

## REQ-FLOW-049 触发入口归一与契约保持

- 优先级 P0 / 必须 / cross-module / executions.js、imRouter → runner.submit；taskService 转发别名 / flow-orchestration / execution / 集成 + E2E
- 接口契约：HTTP 与通道入口行为面不变——POST /api/executions 201 `{id, executionId, queuePosition}`；容量满 503 E-QUEUE-FULL；taskService.createTask/executeTask/clearExecutionQueue 转发别名保持导出

验收标准：
1. POST /api/executions（manual）行为不变：201 + 三字段返回；立即 GET 见 status=queued（观察窗契约，集成）。
2. 队列满经 HTTP → 503 + E-QUEUE-FULL（集成：既有断言迁移）。
3. imRouter 通道路径：入队回执「收到，排队中（第 N 位）」queuePosition 语义不变（集成）。
4. taskService.createTask/executeTask/clearExecutionQueue 转发别名保持导出且行为等价（集成：既有调用方与旧测试 import 迁移后断言不变）。
5. server.js:441 的 clearExecutionQueue 调用替换为 runner.reset()（集成：重启路径回归）。

## REQ-FLOW-050 debug 描述符零落库

- 优先级 P0 / 必须 / cross-module / flows.js → runner.runOnce(debug 描述符) / flow-orchestration / execution / 单元 + 集成
- 接口契约：debug 描述符 `{trigger:"debug", persist:false, artifacts:false, notify:false}`；persist 经 services bag 绑定传播到子调用

验收标准：
1. debug 运行后无任何 execution 行——顶层与 subflow 子树全链路零落库，无孤儿行（集成：调试含子流程运行后查 executions 表）。
2. debug 不收集产物、不写终态通知（集成：产物/通知断言）。
3. persist:false 传播：子调用描述符继承父 persist（单元：services bag 绑定断言）；合成 `debug-<uuid>` parentExecutionId 不再产生（集成：查库无合成父 id 行）。
4. debug 运行返回 status/output 供调试弹窗消费，行为不变（集成：flows.js debug 端点回归）。

## REQ-FLOW-051 嵌套执行收编

- 优先级 P0 / 必须 / cross-module / runner.runOnce(subflow 描述符) / flow-orchestration / execution / 单元 + 集成
- 接口契约：子执行走 runOnce；`execution:completed` 事件 payload 追加 `parentExecutionId`/`depth`（additive）；子日志写子 execution 行

验收标准：
1. 子执行获得 generation 守卫覆盖：reset 中途的子写被拦截，不写已重置 DB（单元：在飞子 run 与 reset 交错）。
2. 子日志写子 execution 行，不再冒泡进父 logs 列（集成：父子 logs 断言，含同名 node id "n1" 场景）。
3. `execution:completed` 事件 payload 含 parentExecutionId/depth，既有字段不变（集成：事件订阅断言，additive 兼容）。
4. 既有嵌套行为保持：子行落库（trigger=subflow）/ 深度兜底 E-FLOW-MAX-DEPTH / 未达出口 E-SUBFLOW-NO-OUTPUT / 失败冒泡 childExecutionId（集成：nestedExecution/subflowFailure 迁移断言不变）。

## REQ-FLOW-052 reset 单一失效机制与竞态语义

- 优先级 P0 / 必须 / cross-module / executionRunner（内部队列 + generation 合并）/ flow-orchestration / execution / 单元
- 接口契约：`reset()` = generation+1 + 队列 destroy + 有界等待（20ms 轮询 + 5s 上限，超时放弃）→ resolve；不再存在独立的 clearExecutionQueue 双机制

验收标准：
1. 失效单一机制：reset() 一次调用完成 generation+1 + destroy + 等待；taskService 不再持有独立队列实例与 generation 双写（单元：结构断言 + 行为断言）。
2. 竞态结算：reset 时在飞 run 到达守卫点，queued 行结算为 error（QUEUE_DRAINED_REASON），收尾写先于 reset resolve（单元：在飞 run 与 reset 交错，晚写被拦截）。
3. running 行弃置语义保持：reset 不写已重置 DB，由 recoverInterruptedExecutions 兜底（集成：启动恢复回归）。
4. 队列行为透过 runner 三接口可观察：同项目串行（前项完成才启动后项）/ 容量 50 / E-QUEUE-FULL / 排水（单元：并发 submit 断言——替换旧 executionQueue.test.js，不保留双份）。

## REQ-FLOW-053 测试 seam 迁移

- 优先级 P1 / 必须 / intra-module / executionRunner / flow-orchestration / execution / 集成（测试基建）
- 接口契约：`setAgentExecutorForTests` / `setChannelAdapterForTests` 迁入 runner；taskService 旧 setter 不再承载注入语义（或转发保兼容，实现期定）

验收标准：
1. 测试注入经 runner seam 生效：artifacts/linkCapture/dailyDigest/nestedExecution 等既有测试 import 迁移后全绿，断言不变（集成：全量迁移回归）。
2. taskService 旧 setter 无注入语义残留（单元：断言注入确实经 runner seam）。

## REQ-SCHEDULE-010 schedule 直调与 skip 反应

- 优先级 P0 / 必须 / cross-module / schedulerService → runner.submit + taskService.markScheduleInvalid / scheduling-execution / schedule / 集成
- 接口契约：schedulerService 到点**直调** `runner.submit({projectId, flowId, trigger:"schedule", variables, scheduleId})`（删 eventBus 一跳与 server.js 订阅接线）；submit 返回 `{skipped:true, reason, scheduleId}` → schedulerService 执行 skip 反应（日志 E-SCHED-FLOW-INVALID + markScheduleInvalid）；入队时校验 + 出队时二次校验语义保持

验收标准：
1. 到点 published flow → 直调创建执行，行为与 eventBus 路径等价（集成：scheduleTriggers 迁移，断言执行行创建且无 bus 一跳）。
2. 到点 draft flow → 无执行行 + 日志 E-SCHED-FLOW-INVALID + markScheduleInvalid 被调用（集成：既有断言迁移至直调路径）。
3. server.js:151 订阅接线删除：启动不再注册 subscribeToScheduleTriggers，无遗留订阅（集成：启动回归）。
4. manual 触发不受 draft 限制（集成：既有断言迁移保持）。
