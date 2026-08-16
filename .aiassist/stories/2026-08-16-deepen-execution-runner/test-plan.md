# Test Plan — ExecutionRunner 深化

> 故事 ID：`2026-08-16-deepen-execution-runner`
> 生成：/test-author（2026-08-16）
> REQ-VERSION：v1-hash:477d80d3adeafd5681b9742b555cc7372f75d76d54fcc01e46c2c0c2ac86e9bd

## 覆盖矩阵

| REQ-ID | Seam 类型 | 测试文件（tests/capabilities/…） | capability/entity | 说明 |
|---|---|---|---|---|
| REQ-FLOW-048 | 单元（runner 直测） | `flow-orchestration/execution/2026-08-16-deepen-execution-runner/api/executionRunner.test.js` | flow-orchestration/execution | 三接口契约/描述符矩阵/观察窗（假时钟）/schedule 二次校验/写入原语 |
| REQ-FLOW-048+053 | 单元 | 同上（末尾 describe） | flow-orchestration/execution | seam 注入经 runner 生效 |
| REQ-FLOW-049 | 集成（startServer）+ 模块别名 | `.../api/executionRunnerSubmit.test.js` | flow-orchestration/execution | HTTP 201 形状/立即 GET queued/503 E-QUEUE-FULL/通道回执/转发别名/重启路径 |
| REQ-FLOW-050 | 集成（startServer）+ 单元（runOnce debug 描述符） | `.../api/debugZeroPersist.test.js` | flow-orchestration/execution | debug 零落库（含子树）/无产物通知/persist 传播/合成 parent 废止 |
| REQ-FLOW-051 | 集成（startServer + 事件订阅） | `.../api/nestedExecutionConsolidated.test.js` | flow-orchestration/execution | 守卫覆盖/日志归子/事件父子字段/既有行为保持 |
| REQ-FLOW-052 | 单元（runner 直测 + 挂起 executor） | `.../api/executionRunnerReset.test.js` | flow-orchestration/execution | 单一失效机制/竞态结算/running 弃置/串行/容量/排水（旧 executionQueue.test.js 行为迁入） |
| REQ-SCHEDULE-010 | 集成（startServer + 真实 scheduler 路径） | `scheduling-execution/schedule/2026-08-16-deepen-execution-runner/api/scheduleDirectCall.test.js` | scheduling-execution/schedule | 直调创建/skip 反应（日志+markScheduleInvalid）/订阅删除/manual 不受限 |

## 测试前需要存在的前提（RED 依据）

1. `src/services/executionRunner.js` 模块（seam 未就绪 → executionRunner 系列全红）
2. 路由/调度直调接线（未切换 → submit/debug/schedule 集成断言红）
3. 子日志归属与事件字段（现状冒泡/缺失 → 新增断言红）

## 既有测试迁移清单（断言不变，import/位置迁移）

| 迁移对象 | 去向 | 说明 |
|---|---|---|
| `scheduling-execution/execution/2026-07-19-media-production-line/api/executionQueue.test.js` | **删除**（行为并入 executionRunnerReset.test.js AC4a/4b，不保留双份） | replace, don't layer |
| `scheduling-execution/schedule/.../scheduleTriggers.test.js` | import/路径不变，接线断言随直调演进（AC1/AC2 迁移） | 断言语义保持 |
| `flow-orchestration/execution/2026-07-23-nested-flow/api/nestedExecution.test.js` + `subflowFailure.test.js` | 断言不变；日志归属/事件字段相关断言并入 nestedExecutionConsolidated.test.js 新增部分 | 契约保持 |
| `artifacts/linkCapture/dailyDigest` 等使用 `taskService.setAgentExecutorForTests/setChannelAdapterForTests` 的测试 | import 改为 runner（REQ-FLOW-053） | 注入语义不变 |

## HTML/UX 映射

N/A——纯内部架构重构，无 UX 原型；DESIGN/DOMAIN-MODEL 阶段跳过。

## REFLECT 人工验收项

无。全部验收标准均可自动化（观察窗时序用假时钟/轮询断言；无审美判断）。

## 待签核断言点（门 1）

1. submit 返回三字段形状与 `id === executionId`（REQ-FLOW-048 AC1 / 049 AC1）
2. 观察窗 ≥250ms 的时序容忍（048 AC4 / 049 AC1）
3. debug 零落库「含子树」的范围（050 AC1/AC3）
4. 竞态结算：queued 结算 vs running 弃置的边界（052 AC2/AC3）
5. 子日志归子行的数据形态（051 AC2）
6. schedule skip 反应经 schedulerService 层（010 AC2）
7. 队列容量 50 与排水语义透 runner 可观察（052 AC4）
