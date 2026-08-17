# ExecutionRunner 深化——一次执行的唯一入口

> 状态：**已完结（历史记录）**——逻辑真值看代码，意图真值看 ADR-028 / business-capabilities.md / CONTEXT.md；回流判断可查本 spec（含初衷）。
> 故事 ID：`2026-08-16-deepen-execution-runner`
> 最后更新：2026-08-17
>
> **v2 重裁决（2026-08-16，architecture-review #1 字面落实）**：撤除生产路径
> 250ms 观察窗——深潜证伪原保留裁决的两条依据（①「UI 依赖排队态展示」：
> `grep -rn "queued" src/renderer` 零命中，UI 仅泛化渲染 status；②「深队列
> 与排队等待重叠、总墙钟不变」：executionQueue 每项目严格串行，睡眠占队头
> 槽位，N 个执行累加 N×250ms 死时间）。观察窗的真实消费者只有测试轮询。
> 裁决：描述符删 `observeQueued`，runOnce 零睡眠；queued 可观察性由真实
> 排队语义承载（队头被占时后续执行稳定 queued + queuePosition≥2）。
> 人拍板：「直接改吧」（2026-08-16，signoff.md v2 重签）。

---

## 1. 问题陈述

一次 flow 执行的生命周期知识散在 taskService 三处手工拼装（executeTask /
debugFlow / invokeSubflowImpl），且已实证漂移：debug 的合成 parentExecutionId
指向不存在的执行行、子流程执行绕过 generation 守卫、250ms 观察睡眠是每次生产
执行的隐形成本。执行上下文重置同时存在 queue destroy 与 generation 两套机制，
互为补丁。开发者改动一次执行语义要跨 N 处，且没有单一测试 seam——一句话痛点：
**「如何运行一次执行」的知识没有属主**。

## 2. 解决方案

新建 ExecutionRunner 模块，把一次执行的生命周期收进一个家：`submit`（入队触发
唯一入口）/ `runOnce`（直跑执行器，描述符参数化）/ `reset`（单一失效机制，
有界等待）三接口；schedule 触发直调去 eventBus 一跳；debug 全链路零落库；
嵌套执行全修复（守卫覆盖、日志归子行、事件补父子字段）；测试 seam 迁入 runner；
taskService 保留兼容转发。10 项决议已在 grilling 全部人拍板，落盘 ADR-028。

## 3. 用户故事

1. 作为开发者，我想要「运行一次执行」的拼装知识只有一个模块，以便改动执行
   语义一处生效。
2. 作为开发者，我想要 debug 运行不产生任何执行行，以便不留孤儿数据。
3. 作为开发者，我想要透过一个 seam 注入 executor/通道适配器，以便测试不再依赖
   模块级变量 + dynamic import。
4. 作为调用方（HTTP / schedule / 通道），我想要提交执行的契约稳定（201 +
   queuePosition、E-QUEUE-FULL 503、排队时 queued 可见），以便既有集成不改。

## 4. 稳定块（已稳定，可结晶为 REQ）

| # | 稳定块 | 为什么不再推翻 |
|---|---|---|
| 1 | ExecutionRunner 模块（submit/runOnce/reset 三接口 + 内部队列与 generation） | 10 项决议全部人拍板，ADR-028 已落盘 |
| 2 | 触发入口归一（manual/schedule/channel → submit；schedule 直调去 eventBus） | 三入口已天然汇聚 createTask，直调已裁决（唯一订阅者） |
| 3 | debug 描述符（persist:false 传播，全链路零落库；合成 parent 废止） | 孤儿行是实证缺陷，方向已拍板 |
| 4 | 嵌套执行收编（generation 守卫覆盖、子日志归子行、事件补父子字段） | 已确认无契约测试锁定现状，方向已拍板 |
| 5 | 契约保持（createTask/executeTask 转发、E-QUEUE-FULL、queuePosition） | 向后兼容是硬约束 |
| 6 | 测试 seam 迁入 runner（setAgentExecutorForTests/setChannelAdapterForTests） | 行为契约不变，仅 import 位置变 |

## 5. 移动块（还在动，暂不入 REQ）

> 全部已解决（/tech-design 深潜，2026-08-16）：
> #1 观察窗 → ~~保持常量 250ms~~ **v2 撤除**（深潜证伪保留依据，见文首 v2 注记）；
> #2 executionQueue 文件组织 → 接口私有化 B1，文件保留（§10.2）；
> #3 collectArtifacts 归属 → runner 全收（§10.2）；
> #4 schedule 二次校验落点 → submit 内校验 + runOnce trigger=schedule 分支校验
> 保持，skip 反应归 schedulerService（§10.3/§10.4）。当前无移动块。

## 6. 用户操作流（Operation Flows）

### 6.1 主流程 / Happy Path

| 步骤 | 用户动作 | 系统响应 | 验收锚点 |
|---|---|---|---|
| 1 | 手动触发：POST /api/executions | 201 `{id, executionId, queuePosition}`；行落 queued | 返回形状不变 |
| 2 | 立即 GET /api/executions/:id | 队头空闲时可见 queued/running/终态任一（轮询容错）；队头被占时稳定见 status=queued + queuePosition≥2 | 排队语义承载可观察性（v2） |
| 3 | schedule 到点（flow 已 published） | 直调 submit → 入队执行 → 完成 | 无 bus 一跳，行为等价 |
| 4 | 调试运行 flow | runOnce 直跑，返回 status/output；无任何 execution 行落库 | 零落库 |
| 5 | flow 内 callFlow 节点 | 子执行走 runOnce：子行落库、子日志写子行、事件带父子字段 | 守卫覆盖 + 归属正确 |
| 6 | 服务重启 / 测试重置 | reset() 有界等待在飞项 settle 后返回 | 不写已重置 DB |

### 6.2 分支与异常

| 触发条件 | 分支结果 | 对应错误状态 |
|---|---|---|
| schedule 触发时 flow 未 published | 入队时 skip（markScheduleInvalid）；出队执行时二次校验 → 执行标 error | E-SCHED-FLOW-INVALID |
| 队列满 | submit 同步拒绝 | E-QUEUE-FULL（503） |
| 子流程深度超限 | 抛错冒泡（竞态兜底） | E-FLOW-MAX-DEPTH |
| reset 时在飞 run 到达守卫点 | 自止 + queued 收尾写（abortExecutionIfQueued 收进 runner） | QUEUE_DRAINED_REASON |
| debug 下子流程调用 | 子树同样零落库，无孤儿行 | —（正常态） |
| 子流程未达出口 | 子行标 error，抛错冒泡 | E-SUBFLOW-NO-OUTPUT |

## 7. 表单与输入验证（Form / Input Validation）

本 story 无用户输入表单（纯内部架构重构）。接口级校验保持现状：

| 输入字段 | 规则 | 错误提示 | 错误状态 |
|---|---|---|---|
| submit.projectId | 必填；项目须存在 | "Project is required" / "Project not found" | 400 |
| submit.flowId | flow 须存在（schedule 触发外） | "Flow not found" | 400 |
| submit.trigger="schedule" | flow 须 published | E-SCHED-FLOW-INVALID | skip / 执行 error |

### 7.1 跨字段/业务规则

| 规则 | 触发时机 | 错误状态 |
|---|---|---|
| 每项目单飞 + 队列上限 50 | submit 容量检查 | E-QUEUE-FULL（503 语义保持） |

## 8. 错误状态与失败响应（Error States / Failure Responses）

| 场景 | 触发条件 | 错误码/消息 | 用户可见状态 | 副作用/回滚 |
|---|---|---|---|---|
| 队列满 | 项目队列 ≥50 | E-QUEUE-FULL "队列已满，稍后再发" | HTTP 503 | 无入队、无落行 |
| schedule 无效 | 触发时 flow 未 published / 缺失 | E-SCHED-FLOW-INVALID | 入队时 submit 返回 `{skipped:true, reason, scheduleId}`（HTTP 面 201 透传）；**skip 反应（日志 + markScheduleInvalid）在 schedulerService 层执行**；出队执行时二次校验 → 行标 error + 日志 | 两处校验语义保持（入队 skip + 执行 error） |
| 深度超限 | 嵌套深度 > MAX_SUBFLOW_DEPTH(8) | E-FLOW-MAX-DEPTH | 父节点错误冒泡 | 子行不落库 |
| reset 竞态 | 在飞 run 发现 generation 失配 | QUEUE_DRAINED_REASON | queued 行收尾为 error | 收尾写完成后 reset 才返回 |
| 子流程无出口 | 子 flow 未达 flowOutput | E-SUBFLOW-NO-OUTPUT | 子行 error，冒泡 | 已累积 nodeRecords 落子行 |
| 引擎/执行错误 | flow 内节点失败 / fatal | 透传 error 对象 | 执行标 error | 节点记录落库（现有语义保持） |

## 9. 复杂度分级

| 维度 | 取值/说明 |
|---|---|
| 复杂度 | **complex** |
| 判断理由 | 触碰面 ~8 个模块（taskService/executionQueue/schedulerService/imRouter/executions/flows/callFlowExecutor/server.js）；5 个触发入口；契约保持面大（HTTP 返回形状、E2E 断言、E-QUEUE-FULL 语义）；双机制合并涉及竞态语义；需要 tech-design 深潜接口契约 |

## 10. 技术方案（Implementation Decisions）

> 已由 `/tech-design` 深潜定稿（6 项对抗式决议：写入原语归属 / 观察窗落点 /
> 描述符字段 / 检查点语义 / 队列私有化 / skip 反应归属）。方案骨架 = ADR-028（10 项决议）。

### 10.1 设计目标

一次执行的生命周期知识收进一个模块：单一失效机制（reset）、单一测试 seam、
三入口行为对齐、debug 与生产同路径、**模块图无环**。

### 10.2 模块与边界

| 模块 | 职责 | 是否新增 |
|---|---|---|
| ExecutionRunner | 队列槽位（内部持有，接口私有）+ generation + submit/runOnce/reset；**执行写入原语全收**（节点记录/完成态/日志/产物/终态通知/queued 结算/通道适配器解析）；executor 装配 | 是 |
| executionQueue（保留文件） | 每项目串行化 + 容量 50 + destroy——runner 内部使用，**不对外导出公开接口** | 否（接口私有化） |
| taskService | 查询（getExecution/list 等）+ schedule CRUD（含 markScheduleInvalid）+ createTask/executeTask/clearExecutionQueue 兼容转发 | 否（瘦身） |
| schedulerService | cron 触发**直调 runner.submit**（删 eventBus 一跳）；**skip 反应**（收到 `{skipped}` → 日志 + markScheduleInvalid） | 否（接线变化） |
| flowEngine / flowService / projectService | 引擎与数据，无变化 | 否 |
| 触发入口 | executions.js/imRouter → runner.submit；flows.js → runner.runOnce（debug）；callFlowExecutor → services bag（无 import） | 否（接线变化） |

#### 模块关系图

```
[executions.js] ──┐
[imRouter] ───────┼─submit──> ┌────────────────────────────┐
[schedulerService]─┘           │ ExecutionRunner            │
                               │  队列(generation 失效统一)  │
[flows.js debug] ──runOnce──>  │  写入原语/守卫/拼装         │
[callFlowExecutor] ──services bag（无 import）              │
                               └──────────┬─────────────────┘
                                          │ runOnce（出队回调）
                                          ▼
                                   [flowEngine.run]
                                          ▼
                          [executions/nodes/logs/产物/通知]
[schedulerService] ──skip 反应──> [taskService.markScheduleInvalid]
[taskService] ──转发 createTask/executeTask/clearExecutionQueue──> [ExecutionRunner]
```

### 10.3 数据流

1. **触发**：5 个入口（manual/schedule/channel → submit；debug/subflow → runOnce）
2. **submit 校验**：项目/flow 存在、schedule published（skip 分支）、容量（E-QUEUE-FULL）
3. **submit 核心**：构建 execution 对象 → 落 queued 行 → 入队（绑定 runOnce +
   descriptor）→ 立即返回 `{id, executionId, queuePosition}`（无睡眠，v2：亦无观察窗）
4. **skip 反应（schedule 路径）**：schedulerService 收到 `{skipped:true, reason,
   scheduleId}` → 日志 E-SCHED-FLOW-INVALID + taskService.markScheduleInvalid
5. **runOnce 执行**：generation 快照 → 检查点①（失配→queued 结算→return）→
   迁移 queued→running（出队后立即，v2 零睡眠）→ 拼装（executors /
   _channelManager shim / services.invokeSubflow 绑定自身 persist）→ 引擎 →
   检查点②（成功）→ 写入（nodes/logs/产物）；catch 检查点③；finally 检查点④
   门控终态通知
6. **persist 传播**：runOnce 把自身 descriptor.persist 绑定进 makeInvokeSubflow，
   子描述符继承（debug 子树零落库）
7. **reset**：generation+1 → 队列 destroy → 有界等待（20ms 轮询 + 5s 上限，
   超时放弃——现状等价）→ resolve

> 观察窗撤除注记（v2 裁决，2026-08-16）：原 tech-design 决议「出队启动时睡 250ms
> 供调用方观察 queued」被证伪后撤除——①UI 无任何 queued 消费（src/renderer
> 零命中，泛化渲染 status）；②串行队列下睡眠占队头槽位，N 个执行累加 N×250ms
> 死时间，「总墙钟不变」不成立；③submit 响应已带 queuePosition，排队位次不依赖
> 行停留。撤除后 queued→running 在出队后立即迁移；reset 竞态由同步时序承载
> （reset 先于出队微任务调用即命中检查点①，见 REQ-FLOW-052 AC2）。

### 10.4 接口契约

#### 接口名称：runner.submit

| 项目 | 说明 |
|---|---|
| 调用方 | executions.js / imRouter / schedulerService |
| 输入 | `{projectId, flowId, trigger (manual\|schedule\|channel), variables, scheduleId?}` |
| 输出 | `{id, executionId, queuePosition}`；或 `{skipped:true, reason, scheduleId}`（trigger=schedule 且 flow 非 published） |
| 业务错误 | E-QUEUE-FULL（503 语义保持）/ project/flow 校验（400） |
| 副作用 | 落 queued 行、入队、事件（execution:started 等，现状保持） |
| 幂等性 | 否（提交即新建；现状语义保持） |

#### 接口名称：runner.runOnce

| 项目 | 说明 |
|---|---|
| 调用方 | 队列出队回调（runner 内部）/ flows.js（debug）/ services bag（subflow） |
| 输入 | `(executionCtx, descriptor)` |
| 描述符 | `{trigger, persist, artifacts, notify}`；subflow 附加 `{parentExecutionId, parentNodeId, depth, entryNodeId}` |
| 各路径值 | 入队 `{trigger, persist:true, artifacts:true, notify:true}`；debug `{trigger:"debug", persist:false, artifacts:false, notify:false}`；subflow `{trigger:"subflow", persist:true, artifacts:false, notify:false, parent…}` |
| 输出 | 执行结果（status/output/nodeRecords/logs） |
| 业务错误 | E-FLOW-MAX-DEPTH / E-SUBFLOW-NO-OUTPUT / 引擎错误（保持） |
| 幂等性 | 否（一次运行一次） |

#### 接口名称：runner.reset

| 项目 | 说明 |
|---|---|
| 调用方 | server.js（停止/重启，替代 clearExecutionQueue）/ 测试生命周期 |
| 输入 | 无 |
| 输出 | Promise（在飞项 settle 后 resolve；5s 超时放弃） |
| 副作用 | generation+1、队列 destroy、有界等待（20ms 轮询） |

### 10.5 关键决策

| 决策 | 选项 | 选择理由 | 风险 |
|---|---|---|---|
| 收编范围 | 全收编 vs 只编排 | 双机制互为补丁，合一是深化本义 | 改动面大（server.js:441 与测试重置路径） |
| schedule 一跳 | 直调 vs 保留 bus | 唯一订阅者 + 进程内单例，One adapter = hypothetical seam | 未来多消费者需重引 |
| debug 语义 | 描述符 vs 独立路径 | 一条代码路径，差异显式 | persist 传播语义要测 |
| 观察窗 | ~~出队启动睡 250ms~~ → **撤除（v2）** | 保留依据被证伪：UI 零消费 queued；串行队列下睡眠累加进墙钟（N×250ms），非零成本；queuePosition 已承载排队信息 | 测试轮询断言迁移为队头占用模式 |
| reset | 有界等待 vs 立即返回 | 保证不写已重置 DB | 5s 上限下极端慢 run 可能超时 |
| 写入原语归属 | runner 全收 vs taskService 保留 | 写入策略单一属主，删除测试通过 | 迁移面（~4 测试文件 import） |
| 检查点语义 | 现状逐点等价 vs 简化/统一结算 | 竞态行为逐点相同；running 弃置由 recoverInterruptedExecutions 兜底 | 无（replace 策略） |
| 队列接口 | 私有化（B1） vs 公开 | 结构保证「不经过 reset 无法失效」；删除测试不过公开接口 | 旧 executionQueue.test.js 替换 |
| skip 反应归属 | schedule 路径 vs submit 内部 | 模块图无环（schedulerService → runner.submit 单向） | 日志落点移 schedulerService（契约正则断言保持） |

> ADR-028 覆盖前 6 项；tech-design 新增后 5 项，随本 story REFLECT 时补充进 ADR。

### 10.6 风险与回流点

| 假设 | 如果错了会怎样 | 回流到 | 能否快速验证 |
|---|---|---|---|
| generation 快照语义在合并后保持等价 | 重置竞态重现 | TECH-DESIGN | 能（竞态测试） |
| ~~观察窗是真实 API 契约~~（v2 已闭环） | ~~撤除会破坏 UI 排队态展示~~——已证伪：renderer 零 queued 消费，UI 泛化渲染 status | 已撤除（v2） | 已验证（grep src/renderer） |
| 子日志归子行无下游依赖 | 执行详情 UI 依赖父行聚合 | PRD（追加块） | 能（回归 + UI 检查） |
| skip 反应迁移到 schedulerService 后契约保持 | 日志格式/标记时机漂移 | TECH-DESIGN | 能（scheduleTriggers 回归） |
| 模块图无环假设成立 | 后续新增依赖重引入环 | TECH-DESIGN | 能（实现期检查 import 方向） |

### 10.7 安全/性能/可观测性

- 观察窗 250ms 撤除（v2）：生产路径每次执行不再付固定睡眠税；串行队列深队列下
  省 N×250ms 死时间；queued 可观察性由真实排队语义承载（队头占用时后续执行
  稳定 queued + queuePosition≥2）
- reset 竞态安全：queued 结算写有界等待保护；running 行弃置由
  recoverInterruptedExecutions 兜底（现状语义保持）
- 描述符 persist:false 结构性保证 debug 零落库（含子树，孤儿行不再产生）
- execution:completed 事件 payload 追加父子字段（additive，不破坏既有消费）
- 新增 telemetry seam：reset 等待时长可观测（供 5s 上限调优）

## 11. 测试决策（Testing Decisions）

### 11.1 覆盖接缝（coverage seams，CLI 优先）

| 稳定块 | Seam | 测试类型 | 依赖处理 |
|---|---|---|---|
| ExecutionRunner 模块 | runner 直测（注入 fake executor / fake 通道适配器 / fake db 路径） | 单元 | stub |
| 触发入口归一 | 既有 HTTP 端点（server 集成模式）+ schedule 直调集成（删 bus 后断言等价） | 集成 | 真实 server + stub 通道 |
| debug 描述符 | runOnce 描述符分支直测 + API 集成断言「debug 运行后无 execution 行」 | 单元 + 集成 | stub |
| 嵌套收编 | 既有 nestedExecution/subflow 测试迁移（断言不变）+ 新增：子日志归属、事件父子字段 | 集成 | stub |
| 契约保持 | 既有执行/调度/通道相关测试全量回归（断言不动，import 迁移） | 集成 + E2E | 真实 |
| queue 私有化 | 透过 submit/runOnce/reset 断言串行/容量（E-QUEUE-FULL）/排水（旧 executionQueue.test.js 替换） | 单元 | stub |
| schedule skip 反应 | schedulerService 触发路径断言：无执行行 + 日志 E-SCHED-FLOW-INVALID（scheduleTriggers 迁移） | 集成 | 真实 |
| reset 语义 | runner.reset 竞态直测（在飞 run 与 reset 交错：晚写被守卫拦截） | 单元 | stub |

### 11.2 测试策略与先例

- **replace, don't layer**：runner 的 interface 测试就位后，旧的 generation×destroy
  竞态、debug 嵌套路径、adapter 解析优先级测试改挂 runner seam，不保留双份；
  新测试断言 interface 可观察结果，不测内部状态。
- 测试只测外部行为：submit 返回契约、执行结果、落库行、事件 payload——不测
  runner 内部拼装顺序。
- 先例：subflowIsolation.test.js（services 注入模式）、mcpService.test.js（工厂
  直测）、executionLog.test.js（轮询断言 queued→终态）。
- E2E：手动触发全链路断言保持（Playwright，行为不变即绿）。

## 12. 范围外

- 评审候选 #2~#8（各自已有 story 起点）
- permissionBridge 20ms 轮询去留（#3 权限裁决 story）
- execution:* 多消费者事件机制（保留 eventBus）
- getCronDescription / UI 助手迁移、响应助手统一（#8 浅残留清扫 story）
- server.js 的 DI 容器抽取（#7 装配容器 story；本 story 只动 schedule 订阅删除与
  reset 调用点）

## 13. 补充说明

- 方案锚点：ADR-028（10 项 grilling 决议，含后果与反模式警示）
- 评审报告存档：`.aiassist/global/architecture-reviews/architecture-review-2026-08-16.html`
- 与 #4（session-domain）/ #7（service-container）边界：本 story 不改 server.js
  的 DI 结构与确认回调，仅删 schedule:triggered 订阅接线、把 clearExecutionQueue
  调用换成 runner.reset()
- 测试 seam 迁移影响面：~4 个测试文件改 import（artifacts/linkCapture/
  dailyDigest/nestedExecution），断言不动

## 14. PRD 完整性自检查

| 检查项 | 状态 | 备注 |
|---|---|---|
| 操作流 | PASS | §6 每个稳定块至少一条 happy path + 分支异常 |
| 输入验证 | PASS | §7 无用户表单；接口级校验规则列出 |
| 错误状态 | PASS | §8 全部可预见失败模式 + 副作用/回滚 |
| 复杂度分级 | complex | §9 理由：8 模块触碰面 / 5 入口 / 契约保持面大 |
| 技术方案（§10） | PASS | /tech-design 深潜定稿（6 项决议）；§10.4 三接口契约 + 描述符表完整 |

---

## 版本记录

| 版本 | 日期 | 变更 | 作者 |
|---|---|---|---|
| v0.1 | 2026-08-16 | 初稿（grilling 决议合成；ADR-028 为方案锚点） | AI + 人 |
