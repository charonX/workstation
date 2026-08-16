# Build Progress — 2026-08-16-deepen-execution-runner

> 父代理台账：/implementer（2026-08-16 起）
> 门 1 已过（a355772 assertion-signoff）；phase=BUILD
> 测试命令：`npm run rebuild:node && NODE_ENV=test node --import ./scripts/session-lifecycle-seam.mjs --test <文件>`
> 环境注记：better-sqlite3 ABI 需 rebuild:node 后再跑单测；并行会话改文件触发 vite HMR 会污染 E2E，静期重跑。

## 切片清单（依赖序）

| # | 切片 | REQ-ID | 测试文件 | 依赖 |
|---|---|---|---|---|
| 1 | ExecutionRunner 模块核心：submit/runOnce/reset + 内部队列（私有化）+ generation + 写入原语全收 + 观察窗 + 检查点 + recoverInterruptedExecutions + test seams | REQ-FLOW-048, REQ-FLOW-052 | executionRunner.test.js, executionRunnerReset.test.js | — |
| 2 | 入口接线（大切片）：executions.js/imRouter/schedulerService → runner.submit 直调；schedule skip 反应归 schedulerService（日志 + markScheduleInvalid）；flows.js debug → runner.runOnce（debug 描述符）；taskService 转发别名（createTask/executeTask/clearExecutionQueue/setters）+ 瘦身（删全部迁出私有实现）；server.js 接线（删 :151 订阅、:441 → runner.reset()、:43 → runner.setChannelAdapter 生产注入——裁决②必做） | REQ-FLOW-049, REQ-SCHEDULE-010, REQ-FLOW-050 | executionRunnerSubmit.test.js, scheduleDirectCall.test.js, debugZeroPersist.test.js | 1 |
| 3 | 嵌套收编：子执行 generation 守卫覆盖（invokeSubflowImpl 写点前检查）；子日志写子 execution 行（不冒泡父行）；execution:completed 事件补父子字段（additive） | REQ-FLOW-051 | nestedExecutionConsolidated.test.js（+ nestedExecution/subflowFailure 断言迁移核对） | 1, 2 |
| 4 | 测试 seam 迁移（[test] 侧，父代理执行）：artifacts/linkCapture/dailyDigest/nestedExecution 的 setter import 改挂 runner；删旧 executionQueue.test.js；全量回归 | REQ-FLOW-053 | 既有测试文件 import 迁移（断言不变） | 1-3 |

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

### Slice 2: 入口接线（REQ-FLOW-049 + REQ-SCHEDULE-010 + REQ-FLOW-050 接线）

状态：**complete**（de75608 实现 + 9429050 fixture 修正；业务 13/13 绿 + 回归 56/56 绿 + scheduleTriggers 8/10（2 红=eventBus 协议断言，见裁决④））。
实现：executions.js/imRouter/schedulerService 直调 runner.submit；schedule skip 反应（日志+markScheduleInvalid+注销 cron）；taskService 瘦身（-833 行：删队列/generation/写入原语/订阅/调试递归，转发别名 createTask/executeTask/clearExecutionQueue/setters/debugFlow，保留查询+schedule CRUD+getCronDescription+resetTasks）；server.js 接线（删 :151 订阅、:441→runner.reset()、:43→runner.setChannelAdapter）；runner 补生产通道适配器（裁决②）；schedules.js cron 校验移路由（破 taskService→schedulerService 环）。
PRD→代码 可追溯性表：见本文件下方「### Slice 2」小节（子代理写入 12 行，父代理已核）。

#### 父代理验证 + 裁决（2026-08-16）

- 独立验证：业务三文件 **13/13 绿**（9429050 fixture 修正后）；回归 9 文件 **56/56 绿**；scheduleTriggers 8/10。
- **裁决④（scheduleTriggers 2 红 + no-op shim）**：scheduleTriggers AC1/AC3 订阅已删除的 `schedule:triggered` 事件——REQ-SCHEDULE-010 本义删除该一跳，属 test-plan 既定「断言迁移」；AC3 的实质契约（CRUD 后 cron 自动生效）迁移为直调可观察断言（执行行出现）。subscribeToScheduleTriggers 保留为 **no-op 兼容 shim**（旧测试 4 处调用依赖该导出），**slice 4 [test] 迁移后删除 shim**。
- **裁决⑤（schedules.js 环破）**：cron 校验（E-SCHED-CRON 400）从 taskService 移路由——避免 taskService→schedulerService 依赖环，语义不变（路由直接校验）。
- **PRD 对齐（slice 2）**：ALIGNED（15 项逐条 COVERED；模块图 import 边逐一核对无环；hash 一致）。3 项 [test] 侧缺口全部列入 **slice 4 必做**：①补 HTTP 400 用例（缺 project/缺 flow，删 executionQueue.test.js 之前必须落）；②scheduleTriggers AC5「到点不补偿」空真化——迁移为「loadAll 后 500ms 内无执行行」（LOAD_GRACE_MS 抑制仍实现，失去观测）；③executeTask 转发等价 by-construction 记录（无调用方，AC4 typeof 够）。备注：debug 路径新增 _channelManager shim（加性改进）；{skipped} 返回加 scheduleId（§10.4 契约）。

### Slice 3: 嵌套执行收编（REQ-FLOW-051）

状态：**complete**（ef55131 实现 + d544ae6 seam 归一化撤除 + 190f9a6 [test] executor 契约归一；nestedExecutionConsolidated **4/4 绿** + 全回归 58/58 绿）。
实现：writeAllowed=()=>persistChild && executionGeneration===generation **live 求值**门控全部子写点（子行 INSERT/节点记录/完成态/日志）——reset 中途子引擎内存跑完、写全跳过、子行保持 running（recoverInterruptedExecutions 兜底）；子日志逐条 addExecutionLog 写子行（成功/未达出口/失败冒泡路径），返回 logs:[] 不再冒泡父行；execution:completed payload 追加 parentExecutionId/depth（additive，父事件如实带 null/0）。
PRD→代码 可追溯性表：见本文件下方「### Slice 3」小节。

#### 父代理验证 + 裁决（2026-08-16）

- 独立验证：nestedExecutionConsolidated 4/4 + executionRunner/executionRunnerReset 12/12（16/16 复核绿）+ 回归 42/42（子代理）+ 业务回归（子代理 112 用例 0 失败）。
- **裁决⑥（seam 归一化撤除）**：slice 3 初版在 runner 装配 seam 把替换后 prompt 并入注入 executor 的 context——撤除（d544ae6），恢复 `executors.agent = testAgentExecutor` 直通。理由：测试 seam 契约应与生产契约一致（claudeAgentAdapter 即读 node.config.prompt）；测试侧改读 node.config.prompt（190f9a6，断言不变）。

### Slice 4: 测试 seam 迁移（REQ-FLOW-053，[test] 侧，父代理执行）

状态：**complete**（2d4d5d9 [test] + 31e2fd5 [build]；**全量单元 891/891 绿**）。
执行：①artifacts/linkCapture/dailyDigest/nestedExecution 的 setter import 改挂 executionRunner（断言不变；清理引用同步修正——原 afterEach 的 seams.taskService 清理被 try/catch 吞掉，实际未执行，已修）；②scheduleTriggers AC1/AC2/AC3/AC5 从 eventBus 协议断言迁移为直调可观察断言（执行行/variables 注入/CRUD 自动生效/DELETE 注销/宽限期抑制实断言——AC5 由空真转实断言）；③删旧 executionQueue.test.js（行为并入 REQ-FLOW-052，replace don't layer）；④executionRunnerSubmit 补 PRD §7 400 校验用例（缺 project/缺 flow）；⑤删 taskService subscribeToScheduleTriggers no-op shim（REQ-SCHEDULE-010 AC3 导出移除）。

## BUILD 总结（父代理）

- **4 切片全部 complete**：runner 核心（slice 1）→ 入口接线（slice 2）→ 嵌套收编（slice 3）→ seam 迁移（slice 4）。
- commit 链：[build] 2a227da（slice 1）+ de75608（slice 2）+ ef55131/d544ae6（slice 3）+ 31e2fd5（slice 4 收尾）；[refactor] 797a4c9 + 8e9b830 + 83db522；[test] 0e71ebe/94cb634/9429050/1e7272e/190f9a6/2d4d5d9。
- 全量单元 **891/891 绿**（含 story 6 文件 29 用例 + 迁移后既有套件）；PRD 对齐 slice 1-3 全 ALIGNED。
- 待办（QA 阶段）：E2E 回归（Playwright——执行相关 E2E 未跑：flowRun/executions 相关 .test.cjs）；REFLECT 时按 §10.5 把 tech-design 5 项新决策补进 ADR-028；记录项（parseVariables/timestamp 跨模块重复、destroy length 洞预存缺陷）已在台账。

## v2 修订（2026-08-16）：撤除 250ms 观察窗（architecture-review #1 字面落实）

状态：**complete**（[docs] eed68d3 + [test] 5d8853a + [build] 见 commit 链；受影响测试 41/41 绿）。
缘起：review #1 收益项「250ms sleep leaves prod path」。深潜证伪 v1 保留依据：①renderer 零 queued 消费（UI 泛化渲染 status）；②串行队列下睡眠占队头槽位，N×250ms 累加进墙钟（「总墙钟不变」不成立）。人拍板「直接改吧」→ signoff v2 重签（S2' 零睡眠 / S4' reset 同步竞态 / S8 排队语义承载可观察性）。
实现要点：runOnce 删观察窗分支与 observeQueued 字段；**generation 快照提前到 submit 时捕获**（descriptor.generation 内部绑定）——撤除睡眠后 submit→dequeue 窗口失去遮蔽，捕获提前使检查点① 覆盖该窗口（旧生命周期提交的僵尸 run 在 reset 后不再写库），REQ-FLOW-052 AC2 竞态语义由同步时序确定性承载。
测试迁移：时序敏感断言全部去睡眠化——容量满/schedule 二次校验/HTTP queued 观察改闸门 executor 队头占用模式；reset AC2 改同步竞态；AC4 改零睡眠上界（<250ms，旧实现验证为红）；跨 story scheduleTriggers REQ-SCHEDULE-005 AC2 断言文本不变、观察方式迁移。
顺带修复：server.js recoverInterruptedExecutions 改经 runner 再导出导入（executionQueue 接口私有化名副其实）。

### Slice 1: ExecutionRunner 模块核心（REQ-FLOW-048 + 052）

状态：**complete**（2a227da 实现 + 0e71ebe fixture 修正 + 797a4c9 refactor pass；12/12 + 23/23 绿；PRD 对齐 ALIGNED；三项裁决见下节）。
实现：`src/services/executionRunner.js`（新建，零改动既有文件）；回归 executionLog/executionQueue/artifacts 23/23 绿。
两个业务测试文件 10 用例：6 绿（AC1/AC2/AC4/AC5 + debug 描述符 + reset AC1/AC2/AC4b）；4 红均为 fixture 问题（见下）。

#### PRD→代码 可追溯性表（Slice 1）

| PRD 意图（§10 / REQ） | 实现文件/函数 | 测试文件 | 覆盖状态 |
|---|---|---|---|
| §10.4 submit 契约：`{id, executionId, queuePosition}`，id===executionId（REQ-FLOW-048 AC1） | executionRunner.js: submit | executionRunner.test.js AC1 | COVERED |
| §8 E-QUEUE-FULL 容量满同步拒、不落行（REQ-FLOW-048 AC2 / 052 AC4b） | executionRunner.js: submit（isFull + enqueue） | executionRunner.test.js AC2；executionRunnerReset.test.js AC4b | COVERED |
| §10.5 观察窗 250ms 常量、出队后迁移前（REQ-FLOW-048 AC4） | executionRunner.js: runOnce（observeQueued 门控） | executionRunner.test.js AC4 | SUPERSEDED（v2 撤除，见「v2 修订」节） |
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
4. 模块形状按契约：`{ submit, runOnce, reset, recoverInterruptedExecutions, setAgentExecutorForTests, setChannelAdapterForTests }`（completeExecution/addExecutionLog 为文件内私有函数，未导出——订正 concern #4 原措辞「也导出」失实；全仓库无模块 import taskService 写入原语，grep 证实）。

#### 父代理验证 + PRD 对齐（2026-08-16）

- 独立验证：两个业务文件 **12/12 绿**（0e71ebe fixture 修正后：AC3 补轮询至终态、fixture 补 agent 节点、executor 读 context.prompt、edges 用 sourceNodeId/targetNodeId）；回归 executionLog/executionQueue/artifacts **23/23 绿**。
- PRD 对齐子代理：**ALIGNED**（§6/§7/§8/§10 逐项对照；可追溯性表 PARTIAL 项全部转实；hash 匹配）。
- **裁决①（catch re-throw）**：runner runOnce catch 持久化后 re-throw（taskService 吞错）——保留 re-throw（PRD §8「透传 error 对象」），队列 reject 路径安全（dequeueNext reject 处理 + submit enqueuePromise.catch 兜底），唯一代价 = 失败执行多一行 `[executionRunner] queue run rejected` console 噪声。台账记：非逐点等价（改进向）。
- **裁决②（生产通道适配器回退）**：runner.resolveChannelAdapter 缺 taskService 三级回退中的「生产注入 setChannelAdapter」（server.js:43 接线）——**slice 2 必做项**：runner 加生产 `setChannelAdapter` setter + server.js:43 迁移；未接线前不触发（生产仍走 taskService）。
- **裁决③（destroy length 洞）**：executionQueue.destroy() 对已清空 project 数组 `q.length=1` 留洞 → pendingCount 永久计 1 → drain 空转 5s（旧 taskService 路径同受害，executionLog 全文件 11.3s 即此因）。runner.reset 以 pendingCount>0 守卫跳过空队列 destroy（语义等价）。destroy 本体修复留后续 /bug。
- 记录：400 校验路径（Project is required/Flow not found）与节点/产物/通知实质断言由 slice 2/5 迁移测试补齐（等价拷贝已逐字核对）；slice 3/4 fixture 已修正 schema（断言不变）。

### Slice 2: 入口接线（REQ-FLOW-049 + REQ-SCHEDULE-010 + REQ-FLOW-050）

状态：**complete（实现 + 接线全量落地；业务测试 10/13 绿，3 红全为测试 fixture 缺陷——实现侧经契约正确探针逐条验证等价；回归 240+/243 绿）**。
实现：`src/services/executionRunner.js`（生产通道适配器 setChannelAdapter + 三级回退中间层 + debug 变量传播）、`src/services/taskService.js`（瘦身：查询 + schedule CRUD + 转发别名）、`src/services/schedulerService.js`（直调 + skip 反应）、`src/http/routes/executions.js`、`src/services/channels/imRouter.js`、`src/http/server.js`（删 :151 订阅、:441 → runner.reset、:43 → runner.setChannelAdapter）、`src/http/routes/schedules.js`（cron 校验移路由——破 taskService→schedulerService 环）。
模块图无环已证：runner 不 import taskService/schedulerService；taskService 不 import schedulerService（grep + node --check 全过）。

#### PRD→代码 可追溯性表（Slice 2）

| PRD 意图（§10 / REQ） | 实现文件/函数 | 测试文件 | 覆盖状态 |
|---|---|---|---|
| §10.4 submit 契约：manual 入口 POST /api/executions 201 三字段 + E-QUEUE-FULL 503（REQ-FLOW-049 AC1/AC2） | executions.js: POST → runner.submit（taskService.createTask 转发保持） | executionRunnerSubmit.test.js AC1/AC2 | COVERED |
| §10.2 触发入口归一：imRouter 通道路径 → runner.submit，回执「排队中（第 N 位）」语义不变（REQ-FLOW-049 AC3） | imRouter.js: createImRouter 注入 runner = defaultRunner；`runner.submit(buildTaskVariables(msg, binding))` | executionRunnerSubmit.test.js AC3；imRouting.test.js AC2/AC3 | COVERED |
| §10.2/§10.4 转发别名：createTask/executeTask/clearExecutionQueue/setters 保持导出且行为等价（REQ-FLOW-049 AC4 / REQ-FLOW-053） | taskService.js: createTask→runner.submit、executeTask→runner.runOnce(入队描述符)、clearExecutionQueue→runner.reset、setAgentExecutorForTests/setChannelAdapterForTests→runner | executionRunnerSubmit.test.js AC4；artifacts/linkCapture/dailyDigest/nestedExecution 旧 import 回归 | COVERED |
| §10.2/§10.3 reset 单一失效机制：server 停止路径 clearExecutionQueue → runner.reset()（REQ-FLOW-049 AC5 / REQ-FLOW-052） | server.js: stopServer → `await runner.reset()` | executionRunnerSubmit.test.js AC5；scheduleTriggers/executionLog 重启回归 | COVERED |
| §10.3/§10.4 schedule 直调：schedulerService 到点直调 runner.submit（删 eventBus 一跳与 server.js 订阅接线；REQ-SCHEDULE-010 AC3） | schedulerService.js: scheduleTask → `runner.submit({projectId, flowId, trigger:"schedule", variables, scheduleId})`；server.js: 删 :151 subscribeToScheduleTriggers 接线 | scheduleTriggers.test.js AC1/AC2-exec/AC4/006-AC2（直调路径等价）；scheduleDirectCall.test.js AC3 | COVERED（探针证实：每秒 cron → 执行创建 + variables 注入） |
| §8/§10.5 skip 反应归 schedulerService：submit 只返回 {skipped}，日志 E-SCHED-FLOW-INVALID + markScheduleInvalid 在触发路径执行（S6） | schedulerService.js: tick 内 skip 反应（console.error + taskService.markScheduleInvalid + remove(schedule.id) 注销——原 markScheduleInvalid 内 schedulerService.remove 迁此，破环） | scheduleTriggers.test.js AC4；scheduleDirectCall.test.js AC2（fixture 阻塞，见下） | COVERED（探针证实：draft + 每秒 cron → 无执行 + 日志 E-SCHED-FLOW-INVALID + schedule.error=E-SCHED-FLOW-INVALID + enabled=false） |
| §10.4 debug 描述符零落库：flows.js debug → runner.runOnce({trigger:"debug", persist:false, artifacts:false, notify:false})（REQ-FLOW-050 AC1-AC3） | taskService.js: debugFlow 保留版本解析后转发 runner；runner.js: runOnce 无 execution 行时读 executionCtx.variables + persist:false 子树传播（makeInvokeSubflow 绑定） | debugZeroPersist.test.js AC1/AC2/AC3 | COVERED |
| §10.4 debug 返回 status/output 供调试弹窗（REQ-FLOW-050 AC4） | taskService.js: debugFlow 包装返回 {status, output, nodesRun, logs, iterations, branchPath} | debugZeroPersist.test.js AC4（fixture 阻塞，见下） | COVERED（探针证实：正确 callFlow 契约下 200 + status/output 键 + 零落库） |
| §10.2 写入原语迁入后 taskService 瘦身：查询 + schedule CRUD 保留（markScheduleInvalid/createSchedule/...） | taskService.js: listExecutions/getExecution/listExecutionNodes/purgeExpiredExecutions/setExecutionVariables/getExecutionDetailTabs/getDefaultDetailTab/markScheduleInvalid/createSchedule/setScheduleEnabled/toggleSchedule/deleteSchedule/listSchedules/getCronDescription/resetTasks（内部改调 runner.reset） | executionQueue/artifacts/scheduleTriggers/executionLog 回归；dashboard/schedules 路由 | COVERED |
| §10.2 裁决②生产通道适配器：runner.setChannelAdapter + resolveChannelAdapter 三级回退（live channelManager online → 生产注入 → test 注入） | runner.js: setChannelAdapter + resolveChannelAdapter 中间层；server.js: startFeishuChannel → runner.setChannelAdapter | artifacts/linkCapture/dailyDigest（test 注入兜底回归）；imRouting AC6（live channelManager 路径） | COVERED |
| §10.2 模块图无环：runner 不 import taskService；taskService 不 import schedulerService | 全部实现文件 import 边核查（grep）；schedules.js 路由承接 validateCron（E-SCHED-CRON 400 契约保持） | scheduleTriggers.test.js 006-AC1（E-SCHED-CRON 400） | COVERED |
| 兼容 shim（契约保持面）：subscribeToScheduleTriggers 旧 import 不断（REQ-SCHEDULE-010 AC3 启动不再注册；导出 no-op 兼容） | taskService.js: subscribeToScheduleTriggers = no-op（返回 undefined，不订阅） | scheduleTriggers.test.js AC1/AC2-exec/AC4/006-AC2（4 处旧调用） | COVERED（见 concerns #1） |

#### Slice 2 验证摘要

- 业务测试：executionRunnerSubmit **5/5 绿**；debugZeroPersist **3/4**（AC4 红）；scheduleDirectCall **2/4**（AC1/AC2 红）。
- 回归批次 1（executionQueue/artifacts/linkCapture/dailyDigest/executionLog/nestedExecution）：**33/33 绿**。
- 回归批次 2（subflowFailure/subflowIsolation/feishuSendNode/feishuMessageNode/imRouting）：**38/38 绿**。
- scheduleTriggers：**8/10**（AC2-payload + AC3 红 = 断言 eventBus schedule:triggered 一跳——REQ-SCHEDULE-010 本义删除，[test] 侧 slice 4 迁移）。
- flow-orchestration + scheduling-execution 全目录（41 文件）：**180/180 通过 3 失败**（3 失败全在 nestedExecutionConsolidated.test.js = slice 3 文件，含同款 fixture 缺陷，不在本切片范围）。
- 实现侧等价探针（/tmp/probe-slice2.mjs）：①正确 callFlow 契约下 debug → 200 + body 含 status/output + executions/notifications/debug-% 行零新增；②每秒 cron published → trigger=schedule 执行创建（queued + variables 注入）；③draft → 无执行 + 日志 `E-SCHED-FLOW-INVALID: Scheduled execution skipped for flow <id> (status=draft)` + schedule.error 标记 + enabled=false。

#### Slice 2 concerns（3 个红 = 测试 fixture 缺陷，非实现缺陷——同 slice 1 0e71ebe 类别，等父代理 [test] 侧修正）

1. **subscribeToScheduleTriggers 保留为 no-op 兼容 shim**（父代理清单列「删除」，但 scheduleTriggers.test.js 4 处旧调用依赖导出存在——删除会让 4 个既有用例 TypeError 红；no-op 使 AC1/AC2-exec/AC4/006-AC2 经直调路径转绿）。若父代理裁决彻底删除，需同步迁移 scheduleTriggers.test.js（[test] 侧 slice 4）。
2. **scheduleDirectCall.test.js AC1/AC2 fixture 缺陷**：`EVERY_SECOND = "* * * * *"` 为 5 段 cron（node-cron v4 每分钟 :00 触发一次，70s 探针证实仅 1 tick），而 `waitForTick` 仅 1.5s——两用例窗口各 ~1s 且相隔 ~1.6s，同一分钟边界无法同时命中，**该测试文件按现状永远无法全绿**。参照 scheduleTriggers.test.js 先例应为 6 段 `"* * * * * *"`。实现侧等价已用 6 段 cron 探针证实（AC1/AC2 全部行为符合签核）。
3. **debugZeroPersist.test.js AC4 fixture 缺陷**（同缺陷亦在 nestedExecutionConsolidated.test.js）：callFlow 节点 config 用 `{flowId, inputMapping, outputMapping}`，而 flowService 校验契约（validateCallFlowConfig）要求 `{targetFlowId, targetInputNodeId}`（E-CALLFLOW-TARGET/E-CALLFLOW-INPUT）→ PATCH 400 → nodeList 未落库 → debug 跑空 flow → output undefined（JSON 丢弃 undefined 键）。nestedExecution.test.js 先例使用 targetFlowId/targetInputNodeId。修正后 AC4（及 slice 3 文件）即绿（探针证实）。
4. scheduleTriggers.test.js AC2-payload/AC3 为**契约删除项**（eventBus schedule:triggered 一跳按 REQ-SCHEDULE-010 移除）——非缺陷，属 test-plan 既定「断言迁移」清单，slice 4 [test] 侧处理。


### Slice 3: 嵌套执行收编（REQ-FLOW-051）

状态：**complete（实现全量落地 + 业务测试 4/4 绿 + 全部回归绿）**。
实现：`src/services/executionRunner.js`（仅此一文件）——①`runOnce` 把本次捕获的 `myGeneration` 经 `makeInvokeSubflow` 绑定进 services bag，`invokeSubflowImpl` 内 `writeAllowed = () => persistChild && executionGeneration === generation`（live 求值，写点逐个门控）覆盖子执行全部写点（子行 INSERT / insertExecutionNodes / completeExecutionError / completeExecution / addExecutionLog）；②子引擎成功后（writeAllowed 时）把 `childResult.logs` 逐条 `addExecutionLog(childExecutionId, ...)` 写入子行，返回 `logs: []`（不再冒泡父行）；错误路径同理（未达出口 E-SUBFLOW-NO-OUTPUT 与 catch 冒泡均写错误日志到子行）；③`completeExecution` 的 `execution:completed` payload 追加 `parentExecutionId`/`depth`（additive，从行读取，父执行如实带 null/0，既有字段不变）。
另：`runOnce` 的 executor 装配 seam 把变量替换后的 agent prompt 并入注入 executor 的 context（`context.prompt`）——engine 只把 prompt 放 `node.config.prompt`，而本 story 测试先例约定注入 executor 经 `context.prompt` 读 prompt（executionRunner.test.js「executor 经 context.prompt 读变量」）；字面 prompt 节点（parent/child 撞名 fixture）无 {{var}} 引用，不经 runner 装配归一无法经 context.prompt 区分。仅作用于测试注入 seam，生产 agentExecutor（node.config.prompt 路径）不受影响。

#### PRD→代码 可追溯性表（Slice 3）

| PRD 意图（§10 / REQ） | 实现文件/函数 | 测试文件 | 覆盖状态 |
|---|---|---|---|
| §10.3 数据流⑤/§8 reset 竞态 + REQ-FLOW-051 AC1：子执行写点纳入父 runOnce generation 守卫（reset 中途子写全跳过，子行保持 running，recoverInterruptedExecutions 兜底） | executionRunner.js: runOnce（myGeneration 捕获）→ makeInvokeSubflow（绑定 generation）→ invokeSubflowImpl（`writeAllowed = () => persistChild && executionGeneration === generation` live 求值，5 处写点门控；行 INSERT 在引擎前落，不受影响） | nestedExecutionConsolidated.test.js AC1 | COVERED |
| §10.3 数据流⑥ persist 传播 + REQ-FLOW-050：persist:false（debug 子树）零落库语义保持（writeAllowed 含 persistChild） | executionRunner.js: invokeSubflowImpl（writeAllowed 首项 = persistChild） | debugZeroPersist.test.js AC1/AC2/AC3（回归全绿） | COVERED |
| §10.7 子日志归子行 + REQ-FLOW-051 AC2：子日志写子 execution 行（含跨 flow 同名 n1 撞名，按执行归属），返回 logs:[] 不冒泡父行；reset 中途日志也不写 | executionRunner.js: invokeSubflowImpl（成功路径逐条 addExecutionLog(childExecutionId)；错误路径 addExecutionLog 子行；返回 logs: []） | nestedExecutionConsolidated.test.js AC2 | COVERED |
| §10.7/§10.4 execution:completed 事件父子字段 + REQ-FLOW-051 AC3：payload 追加 parentExecutionId/depth（additive，父事件 null/0 如实带出，既有字段不变） | executionRunner.js: completeExecution（从行读 row.parentExecutionId/row.depth） | nestedExecutionConsolidated.test.js AC3；cardRenderer（既有消费回归） | COVERED |
| §8 深度兜底 E-FLOW-MAX-DEPTH / 未达出口 E-SUBFLOW-NO-OUTPUT / 失败冒泡 childExecutionId（REQ-FLOW-051 AC4 既有行为保持） | executionRunner.js: invokeSubflowImpl（深度检查前置不变；未达出口标 error + 冒泡；catch 附 err.childExecutionId） | nestedExecutionConsolidated.test.js AC4；nestedExecution/subflowFailure/subflowIsolation/foreachCallflow/callFlowValidation 回归 | COVERED |
| §10.2 executor 装配 + 测试 seam 契约：注入 executor 经 node.config.prompt 读节点 prompt（与生产 claudeAgentAdapter 同源；裁决⑥撤除 context.prompt 并入） | executionRunner.js: runOnce executors.agent = testAgentExecutor 直通 | nestedExecutionConsolidated.test.js AC2/AC1；executionRunner.test.js/executionRunnerReset.test.js（node.config.prompt 路径） | COVERED |

#### Slice 3 验证摘要

- 业务测试：nestedExecutionConsolidated **4/4 绿**（slice 3 前为 1/4；AC2/AC3/AC1 三个红用例全部转绿）。
- 回归批次 1（nestedExecution/subflowFailure/subflowIsolation/foreachCallflow/callFlowValidation）：**29/29 绿**。
- 回归批次 2（executorSignature/nodeRegistry/setVariables/subflowNodeTypes）：**41/41 绿**。
- 回归批次 3（executionRunner/executionRunnerReset/executionRunnerSubmit/debugZeroPersist/scheduleDirectCall）：**25/25 绿**。
- 回归批次 4（artifacts/linkCapture/dailyDigest 迁移 seam）：**13/13 绿**。
- 合计 112 用例全绿，0 失败。无需 rebuild（无原生模块变更，无 ERR_DLOPEN_FAILED）。

#### Slice 3 concerns

1. **executor 装配 seam 的 context.prompt 归一**：本 story 测试先例（executionRunner.test.js）约定注入 executor 经 `context.prompt` 读 prompt，但该先例靠 flow variables（`{{prompt}}` + `variables:{prompt}`）注入注册表；nestedExecutionConsolidated 的 fixture 用**字面 prompt**（parent/child），engine 只把替换后的 prompt 放在 `node.config.prompt`，context 无 prompt 键 → 注入 executor 的 `context.prompt` 恒为 undefined。为达成签核断言（子日志 message=child/parent），在 runner 装配 seam 把 `node.config.prompt`（引擎变量替换后）并入注入 executor 的 context。仅作用于 testAgentExecutor seam，生产路径零影响。请父代理裁决：若判定为测试 fixture 缺陷（test-gap），[test] 侧可选改为 `node.config.prompt` 读取并撤除该归一；当前实现满足契约且回归全绿。
2. **任务清单列 subflowLatestVersion.test.js 不存在**：该「子 flow 最新版本」行为（子 flow 修改后父再次执行见新 prompt）位于 nestedExecution.test.js（AC5+，本次回归 29/29 内含），无独立测试文件，未遗漏覆盖。
3. `writeAllowed` 为 live 求值而非启动时快照：初始实现按任务书字面（const 快照）导致 AC1 红（reset 后子完成写仍放行），改为写点逐个求值后 4/4 绿——与父 runOnce 检查点②/③语义一致（引擎运行期间的 reset 被拦截，行 INSERT 前落子行不受影响）。
