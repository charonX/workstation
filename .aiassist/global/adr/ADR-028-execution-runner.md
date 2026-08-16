# ADR-028：执行运行器 ExecutionRunner——一次执行的唯一入口

- 状态：已接受
- 日期：2026-08-16
- 相关 REQ：—（/improve-codebase-architecture 独立触发，无 story 绑定）

## 上下文

架构评审（2026-08-16）走查 flow 执行子系统发现：**「如何运行一次执行」的知识无属主**。

- **三处手工拼装 run options 且已漂移**：`executeTask`（taskService.js:665-668）、
  `debugFlow`（:391-395）、`invokeSubflowImpl`（:487-498）各自拼
  `{maxDepth:100, maxIterations:1000, executors, services, currentDepth}`。已实证发散：
  debug 注入合成 `debug-<uuid>` parentExecutionId（指向不存在的 execution 行）；
  invokeSubflowImpl 无 generation 守卫（reset 竞态下子写仍落已重置 DB）；
  debug 不收集产物、不写通知。
- **双失效机制重叠**：`clearExecutionQueue`（:44-59）= generation+1 + 换队列实例 +
  destroy + 5s drain 轮询；`executeTask` 另在 4 处做 generation 检查——同一「执行上下文
  已重置」语义两套机制互为补丁。
- **250ms queued 观察睡眠**（QUEUED_STATE_OBSERVATION_MS，:596）藏在 executeTask 内，
  为「createTask 后立即 GET 稳定看到 queued」而设——契约成本不可见。
- **schedule 触发经 eventBus 一跳**（schedulerService:27 → server.js:151 接线 →
  subscribeToScheduleTriggers:1118），全链唯一订阅者。
- **debug 子树落孤儿行**：debug 顶层不落库，但其 subflow 子树照落（trigger=subflow +
  不存在的合成父 id），UI 执行列表可见孤儿执行。
- **子日志冒泡写父行**：子 flow 的 `result.logs` 由父的 addExecutionLog 循环写入父
  logs 列，node id 是子 flow 的（父子可都有 "n1"）；`execution:completed` 事件 payload
  不含 parentExecutionId/depth，下游（cardRenderer）无法区分父子。已确认无契约测试
  锁定该行为。

## 决策

1. **新建 `src/services/executionRunner.js` 独立模块**：内部持有队列实例 +
   generation；暴露 `submit()` / `runOnce()` / `reset()` 三接口。消费者直调，
   taskService 保留 `executeTask`/`createTask` 向后兼容转发（旧调用方与测试不破）。
2. **submit = 入队触发唯一入口**：容量检查（E-QUEUE-FULL 语义不变）+ 构建 execution
   对象 + 落 queued 行 + 入队 + 250ms 观察窗（**显式接口语义**：入队触发专属，
   debug/subflow 天然不走）+ 返回 `{id, executionId, queuePosition}`（形状不变）。
3. **runOnce = 一次运行的执行器**：描述符参数化 `{trigger, persist, artifacts,
   notify}`；generation 守卫（快照 + 中止点检查）；options/executors/services 拼装；
   状态迁移与写入策略（nodes/logs/artifacts/通知）。debug 与生产同一条代码路径。
4. **debug = runOnce + 描述符**（trigger:"debug"，persist:false 传播到子树）：
   全链路零落库，孤儿行不再产生；合成 `debug-<uuid>` parentExecutionId 整体废止。
5. **reset() 单一失效机制**：generation+1 + 队列 destroy + **有界等待**（20ms 轮询 +
   5s 上限，可 await；在飞项到达守卫点完成收尾写后才返回，保证不写已重置 DB）。
   替代 clearExecutionQueue 的双机制。
6. **schedule 触发直调 submit**：删 eventBus 一跳与 server.js:151 接线、
   subscribeToScheduleTriggers（唯一订阅者、进程内单例；"未来多消费者"是假设性需求，
   One adapter = hypothetical seam 原则）。
7. **嵌套执行全修复**：子执行走 runOnce（generation 守卫覆盖）；子日志写子 execution
   行（消除 n1 撞名误导）；`execution:completed` 事件补 parentExecutionId/depth
   （additive，不影响既有消费）。ADRD-008 的 services-bag seam（invokeSubflow 注入）
   维持。
8. **测试 seam 迁入 runner**：`setAgentExecutorForTests`/`setChannelAdapterForTests`
   迁入 runner（约 4 个测试文件改 import：artifacts/linkCapture/dailyDigest/
   nestedExecution）；行为契约不变。

## 后果

- 一次执行的生命周期知识集中在 runner 一处：三入口行为对齐，debug 与生产同路径，
  子流程获得与顶层相同的守卫。
- 契约保留：createTask/executeTask 转发别名、E-QUEUE-FULL 503 语义、queuePosition
  返回、schedule published 双校验语义（入队时 + 出队执行时）均在 runner 内单点表达。
- 数据形态变化：子日志从父 logs 列移出（需回归 nestedExecution 测试与执行详情 UI）；
  execution:completed 事件 payload 追加字段（additive）。
- 测试策略：replace, don't layer——runner 的 interface 测试就位后，旧的
  generation×destroy 竞态、debug 嵌套路径、adapter 解析优先级相关测试改挂 runner
  的 seam；不再透过模块级变量 + dynamic import 侧测。
- 反模式警示：context._xxx shim（ADR-008 否决模式）在本域禁止新增；
  execution:* 事件与直调的选用按「多消费者与否」裁决，不再按历史偶然。
