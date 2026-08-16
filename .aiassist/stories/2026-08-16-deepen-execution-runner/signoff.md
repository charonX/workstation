# 签核记录 — 2026-08-16-deepen-execution-runner

## Assertion（门 1，2026-08-16）

### 检查清单

- [x] 不存在未关闭的 `prd-gap-report.md`（PRD §14 唯一 GAP=§10 技术方案，已由 /tech-design 定稿更新为 PASS，无悬空）
- [x] PRD 第 6-8 节（操作流 / 验证规则 §7 / 错误状态 §8）已覆盖
- [x] 每个 REQ-ID 都有对应测试（REQ-FLOW-048~053 + REQ-SCHEDULE-010 → 6 个测试文件全覆盖）
- [x] 每个测试文件都有 `REQ-TRACE`、`REQ-VERSION`、`CAPABILITY-TRACE`、`ENTITY-TRACE`
- [x] 每个 REQ 的 capability/entity 与 `business-capabilities.md` 一致（flow-orchestration/execution、scheduling-execution/schedule）
- [x] 无 `// TODO: HUMAN ASSERTION` 占位（全部落签为具体断言）
- [x] 预期值来源清晰：expected 值全部来自 requirements.md 契约（人拍板），非代码输出
- [x] 无快照当判定依据
- [x] 边界/错误 case 已覆盖（容量满 51 拒、schedule 双校验、reset 竞态结算/弃置、debug 零落库含子树、n1 撞名、skip 反应）

### 人签决策（批量确认 2026-08-16）

- **S1 submit 契约**：`submit({projectId, flowId, trigger, variables, scheduleId?}) → {id, executionId, queuePosition}`，`id === executionId`；容量满同步拒绝 `E-QUEUE-FULL`（第 51 个）；trigger=schedule 且 flow 非 published → `{skipped:true, reason, scheduleId}`。
- **S2 观察窗**：入队触发（observeQueued=true）出队后、状态迁移前 queued 保持 ≥250ms；debug/subflow 不走（零睡眠）。
- **S3 debug 零落库范围**：debug 运行（含 callFlow 子树）全链路零 execution 行、零产物、零通知；无 `parentExecutionId LIKE 'debug-%'` 合成父行。
- **S4 reset 竞态边界**：观察窗内 reset → queued 行结算 error（日志含 QUEUE_DRAINED_REASON）；在飞 running 行弃置不写，由 recoverInterruptedExecutions 标 error（variables.reason=server-restart）。
- **S5 子日志归属**：子执行行（trigger=subflow）落库；子节点日志写子行不冒泡父行（n1 撞名按 executionId 归属）；execution:completed 事件 payload 含 parentExecutionId/depth（additive，父事件既有字段不变）。
- **S6 schedule skip 反应**：schedulerService 直调 runner.submit；draft 到点 → 无执行行 + 日志 E-SCHED-FLOW-INVALID + schedule 行 error 被标记（markScheduleInvalid 经 schedulerService 层）。
- **S7 队列容量与排水**：容量 50；透 runner 三接口可观察（串行 A→B、第 51 拒、reset 后可重新接受）。

### 覆盖摘要

| REQ-ID | 测试文件 | capability/entity |
|---|---|---|
| REQ-FLOW-048 + 053 | api/executionRunner.test.js | flow-orchestration/execution |
| REQ-FLOW-052 | api/executionRunnerReset.test.js | flow-orchestration/execution |
| REQ-FLOW-049 | api/executionRunnerSubmit.test.js | flow-orchestration/execution |
| REQ-FLOW-050 | api/debugZeroPersist.test.js | flow-orchestration/execution |
| REQ-FLOW-051 | api/nestedExecutionConsolidated.test.js | flow-orchestration/execution |
| REQ-SCHEDULE-010 | scheduling-execution/schedule/.../api/scheduleDirectCall.test.js | scheduling-execution/schedule |

迁移清单（test-plan.md）：executionQueue.test.js 删除（行为并入 REQ-FLOW-052）、
scheduleTriggers/nestedExecution/subflowFailure 断言迁移、seam import 迁移
（artifacts/linkCapture/dailyDigest/nestedExecution，REQ-FLOW-053）。

### 签核状态

签核时 6 文件全 RED（executionRunner 模块 seam 未就绪 / 路由未切换 / 日志归属与
事件字段未实现），0 例误绿（观察窗时序断言依赖 runner 实现后才可验证）。
人工验收留在 REFLECT：无（全部验收标准可自动化）。
