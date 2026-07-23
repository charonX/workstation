# ADR-008: 子流程内联同步执行 + services 注入模式

- **状态**: 已接受
- **日期**: 2026-07-23
- **相关 story**: 2026-07-23-nested-flow
- **相关 REQ**: 待结晶（嵌套子流程调用）

## 背景

workstation flow 引擎是单层 DAG 执行模型，executor 签名 `({node, context, project, projectPath, iteration})` 不持有任何 service 引用。节点类型通过插件式 executor 注册，引擎本身对节点语义无感知（control 节点 condition/foreach/while 通过 `sourcePort` 字符串匹配实现分支/循环）。

新需求要求支持「flow 作为节点被另一个 flow 同步调用」。callFlow 节点执行时需要：
1. 按 targetFlowId 从 DB 加载子 flow 定义
2. 创建子 execution 记录（带 parentExecutionId/parentNodeId/depth）
3. 递归执行子 flow
4. 持久化子 execution_nodes 并把出参返回父

这些动作是「有副作用的 service 调用」，executor 当前拿不到这些能力。

## 决策

采用**内联递归执行 + options.services 注入**模式：

1. **executor 入参扩展**：`flowEngine.run()` 的 options 新增 `services` 对象，引擎在调用 executor 时传入 `{ ..., services, currentDepth }`。现有 executor 忽略这两个字段即可，向后兼容。

2. **callFlow 节点的所有生命周期动作封装在 services.invokeSubflow 回调里**：由调用方（taskService.executeTask 或测试）注入生产/mock 实现。引擎本身对 callFlow 节点无特殊处理，和其他节点一样查 executor 调用。

3. **子 flow 内联递归执行，不走任务队列**：invokeSubflow 在当前调用栈内直接调 `flowEngine.run(subflow, {startNodeId, services, currentDepth: depth+1}, inputVars)`，阻塞等待子 flow 跑完。子 execution 行由 invokeSubflow 在执行前 INSERT（status=running），执行后 UPDATE + INSERT execution_nodes。

4. **子 flow 永远读当前版本（nodeList/edges，draft）**，不读 publishedSnapshot——符合"调最新、子 flow 改了自动生效"的产品意图。

5. **嵌套深度 8 层上限双重防护**：保存时静态 DFS 检测 + 运行时 invokeSubflow 在 currentDepth+1 > 8 时直接 throw。

## 替代方案

1. **引擎内建 callFlow 语义（特殊分支）**：引擎识别 callflow 类型节点，自己做加载/递归/持久化。拒绝——违背"引擎对节点类型无感知"的现有架构，把 service 耦合进引擎核心，测试时必须起 DB/全栈。

2. **走 taskService.createTask 异步队列**：callFlow 节点排队一个子 task，轮询等待完成。拒绝——(a) 破坏同步语义，父 flow 需要暂停-恢复机制，现有同步 while 循环模型要大改；(b) 排队引入延迟、死锁风险（队列串行时父在等子、子在父后面排队）；(c) 独立 execution 行和 parentExecutionId 关联本方案同样能实现。

3. **context._xxx shim 模式**（和 feishuSend 用 context._channelManager 一样）：把 invokeSubflow 塞进 context。拒绝——(a) context 是变量注册表，混 service 回调破坏语义；(b) context 会被序列化进 execution_nodes.inputVariables 快照（见 taskService.insertExecutionNodes），service 函数不能被序列化会产生噪音或报错。

4. **flowOutput 用特殊 status:"exit" 让引擎 break**：拒绝——破坏 executor success/error/fatal 三态约定；扫描 nodeRecords 找最后一个 flowOutput 节点（DAG 里它是叶子）已足够。

## 影响

- `flowEngine.js`：主循环 executor 调用点加 services/currentDepth 入参；run() 接受 startNodeId 跳过入度为 0 节点的寻找；applyTriggerVariableOverrides 在 startNodeId 指向特定节点时只对该节点做 override；flowinput 类型加入 TRIGGER_LIKE_NODE_TYPES。
- 新增 `flowInputExecutor.js` / `flowOutputExecutor.js` / `callFlowExecutor.js`，注册进 defaultExecutors。
- `taskService.executeTask`：构造 services.invokeSubflow 闭包（绑定 projectId、parentExecutionId、loadFlow/insertExecutionNodes 等），传入 run()。
- `db.js` migrations：executions 表加 `parentExecutionId TEXT NULL`、`parentNodeId TEXT NULL`、`depth INTEGER NOT NULL DEFAULT 0`；加 `idx_executions_parentExecutionId` 索引。老数据 depth 默认为 0（顶层），无需回填。
- `flowService`：节点校验白名单加三类型；新增 `validateSubflowCalls` 做跨 flow 校验；新增 listCallFlowCandidates / getFlowInputNodes 查询接口。
- 前端：NodePalette 加三类型；NodeConfigPanel 加对应 Fields 子组件（callFlow 含子 flow/入口下拉 + 入参映射表）；upstreamVariables 暴露 callFlow 出参；执行详情 UI 按 childExecutionId 可展开。
- **逆转成本：中高**。services 注入模式一旦确立，未来有副作用的新节点类型（如外部 API 调用、数据库写入节点）会复用该模式，改回其他模式要改 executor 签名和所有 callFlow 相关逻辑。但本身架构增益明显（可测性、插件化），逆转可能性低。

## 相关文件

- `.aiassist/stories/2026-07-23-nested-flow/tech-design.md`
- `.aiassist/stories/2026-07-23-nested-flow/prd.md`
- `src/flowEngine/flowEngine.js`、`src/flowEngine/executors/{flowInput,flowOutput,callFlow}Executor.js`
- `src/services/taskService.js`、`src/services/flowService.js`、`src/db.js`
